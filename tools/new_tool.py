#!/usr/bin/env python3
"""Create a new StudioKit single-page tool from the standard template."""
from __future__ import annotations
import argparse
import html as html_lib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id', required=True, help='lowercase kebab-case tool ID')
    parser.add_argument('--name', required=True, help='human-readable tool name')
    parser.add_argument('--description', required=True, help='short tool description')
    parser.add_argument('--icon', default='◇', help='one-character/emoji card icon')
    parser.add_argument('--root', type=Path, default=ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if not SLUG_RE.fullmatch(args.id):
        parser.error('--id must be lowercase kebab-case, e.g. rounded-image')
    if not args.name.strip() or not args.description.strip():
        parser.error('--name and --description must not be blank')

    root = args.root.resolve()
    target = root / 'apps' / args.id
    template = root / 'templates' / 'single-page-tool'
    registry_path = root / 'shared' / 'tool-registry.json'
    if target.exists():
        parser.error(f'target already exists: {target}')
    if not template.is_dir() or not registry_path.is_file():
        parser.error('template or shared/tool-registry.json is missing')

    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    existing = next((tool for tool in registry.get('tools', []) if tool.get('id') == args.id), None)
    if existing and existing.get('status') != 'planned':
        parser.error(f'tool ID already registered and not planned: {args.id}')

    replacements = {
        '__TOOL_ID__': args.id,
        '__TOOL_NAME__': args.name.strip(),
        '__TOOL_DESCRIPTION__': args.description.strip(),
        '__TOOL_VERSION__': '0.1.0',
    }
    shutil.copytree(template, target)
    for path in target.rglob('*'):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        values = replacements
        if path.suffix.lower() in ('.html', '.htm'):
            values = {key: html_lib.escape(value, quote=True) for key, value in replacements.items()}
        for old, new in values.items():
            content = content.replace(old, new)
        path.write_text(content, encoding='utf-8')

    entry = {
        'id': args.id,
        'name': args.name.strip(),
        'subtitle': args.name.strip(),
        'description': args.description.strip(),
        'version': '0.1.0',
        'status': 'draft',
        'href': f'./apps/{args.id}/',
        'icon': args.icon,
        'tags': ['新工具']
    }
    if existing:
        existing.clear(); existing.update(entry)
    else:
        registry.setdefault('tools', []).append(entry)
    registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    action = 'Upgraded planned entry and created' if existing else 'Created'
    print(f'{action} apps/{args.id}/ as draft.')
    print('Next: implement the tool, add README/CHANGELOG, validate, then change registry status to available.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
