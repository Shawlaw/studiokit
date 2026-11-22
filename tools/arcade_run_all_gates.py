#!/usr/bin/env python3
"""Run all offline/regression gates used for Arcade 0.11.1 local verification.

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
        ('career_registry', ['node', 'tools/career_registry_test.mjs'], None),
        ('career_discovery', ['node', 'tools/career_discovery_test.mjs'], None),
        ('career_legacy_baseline', ['node', 'tools/career_legacy_baseline_test.mjs'], None),
        ('career_db', ['node', 'tools/career_db_test.mjs'], {
            'CAREER_DB_PORT': os.environ.get('CAREER_DB_PORT', '8830'),
            'CAREER_DB_CDP_PORT': os.environ.get('CAREER_DB_CDP_PORT', '9430'),
        }),
        ('career_backup', ['node', 'tools/career_backup_test.mjs'], {
            'CAREER_BACKUP_PORT': os.environ.get('CAREER_BACKUP_PORT', '8831'),
            'CAREER_BACKUP_CDP_PORT': os.environ.get('CAREER_BACKUP_CDP_PORT', '9431'),
        }),
        ('career_a11y', ['node', 'tools/career_discovery_accessibility_test.mjs'], {
            'CAREER_A11Y_PORT': os.environ.get('CAREER_A11Y_PORT', '8832'),
            'CAREER_A11Y_CDP_PORT': os.environ.get('CAREER_A11Y_CDP_PORT', '9432'),
        }),
        ('career_games_reachability', ['node', 'tools/career_games_reachability_test.mjs'], {
            'CAREER_GAMES_PORT': os.environ.get('CAREER_GAMES_PORT', '8833'),
            'CAREER_GAMES_CDP_PORT': os.environ.get('CAREER_GAMES_CDP_PORT', '9433'),
        }),
        ('career_pwa_offline', ['node', 'tools/career_pwa_offline_test.mjs'], {
            'CAREER_PWA_PORT': os.environ.get('CAREER_PWA_PORT', '8839'),
            'CAREER_PWA_CDP_PORT': os.environ.get('CAREER_PWA_CDP_PORT', '9439'),
        }),
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
        ('review', ['node', 'tools/arcade_review_test.mjs'], {
            'ARCADE_REVIEW_PORT': os.environ.get('ARCADE_REVIEW_PORT', '8826'),
            'ARCADE_REVIEW_CDP_PORT': os.environ.get('ARCADE_REVIEW_CDP_PORT', '9426'),
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
