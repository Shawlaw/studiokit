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
    'index.html', '.nojekyll', 'favicon.svg', 'LICENSE',
    'shared/site.css', 'shared/home.js', 'shared/site-shell.js', 'shared/tool-registry.json',
    'apps/badge-studio/index.html', 'apps/badge-studio/README.md', 'apps/badge-studio/CHANGELOG.md',
    'apps/arcade/index.html', 'apps/arcade/README.md', 'apps/arcade/CHANGELOG.md',
    'apps/arcade/DESIGN-0.4.0.md', 'apps/arcade/DESIGN-0.5.0.md',
    'apps/arcade/DESIGN-0.6.0.md',
    'apps/arcade/engine.js', 'apps/arcade/arcade.css', 'apps/arcade/sw.js',
    'apps/arcade/manifest.webmanifest',
    'apps/arcade/icons/icon-192.png', 'apps/arcade/icons/icon-512.png',
    'apps/arcade/icons/maskable-512.png', 'apps/arcade/icons/apple-touch-icon.png',
    'apps/arcade/games/star-raid.html', 'apps/arcade/games/shadow-leap.html',
    'apps/arcade/games/pendulum-tower.html', 'apps/arcade/games/snowbells.html',
    'apps/arcade/games/block-drop.html', 'apps/arcade/games/road-rush.html',
    'apps/arcade/games/gold-miner.html',
    'apps/arcade/games/memory-flip.html', 'apps/arcade/games/merge-2048.html',
    'apps/arcade/games/brick-breaker.html', 'apps/arcade/games/gravity-flip.html',
    'apps/arcade/games/snake-run.html', 'apps/arcade/games/mole-whack.html',
    'templates/single-page-tool/index.html', 'tools/build_site.py', 'tools/new_tool.py'
]

# 0.9 挑战模式：每款游戏一个生成数据文件（tools/arcade_09_data.mjs 生成，入库）。
ARCADE_CHALLENGE_GAMES = [
    'shadow-leap', 'snowbells', 'star-raid', 'pendulum-tower', 'block-drop',
    'road-rush', 'gold-miner', 'brick-breaker', 'gravity-flip', 'snake-run',
    'mole-whack', 'memory-flip', 'merge-2048',
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
        # 根路径引用在 GitHub Pages 项目站点（/studiokit/）下会 404；Cloudflare 根路径下却正常，
        # 这类问题只会在双目标部署时暴露，因此在这里直接拦下。
        if ref.startswith('/') and not ref.startswith('//'):
            ok = fail(f'{rel}: root-absolute reference breaks subpath hosting: {ref}') and ok
            continue
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

    for css_dir in ('shared', 'apps'):
        css_root = root / css_dir
        if not css_root.exists():
            continue
        for css_path in sorted(css_root.glob('**/*.css')):
            css_text = css_path.read_text(encoding='utf-8')
            for match in re.finditer(r"url\(\s*['\"]?/(?!/)", css_text):
                ok = fail(
                    f'{css_path.relative_to(root)}: root-absolute CSS url() breaks subpath hosting: '
                    f'{match.group(0)}'
                ) and ok

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
        if "const ARCADE_VERSION = '0.7.0'" not in source:
            ok = fail('Arcade ARCADE_VERSION drifted; update registry/README/CHANGELOG together') and ok
        if source.count("file: '") < 13:
            ok = fail('Arcade GAMES list should contain at least 13 games') and ok
        if "const RUNS_KEY = 'studiokit:arcade:runs:v1'" not in source:
            ok = fail('Arcade run-save key changed; requires migration review') and ok
        if "const PLAYTIME_KEY = 'studiokit:arcade:playtime:v1'" not in source:
            ok = fail('Arcade playtime key changed; requires migration review') and ok
        if 'function installDisplayMode' not in source:
            ok = fail('Arcade fullscreen/immersive helper is missing') and ok
        for marker in ('const Playtime =', 'function formatDuration', 'const Share =', 'const Offline =', 'arcade-precache', 'function createToolbelt', 'PLAYTIME_REST_MS'):
            if marker not in source:
                ok = fail(f'Arcade 0.7.0 marker missing in engine.js: {marker}') and ok
        # 0.9 平台地基：挑战记录 key + A.Challenge 共享帮助（不改既有版本断言）。
        if "const CHALLENGE_KEY = 'studiokit:arcade:challenge:v1'" not in source:
            ok = fail('Arcade challenge storage key missing/changed: expected studiokit:arcade:challenge:v1') and ok
        if 'const Challenge = {' not in source:
            ok = fail('Arcade A.Challenge shared helper is missing from engine.js') and ok
        if '\n    Challenge,' not in source:
            ok = fail('window.Arcade.Challenge export is missing from engine.js') and ok
        challenge_dir = root / 'apps/arcade/challenge'
        for game_id in ARCADE_CHALLENGE_GAMES:
            data_file = challenge_dir / f'{game_id}.js'
            if not data_file.exists():
                ok = fail(f'Arcade challenge data missing: {data_file.relative_to(root)}') and ok
                continue
            data_source = data_file.read_text(encoding='utf-8')
            if 'window.ArcadeChallengeData' not in data_source:
                ok = fail(f'{data_file.relative_to(root)}: missing window.ArcadeChallengeData registration') and ok
            if f"window.ArcadeChallengeData['{game_id}']" not in data_source:
                ok = fail(f'{data_file.relative_to(root)}: gameId registration mismatch (expected {game_id})') and ok
            if '"referencePlan"' in data_source or '"acceptance"' in data_source:
                ok = fail(f'{data_file.relative_to(root)}: runtime data must not leak referencePlan/acceptance') and ok
        gold_miner = root / 'apps/arcade/games/gold-miner.html'
        if gold_miner.exists():
            gold_source = gold_miner.read_text(encoding='utf-8')
            for marker in ('data-toolbelt', 'data-tool="aim"', 'AIM_EXTEND_SPEED', 'winchArmed'):
                if marker not in gold_source:
                    ok = fail(f'Gold miner 0.4.0 marker missing: {marker}') and ok
        arcade_index = root / 'apps/arcade/index.html'
        if arcade_index.exists():
            index_source = arcade_index.read_text(encoding='utf-8')
            for marker in ('rel="manifest"', 'data-playtime-section', 'data-offline', 'data-install', 'data-share', 'data-random', '无签到', 'data-hall-version>0.7.0'):
                if marker not in index_source:
                    ok = fail(f'Arcade hub 0.7.0 marker missing: {marker}') and ok
        arcade_sw = root / 'apps/arcade/sw.js'
        if arcade_sw.exists():
            sw_source = arcade_sw.read_text(encoding='utf-8')
            for marker in ("const VERSION = '0.7.0'", 'arcade-precache', 'skipWaiting', 'clients.claim'):
                if marker not in sw_source:
                    ok = fail(f'Arcade service worker marker missing: {marker}') and ok
            # 0.9：13 个挑战数据文件必须进入 shell 预缓存（相对路径写法，兼容子路径部署）。
            for game_id in ARCADE_CHALLENGE_GAMES:
                if f"'./challenge/{game_id}.js'" not in sw_source:
                    ok = fail(f'Arcade service worker shell list missing challenge data: ./challenge/{game_id}.js') and ok
        manifest = root / 'apps/arcade/manifest.webmanifest'
        if manifest.exists():
            try:
                data = json.loads(manifest.read_text(encoding='utf-8'))
                if data.get('start_url') != './' or data.get('scope') != './':
                    ok = fail('Arcade manifest start_url/scope must stay relative (./)') and ok
                if data.get('display') != 'standalone':
                    ok = fail('Arcade manifest display must be standalone') and ok
                sizes = {icon.get('sizes') for icon in data.get('icons', [])}
                for size in ('192x192', '512x512'):
                    if size not in sizes:
                        ok = fail(f'Arcade manifest missing {size} icon') and ok
            except Exception as exc:
                ok = fail(f'cannot parse Arcade manifest: {exc}') and ok
        if registry_path.exists():
            try:
                registry = json.loads(registry_path.read_text(encoding='utf-8'))
                arcade = next((t for t in registry.get('tools', []) if t.get('id') == 'arcade'), None)
                if arcade and arcade.get('version') != '0.7.0':
                    ok = fail('Arcade registry version must match engine 0.7.0') and ok
            except Exception:
                pass

    license_path = root / 'LICENSE'
    if license_path.exists():
        license_text = license_path.read_text(encoding='utf-8')
        if 'MIT License' not in license_text or 'Copyright (c)' not in license_text:
            ok = fail('LICENSE must keep the MIT license text and a copyright line') and ok

    repo_url = 'https://github.com/Shawlaw/studiokit'
    for rel_path in ('index.html', 'shared/site-shell.js'):
        path = root / rel_path
        if path.exists():
            source = path.read_text(encoding='utf-8')
            if repo_url not in source:
                ok = fail(f'{rel_path}: GitHub source link must point to {repo_url}') and ok
            if 'noopener' not in source:
                ok = fail(f'{rel_path}: external source link must set rel=noopener') and ok

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
