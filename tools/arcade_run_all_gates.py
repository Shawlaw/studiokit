#!/usr/bin/env python3
"""Run all offline/regression gates used for Arcade 0.10 local verification.

The script is intentionally simple: each entry is argv for a native tool. Ports are
fixed high values to reduce collisions with interactive test sessions. Environment
variables can override them.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(label: str, args: list[str], env: dict[str, str] | None = None) -> bool:
    print('\n=== ' + label + ' ===', flush=True)
    child_env = os.environ.copy()
    if env:
        child_env.update(env)
    result = subprocess.run(args, cwd=ROOT, env=child_env)
    if result.returncode != 0:
        print('FAILED ' + label + ' (exit ' + str(result.returncode) + ')')
        return False
    return True


def main() -> int:
    checks = [
        ('validate_site', [sys.executable, '-X', 'utf8', 'tools/validate_site.py'], None),
        ('build_site', [sys.executable, '-X', 'utf8', 'tools/build_site.py'], None),
        ('design_regeneration', [sys.executable, '-X', 'utf8', 'tools/arcade_design_check.py'], None),
        ('inline_scripts', ['node', 'tools/check_inline_scripts.mjs'], None),
        ('stage_coverage', ['node', 'tools/arcade_stage_coverage.mjs'], None),
        ('smoke', ['node', 'tools/arcade_smoke.mjs'], {
            'ARCADE_SMOKE_PORT': os.environ.get('ARCADE_SMOKE_PORT', '8821'),
            'ARCADE_CDP_PORT': os.environ.get('ARCADE_CDP_PORT', '9421'),
        }),
        ('zen_scores', ['node', 'tools/arcade_zen_scores_test.mjs'], {
            'ARCADE_ZEN_SCORES_PORT': os.environ.get('ARCADE_ZEN_SCORES_PORT', '8822'),
            'ARCADE_ZEN_SCORES_CDP_PORT': os.environ.get('ARCADE_ZEN_SCORES_CDP_PORT', '9422'),
        }),
        ('calm_games', ['node', 'tools/arcade_calm_games_test.mjs'], {
            'ARCADE_CALM_PORT': os.environ.get('ARCADE_CALM_PORT', '8823'),
            'ARCADE_CALM_CDP_PORT': os.environ.get('ARCADE_CALM_CDP_PORT', '9423'),
        }),
        ('gameplay_all', ['node', 'tools/arcade_gameplay_test.mjs', '--suite=all', '--repeat=1'], {
            'ARCADE_GAMEPLAY_PORT': os.environ.get('ARCADE_GAMEPLAY_PORT', '8824'),
            'ARCADE_GAMEPLAY_CDP_PORT': os.environ.get('ARCADE_GAMEPLAY_CDP_PORT', '9424'),
        }),
        ('gameplay_base', ['node', 'tools/arcade_gameplay_test.mjs', '--suite=base', '--repeat=2'], {
            'ARCADE_GAMEPLAY_PORT': os.environ.get('ARCADE_GAMEPLAY_BASE_PORT', '8825'),
            'ARCADE_GAMEPLAY_CDP_PORT': os.environ.get('ARCADE_GAMEPLAY_BASE_CDP_PORT', '9425'),
        }),
    ]
    failed = []
    for label, args, env in checks:
        if not run(label, args, env):
            failed.append(label)
            break
    if failed:
        print('\nGATES FAILED: ' + ', '.join(failed))
        return 1
    print('\nALL GATES PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
