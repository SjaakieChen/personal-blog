import base64
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).resolve().parents[1]/'publisher/server.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishingTests(unittest.TestCase):
    def test_create_preserves_unicode_and_fixed_repository(self):
        missing = RuntimeError('not found'); missing.status = 404
        with patch.object(publisher, 'gh_api', side_effect=[missing, {'content': {'sha': 'new'}, 'commit': {'sha':'commit','committer': {'date':'now'}}}]) as api:
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
        with patch.object(publisher, 'gh_api', side_effect=[{'sha':'base','content':base64.b64encode(b'old').decode()}, {'content':{'sha':'updated'},'commit':{'sha':'commit','committer':{'date':'now'}}}]) as api:
            publisher.publish({'path':'pages/source.md','content':'---\nUpdated','baseSha':'base'})
            self.assertEqual(api.call_args.args[2]['sha'],'base')

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
