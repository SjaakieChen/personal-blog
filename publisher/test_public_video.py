"""Focused safety check for the existing private desk's public MP4 cache."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('archive_staged_publisher', Path(__file__).with_name('server.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublicVideoCacheTest(unittest.TestCase):
    def test_only_authenticated_public_evidence_mp4_is_served(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)/'runtime'
            video = root/'assets/evidence/entrepreneur/spark-demonstration.mp4'
            video.parent.mkdir(parents=True)
            video.write_bytes(b'checked public mp4 fixture')
            handler = object.__new__(publisher.Handler)
            handler.send = Mock()
            handler.allowed = Mock(return_value=True)
            with patch.object(publisher, 'ROOT', root):
                handler.path = '/assets/evidence/entrepreneur/spark-demonstration.mp4'
                handler.do_GET()
                handler.send.assert_called_once_with(200, video.read_bytes(), 'video/mp4')
                for unsafe in [
                    '/assets/evidence/entrepreneur/missing.mp4',
                    '/assets/evidence/entrepreneur/../spark-demonstration.mp4',
                    '/assets/evidence/entrepreneur/%2e%2e/spark-demonstration.mp4',
                    '/assets/evidence/drafts/spark-demonstration.mp4',
                    '/assets/evidence/drafts/entrepreneur/spark-demonstration.mp4',
                    '/assets/elsewhere/spark-demonstration.mp4',
                ]:
                    with self.subTest(path=unsafe):
                        self.assertIsNone(publisher.public_video_file(unsafe))
                        handler.send.reset_mock()
                        handler.path = unsafe
                        handler.do_GET()
                        self.assertEqual(handler.send.call_args.args[0], 404)
                self.assertNotIn('.mp4', publisher.MEDIA_TYPES)
                self.assertIsNone(publisher.private_media_file('/assets/evidence/drafts/entrepreneur/spark-demonstration.mp4'))
                outside = Path(temp)/'outside.mp4'
                outside.write_bytes(b'must not be served')
                escape = video.parent/'escape.mp4'
                try:
                    escape.symlink_to(outside)
                except OSError:
                    pass  # Windows may lack symlink rights; the same test runs on Yoga before deployment.
                else:
                    self.assertIsNone(publisher.public_video_file('/assets/evidence/entrepreneur/escape.mp4'))
                handler.send.reset_mock()
                handler.allowed.return_value = False
                handler.path = '/assets/evidence/entrepreneur/spark-demonstration.mp4'
                handler.do_GET()
                self.assertEqual(handler.send.call_args.args[0], 403)


if __name__ == '__main__':
    unittest.main()
