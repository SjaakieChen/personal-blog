import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from post_timestamps import timestamps, stamp

class TimestampTests(unittest.TestCase):
    def test_original_time_survives_edits_and_unrelated_commits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args, at=None):
                env = os.environ.copy()
                if at: env.update(GIT_AUTHOR_DATE=at, GIT_COMMITTER_DATE=at)
                return subprocess.check_output(['git',*args],cwd=root,env=env,text=True,stderr=subprocess.DEVNULL)
            git('init')
            git('config','user.name','Test')
            git('config','user.email','test@example.invalid')
            path = Path('_posts/2026-10-15-test.md')
            (root/path).parent.mkdir()
            (root/path).write_text('---\ntitle: Test\n---\nFirst version.\n')
            git('add','.')
            git('commit','-m','Create',at='2026-10-15T10:00:00+01:00')
            self.assertEqual(timestamps(root,path),('2026-10-15T10:00:00+01:00',None))
            (root/path).write_text('---\ntitle: Test\n---\nEdited version.\n')
            git('add','.')
            git('commit','-m','Edit',at='2026-10-15T11:30:00+01:00')
            (root/'styles.css').write_text('body {}')
            git('add','.')
            git('commit','-m','Change style',at='2026-10-15T12:00:00+01:00')
            self.assertEqual(timestamps(root,path),('2026-10-15T10:00:00+01:00','2026-10-15T11:30:00+01:00'))
            self.assertEqual(stamp(root),1)
            result=(root/path).read_text()
            self.assertIn('published_at: "2026-10-15T10:00:00+01:00"',result)
            self.assertIn('last_edited_at: "2026-10-15T11:30:00+01:00"',result)
            self.assertIn('Edited version.',result)
            stamp(root)
            self.assertEqual((root/path).read_text(),result)

if __name__ == '__main__': unittest.main()
