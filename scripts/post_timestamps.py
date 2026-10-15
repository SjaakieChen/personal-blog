"""Add publication/edit times from Git to the build copy, without new commits."""
from datetime import datetime
from pathlib import Path
import json
import re
import subprocess

def timestamps(root, path):
    history = subprocess.check_output(
        ['git', 'log', '--follow', '--format=%H%x09%cI', '--', path.as_posix()],
        cwd=root, text=True, encoding='utf-8').strip().splitlines()
    if not history:
        raise ValueError(f'No committed history for {path}')
    newest_hash, newest = history[0].split('\t')
    oldest_hash, oldest = history[-1].split('\t')
    return oldest, newest if newest_hash != oldest_hash else None

def stamp(root):
    root = Path(root)
    count = 0
    for folder in ('_posts', 'pages'):
        for path in sorted((root / folder).glob('*.md')):
            text = path.read_text(encoding='utf-8')
            match = re.match(r'\A---\s*\n(.*?)\n---\s*\n', text, re.S)
            if not match:
                raise ValueError(f'Missing front matter: {path}')
            published, edited = timestamps(root, path.relative_to(root))
            # Build-derived fields cannot be supplied by an author to mask edits.
            metadata = re.sub(r'^(published_at|last_edited_at):[^\n]*\n?', '', match[1], flags=re.M).rstrip()
            metadata += '\npublished_at: ' + json.dumps(published)
            if edited:
                metadata += '\nlast_edited_at: ' + json.dumps(edited)
            path.write_text('---\n' + metadata + '\n---\n' + text[match.end():], encoding='utf-8')
            count += 1
    return count

if __name__ == '__main__':
    print(f'Added Git publication/edit timestamps to {stamp(Path.cwd())} entries.')
