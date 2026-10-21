import base64
import importlib.util
import io
import json
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).resolve().parents[1]/'publisher/server.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishingTests(unittest.TestCase):
    def media_get(self, path, owner='owner@example.com', host='private.example:8446'):
        handler = object.__new__(publisher.Handler)
        handler.path = path
        handler.headers = {'Tailscale-User-Login': owner, 'Host': host}
        handler.wfile = io.BytesIO()
        status, headers = [], {}
        handler.send_response = status.append
        handler.send_header = lambda name, value: headers.update({name: value})
        handler.end_headers = lambda: None
        with patch.object(publisher, 'OWNER', 'owner@example.com'), patch.object(publisher, 'ORIGIN', 'https://private.example:8446'):
            handler.do_GET()
        return status[0], headers, handler.wfile.getvalue()

    def test_private_manifest_and_media_use_authenticated_real_response_serialization(self):
        with tempfile.TemporaryDirectory() as directory:
            root, state = Path(directory)/'source', Path(directory)/'state'
            (root/'_data').mkdir(parents=True)
            (state/'media/ib').mkdir(parents=True)
            public = {'/public/': {'pdf': '/assets/evidence/public.pdf', 'title': 'Public'}}
            private = {'/private/': {'pdf': '/assets/evidence/drafts/ib/paper.pdf', 'download_url': 'https://private.example:8446/assets/evidence/drafts/ib/paper.pdf', 'title': 'Private'}}
            (root/'_data/evidence.json').write_text(json.dumps(public), encoding='utf-8')
            (state/'media.json').write_text(json.dumps(private), encoding='utf-8')
            with patch.object(publisher, 'ROOT', root), patch.object(publisher, 'STATE', state):
                status, headers, body = self.media_get('/assets/evidence/media.json')
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body), {**public, **private})
                self.assertEqual(headers['Cache-Control'], 'no-store')
                self.assertEqual(json.loads((root/'_data/evidence.json').read_text()), public)
                for suffix, mime in publisher.MEDIA_TYPES.items():
                    with self.subTest(suffix=suffix):
                        content = b'%PDF-1.4 private bytes' if suffix == '.pdf' else b'private image bytes'
                        (state/('media/ib/paper'+suffix)).write_bytes(content)
                        path = '/assets/evidence/drafts/ib/paper'+suffix
                        status, headers, body = self.media_get(path)
                        self.assertEqual((status, body), (200, content))
                        self.assertEqual(headers['Content-Type'], mime)
                        self.assertEqual(headers['Content-Disposition'], 'inline; filename="paper'+suffix+'"')
                        for who, host in [('', 'private.example:8446'), ('other@example.com', 'private.example:8446'), ('owner@example.com', 'wrong.example:8446')]:
                            self.assertEqual(self.media_get(path, who, host)[0], 403)
                            self.assertEqual(self.media_get('/assets/evidence/media.json', who, host)[0], 403)
                (state/'media.json').unlink()
                self.assertEqual(json.loads(self.media_get('/assets/evidence/media.json')[2]), public)

    def test_private_media_rejects_traversal_unapproved_extensions_and_state_paths(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher, 'STATE', Path(directory)):
            state = Path(directory)
            (state/'github').mkdir()
            (state/'github/token.pdf').write_bytes(b'private credential fixture')
            (state/'media/ib').mkdir(parents=True)
            (state/'media/ib/metadata.json').write_text('{}')
            for path in ['/assets/evidence/drafts/../github/token.pdf', '/assets/evidence/drafts/ib/../../github/token.pdf', '/assets/evidence/drafts/ib/%2e%2e/%2e%2e/github/token.pdf', '/assets/evidence/drafts/ib/metadata.json', '/assets/evidence/drafts/ib/nested/paper.pdf', '/assets/evidence/drafts/ib/.hidden.pdf', '/assets/evidence/drafts/ib/missing.pdf', '/assets/evidence/media.json/../drafts.json', '/media.json', '/github/token.pdf']:
                with self.subTest(path=path):
                    status, _, body = self.media_get(path)
                    self.assertEqual(status, 404)
                    self.assertNotIn(b'credential fixture', body)

    def test_private_media_cannot_follow_symlink_outside_media_directory(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher, 'STATE', Path(directory)):
            state = Path(directory)
            (state/'media/ib').mkdir(parents=True)
            outside = state/'outside.pdf'
            outside.write_bytes(b'outside private media')
            try:
                (state/'media/ib/link.pdf').symlink_to(outside)
            except OSError:
                self.skipTest('Creating symlinks is unavailable on this host')
            self.assertEqual(self.media_get('/assets/evidence/drafts/ib/link.pdf')[0], 404)

    def test_publish_rejects_private_attachment_links_before_any_github_request(self):
        prefix = publisher.PRIVATE_MEDIA_PREFIX
        for link in [publisher.ORIGIN+prefix+'ib/paper.pdf', prefix+'ib/paper.pdf', prefix.replace('/', '%2F')+'ib/paper.pdf', prefix.replace('/', '&#47;')+'ib/paper.pdf', (publisher.ORIGIN+prefix+'ib/paper.pdf').replace('/', '\\/')]:
            with self.subTest(link=link), patch.object(publisher, 'gh_api') as api:
                with self.assertRaisesRegex(ValueError, 'Promote the attachment'):
                    publisher.publish({'path': 'pages/private.md', 'content': '---\ntitle: "Private"\n---\n<p><a href="'+link+'">Paper</a></p>'})
                api.assert_not_called()

    def test_media_manifest_is_valid_json_on_private_desk(self):
        handler=object.__new__(publisher.Handler)
        handler.path='/assets/evidence/media.json'
        handler.wfile=io.BytesIO()
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher,'STATE',Path(directory)), patch.object(handler,'allowed',return_value=True), patch.object(handler,'send_response') as status, patch.object(handler,'send_header'), patch.object(handler,'end_headers'):
            handler.do_GET()
        status.assert_called_once_with(200)
        manifest=json.loads(handler.wfile.getvalue())
        self.assertEqual(manifest,json.loads((publisher.ROOT/'_data/evidence.json').read_text(encoding='utf-8')))
        self.assertTrue(manifest['/evidence/ct-scanner/']['previews'])

    def test_private_drafts_persist_and_reject_stale_writes(self):
        draft={'id':'one','kind':'post','title':'Private','quote':'','doc':[{'runs':[{'text':'Private draft'}]}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(publisher,'STATE',Path(directory)):
            self.assertEqual(publisher.read_drafts()['revision'],0)
            first=publisher.write_drafts({'revision':0,'drafts':[draft],'deleted':[]})
            self.assertEqual(publisher.read_drafts(),first)
            self.assertEqual(publisher.write_drafts(first),first)
            with self.assertRaises(RuntimeError) as error:
                publisher.write_drafts({'revision':0,'drafts':[],'deleted':[]})
            self.assertEqual(error.exception.status,409)
            removed=publisher.write_drafts({'revision':first['revision'],'drafts':[],'deleted':['one']})
            attempted_restore=publisher.write_drafts({'revision':removed['revision'],'drafts':[draft],'deleted':[]})
            self.assertEqual(attempted_restore['drafts'],[])
            self.assertEqual(attempted_restore['deleted'],['one'])
            self.assertTrue((Path(directory)/'drafts.previous.json').exists())
            with self.assertRaises(ValueError):publisher.write_drafts({'revision':2,'drafts':[{}],'deleted':[]})

    def test_create_preserves_unicode_and_fixed_repository(self):
        missing = RuntimeError('not found'); missing.status = 404
        with patch.object(publisher, 'repository_sources', return_value=('head', [])), patch.object(publisher, 'gh_api', side_effect=[missing, {'content': {'sha': 'new'}, 'commit': {'sha':'commit','committer': {'date':'now'}}}]) as api:
            result = publisher.publish({'path':'_posts/2026-10-15-test.md','content':'---\ntitle: Test\n---\n你好'})
            call = api.call_args
            self.assertTrue(call.args[0].startswith('repos/SjaakieChen/personal-blog/contents/'))
            self.assertEqual(call.args[2]['branch'], 'main')
            self.assertEqual(base64.b64decode(call.args[2]['content']).decode(), '---\ntitle: Test\n---\n你好')
            self.assertEqual(result['sha'], 'new')

    def test_conflict_never_overwrites(self):
        with patch.object(publisher, 'gh_api', return_value={'sha':'newer', 'content':base64.b64encode(b'old').decode()}) as api:
            with self.assertRaises(RuntimeError):
                publisher.publish({'path':'pages/source.md','content':'---\nChanged','baseSha':'older'})
            self.assertEqual(api.call_count, 1)

    def test_lost_response_can_retry_without_duplicate_commit(self):
        content = '---\nSame content'
        with patch.object(publisher, 'gh_api', return_value={'sha':'existing','content':base64.b64encode(content.encode()).decode()}) as api:
            self.assertTrue(publisher.publish({'path':'pages/source.md','content':content})['unchanged'])
            self.assertEqual(api.call_count, 1)

    def test_matching_revision_can_update(self):
        with patch.object(publisher, 'repository_sources', return_value=('head', [('pages/source.md', 'base', {'title':'Same title'}, '')])), patch.object(publisher, 'gh_api', side_effect=[{'sha':'base','content':base64.b64encode(b'old').decode()}, {'content':{'sha':'updated'},'commit':{'sha':'commit','committer':{'date':'now'}}}]) as api:
            publisher.publish({'path':'pages/source.md','content':'---\ntitle: "Same title"\n---\nUpdated','baseSha':'base'})
            self.assertEqual(api.call_args.args[2]['sha'],'base')

    def test_duplicate_title_is_rejected_before_any_write(self):
        missing=RuntimeError('not found');missing.status=404
        for title in ['Genesis', '  GENESIS  ', 'Ｇｅｎｅｓｉｓ']:
            with patch.object(publisher, 'repository_sources', return_value=('head', [('_posts/older.md','sha',{'title':'Genesis'},'')])), patch.object(publisher,'gh_api',side_effect=missing) as api:
                with self.assertRaisesRegex(RuntimeError,'title already exists'):
                    publisher.publish({'path':'_posts/new.md','content':'---\ntitle: "'+title+'"\n---\nText'})
                self.assertEqual(api.call_count,1)

    def test_current_index_excludes_deleted_files_and_uses_git_dates(self):
        publisher.entry_cache.clear()
        entries=[('_posts/new.md','new',{'title':'New'},'<p>New</p>'),('_posts/old.md','old',{'title':'Old'},'<p>Old</p>')]
        def history(endpoint):
            day='15' if 'new.md' in endpoint else '01'
            return [{'commit':{'committer':{'date':'2026-10-'+day+'T12:00:00Z'}}}]
        with patch.object(publisher,'repository_sources',return_value=('head',entries)),patch.object(publisher,'gh_api',side_effect=history):
            index=publisher.writing_index()
            self.assertEqual([p['title'] for p in index['posts']],['New','Old'])
            self.assertEqual(index['posts'][0]['sourceSha'],'new')
        with patch.object(publisher,'repository_sources',return_value=('head',entries[1:])):
            self.assertEqual([p['title'] for p in publisher.writing_index()['posts']],['Old'])

    def test_only_content_paths_are_accepted(self):
        for path in ['../secret', '.github/workflows/pages.yml', 'assets/writer.js', 'pages/../../file.md']:
            with self.assertRaises(ValueError):publisher.publish({'path':path,'content':'---\nBad'})

    def test_private_identity_and_host_are_required(self):
        handler=object.__new__(publisher.Handler)
        with patch.object(publisher,'OWNER','owner@example.com'), patch.object(publisher,'ORIGIN','https://example.ts.net:8446'):
            handler.headers={'Tailscale-User-Login':'owner@example.com','Host':'example.ts.net:8446'}
            self.assertTrue(handler.allowed())
            handler.headers={'Tailscale-User-Login':'other@example.com','Host':'example.ts.net:8446'}
            self.assertFalse(handler.allowed())
            handler.headers={}
            self.assertFalse(handler.allowed())

    def test_delete_requires_matching_revision_and_keeps_git_history(self):
        sha='a'*40
        with patch.object(publisher,'gh_api',side_effect=[{'sha':sha},{'commit':{'sha':'b'*40}}]) as api:
            result=publisher.delete_entry({'path':'_posts/2026-10-15-test.md','baseSha':sha})
            self.assertEqual(api.call_args.args[1],'DELETE')
            self.assertEqual(api.call_args.args[2]['sha'],sha)
            self.assertEqual(api.call_args.args[2]['branch'],'main')
            self.assertEqual(result['commit'],'b'*40)

    def test_delete_rejects_stale_or_invalid_targets(self):
        with patch.object(publisher,'gh_api',return_value={'sha':'b'*40}) as api:
            with self.assertRaises(RuntimeError):publisher.delete_entry({'path':'pages/source.md','baseSha':'a'*40})
            self.assertEqual(api.call_count,1)
        for path in ['../secret','.github/workflows/pages.yml','assets/writer.js']:
            with self.assertRaises(ValueError):publisher.delete_entry({'path':path,'baseSha':'a'*40})
        with self.assertRaises(ValueError):publisher.delete_entry({'path':'pages/source.md','baseSha':None})

    def test_delete_retry_is_idempotent(self):
        missing=RuntimeError('Not found');missing.status=404
        with patch.object(publisher,'gh_api',side_effect=missing) as api:
            self.assertTrue(publisher.delete_entry({'path':'pages/source.md','baseSha':'a'*40})['alreadyRemoved'])
            self.assertEqual(api.call_count,1)
