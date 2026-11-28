#!/usr/bin/env python3
"""Verify that every deployment target serves the same StudioKit release."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    'index.html',
    'favicon.svg',
    'shared/home.js',
    'shared/site-shell.js',
    'shared/tool-registry.json',
    'apps/badge-studio/index.html',
    'apps/restaurant-compare/index.html',
    'apps/arcade/index.html',
    'apps/arcade/engine.js',
    'apps/arcade/arcade.css',
    'apps/arcade/sw.js',
    'apps/arcade/manifest.webmanifest',
    'apps/arcade/DESIGN-0.20.0.md',
    'apps/arcade/DESIGN-0.21.0.md',
    'apps/arcade/DESIGN-0.21.1.md',
    'apps/arcade/DESIGN-0.21.2.md',
    'apps/arcade/DESIGN-0.22.0.md',
    'apps/arcade/DESIGN-0.23.0.md',
    'apps/arcade/DESIGN-0.24.0.md',
    'apps/arcade/DESIGN-0.24.1.md',
    'apps/arcade/career/bridge.js',
    'apps/arcade/career/router.js',
    'apps/arcade/career/registry.js',
    'apps/arcade/career/discovery.js',
    'apps/arcade/career/profession-state.js',
    'apps/arcade/career/profession-view.js',
    'apps/arcade/career/career-core.js',
    'apps/arcade/career/career-db.js',
    'apps/arcade/career/entry-router.js',
    'apps/arcade/career/backup.js',
    'apps/arcade/career/commission-core.js',
    'apps/arcade/career/commission-schema.js',
    'apps/arcade/career/materials.js',
    'apps/arcade/career/crafting.js',
    'apps/arcade/career/professions.js',
    'apps/arcade/career/story-evidence.js',
    'apps/arcade/career/route-planner.js',
    'apps/arcade/career/campaign-core.js',
    'apps/arcade/career/ending-reducer.js',
    'apps/arcade/career/star-combat-config.js',
    'apps/arcade/career/rental.js',
    'apps/arcade/career/alternatives.js',
    'apps/arcade/career/world-narrative.js',
    'apps/arcade/career/content/registry.json',
    'apps/arcade/career/content/clues.json',
    'apps/arcade/career/content/commissions.json',
    'apps/arcade/career/content/world-work.json',
    'apps/arcade/career/content/world-narrative.json',
    'apps/arcade/career/content/narrative-registry.json',
    'apps/arcade/career/content/narrative-shards/shard-01.json',
    'apps/arcade/career/content/narrative-shards/shard-02.json',
    'apps/arcade/career/content/narrative-shards/shard-03.json',
    'apps/arcade/career/content/narrative-shards/shard-04.json',
    'apps/arcade/career/content/items.json',
    'apps/arcade/career/content/chapter-01.json',
    'apps/arcade/career/content/campaign.json',
    'apps/arcade/career/content/chapter-00.json',
    'apps/arcade/career/content/chapter-02.json',
    'apps/arcade/career/content/chapter-03.json',
    'apps/arcade/career/content/chapter-04.json',
    'apps/arcade/career/content/chapter-05.json',
    'apps/arcade/career/content/ending-combat.json',
    'apps/arcade/career/content/ending-research.json',
    'apps/arcade/career/content/ending-rescue.json',
    'apps/arcade/career/content/npc.json',
    'apps/arcade/career/content/side-stories.json',
    'apps/arcade/career/ui/clue-surface.js',
    'apps/arcade/career/ui/clue-surface.css',
    'apps/arcade/career/ui/components.js',
    'apps/arcade/career/ui/components.css',
    'apps/arcade/career/ui/harbor.js',
    'apps/arcade/career/ui/tokens.css',
    'apps/arcade/career/ui/invitation.js',
    'apps/arcade/career/ui/mailbox.js',
    'apps/arcade/career/ui/settings.js',
    'apps/arcade/career/ui/town.js',
    'apps/arcade/career/ui/hangar.js',
    'apps/arcade/career/ui/receipt.js',
    'apps/arcade/career/ui/market.js',
    'apps/arcade/career/ui/workshop.js',
    'apps/arcade/career/ui/world-state.js',
    'apps/arcade/career/ui/journal.js',
    'apps/arcade/games/memory-flip.html',
    'apps/arcade/games/merge-2048.html',
    'apps/arcade/games/snowbells.html',
    'apps/arcade/games/brick-breaker.html',
    'apps/arcade/games/gravity-flip.html',
    'apps/arcade/games/snake-run.html',
    'apps/arcade/games/mole-whack.html',
    'apps/arcade/games/block-drop.html',
    'apps/arcade/games/star-raid.html',
    'apps/arcade/games/road-rush.html',
    'apps/arcade/games/shadow-leap.html',
    'apps/arcade/games/pendulum-tower.html',
    'apps/arcade/games/gold-miner.html',
    'apps/arcade/games/blackjack.html',
    'apps/arcade/games/gomoku.html',
    'apps/arcade/games/solitaire.html',
    'apps/arcade/challenge/block-drop.js',
    'apps/arcade/challenge/brick-breaker.js',
    'apps/arcade/challenge/gold-miner.js',
    'apps/arcade/challenge/gravity-flip.js',
    'apps/arcade/challenge/memory-flip.js',
    'apps/arcade/challenge/merge-2048.js',
    'apps/arcade/challenge/mole-whack.js',
    'apps/arcade/challenge/pendulum-tower.js',
    'apps/arcade/challenge/road-rush.js',
    'apps/arcade/challenge/shadow-leap.js',
    'apps/arcade/challenge/snake-run.js',
    'apps/arcade/challenge/snowbells.js',
    'apps/arcade/challenge/star-raid.js',
]
TEXT_SUFFIXES = {'.html', '.css', '.js', '.json', '.webmanifest', '.svg', '.txt'}
USER_AGENT = 'StudioKit-deploy-check/1.0 (+https://github.com/Shawlaw/studiokit)'


def normalize(payload: bytes, path: str) -> bytes:
    """Compare text payloads independently of Windows/Linux line endings."""
    if Path(path).suffix.lower() in TEXT_SUFFIXES:
        return payload.replace(b'\r\n', b'\n')
    return payload


def digest(payload: bytes, path: str) -> str:
    return hashlib.sha256(normalize(payload, path)).hexdigest()


def fetch(url: str, timeout: float) -> tuple[str, bytes]:
    request = Request(url, headers={'User-Agent': USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        return response.headers.get('Content-Type', ''), response.read()


def fetch_retry(url: str, retries: int, delay: float, timeout: float) -> tuple[str, bytes]:
    last_error = 'unknown error'
    for attempt in range(1, retries + 1):
        try:
            content_type, payload = fetch(url, timeout)
            if payload:
                return content_type, payload
            last_error = 'empty response body'
        except HTTPError as exc:
            last_error = f'HTTP {exc.code}'
        except (URLError, TimeoutError, OSError) as exc:
            last_error = str(exc)
        if attempt < retries:
            time.sleep(delay)
    raise RuntimeError(f'{last_error} after {retries} attempts')


def get_version(pattern: str, text: str, label: str) -> str:
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError(f'cannot find {label} version marker')
    return match.group(1)


def check_content_type(path: str, content_type: str) -> list[str]:
    lower = content_type.lower()
    if path.endswith('.html') and 'text/html' not in lower:
        return [f'{path}: expected text/html, got {content_type!r}']
    if path.endswith('.js') and 'javascript' not in lower:
        return [f'{path}: expected javascript content type, got {content_type!r}']
    if path.endswith('.webmanifest') and 'manifest+json' not in lower:
        return [f'{path}: expected application/manifest+json, got {content_type!r}']
    if path.endswith('.svg') and 'image/svg+xml' not in lower:
        return [f'{path}: expected image/svg+xml, got {content_type!r}']
    return []


def verify_base(base: str, retries: int, delay: float, timeout: float) -> dict:
    base = base.rstrip('/') + '/'
    results = {}
    for path in PATHS:
        url = base + quote(path)
        content_type, payload = fetch_retry(url, retries, delay, timeout)
        problems = check_content_type(path, content_type)
        if problems:
            raise RuntimeError('; '.join(problems))
        results[path] = {
            'content_type': content_type,
            'body': payload,
            'hash': digest(payload, path),
        }
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', action='append', required=True, help='deployment base URL; repeat for every target')
    parser.add_argument('--retries', type=int, default=12, help='attempts per file (default: 12)')
    parser.add_argument('--delay', type=float, default=5.0, help='seconds between attempts (default: 5)')
    parser.add_argument('--timeout', type=float, default=30.0, help='HTTP timeout in seconds (default: 30)')
    args = parser.parse_args(argv)

    bases = [base.strip() for base in args.base if base.strip()]
    if not bases:
        parser.error('at least one non-empty --base is required')

    results = {}
    for base in bases:
        try:
            results[base] = verify_base(base, args.retries, args.delay, args.timeout)
        except RuntimeError as exc:
            print(f'FAIL {base}: {exc}', file=sys.stderr)
            return 1

    if len(results) > 1:
        mismatches = []
        for path in PATHS:
            hashes = {base: result[path]['hash'] for base, result in results.items()}
            if len(set(hashes.values())) != 1:
                mismatches.append((path, hashes))
        if mismatches:
            for path, hashes in mismatches:
                print(f'FAIL {path}: deployment byte hashes differ', file=sys.stderr)
                for base, value in hashes.items():
                    print(f'  {base}: {value[:16]}', file=sys.stderr)
            return 1
        print(f'PASS cross-origin: {len(PATHS)}/{len(PATHS)} files identical across {len(bases)} targets')

    first = next(iter(results.values()))
    try:
        registry = json.loads(first['shared/tool-registry.json']['body'].decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f'FAIL cannot parse remote tool registry: {exc}', file=sys.stderr)
        return 1

    tools = {tool.get('id'): tool for tool in registry.get('tools', []) if isinstance(tool, dict)}
    arcade = tools.get('arcade', {})
    badge = tools.get('badge-studio', {})
    venue = tools.get('restaurant-compare', {})
    registry_arcade = arcade.get('version')
    registry_badge = badge.get('version')
    registry_venue = venue.get('version')
    venue_status = venue.get('status')

    try:
        engine_arcade = get_version(
            r"const ARCADE_VERSION = '([^']+)'",
            first['apps/arcade/engine.js']['body'].decode('utf-8'),
            'engine',
        )
        sw_arcade = get_version(
            r"const VERSION = '([^']+)'",
            first['apps/arcade/sw.js']['body'].decode('utf-8'),
            'service worker',
        )
        badge_app = get_version(
            r"const APP_VERSION = '([^']+)'",
            first['apps/badge-studio/index.html']['body'].decode('utf-8'),
            'Badge Studio',
        )
        venue_app = get_version(
            r"const APP_VERSION = '([^']+)'",
            first['apps/restaurant-compare/index.html']['body'].decode('utf-8'),
            'Venue Compare',
        )
    except (UnicodeDecodeError, RuntimeError) as exc:
        print(f'FAIL cannot read remote version markers: {exc}', file=sys.stderr)
        return 1

    failures = []
    if not (engine_arcade == sw_arcade == registry_arcade):
        failures.append(
            f'Arcade versions differ: engine={engine_arcade}, sw={sw_arcade}, registry={registry_arcade}'
        )
    if badge_app != registry_badge:
        failures.append(f'Badge Studio versions differ: app={badge_app}, registry={registry_badge}')
    if venue_app != registry_venue:
        failures.append(f'Venue Compare versions differ: app={venue_app}, registry={registry_venue}')
    if venue_status != 'available':
        failures.append(f'restaurant-compare registry status is {venue_status!r}, expected available')
    if not registry_arcade or not registry_badge or not registry_venue:
        failures.append('registry is missing arcade/badge-studio/restaurant-compare versions')
    if failures:
        for failure in failures:
            print(f'FAIL {failure}', file=sys.stderr)
        return 1

    if b'StudioKit' not in first['index.html']['body']:
        print('FAIL index.html does not contain the StudioKit brand', file=sys.stderr)
        return 1

    for base, result in results.items():
        print(
            f'PASS {base} ({len(PATHS)} files, arcade {registry_arcade}, badge {registry_badge}, '
            f'venue {registry_venue}, manifest {result["apps/arcade/manifest.webmanifest"]["content_type"]})'
        )
    print(f'PASS versions: arcade {registry_arcade} (engine/sw/registry), badge {registry_badge}, venue {registry_venue} (available)')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
