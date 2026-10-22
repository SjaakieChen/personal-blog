import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from test_publisher import publisher, FakeGit


class MediaPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)/'runtime'
        self.state = Path(self.temporary.name)/'state'
        (self.root/'_data').mkdir(parents=True)
        (self.state/'media/ib').mkdir(parents=True)
        (self.state/'media/imec').mkdir(parents=True)
        self.public = {'/evidence/ct-scanner/': {'pdf': '/assets/evidence/ct/poster.pdf', 'title': 'Keep CT metadata'}}
        self.private = {'/evidence/ib-physics/': {'pdf': '/assets/evidence/drafts/ib/paper.pdf', 'download_url': publisher.ORIGIN+'/assets/evidence/drafts/ib/paper.pdf', 'title': 'IB physics', 'previews': ['/assets/evidence/drafts/ib/page-1.webp', '/assets/evidence/drafts/ib/page-10.webp'], 'preview_pages': [1, 10], 'total_pages': 22}}
        (self.root/'_data/evidence.json').write_text(json.dumps(self.public))
        (self.state/'media.json').write_text(json.dumps(self.private))
        for name, raw in {'ib/paper.pdf': b'%PDF-1.4 retained paper', 'ib/page-1.webp': b'page one preview', 'ib/page-10.webp': b'page ten preview', 'ib/unrelated.png': b'private unrelated image', 'imec/lenses.png': b'real retained lens picture'}.items():
            (self.state/'media'/name).write_bytes(raw)
        self.content = '---\nlayout: page\ntitle: "IB physics"\npermalink: "/evidence/ib-physics/"\n---\n<p>Original prose <a href="'+publisher.ORIGIN+'/assets/evidence/drafts/ib/paper.pdf">Read the paper</a>.</p>\n'
        self.data = {'path': 'pages/ib-physics.md', 'content': self.content, 'baseSha': None}
        self.git = FakeGit({'README.md': b'Keep unrelated repository files', '_data/evidence.json': json.dumps(self.public).encode()})
        publisher.source_cache.clear()
        for name, value in [('ROOT', self.root), ('STATE', self.state), ('gh_api', self.git)]:
            patcher = patch.object(publisher, name, value); patcher.start(); self.addCleanup(patcher.stop)

    def test_atomic_pdf_page_previews_manifest_and_runtime_cache(self):
        original = (self.state/'media/ib/paper.pdf').read_bytes()
        result = publisher.publish(self.data)
        files = self.git.visible()
        self.assertEqual(set(files), {'README.md', '_data/evidence.json', 'pages/ib-physics.md', 'assets/evidence/ib/paper.pdf', 'assets/evidence/ib/page-1.webp', 'assets/evidence/ib/page-10.webp'})
        self.assertEqual(files['assets/evidence/ib/paper.pdf'], original)
        self.assertEqual((self.state/'media/ib/paper.pdf').read_bytes(), original)
        self.assertEqual(files['README.md'], b'Keep unrelated repository files')
        expected_url = publisher.PUBLIC+'/assets/evidence/ib/paper.pdf'
        self.assertIn(expected_url.encode(), files[self.data['path']])
        self.assertEqual(result['linkReplacements'], {publisher.ORIGIN+'/assets/evidence/drafts/ib/paper.pdf': expected_url})
        self.assertEqual(result['sha'], publisher.git_blob_sha(files[self.data['path']]))
        self.assertTrue(result['mediaPublished']); self.assertFalse(result['unchanged'])
        public = json.loads(files['_data/evidence.json'])
        self.assertEqual(public['/evidence/ct-scanner/'], self.public['/evidence/ct-scanner/'])
        self.assertEqual(public['/evidence/ib-physics/']['preview_pages'], [1, 10])
        self.assertEqual(public['/evidence/ib-physics/']['public_pdf'], expected_url)
        self.assertEqual((self.root/'assets/evidence/ib/page-10.webp').read_bytes(), files['assets/evidence/ib/page-10.webp'])
        private_view = publisher.media_manifest()['/evidence/ib-physics/']
        self.assertEqual(private_view['download_url'], expected_url)
        self.assertEqual(private_view['pdf'], '/assets/evidence/drafts/ib/paper.pdf')
        self.assertEqual(private_view['previews'], self.private['/evidence/ib-physics/']['previews'])
        self.assertEqual(sum(method == 'PATCH' for method, _, _ in self.git.calls), 1)
        self.assertEqual(self.git.calls[-1][1], 'refs/heads/main')

    def test_image_fragment_promotes_only_that_file(self):
        link = '#media-image/assets/evidence/drafts/imec/lenses.png'
        data = {'path': 'pages/imec.md', 'content': '---\ntitle: "Imec"\n---\n<p><a href="'+link+'">Real lenses</a></p>'}
        result = publisher.publish(data)
        self.assertEqual(result['linkReplacements'], {link: '#media-image/assets/evidence/imec/lenses.png'})
        self.assertEqual(set(self.git.visible()), {'README.md', '_data/evidence.json', 'pages/imec.md', 'assets/evidence/imec/lenses.png'})
        self.assertEqual(json.loads(self.git.visible()['_data/evidence.json']), self.public)

    def test_missing_preview_stops_before_any_github_request(self):
        (self.state/'media/ib/page-10.webp').unlink()
        with self.assertRaisesRegex(ValueError, 'missing or unsupported'):
            publisher.publish(self.data)
        self.assertEqual(self.git.calls, [])

    def test_lost_response_retry_is_idempotent_and_repairs_preview_cache(self):
        self.git.lose_response = True
        with self.assertRaisesRegex(RuntimeError, 'Lost response'):
            publisher.publish(self.data)
        committed = self.git.head
        self.assertIn(self.data['path'], self.git.visible())
        self.assertFalse((self.root/'assets/evidence/ib/paper.pdf').exists())
        self.git.calls.clear()
        result = publisher.publish(self.data)
        self.assertTrue(result['unchanged'])
        self.assertEqual(self.git.head, committed)
        self.assertTrue(result['linkReplacements'])
        self.assertFalse(any(method != 'GET' for method, _, _ in self.git.calls))
        self.assertTrue((self.root/'assets/evidence/ib/paper.pdf').is_file())

    def test_concurrent_branch_change_cannot_overwrite_or_cache(self):
        self.git.race = True
        with self.assertRaisesRegex(RuntimeError, 'blog changed') as error:
            publisher.publish(self.data)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.git.head, 'initial')
        self.assertNotIn(self.data['path'], self.git.visible())
        self.assertFalse((self.root/'assets/evidence/ib/paper.pdf').exists())

    def test_attachment_collision_never_overwrites_public_bytes(self):
        self.git = FakeGit({**self.git.visible(), 'assets/evidence/ib/paper.pdf': b'Existing distinct public paper'})
        with patch.object(publisher, 'gh_api', self.git), self.assertRaisesRegex(RuntimeError, 'different contents'):
            publisher.publish(self.data)
        self.assertEqual(self.git.visible()['assets/evidence/ib/paper.pdf'], b'Existing distinct public paper')
        self.assertFalse(any(method != 'GET' for method, _, _ in self.git.calls))

    def test_stale_source_revision_rejects_but_matching_revision_updates(self):
        old = b'---\ntitle: "IB physics"\n---\nOld public words.'
        self.git = FakeGit({**self.git.visible(), self.data['path']: old})
        with patch.object(publisher, 'gh_api', self.git):
            with self.assertRaisesRegex(RuntimeError, 'changed elsewhere'):
                publisher.publish({**self.data, 'baseSha': 'wrong'})
            self.assertFalse(any(method != 'GET' for method, _, _ in self.git.calls))
            result = publisher.publish({**self.data, 'baseSha': publisher.git_blob_sha(old)})
            self.assertFalse(result['unchanged'])

    def test_duplicate_title_in_same_snapshot_rejects_before_writing(self):
        self.git = FakeGit({**self.git.visible(), 'pages/existing.md': b'---\ntitle: " IB PHYSICS "\n---\nExisting'})
        with patch.object(publisher, 'gh_api', self.git), self.assertRaisesRegex(RuntimeError, 'title already exists'):
            publisher.publish(self.data)
        self.assertFalse(any(method != 'GET' for method, _, _ in self.git.calls))

    def test_cache_failure_does_not_misreport_successful_publication(self):
        with patch.object(publisher, 'cache_published_media', return_value=False):
            result = publisher.publish(self.data)
        self.assertFalse(result['unchanged']); self.assertTrue(result['previewRefreshNeeded'])
        self.assertIn(self.data['path'], self.git.visible())

    def test_rewrite_matches_writer_serialization_and_keeps_prose(self):
        node = os.environ.get('NODE_BINARY') or shutil.which('node')
        if not node: self.skipTest('Node.js is needed for cross-runtime serialization verification')
        core = str(Path(__file__).resolve().parents[1]/'assets/writer-core.js')
        private_url = publisher.ORIGIN+'/assets/evidence/drafts/ib/paper.pdf#page=10'
        draft = {'id': 'ib-fixture', 'kind': 'page', 'title': 'IB physics', 'quote': '', 'targetPath': self.data['path'], 'permalink': '/evidence/ib-physics/', 'references': [{'id': 'paper', 'title': 'Paper — original', 'author': 'Jiaqi Chen', 'url': private_url}], 'doc': [{'runs': [{'text': 'Literal URL in prose: '+private_url+'. '}, {'text': 'Open the paper', 'link': private_url, 'reference': 'paper', 'label': 'Evidence'}]}]}
        script = 'const fs=require("node:fs"),core=require(process.argv[1]),d=JSON.parse(fs.readFileSync(0,"utf8"));const original=core.prepare(d).content;for(const b of d.doc)for(const r of b.runs)if(r.link)r.link=r.link.replace(process.argv[2],process.argv[3]);for(const r of d.references)r.url=r.url.replace(process.argv[2],process.argv[3]);process.stdout.write(JSON.stringify({original,expected:core.prepare(d).content}));'
        generated = json.loads(subprocess.check_output([node, '-e', script, core, publisher.ORIGIN+'/assets/evidence/drafts/', publisher.PUBLIC+'/assets/evidence/'], input=json.dumps(draft).encode()))
        prepared = publisher.prepare_media_publication(generated['original'])
        self.assertEqual(prepared['content'], generated['expected'])
        self.assertIn('Literal URL in prose: '+private_url, prepared['content'])
        self.assertEqual(prepared['linkReplacements'], {private_url: publisher.PUBLIC+'/assets/evidence/ib/paper.pdf#page=10'})
        only_prose = '---\ntitle: "Text"\n---\n<p>Literal '+private_url+'</p>'
        self.assertIsNone(publisher.prepare_media_publication(only_prose))
        for example in ['&lt;a href="'+private_url+'"&gt;An example&lt;/a&gt;', '<a title="Example href=\x27'+private_url+'\x27" href="https://example.org">Example</a>', '<!-- <a href="'+private_url+'">Comment</a> -->']:
            with self.subTest(example=example):
                self.assertIsNone(publisher.prepare_media_publication('---\ntitle: "Text"\n---\n<p>'+example+'</p>'))

    def test_encoded_and_html_escaped_paths_promote_only_valid_files(self):
        prefix = publisher.PRIVATE_MEDIA_PREFIX
        for value in [prefix+'ib/paper.pdf', prefix.replace('/', '%2F')+'ib/paper.pdf', prefix.replace('/', '&#47;')+'ib/paper.pdf', (publisher.ORIGIN+prefix+'ib/paper.pdf').replace('/', '\\/')]:
            with self.subTest(value=value):
                content = '---\ntitle: "Text"\n---\n<a href="'+value+'">Paper</a>'
                prepared = publisher.prepare_media_publication(content)
                self.assertIn(publisher.PUBLIC+'/assets/evidence/ib/paper.pdf', prepared['content'])
                self.assertEqual(prepared['assets']['assets/evidence/ib/paper.pdf'], b'%PDF-1.4 retained paper')
