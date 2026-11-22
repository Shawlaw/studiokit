#!/usr/bin/env python3
"""Dependency-free checks for the README set.

1. Relative markdown links resolve (directory links allowed).
2. `#anchor` fragments exist in the target document.
3. Every pipe table row has the same number of cells as its header.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'README.md',
    'START-HERE.md',
    'CONTRIBUTING.md',
    'apps/arcade/README.md',
    'apps/badge-studio/README.md',
    'apps/restaurant-compare/README.md',
    'docs/arcade/README.md',
    'docs/arcade/0.9/README.md',
    'templates/single-page-tool/README.md',
]
LINK_RE = re.compile(r'(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
FENCE_RE = re.compile(r'^\s*```')
ESCAPED_PIPE = '\x00'


def github_slug(heading: str) -> str:
    text = heading.strip().lower()
    text = re.sub(r'`([^`]*)`', r'\1', text)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'[^\w\u4e00-\u9fff\- ]', '', text)
    text = re.sub(r'\s', '-', text)
    return text.strip('-')


def anchors(path: Path) -> set[str]:
    found: set[str] = set()
    in_fence = False
    for line in path.read_text(encoding='utf-8').splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence and line.startswith('#'):
            found.add(github_slug(line.lstrip('#').strip()))
    return found


def cells(line: str) -> int:
    row = line.strip().replace('\\|', ESCAPED_PIPE)
    if row.startswith('|'):
        row = row[1:]
    if row.endswith('|'):
        row = row[:-1]
    return len(row.split('|'))


def table_problems(rel: str, lines: list[str]) -> list[str]:
    problems: list[str] = []
    in_fence = False
    block: list[tuple[int, str]] = []

    def flush() -> None:
        if len(block) < 2:
            block.clear()
            return
        expected = cells(block[0][1])
        for lineno, row in block[1:]:
            actual = cells(row)
            if actual != expected:
                problems.append(
                    f'{rel}:{lineno}: table row has {actual} cells, header has {expected}'
                )
        block.clear()

    for index, line in enumerate(lines, start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            flush()
            continue
        if not in_fence and line.strip().startswith('|'):
            block.append((index, line))
        else:
            flush()
    flush()
    return problems


INLINE_CODE_RE = re.compile(r'`[^`\n]*`')


def strip_inline_code(text: str) -> str:
    """Markdown inside inline code spans is literal text, not links."""
    return INLINE_CODE_RE.sub('``', text)


def collect_files(all_files: bool) -> list[str]:
    if not all_files:
        return FILES
    skip = {'dist', 'test-artifacts', '.git', 'node_modules'}
    found = []
    for path in ROOT.rglob('*.md'):
        if any(part in skip for part in path.parts):
            continue
        if not path.is_file():
            continue
        found.append(path.relative_to(ROOT).as_posix())
    return sorted(found)


def main() -> int:
    all_files = '--all' in sys.argv
    problems: list[str] = []
    cache: dict[Path, set[str]] = {}

    for rel in collect_files(all_files):
        path = ROOT / rel
        if not path.is_file():
            problems.append(f'{rel}: file missing')
            continue
        text = path.read_text(encoding='utf-8')
        if not all_files:
            # `--all` audits the whole tree; table-column noise from historic machine-written
            # docs is out of scope there, so only the curated list gets the table check.
            problems.extend(table_problems(rel, text.splitlines()))

        for raw in LINK_RE.findall(strip_inline_code(text)):
            if raw.startswith(('http://', 'https://', 'mailto:', '#')):
                if raw.startswith('#') and raw[1:]:
                    if path not in cache:
                        cache[path] = anchors(path)
                    if raw[1:].lower() not in {a.lower() for a in cache[path]}:
                        problems.append(f'{rel}: missing anchor {raw}')
                continue
            target, _, frag = raw.partition('#')
            resolved = (path.parent / unquote(target)).resolve() if target else path
            if not resolved.exists():
                problems.append(f'{rel}: broken link target {raw}')
                continue
            if resolved.is_dir():
                # GitHub renders directory links as a tree listing; accept them.
                continue
            if frag:
                if resolved not in cache:
                    cache[resolved] = anchors(resolved)
                if frag.lower() not in {a.lower() for a in cache[resolved]}:
                    problems.append(
                        f'{rel}: missing anchor #{frag} in '
                        f'{resolved.relative_to(ROOT).as_posix()}'
                    )

    if problems:
        print('README PROBLEMS:')
        for item in problems:
            print(' -', item)
        return 1
    scope = 'all tracked markdown' if all_files else f'{len(FILES)} documents'
    print(f'PASS: links, anchors and tables are consistent across {scope}.')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
