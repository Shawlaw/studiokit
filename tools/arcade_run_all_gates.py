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


def run(label: str, args: list[str], env: dict[str, str] | None = None, attempts: int = 1) -> bool:
    print('\n=== ' + label + ' ===', flush=True)
    child_env = os.environ.copy()
    if env:
        child_env.update(env)
    for attempt in range(1, attempts + 1):
        result = subprocess.run(args, cwd=ROOT, env=child_env)
        if result.returncode == 0:
            return True
        if attempt < attempts:
            print('RETRY ' + label + ' (' + str(attempt) + '/' + str(attempts) + ' failed, exit ' + str(result.returncode) + ')', flush=True)
    print('FAILED ' + label + ' (exit ' + str(result.returncode) + ')')
    return False


def main() -> int:
    checks = [
        ('validate_site', [sys.executable, '-X', 'utf8', 'tools/validate_site.py'], None),
        ('build_site', [sys.executable, '-X', 'utf8', 'tools/build_site.py'], None),
        ('design_regeneration', [sys.executable, '-X', 'utf8', 'tools/arcade_design_check.py'], None),
        ('inline_scripts', ['node', 'tools/check_inline_scripts.mjs'], None),
        ('career_registry', ['node', 'tools/career_registry_test.mjs'], None),
        ('career_discovery', ['node', 'tools/career_discovery_test.mjs'], None),
        ('career_legacy_baseline', ['node', 'tools/career_legacy_baseline_test.mjs'], None),
        ('career_rental', ['node', 'tools/career_rental_test.mjs'], None),
        ('career_alternatives', ['node', 'tools/career_alternatives_test.mjs'], None),
        ('career_commission', ['node', 'tools/career_commission_test.mjs'], None),
        ('career_materials', ['node', 'tools/career_materials_test.mjs'], None),
        ('career_professions', ['node', 'tools/career_professions_test.mjs'], None),
        ('career_story_evidence', ['node', 'tools/career_story_evidence_test.mjs'], None),
        ('career_route_planner', ['node', 'tools/career_route_planner_test.mjs'], None),
        ('career_economy_balance', ['node', 'tools/career_economy_balance_test.mjs'], None),
        ('career_crystal_alias', ['node', 'tools/career_crystal_alias_test.mjs'], {
            'CAREER_CRYSTAL_PORT': os.environ.get('CAREER_CRYSTAL_PORT', '8991'),
            'CAREER_CRYSTAL_CDP': os.environ.get('CAREER_CRYSTAL_CDP', '9591'),
        }),
        ('career_mission_schema', ['node', 'tools/career_mission_fixture_runner.mjs', '--validate'], None),
        ('career_star_combat_config', ['node', 'tools/career_star_combat_config_test.mjs'], None),
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
        ('career_run_resume', ['node', 'tools/career_run_resume_test.mjs'], {
            'CAREER_RESUME_PORT': os.environ.get('CAREER_RESUME_PORT', '8880'),
            'CAREER_RESUME_CDP': os.environ.get('CAREER_RESUME_CDP', '9480'),
        }),
        ('career_96_missions', ['node', 'tools/career_96_missions_test.mjs'], {
            'M96_PORT': os.environ.get('M96_PORT', '8942'),
            'M96_CDP': os.environ.get('M96_CDP', '9542'),
        }),
        ('career_mobile', ['node', 'tools/career_mobile_016_test.mjs'], {
            'CAREER_MOBILE_PORT': os.environ.get('CAREER_MOBILE_PORT', '8882'),
            'CAREER_MOBILE_CDP': os.environ.get('CAREER_MOBILE_CDP', '9482'),
        }),
        ('career_campaign_core', ['node', 'tools/career_campaign_core_test.mjs'], None),
        ('career_ending_reducer', ['node', 'tools/career_ending_reducer_test.mjs'], None),
        ('career_graph_reachability', ['node', 'tools/career_graph_reachability_test.mjs'], None),
        ('career_world_state', ['node', 'tools/career_world_state_test.mjs'], {
            'WORLD18_PORT': os.environ.get('WORLD18_PORT', '8994'),
            'WORLD18_CDP': os.environ.get('WORLD18_CDP', '9594'),
        }),
        ('career_campaign_e2e', ['node', 'tools/career_campaign_e2e_test.mjs'], {
            'C18_E2E_PORT': os.environ.get('C18_E2E_PORT', '8996'),
            'C18_E2E_CDP': os.environ.get('C18_E2E_CDP', '9596'),
        }),
        ('career_review3_regression', ['node', 'tools/career_review3_regression_test.mjs'], None),
        ('career_review4_same_route', ['node', 'tools/career_review4_same_route_test.mjs'], None),
        ('career_review5_import', ['node', 'tools/career_review5_import_test.mjs'], None),
        ('career_closeout', ['node', 'tools/career_closeout_test.mjs'], None),
        ('career_chrome_isolation', ['node', 'tools/career_chrome_isolation_test.mjs'], None),
        ('career_review3_workshop', ['node', 'tools/career_review3_workshop_test.mjs'], None),
        ('career_route_evidence', ['node', 'tools/career_route_evidence_test.mjs'], None),
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
        ('compact_touch', ['node', 'tools/arcade_compact_touch_test.mjs'], {
            'ARCADE_COMPACT_PORT': os.environ.get('ARCADE_COMPACT_PORT', '8827'),
            'ARCADE_COMPACT_CDP': os.environ.get('ARCADE_COMPACT_CDP', '9427'),
        }),
        ('gameplay_all', ['node', 'tools/arcade_gameplay_test.mjs', '--suite=all', '--repeat=1'], {
            'ARCADE_GAMEPLAY_PORT': os.environ.get('ARCADE_GAMEPLAY_PORT', '8824'),
            'ARCADE_GAMEPLAY_CDP_PORT': os.environ.get('ARCADE_GAMEPLAY_CDP_PORT', '9424'),
        }, 2),
        ('gameplay_base', ['node', 'tools/arcade_gameplay_test.mjs', '--suite=base', '--repeat=2'], {
            'ARCADE_GAMEPLAY_PORT': os.environ.get('ARCADE_GAMEPLAY_BASE_PORT', '8825'),
            'ARCADE_GAMEPLAY_CDP_PORT': os.environ.get('ARCADE_GAMEPLAY_BASE_CDP_PORT', '9425'),
        }, 2),
        # 0.20 生涯首航 V2 新增纯 Node 门禁（无 Chrome、无端口占用）。
        ('career_continuation', ['node', 'tools/career_continuation_test.mjs'], None),
        ('career_recommendation', ['node', 'tools/career_recommendation_test.mjs'], None),
        ('career_route_consistency', ['node', 'tools/career_route_consistency_test.mjs'], None),
        ('career_receipt_feedback', ['node', 'tools/career_receipt_feedback_test.mjs'], None),
        ('career_mailbox_flow', ['node', 'tools/career_mailbox_flow_test.mjs'], None),
        ('career_town_flow', ['node', 'tools/career_town_flow_test.mjs'], None),
        ('career_town_recommend_preload', ['node', 'tools/career_town_recommend_preload_test.mjs'], None),
        ('career_origin_letter', ['node', 'tools/career_origin_letter_test.mjs'], None),
        # 0.20 零种子完整首航：Chrome 长跑门禁，独占 CDP，串行运行时放最后。
        ('career_flow_e2e', ['node', 'tools/career_flow_e2e_test.mjs'], {
            'CAREER_FLOW_PORT': os.environ.get('CAREER_FLOW_PORT', '9901'),
            'CAREER_FLOW_CDP': os.environ.get('CAREER_FLOW_CDP', '10301'),
        }),
    ]
    failed = []
    for label, args, env, *rest in checks:
        attempts = rest[0] if rest else 1
        if not run(label, args, env, attempts):
            failed.append(label)
            break
    if failed:
        print('\nGATES FAILED: ' + ', '.join(failed))
        return 1
    print('\nALL GATES PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
