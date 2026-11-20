#!/usr/bin/env python3
"""Compare committed design artifacts with a fresh regeneration in a temporary copy.

Runs the generators in an isolated worktree-like temp directory so no committed file is
modified. All text is normalized to LF before comparison.
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACK = ROOT / 'docs' / 'arcade' / '0.9'


def normalize(text: str) -> str:
    return text.replace('\r\n', '\n').replace('\r', '\n')


def python_cmd() -> list[str]:
    return [sys.executable, '-X', 'utf8']


def run(script: pathlib.Path, cwd: pathlib.Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        python_cmd() + [str(script)],
        cwd=cwd,
        text=True,
        encoding='utf-8',
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
    )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='arcade-design-check-') as tmp:
        sandbox = pathlib.Path(tmp)
        sandbox_pack = sandbox / 'docs/arcade/0.9'
        sandbox_pack.parent.mkdir(parents=True)
        shutil.copytree(PACK, sandbox_pack)
        scripts = sandbox_pack / 'scripts'
        for name in ['build_pack.py', 'render_docs.py', 'render_atlas.py', 'validate_levels.py']:
            result = run(scripts / name, scripts)
            if result.returncode != 0:
                print('FAIL  ' + name + ' exited ' + str(result.returncode))
                print((result.stdout or '')[-3000:])
                return 1

        problems: list[str] = []
        checked = 0
        for path in sorted(sandbox_pack.rglob('*')):
            if not path.is_file():
                continue
            if '__pycache__' in path.parts:
                continue
            rel = path.relative_to(sandbox_pack)
            committed = PACK / rel
            if not committed.exists():
                problems.append('new artifact not committed: ' + str(rel))
                continue
            a = normalize(committed.read_text(encoding='utf-8'))
            b = normalize(path.read_text(encoding='utf-8'))
            if a != b:
                problems.append('stale artifact: ' + str(rel))
            checked += 1
        # Committed files that generators never emit are allowed (manual notes/reviews).
        if problems:
            for item in problems:
                print('FAIL  ' + item)
            return 1
        print(f'PASS  design-pack regeneration check: {checked} generated artifacts match committed files (normalized LF)')
        return 0


if __name__ == '__main__':
    sys.exit(main())
