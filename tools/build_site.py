#!/usr/bin/env python3
"""Build a clean GitHub Pages artifact using an explicit public-file allowlist."""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
ALLOWLIST = ['index.html', 'favicon.svg', 'shared', 'apps']


def main():
    from validate_site import validate
    if not validate(ROOT):
        print('Build aborted: source validation failed.', file=sys.stderr)
        return 1
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    for item in ALLOWLIST:
        source = ROOT / item
        target = DIST / item
        if source.is_dir():
            shutil.copytree(source, target)
        elif source.is_file():
            shutil.copy2(source, target)
        else:
            print(f'Missing allowlisted site item: {item}', file=sys.stderr)
            return 1
    (DIST / '.nojekyll').write_text('', encoding='utf-8')
    if not (DIST / 'apps/badge-studio/index.html').exists():
        print('Build artifact is missing Badge Studio.', file=sys.stderr)
        return 1
    print(f'Built static site: {DIST}')
    print('Published paths: ' + ', '.join(ALLOWLIST + ['.nojekyll']))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
