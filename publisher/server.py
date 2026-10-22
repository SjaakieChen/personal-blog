"""Private, Tailscale-authenticated publishing desk. No GitHub token reaches the browser."""
import base64
import hashlib
from html import escape, unescape
from html.parser import HTMLParser
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, urlencode, unquote

REPO = 'SjaakieChen/personal-blog'
PUBLIC = 'https://sjaakiechen.github.io/personal-blog'
ROOT = Path(__file__).resolve().parent.parent
STATE = Path(os.environ.get('BLOG_STATE', str(Path.home()/'.local/state/blog-publisher')))
ORIGIN = os.environ.get('BLOG_ORIGIN', 'https://yoga-jiaqi.taile0df21.ts.net:8446')
OWNER = os.environ.get('BLOG_OWNER', '')
ENV = {**os.environ, 'GH_CONFIG_DIR': str(STATE/'github'), 'GH_BROWSER': '/bin/true', 'BROWSER': '/bin/true'}
lock = threading.Lock()
login_process = None
login_output = ''
login_result = ''
identity = None
source_cache = {}
entry_cache = {}
index_lock = threading.Lock()
draft_lock = threading.Lock()
PRIVATE_MEDIA_PREFIX = '/assets/evidence/drafts/'
PRIVATE_DEMO_PREFIX = PRIVATE_MEDIA_PREFIX+'demos/'
DEMO_TYPES = {'index.html': 'text/html; charset=utf-8', 'demo.js': 'application/javascript; charset=utf-8', 'demo.css': 'text/css; charset=utf-8'}
MEDIA_TYPES = {'.pdf': 'application/pdf', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}


def media_manifest():
    public = json.loads((ROOT/'_data/evidence.json').read_text(encoding='utf-8'))
    private_path = STATE/'media.json'
    private = json.loads(private_path.read_text(encoding='utf-8')) if private_path.exists() else {}
    if not isinstance(public, dict) or not isinstance(private, dict):
        raise ValueError('Invalid media metadata.')
    combined = {**public, **private}
    for route, entry in private.items():
        live = public.get(route)
        if (isinstance(entry, dict) and isinstance(live, dict)
                and entry.get('pdf', '').startswith(PRIVATE_MEDIA_PREFIX)
                and live.get('pdf') == entry['pdf'].replace(PRIVATE_MEDIA_PREFIX, '/assets/evidence/', 1)):
            # Keep retained private previews usable while also recognizing the
            # public PDF link returned by Publish. Originals stay untouched.
            combined[route] = {**entry, 'download_url': PUBLIC+live['pdf']}
    return combined


def private_media_file(path):
    if not path.startswith(PRIVATE_MEDIA_PREFIX):
        return None
    relative = path[len(PRIVATE_MEDIA_PREFIX):]
    if not re.fullmatch(r'[a-zA-Z0-9_-]+/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:pdf|webp|png|jpg|jpeg)', relative):
        return None
    state = STATE.resolve()
    root = (state/'media').resolve()
    file = (root/relative).resolve()
    return file if state in root.parents and root in file.parents and file.is_file() else None


def private_demo_file(path):
    if not path.startswith(PRIVATE_DEMO_PREFIX):
        return None
    relative = path[len(PRIVATE_DEMO_PREFIX):]
    if not re.fullmatch(r'[a-zA-Z0-9_-]+/(?:index\.html|demo\.js|demo\.css)', relative):
        return None
    state = STATE.resolve()
    root = (state/'demos').resolve()
    file = (root/relative).resolve()
    return file if state in root.parents and root in file.parents and file.is_file() else None


def read_drafts():
    path = STATE/'drafts.json'
    if not path.exists():
        return {'revision': 0, 'drafts': [], 'deleted': []}
    return json.loads(path.read_text(encoding='utf-8'))


def write_drafts(data):
    if not isinstance(data, dict) or type(data.get('revision')) is not int:
        raise ValueError('A draft revision is required.')
    drafts, deleted = data.get('drafts'), data.get('deleted')
    if not isinstance(drafts, list) or not isinstance(deleted, list) or not all(isinstance(i, str) for i in deleted):
        raise ValueError('Invalid draft collection.')
    for d in drafts:
        if not isinstance(d, dict) or not all(isinstance(d.get(f), str) for f in ('id', 'title', 'quote')) or d.get('kind') not in ('post', 'page') or not isinstance(d.get('doc'), list):
            raise ValueError('Invalid draft.')
        for block in d['doc']:
            if not isinstance(block, dict) or not isinstance(block.get('runs'), list) or not all(isinstance(r, dict) and isinstance(r.get('text'), str) for r in block['runs']):
                raise ValueError('Invalid draft text.')
    if len({d['id'] for d in drafts}) != len(drafts):
        raise ValueError('Duplicate draft IDs.')
    with draft_lock:
        previous = read_drafts()
        if data['revision'] != previous['revision']:
            error = RuntimeError('Drafts changed on another device. Sync again.'); error.status = 409
            raise error
        removed = list(dict.fromkeys(previous['deleted'] + deleted))
        next_state = {'revision': previous['revision'], 'drafts': [d for d in drafts if d['id'] not in removed], 'deleted': removed}
        if next_state == previous:
            return previous
        next_state['revision'] += 1
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        def atomic_write(name, value):
            temp = STATE/(name+'.tmp')
            with temp.open('w', encoding='utf-8') as stream:
                os.chmod(temp, 0o600)
                json.dump(value, stream, ensure_ascii=False)
                stream.flush(); os.fsync(stream.fileno())
            os.replace(temp, STATE/name)
        atomic_write('drafts.previous.json', previous)
        atomic_write('drafts.json', next_state)
        return next_state


def valid_path(path):
    return isinstance(path, str) and re.fullmatch(r'(?:_posts|pages)/[a-zA-Z0-9_-]+\.md', path) is not None


def parse_source(content):
    """Read the writer's one-line JSON front matter without executing YAML."""
    parts = content.split('---\n', 2)
    if len(parts) != 3 or parts[0]:
        raise ValueError('Invalid document header.')
    fields = {}
    for line in parts[1].splitlines():
        name, sep, value = line.partition(':')
        if sep:
            value = value.strip()
            try:
                fields[name] = json.loads(value)
            except ValueError:
                fields[name] = value.strip("'\"")
    return fields, parts[2].strip()


def repository_sources():
    revision = gh_api(f'repos/{REPO}/git/ref/heads/main')['object']['sha']
    tree = gh_api(f'repos/{REPO}/git/trees/{revision}?recursive=1')
    if tree.get('truncated'):
        raise RuntimeError('GitHub returned an incomplete post list. Try again before publishing.')
    entries = []
    for item in tree['tree']:
        if item['type'] != 'blob' or not valid_path(item['path']):
            continue
        sha = item['sha']
        if sha not in source_cache:
            blob = gh_api(f'repos/{REPO}/git/blobs/{sha}')
            source_cache[sha] = parse_source(base64.b64decode(blob['content']).decode('utf-8'))
        fields, html = source_cache[sha]
        entries.append((item['path'], sha, fields, html))
    return revision, entries


def ensure_unique_title(path, content, entries=None):
    fields, _ = parse_source(content)
    def normalized(value):
        return ' '.join(unicodedata.normalize('NFKC', str(value)).casefold().split())
    title = normalized(fields.get('title', ''))
    if not title:
        raise ValueError('Add a title before publishing.')
    if entries is None:
        _, entries = repository_sources()
    for other, _, meta, _ in entries:
        if other != path and other.split('/')[0] == path.split('/')[0] and normalized(meta.get('title', '')) == title:
            error = RuntimeError('A post or archive entry with this title already exists. Open it to edit, or choose a different title.')
            error.status = 409
            raise error


def writing_index():
    # Read GitHub, not a Pages build that may still include a deleted post.
    with index_lock:
        revision, entries = repository_sources()
        result = {'posts': [], 'pages': []}
        for path, sha, fields, html in entries:
            cache_key = (path, sha)
            if cache_key not in entry_cache:
                previous_paths = fields.get('previous_paths', [])
                if not isinstance(previous_paths, list) or any(not valid_path(old) or old == path for old in previous_paths):
                    raise ValueError('Invalid previous publication paths.')
                previous_paths = list(dict.fromkeys(previous_paths))
                previous_sha = fields.get('previous_source_sha')
                if previous_sha is not None and (not isinstance(previous_sha, str) or not re.fullmatch(r'[a-f0-9]{40}', previous_sha)):
                    raise ValueError('Invalid previous publication revision.')

                def path_history(history_path, at_revision):
                    commits = []
                    page = 1
                    while True:
                        query = urlencode({'path': history_path, 'sha': at_revision, 'per_page': 100, 'page': page})
                        batch = gh_api(f'repos/{REPO}/commits?{query}')
                        commits.extend(batch)
                        if len(batch) < 100:
                            break
                        page += 1
                    if not commits:
                        raise RuntimeError('Could not load publication dates from GitHub.')
                    return commits

                history = path_history(path, revision)
                # The commits API does not follow renames. Read former paths as
                # they stood at the move, so later reuse cannot alter this post.
                moved_at = history[-1].get('sha', revision)
                for old_path in previous_paths:
                    history.extend(path_history(old_path, moved_at))
                unique_history = {item.get('sha') or json.dumps(item, sort_keys=True): item for item in history}
                dates = [item['commit']['committer']['date'] for item in unique_history.values()]
                newest, oldest = max(dates), min(dates)
                kind = 'post' if path.startswith('_posts/') else 'page'
                slug = re.sub(r'^\d{4}-\d{2}-\d{2}-', '', Path(path).stem)
                permalink = fields.get('permalink') or '/posts/'+slug+'/'
                entry_cache[cache_key] = {
                    'path': path, 'sourceSha': sha, 'kind': kind,
                    'title': fields.get('title', ''), 'quote': fields.get('quote', ''),
                    'html': html, 'date': fields.get('date', oldest),
                    'publishedAt': oldest, 'editedAt': newest if len(unique_history) > 1 else None,
                    'url': '/personal-blog'+permalink, 'permalink': permalink,
                    'previousPaths': previous_paths, 'previousSourceSha': previous_sha,
                    'references': fields.get('references', []), 'notes': fields.get('notes', []),
                    'referenceKey': fields.get('reference_key'),
                    'quoteReference': fields.get('quote_reference'), 'quoteLocator': fields.get('quote_locator')
                }
            result['posts' if path.startswith('_posts/') else 'pages'].append(entry_cache[cache_key])
        for entries in result.values():
            entries.sort(key=lambda entry: entry['publishedAt'], reverse=True)
        return result


def gh_api(path, method='GET', payload=None):
    args = ['gh', 'api', '-X', method, '-H', 'Accept: application/vnd.github+json', path]
    if payload is not None:
        args += ['--input', '-']
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, env=ENV, timeout=40)
    if result.returncode:
        # Do not return CLI output, which can include authentication diagnostics.
        error = RuntimeError('GitHub request failed. Check the connection and try again.')
        if 'HTTP 404' in result.stderr:
            error.status = 404
        elif 'HTTP 409' in result.stderr or 'HTTP 422' in result.stderr:
            error.status = 409
        elif 'HTTP 401' in result.stderr:
            error.status = 401
        else:
            error.status = 502
        raise error
    return json.loads(result.stdout)


def connected(force=False):
    global identity
    if not force and identity and time.time()-identity[1] < 120:
        return identity[0]
    try:
        user = gh_api('user')['login']
        if user.lower() != 'sjaakiechen':
            return None
        identity = (user, time.time())
        return user
    except (RuntimeError, subprocess.TimeoutExpired, KeyError):
        return None


def read_login(process):
    global login_output, login_result, identity
    # Keep only the short-lived device code; never persist or expose process output.
    for line in process.stdout:
        match = re.search(r'\b[A-Z0-9]{4}-[A-Z0-9]{4}\b', line)
        if match:
            login_output = match.group(0)
    process.wait()
    identity = None
    login_result = '' if connected() else 'Sign-in did not complete for SjaakieChen. Try again.'
    login_output = ''


def prepare_media_publication(content):
    """Resolve only links in this submitted document, before any GitHub write."""
    marker = lambda value: PRIVATE_MEDIA_PREFIX in unquote(unescape(value)).replace('\\/', '/')
    if not marker(content):
        return None
    assets, replacements, selected_pdfs = {}, {}, set()

    def attachment(value):
        if not isinstance(value, str) or not marker(value):
            return value
        original = value
        normalized = unescape(value).replace('\\/', '/')
        image_fragment = normalized.startswith('#media-image')
        parsed = urlsplit(unquote(normalized[len('#media-image'):]) if image_fragment else normalized)
        if not image_fragment and not parsed.scheme and not parsed.netloc:
            parsed = urlsplit(unquote(normalized))
        path = unquote(parsed.path)
        origin = urlsplit(ORIGIN)
        if (not path.startswith(PRIVATE_MEDIA_PREFIX) or parsed.username or parsed.password
                or (parsed.scheme or parsed.netloc) and (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc)):
            raise ValueError('A private attachment link is invalid. Choose the retained PDF or image again before publishing.')
        if path.startswith(PRIVATE_DEMO_PREFIX):
            raise ValueError('Interactive demos cannot be published from the writing desk yet. Remove the demo link or keep this draft private.')
        if image_fragment and (Path(path).suffix not in MEDIA_TYPES or Path(path).suffix == '.pdf' or parsed.query or parsed.fragment):
            raise ValueError('This picture link is invalid. Choose a retained image before publishing.')
        file = private_media_file(path)
        if file is None:
            raise ValueError('A referenced PDF or image is missing or unsupported. Restore the attachment before publishing; your draft is saved.')
        public_path = path.replace(PRIVATE_MEDIA_PREFIX, '/assets/evidence/', 1)
        if public_path not in assets:
            if file.stat().st_size > 25_000_000:
                raise ValueError('A referenced attachment is larger than 25 MB. Use a smaller publication copy; your draft is saved.')
            raw = file.read_bytes()
            if len(raw) > 25_000_000:
                raise ValueError('A referenced attachment is larger than 25 MB. Use a smaller publication copy; your draft is saved.')
            assets[public_path.lstrip('/')] = raw
            if len(assets) > 50 or sum(map(len, assets.values())) > 75_000_000:
                raise ValueError('This draft has too many or too-large attachments. Publish a smaller collection; your draft is saved.')
        if path.endswith('.pdf'):
            selected_pdfs.add(path)
        public_url = '#media-image'+public_path if image_fragment else PUBLIC+public_path
        if not image_fragment:
            public_url += ('?'+parsed.query if parsed.query else '')+('#'+parsed.fragment if parsed.fragment else '')
        replacements[original] = public_url
        return public_url

    # Writer front matter contains JSON references. Only URL fields are changed;
    # prose, titles, locators and unrelated metadata retain their original bytes.
    parts = content.split('---\n', 2)
    if len(parts) != 3 or parts[0]:
        raise ValueError('Invalid document header.')
    lines = parts[1].splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.startswith('references:'):
            try:
                references = json.loads(line.partition(':')[2])
                if not isinstance(references, list):
                    raise ValueError('The reference list is invalid. Your draft is saved.')
                changed = False
                for reference in references:
                    if not isinstance(reference, dict):
                        raise ValueError('A reference is invalid. Your draft is saved.')
                    for key in ('url', 'savedUrl'):
                        value = reference.get(key)
                        replacement = attachment(value)
                        if replacement != value:
                            reference[key] = replacement; changed = True
                if changed:
                    lines[index] = 'references: '+json.dumps(references, ensure_ascii=False, separators=(',', ':'))+('\n' if line.endswith('\n') else '')
            except (TypeError, json.JSONDecodeError):
                raise ValueError('A reference is invalid. Check its PDF or image link before publishing.') from None

    html = parts[2]
    line_offsets = [0]+[match.end() for match in re.finditer('\n', html)]
    edits = []

    class AttachmentLinks(HTMLParser):
        def handle_starttag(self, tag, attributes):
            wanted = {'a': 'href', 'img': 'src'}.get(tag)
            if not wanted:
                return
            raw = self.get_starttag_text()
            start = re.match(r'<[^\s/>]+', raw).end()
            changes = []
            # Tokenize whole attribute values, so a quoted title containing an
            # HTML example cannot masquerade as another link attribute.
            for token in re.finditer(r'([^\s=<>/]+)(?:\s*=\s*("[^"]*"|\x27[^\x27]*\x27|[^\s>]+))?', raw[start:]):
                if token.group(1).lower() != wanted or token.group(2) is None:
                    continue
                original = token.group(2)
                quoted = original[0] in '\"\x27'
                value = unescape(original[1:-1] if quoted else original)
                replacement = attachment(value)
                if replacement != value:
                    quote = original[0] if quoted else '"'
                    changes.append((start+token.start(2), start+token.end(2), quote+escape(replacement, quote=True)+quote))
            if changes:
                changed = raw
                for begin, end, replacement in reversed(changes):
                    changed = changed[:begin]+replacement+changed[end:]
                line, column = self.getpos()
                begin = line_offsets[line-1]+column
                edits.append((begin, begin+len(raw), changed))

    parser = AttachmentLinks(convert_charrefs=False)
    parser.feed(html); parser.close()
    for begin, end, replacement in reversed(edits):
        html = html[:begin]+replacement+html[end:]
    rewritten = '---\n'+''.join(lines)+'---\n'+html
    if not assets:
        return None
    draft_replacements = dict(replacements)
    private_path = STATE/'media.json'
    private = json.loads(private_path.read_text(encoding='utf-8')) if private_path.exists() else {}
    if not isinstance(private, dict):
        raise ValueError('Private PDF preview metadata is invalid. Your draft is saved.')
    updates = {}
    for route, entry in private.items():
        if not isinstance(entry, dict) or entry.get('pdf') not in selected_pdfs:
            continue
        if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*', route) or not isinstance(entry.get('title'), str):
            raise ValueError('Private PDF preview metadata is invalid. Your draft is saved.')
        previews = entry.get('previews', [])
        pages = entry.get('preview_pages', list(range(1, len(previews)+1))) if isinstance(previews, list) else None
        total = entry.get('total_pages')
        if (not isinstance(previews, list) or not all(isinstance(p, str) and p.startswith(PRIVATE_MEDIA_PREFIX) and Path(p).suffix in MEDIA_TYPES and not p.endswith('.pdf') for p in previews)
                or not isinstance(pages, list) or len(pages) != len(previews)
                or not all(type(p) is int and p > 0 for p in pages) or len(set(pages)) != len(pages)
                or total is not None and (type(total) is not int or total < max(pages, default=1))):
            raise ValueError('Private PDF preview metadata is invalid. Your draft is saved.')
        pdf = entry['pdf'].replace(PRIVATE_MEDIA_PREFIX, '/assets/evidence/', 1)
        public_entry = {'pdf': pdf, 'public_pdf': PUBLIC+pdf, 'title': entry['title']}
        if previews:
            public_entry['previews'] = []
            for preview in previews:
                attachment(preview)
                public_entry['previews'].append(preview.replace(PRIVATE_MEDIA_PREFIX, '/assets/evidence/', 1))
            if 'preview_pages' in entry:
                public_entry['preview_pages'] = pages
        if total is not None:
            public_entry['total_pages'] = total
        updates[route] = public_entry
    # Preview dependencies are not draft links, so do not ask the client to
    # transform arbitrary text that happens to equal one of their file paths.
    return {'content': rewritten, 'assets': assets, 'manifest': updates, 'linkReplacements': draft_replacements}


def git_blob_sha(raw):
    return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()


def cache_published_media(assets, manifest):
    """Best-effort preview cache after success; never alter private originals."""
    files = dict(assets)
    if manifest is not None:
        files['_data/evidence.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode()
    try:
        root = ROOT.resolve()
        for path, raw in files.items():
            destination = (root/path).resolve()
            if root not in destination.parents:
                raise OSError('Invalid cache path')
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name+'.publish-tmp')
            temporary.write_bytes(raw)
            os.replace(temporary, destination)
        return True
    except OSError:
        return False


def publish_with_media(data, prepared):
    path, content = data['path'], prepared['content']
    prefix = f'repos/{REPO}/git/'
    head = gh_api(prefix+'ref/heads/main')['object']['sha']
    parent = gh_api(prefix+'commits/'+head)
    tree = gh_api(prefix+'trees/'+parent['tree']['sha']+'?recursive=1')
    if tree.get('truncated'):
        raise RuntimeError('GitHub returned an incomplete file list. Your draft is saved; try publishing again.')
    entries = {item['path']: item for item in tree['tree']}
    page_bytes = content.encode('utf-8')
    page_sha = git_blob_sha(page_bytes)
    existing = entries.get(path)
    if existing and (existing.get('type') != 'blob' or existing.get('mode') != '100644' or existing['sha'] != page_sha and data.get('baseSha') != existing['sha']):
        error = RuntimeError('This file already exists or changed elsewhere. Reopen the published version before updating it; your draft is still saved.')
        error.status = 409; raise error
    if not existing and data.get('baseSha'):
        error = RuntimeError('The published file was removed. Your draft is still saved; reload the published list before retrying.')
        error.status = 409; raise error
    sources = []
    for item in entries.values():
        if item['type'] == 'blob' and valid_path(item['path']):
            sha = item['sha']
            if sha not in source_cache:
                blob = gh_api(prefix+'blobs/'+sha)
                source_cache[sha] = parse_source(base64.b64decode(blob['content']).decode('utf-8'))
            fields, html = source_cache[sha]
            sources.append((item['path'], sha, fields, html))
    ensure_unique_title(path, content, sources)
    files = {path: page_bytes, **prepared['assets']}
    for asset, raw in prepared['assets'].items():
        old = entries.get(asset)
        if old and (old.get('mode') != '100644' or old.get('type') != 'blob' or old['sha'] != git_blob_sha(raw)):
            error = RuntimeError('A public attachment at this address has different contents. Give the new attachment a different filename before publishing.')
            error.status = 409; raise error
    manifest = None
    if prepared['manifest']:
        old = entries.get('_data/evidence.json')
        if old and (old.get('type') != 'blob' or old.get('mode') != '100644'):
            raise ValueError('The public PDF preview metadata is invalid. Your draft is saved.')
        manifest = json.loads(base64.b64decode(gh_api(prefix+'blobs/'+old['sha'])['content']).decode('utf-8')) if old else {}
        if not isinstance(manifest, dict):
            raise ValueError('The public PDF preview metadata is invalid. Your draft is saved.')
        for route, entry in prepared['manifest'].items():
            if route in manifest and (not isinstance(manifest[route], dict) or manifest[route].get('pdf') != entry['pdf']):
                error = RuntimeError('This archive address already has a different PDF. Choose a different archive address before publishing.')
                error.status = 409; raise error
            manifest[route] = entry
        files['_data/evidence.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode()
    changes = {name: raw for name, raw in files.items() if entries.get(name, {}).get('sha') != git_blob_sha(raw)}
    result = {'sha': page_sha, 'unchanged': not changes, 'linkReplacements': prepared['linkReplacements'], 'mediaPublished': True}
    if changes:
        new_tree = []
        for name, raw in sorted(changes.items()):
            blob = gh_api(prefix+'blobs', 'POST', {'content': base64.b64encode(raw).decode(), 'encoding': 'base64'})
            if blob['sha'] != git_blob_sha(raw):
                raise RuntimeError('GitHub did not confirm an attachment correctly. Your draft is saved; try publishing again.')
            new_tree.append({'path': name, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        created_tree = gh_api(prefix+'trees', 'POST', {'base_tree': parent['tree']['sha'], 'tree': new_tree})
        commit = gh_api(prefix+'commits', 'POST', {'message': ('Update ' if existing else 'Publish ')+path, 'tree': created_tree['sha'], 'parents': [head]})
        try:
            gh_api(prefix+'refs/heads/main', 'PATCH', {'sha': commit['sha'], 'force': False})
        except RuntimeError as error:
            if getattr(error, 'status', 0) == 409:
                conflict = RuntimeError('The blog changed while this publication was being prepared. Nothing was overwritten. Sync and try Publish again; your draft is saved.')
                conflict.status = 409; raise conflict from None
            raise
        result.update(commit=commit['sha'], time=commit['committer']['date'])
        with index_lock:
            entry_cache.clear()
    if not cache_published_media(prepared['assets'], manifest):
        result['previewRefreshNeeded'] = True
    return result


def publish(data):
    path, content = data.get('path'), data.get('content')
    if not valid_path(path) or not isinstance(content, str) or not content.startswith('---\n') or len(content.encode()) > 1_000_000:
        raise ValueError('Invalid post or archive entry.')
    prepared = prepare_media_publication(content)
    if prepared is not None:
        return publish_with_media(data, prepared)
    base_sha = data.get('baseSha')
    endpoint = f'repos/{REPO}/contents/{path}'
    try:
        existing = gh_api(endpoint+'?ref=main')
    except RuntimeError as error:
        if getattr(error, 'status', 0) != 404:
            raise
        existing = None
    if existing:
        old = base64.b64decode(existing['content']).decode('utf-8')
        if old == content:
            return {'sha': existing['sha'], 'unchanged': True}
        if not base_sha or base_sha != existing['sha']:
            error = RuntimeError('This file already exists or changed elsewhere. Reopen the published version before updating it; your draft is still saved.')
            error.status = 409
            raise error
    elif base_sha:
        error = RuntimeError('The published file was removed. Your draft is still saved; reload the published list before retrying.')
        error.status = 409
        raise error
    ensure_unique_title(path, content)
    payload = {'message': ('Update ' if existing else 'Publish ')+path,
               'content': base64.b64encode(content.encode('utf-8')).decode(), 'branch': 'main'}
    if existing:
        payload['sha'] = existing['sha']
    result = gh_api(endpoint, 'PUT', payload)
    with index_lock:
        entry_cache.clear()
    return {'sha': result['content']['sha'], 'commit': result['commit']['sha'],
            'time': result['commit']['committer']['date'], 'unchanged': False}


def delete_entry(data):
    path, base_sha = data.get('path'), data.get('baseSha')
    if not valid_path(path) or not isinstance(base_sha, str) or not re.fullmatch(r'[a-f0-9]{40}', base_sha):
        raise ValueError('Select a published post or archive entry before deleting.')
    endpoint = f'repos/{REPO}/contents/{path}'
    try:
        existing = gh_api(endpoint+'?ref=main')
    except RuntimeError as error:
        if getattr(error, 'status', 0) == 404:
            return {'alreadyRemoved': True}
        raise
    if existing['sha'] != base_sha:
        error = RuntimeError('This post changed elsewhere. Reopen its latest published version before deleting. Your draft is still saved.')
        error.status = 409
        raise error
    result = gh_api(endpoint, 'DELETE', {'message': 'Remove '+path, 'sha': base_sha, 'branch': 'main'})
    with index_lock:
        entry_cache.clear()
    return {'commit': result['commit']['sha'], 'alreadyRemoved': False}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log auth codes, post contents, or request query strings.

    def send(self, status, body, content_type='application/json; charset=utf-8', filename=None, demo=False):
        raw = json.dumps(body).encode() if content_type.startswith('application/json') else body
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        if filename is not None:
            self.send_header('Content-Disposition', 'inline; filename="'+filename+'"')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        policy = (f"sandbox allow-scripts; default-src 'none'; script-src {ORIGIN}; style-src {ORIGIN}; img-src {ORIGIN} data:; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'" if demo else
                  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header('Content-Security-Policy', policy)
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self):
        # The listener is loopback only. Tailscale Serve supplies authenticated identity.
        return bool(OWNER) and self.headers.get('Tailscale-User-Login', '').lower() == OWNER.lower() and self.headers.get('Host') == urlsplit(ORIGIN).netloc

    def do_GET(self):
        if not self.allowed():
            return self.send(403, {'error': 'Open the private desk through your own Tailscale account.'})
        path = urlsplit(self.path).path
        try:
            if path == '/api/session':
                user = connected(force=parse_qs(urlsplit(self.path).query).get('fresh') == ['1'])
                return self.send(200, {'connected': bool(user), 'login': user, 'code': login_output,
                                       'verificationUrl': 'https://github.com/login/device', 'error': login_result})
            if path == '/api/drafts':
                with draft_lock:
                    return self.send(200, read_drafts())
            if path == '/writing-index.json':
                return self.send(200, writing_index())
            if path == '/assets/evidence/media.json':
                return self.send(200, media_manifest())
            if path.startswith(PRIVATE_DEMO_PREFIX):
                file = private_demo_file(path)
                if file is None:
                    return self.send(404, {'error': 'Not found.'})
                return self.send(200, file.read_bytes(), DEMO_TYPES[file.name], demo=True)
            if path.startswith(PRIVATE_MEDIA_PREFIX):
                file = private_media_file(path)
                if file is None:
                    return self.send(404, {'error': 'Not found.'})
                return self.send(200, file.read_bytes(), MEDIA_TYPES[file.suffix], filename=file.name)
            if path == '/api/deployment':
                commit = parse_qs(urlsplit(self.path).query).get('commit', [''])[0]
                if not re.fullmatch(r'[a-f0-9]{40}', commit):
                    return self.send(400, {'error': 'Invalid commit.'})
                data = gh_api(f'repos/{REPO}/actions/workflows/pages.yml/runs?head_sha={commit}&per_page=1')
                runs = data.get('workflow_runs', [])
                run = runs[0] if runs else {}
                return self.send(200, {'status': run.get('status', 'queued'), 'conclusion': run.get('conclusion')})
            if path in ('/', '/write/'):
                html = (ROOT/'write.html').read_text(encoding='utf-8')
                html = re.sub(r'^---.*?---\s*', '', html, count=1, flags=re.S)
                html = re.sub(r"{{ '([^']+)' \| relative_url }}", r'\1', html)
                html = re.sub(r'{{.*?}}', 'private', html)
                html = html.replace('data-index="/writing-index.json"', 'data-index="/writing-index.json" data-private-desk="true"')
                html = html.replace('<a href="/">', '<a href="'+PUBLIC+'/">')
                return self.send(200, html.encode(), 'text/html; charset=utf-8')
            if path == '/styles.css' or re.fullmatch(r'/assets/[a-zA-Z0-9_./-]+', path):
                file = (ROOT/path.lstrip('/')).resolve()
                if ROOT.resolve() in file.parents and file.is_file() and file.suffix in ('.css', '.js', '.woff2', '.webp', '.png', '.jpg', '.jpeg'):
                    return self.send(200, file.read_bytes(), mimetypes.guess_type(file)[0] or 'application/octet-stream')
            return self.send(404, {'error': 'Not found.'})
        except Exception:
            return self.send(502, {'error': 'Could not reach GitHub. Your local drafts are safe; try again.'})

    def do_POST(self):
        global login_process, login_output, login_result
        if not self.allowed() or self.headers.get('Origin') != ORIGIN or self.headers.get('Content-Type') != 'application/json':
            return self.send(403, {'error': 'Request not allowed.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= (10_000_000 if self.path == '/api/drafts' else 2_000_000):
                return self.send(413, {'error': 'Post too large.'})
            data = json.loads(self.rfile.read(length))
            if self.path == '/api/drafts':
                return self.send(200, write_drafts(data))
            if self.path == '/api/auth/start':
                with lock:
                    if not login_process or login_process.poll() is not None:
                        login_output = login_result = ''
                        login_process = subprocess.Popen(['gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--insecure-storage'], env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                        threading.Thread(target=read_login, args=(login_process,), daemon=True).start()
                return self.send(200, {'started': True})
            if self.path in ('/api/publish', '/api/delete'):
                if not connected():
                    return self.send(401, {'error': 'Sign in to GitHub first.'})
                with lock:
                    result = publish(data) if self.path == '/api/publish' else delete_entry(data)
                return self.send(200, result)
            return self.send(404, {'error': 'Not found.'})
        except ValueError as error:
            return self.send(400, {'error': str(error)})
        except RuntimeError as error:
            return self.send(getattr(error, 'status', 502), {'error': str(error)})
        except Exception:
            return self.send(502, {'error': 'Publishing could not be confirmed. Your draft is saved; retry to check whether GitHub received it.'})


if __name__ == '__main__':
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    (STATE/'github').mkdir(exist_ok=True, mode=0o700)
    (STATE/'media').mkdir(exist_ok=True, mode=0o700)
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('BLOG_PORT', '8767'))), Handler).serve_forever()
