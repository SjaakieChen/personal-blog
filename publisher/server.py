"""Private, Tailscale-authenticated publishing desk. No GitHub token reaches the browser."""
import base64
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from urllib.request import urlopen

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


def valid_path(path):
    return isinstance(path, str) and re.fullmatch(r'(?:_posts|pages)/[a-zA-Z0-9_-]+\.md', path) is not None


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


def connected():
    global identity
    if identity and time.time()-identity[1] < 120:
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


def publish(data):
    path, content = data.get('path'), data.get('content')
    if not valid_path(path) or not isinstance(content, str) or not content.startswith('---\n') or len(content.encode()) > 1_000_000:
        raise ValueError('Invalid post or reference page.')
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
    payload = {'message': ('Update ' if existing else 'Publish ')+path,
               'content': base64.b64encode(content.encode('utf-8')).decode(), 'branch': 'main'}
    if existing:
        payload['sha'] = existing['sha']
    result = gh_api(endpoint, 'PUT', payload)
    return {'sha': result['content']['sha'], 'commit': result['commit']['sha'],
            'time': result['commit']['committer']['date'], 'unchanged': False}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log auth codes, post contents, or request query strings.

    def send(self, status, body, content_type='application/json; charset=utf-8'):
        raw = json.dumps(body).encode() if content_type.startswith('application/json') else body
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
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
                user = connected()
                return self.send(200, {'connected': bool(user), 'login': user, 'code': login_output,
                                       'verificationUrl': 'https://github.com/login/device', 'error': login_result})
            if path == '/writing-index.json':
                with urlopen(PUBLIC+'/writing-index.json?fresh='+str(time.time_ns()), timeout=20) as response:
                    data = json.load(response)
                return self.send(200, data)
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
                if ROOT.resolve() in file.parents and file.is_file() and file.suffix in ('.css', '.js', '.woff2'):
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
            if not 0 <= length <= 2_000_000:
                return self.send(413, {'error': 'Post too large.'})
            data = json.loads(self.rfile.read(length))
            if self.path == '/api/auth/start':
                with lock:
                    if not login_process or login_process.poll() is not None:
                        login_output = login_result = ''
                        login_process = subprocess.Popen(['gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--insecure-storage'], env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                        threading.Thread(target=read_login, args=(login_process,), daemon=True).start()
                return self.send(200, {'started': True})
            if self.path == '/api/publish':
                if not connected():
                    return self.send(401, {'error': 'Sign in to GitHub first.'})
                with lock:
                    result = publish(data)
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
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('BLOG_PORT', '8767'))), Handler).serve_forever()
