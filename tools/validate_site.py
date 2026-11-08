#!/usr/bin/env python3
"""Dependency-free structural validation for the StudioKit static site."""
from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    'index.html', '.nojekyll', 'favicon.svg',
    'shared/site.css', 'shared/home.js', 'shared/site-shell.js', 'shared/tool-registry.json',
    'apps/badge-studio/index.html', 'apps/badge-studio/README.md', 'apps/badge-studio/CHANGELOG.md',
    'apps/arcade/index.html', 'apps/arcade/README.md', 'apps/arcade/CHANGELOG.md',
    'apps/arcade/engine.js', 'apps/arcade/arcade.css',
    'apps/arcade/games/star-raid.html', 'apps/arcade/games/shadow-leap.html',
    'apps/arcade/games/pendulum-tower.html', 'apps/arcade/games/snowbells.html',
    'apps/arcade/games/block-drop.html', 'apps/arcade/games/road-rush.html',
    'apps/arcade/games/gold-miner.html',
    'apps/arcade/games/memory-flip.html', 'apps/arcade/games/merge-2048.html',
    'apps/arcade/games/brick-breaker.html', 'apps/arcade/games/gravity-flip.html',
    'apps/arcade/games/snake-run.html', 'apps/arcade/games/mole-whack.html',
    'templates/single-page-tool/index.html', 'tools/build_site.py', 'tools/new_tool.py'
]

class RefParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.refs = []; self.external_assets = []; self.bad_attrs = []
    def handle_starttag(self, tag, attrs):
        for name, _ in attrs:
            # 属性名中出现引号（如 data-ov-text" 的笔误）会让 querySelector 静默失配，页面 JS 挂掉
            if '"' in name or "'" in name:
                self.bad_attrs.append(f'<{tag}> {name}')
        attrs = dict(attrs)
        for key in ('href', 'src'):
            value = attrs.get(key)
            if not value:
                continue
            parsed = urlsplit(value)
            if parsed.scheme in ('http', 'https') or value.startswith('//'):
                if tag in ('script', 'link', 'img', 'iframe') and (key == 'src' or tag == 'link'):
                    self.external_assets.append(value)
                continue
            if value.startswith('#') or parsed.scheme or value.startswith('data:'):
                continue
            self.refs.append(value)


def fail(message):
    print(f'FAIL: {message}')
    return False


def check_html(path, root):
    rel = path.relative_to(root)
    parser = RefParser()
    parser.feed(path.read_text(encoding='utf-8'))
    ok = True
    for ref in parser.refs:
        parsed = urlsplit(ref)
        local = unquote(parsed.path)
        if not local:
            continue
        target = (path.parent / local).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            ok = fail(f'{rel}: local reference escapes site root: {ref}') and ok
            continue
        if target.is_dir():
            target = target / 'index.html'
        if not target.exists():
            ok = fail(f'{rel}: missing local reference {ref} -> {target.relative_to(root.resolve())}') and ok
    for ref in parser.external_assets:
        ok = fail(f'{rel}: external runtime asset is not allowed by default: {ref}') and ok
    for bad in parser.bad_attrs:
        ok = fail(f'{rel}: malformed attribute name (stray quote): {bad}') and ok
    return ok


def validate(root=ROOT):
    root = Path(root).resolve()
    ok = True
    for rel in REQUIRED:
        if not (root / rel).exists():
            ok = fail(f'missing required file: {rel}') and ok

    registry_path = root / 'shared/tool-registry.json'
    if registry_path.exists():
        try:
            registry = json.loads(registry_path.read_text(encoding='utf-8'))
            tools = registry.get('tools')
            if registry.get('schemaVersion') != 1 or not isinstance(tools, list):
                ok = fail('tool registry schema must be version 1 with a tools array') and ok
            seen = set()
            for tool in tools or []:
                tool_id = tool.get('id', '')
                if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', tool_id):
                    ok = fail(f'invalid tool ID: {tool_id!r}') and ok
                if tool_id in seen:
                    ok = fail(f'duplicate tool ID: {tool_id}') and ok
                seen.add(tool_id)
                status = tool.get('status')
                if status not in ('available', 'draft', 'planned'):
                    ok = fail(f'{tool_id}: invalid status {status!r}') and ok
                href = tool.get('href')
                if status in ('available', 'draft'):
                    if not href:
                        ok = fail(f'{tool_id}: {status} tool requires href') and ok
                    else:
                        parsed = urlsplit(href)
                        target = (root / unquote(parsed.path.removeprefix('./'))).resolve()
                        if target.is_dir(): target = target / 'index.html'
                        if not target.exists():
                            ok = fail(f'{tool_id}: registry href target missing: {href}') and ok
                elif status == 'planned' and href:
                    ok = fail(f'{tool_id}: planned tool must not expose an href') and ok
        except Exception as exc:
            ok = fail(f'cannot parse tool registry: {exc}') and ok

    html_files = [root / 'index.html']
    apps = root / 'apps'
    if apps.exists(): html_files += sorted(apps.glob('**/*.html'))
    for path in html_files:
        if path.exists(): ok = check_html(path, root) and ok

    badge = root / 'apps/badge-studio/index.html'
    if badge.exists():
        source = badge.read_text(encoding='utf-8')
        if "const APP_VERSION = '2.2.1'" not in source:
            ok = fail('Badge Studio APP_VERSION changed; update baseline docs and registry intentionally') and ok
        if "const AUTOSAVE_KEY = 'concentric_badge_editor_autosave_v2'" not in source:
            ok = fail('Badge Studio legacy autosave key changed; requires migration review') and ok
        if 'data-studiokit-app="badge-studio"' not in source:
            ok = fail('Badge Studio page is missing StudioKit shell metadata') and ok

    arcade_engine = root / 'apps/arcade/engine.js'
    if arcade_engine.exists():
        source = arcade_engine.read_text(encoding='utf-8')
        if "const ARCADE_VERSION = '0.3.0'" not in source:
            ok = fail('Arcade ARCADE_VERSION drifted; update registry/README/CHANGELOG together') and ok
        if source.count("file: '") < 13:
            ok = fail('Arcade GAMES list should contain at least 13 games') and ok
        if "const RUNS_KEY = 'studiokit:arcade:runs:v1'" not in source:
            ok = fail('Arcade run-save key changed; requires migration review') and ok
        if registry_path.exists():
            try:
                registry = json.loads(registry_path.read_text(encoding='utf-8'))
                arcade = next((t for t in registry.get('tools', []) if t.get('id') == 'arcade'), None)
                if arcade and arcade.get('version') != '0.3.0':
                    ok = fail('Arcade registry version must match engine 0.3.0') and ok
            except Exception:
                pass

    template = root / 'templates/single-page-tool/index.html'
    if template.exists():
        source = template.read_text(encoding='utf-8')
        for marker in ('__TOOL_ID__', '__TOOL_NAME__', '__TOOL_DESCRIPTION__', '__TOOL_VERSION__'):
            if marker not in source:
                ok = fail(f'template missing placeholder {marker}') and ok

    if ok:
        print(f'PASS: StudioKit validation succeeded ({root})')
    return ok

if __name__ == '__main__':
    raise SystemExit(0 if validate() else 1)
