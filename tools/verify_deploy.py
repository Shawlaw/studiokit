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
    'apps/arcade/index.html',
    'apps/arcade/engine.js',
    'apps/arcade/sw.js',
    'apps/arcade/manifest.webmanifest',
    'apps/arcade/games/gold-miner.html',
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
    registry_arcade = arcade.get('version')
    registry_badge = badge.get('version')

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
    if not registry_arcade or not registry_badge:
        failures.append('registry is missing arcade/badge-studio versions')
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
            f'manifest {result["apps/arcade/manifest.webmanifest"]["content_type"]})'
        )
    print(f'PASS versions: arcade {registry_arcade} (engine/sw/registry), badge {registry_badge}')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
