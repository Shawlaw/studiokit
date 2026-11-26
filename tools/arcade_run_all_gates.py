#!/usr/bin/env python3
"""Run Arcade regression gates in three layers (static / release / full).

Profiles (see tools/README-gates.md):
  static  - validation, build, every pure-Node gate, 96 --static, flow --static-only.
            No Chrome is launched; the only subprocesses are python/node.
  release - static plus a serial critical Chrome set (smoke, isolation, gameplay
            base, mobile, PWA, full first-flight flow, affected 96 games).
  full    - the historical complete gate list, unchanged and strictly serial.

Defaults are backward compatible: no flags means ``--profile full``. Environment
variables can override the fixed high ports to avoid collisions with interactive
test sessions. Every item records its real wall-clock duration and attempts;
a JSON summary is printed at the end. Environment errors / skipped items are
never reported as a pass.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]

STATIC = 'static'
CHROME = 'chrome'

# Profile membership. A gate may appear in several profiles; ``kind`` controls
# whether it is allowed to run in parallel (only static gates are).
P_ALL = (STATIC, 'release', 'full')
# Chrome gates never appear in static. Critical Chrome gates appear in release
# and full; non-critical ones only in full.
P_CHROME_RELEASE = ('release', 'full')
P_CHROME_FULL = ('full',)


def _gate(label, args, env=None, attempts=1, kind=STATIC, profiles=None, args_by_profile=None):
    """Describe one gate. ``args_by_profile`` overrides args for a profile."""
    if profiles is None:
        profiles = P_ALL if kind == STATIC else P_CHROME_FULL
    return {
        'label': label,
        'args': args,
        'env': env or {},
        'attempts': attempts,
        'kind': kind,
        'profiles': tuple(profiles),
        'args_by_profile': args_by_profile or {},
    }


def _env(name, fallback):
    return os.environ.get(name, fallback)


def gates():
    """Return the gate registry in the historical full-run order."""
    return [
        _gate('validate_site', [sys.executable, '-X', 'utf8', 'tools/validate_site.py']),
        _gate('build_site', [sys.executable, '-X', 'utf8', 'tools/build_site.py']),
        _gate('design_regeneration', [sys.executable, '-X', 'utf8', 'tools/arcade_design_check.py']),
        _gate('inline_scripts', ['node', 'tools/check_inline_scripts.mjs']),
        _gate('career_registry', ['node', 'tools/career_registry_test.mjs']),
        _gate('career_discovery', ['node', 'tools/career_discovery_test.mjs']),
        _gate('career_legacy_baseline', ['node', 'tools/career_legacy_baseline_test.mjs']),
        _gate('career_rental', ['node', 'tools/career_rental_test.mjs']),
        _gate('career_alternatives', ['node', 'tools/career_alternatives_test.mjs']),
        _gate('career_commission', ['node', 'tools/career_commission_test.mjs']),
        _gate('career_materials', ['node', 'tools/career_materials_test.mjs']),
        _gate('career_professions', ['node', 'tools/career_professions_test.mjs']),
        _gate('career_story_evidence', ['node', 'tools/career_story_evidence_test.mjs']),
        _gate('career_route_planner', ['node', 'tools/career_route_planner_test.mjs']),
        _gate('career_economy_balance', ['node', 'tools/career_economy_balance_test.mjs']),
        _gate('career_crystal_alias', ['node', 'tools/career_crystal_alias_test.mjs'], {
            'CAREER_CRYSTAL_PORT': _env('CAREER_CRYSTAL_PORT', '8991'),
            'CAREER_CRYSTAL_CDP': _env('CAREER_CRYSTAL_CDP', '9591'),
        }, kind=CHROME),
        _gate('career_mission_schema', ['node', 'tools/career_mission_fixture_runner.mjs', '--validate']),
        _gate('career_star_combat_config', ['node', 'tools/career_star_combat_config_test.mjs']),
        _gate('career_db', ['node', 'tools/career_db_test.mjs'], {
            'CAREER_DB_PORT': _env('CAREER_DB_PORT', '8830'),
            'CAREER_DB_CDP_PORT': _env('CAREER_DB_CDP_PORT', '9430'),
        }, kind=CHROME),
        _gate('career_backup', ['node', 'tools/career_backup_test.mjs'], {
            'CAREER_BACKUP_PORT': _env('CAREER_BACKUP_PORT', '8831'),
            'CAREER_BACKUP_CDP_PORT': _env('CAREER_BACKUP_CDP_PORT', '9431'),
        }, kind=CHROME),
        _gate('career_a11y', ['node', 'tools/career_discovery_accessibility_test.mjs'], {
            'CAREER_A11Y_PORT': _env('CAREER_A11Y_PORT', '8832'),
            'CAREER_A11Y_CDP_PORT': _env('CAREER_A11Y_CDP_PORT', '9432'),
        }, kind=CHROME),
        _gate('career_games_reachability', ['node', 'tools/career_games_reachability_test.mjs'], {
            'CAREER_GAMES_PORT': _env('CAREER_GAMES_PORT', '8833'),
            'CAREER_GAMES_CDP_PORT': _env('CAREER_GAMES_CDP_PORT', '9433'),
        }, kind=CHROME),
        _gate('career_pwa_offline', ['node', 'tools/career_pwa_offline_test.mjs'], {
            'CAREER_PWA_PORT': _env('CAREER_PWA_PORT', '8839'),
            'CAREER_PWA_CDP_PORT': _env('CAREER_PWA_CDP_PORT', '9439'),
        }, kind=CHROME, profiles=P_CHROME_RELEASE),
        _gate('career_run_resume', ['node', 'tools/career_run_resume_test.mjs'], {
            'CAREER_RESUME_PORT': _env('CAREER_RESUME_PORT', '8880'),
            'CAREER_RESUME_CDP': _env('CAREER_RESUME_CDP', '9480'),
        }, kind=CHROME),
        _gate('career_96_missions', ['node', 'tools/career_96_missions_test.mjs'], {
            'M96_PORT': _env('M96_PORT', '8942'),
            'M96_CDP': _env('M96_CDP', '9542'),
        }, kind=CHROME, profiles=P_ALL, args_by_profile={
            STATIC: ['node', 'tools/career_96_missions_test.mjs', '--static'],
            'release': ['node', 'tools/career_96_missions_test.mjs', '--e2e', '--skip-static'],
            'full': ['node', 'tools/career_96_missions_test.mjs'],
        }),
        _gate('career_mobile', ['node', 'tools/career_mobile_016_test.mjs'], {
            'CAREER_MOBILE_PORT': _env('CAREER_MOBILE_PORT', '8882'),
            'CAREER_MOBILE_CDP': _env('CAREER_MOBILE_CDP', '9482'),
        }, kind=CHROME, profiles=P_CHROME_RELEASE),
        _gate('career_campaign_core', ['node', 'tools/career_campaign_core_test.mjs']),
        _gate('career_ending_reducer', ['node', 'tools/career_ending_reducer_test.mjs']),
        _gate('career_graph_reachability', ['node', 'tools/career_graph_reachability_test.mjs']),
        _gate('career_world_state', ['node', 'tools/career_world_state_test.mjs'], {
            'WORLD18_PORT': _env('WORLD18_PORT', '8994'),
            'WORLD18_CDP': _env('WORLD18_CDP', '9594'),
        }, kind=CHROME),
        _gate('career_campaign_e2e', ['node', 'tools/career_campaign_e2e_test.mjs'], {
            'C18_E2E_PORT': _env('C18_E2E_PORT', '8996'),
            'C18_E2E_CDP': _env('C18_E2E_CDP', '9596'),
        }, kind=CHROME),
        _gate('career_review3_regression', ['node', 'tools/career_review3_regression_test.mjs'], kind=CHROME),
        _gate('career_review4_same_route', ['node', 'tools/career_review4_same_route_test.mjs'], kind=CHROME),
        _gate('career_review5_import', ['node', 'tools/career_review5_import_test.mjs'], kind=CHROME),
        _gate('career_closeout', ['node', 'tools/career_closeout_test.mjs'], kind=CHROME),
        _gate('career_chrome_isolation', ['node', 'tools/career_chrome_isolation_test.mjs'], kind=CHROME, profiles=P_CHROME_RELEASE),
        _gate('career_review3_workshop', ['node', 'tools/career_review3_workshop_test.mjs'], kind=CHROME),
        _gate('career_route_evidence', ['node', 'tools/career_route_evidence_test.mjs']),
        _gate('stage_coverage', ['node', 'tools/arcade_stage_coverage.mjs']),
        _gate('smoke', ['node', 'tools/arcade_smoke.mjs'], {
            'ARCADE_SMOKE_PORT': _env('ARCADE_SMOKE_PORT', '8821'),
            'ARCADE_CDP_PORT': _env('ARCADE_CDP_PORT', '9421'),
        }, kind=CHROME, profiles=P_CHROME_RELEASE),
        _gate('zen_scores', ['node', 'tools/arcade_zen_scores_test.mjs'], {
            'ARCADE_ZEN_SCORES_PORT': _env('ARCADE_ZEN_SCORES_PORT', '8822'),
            'ARCADE_ZEN_SCORES_CDP_PORT': _env('ARCADE_ZEN_SCORES_CDP_PORT', '9422'),
        }, kind=CHROME),
        _gate('calm_games', ['node', 'tools/arcade_calm_games_test.mjs'], {
            'ARCADE_CALM_PORT': _env('ARCADE_CALM_PORT', '8823'),
            'ARCADE_CALM_CDP_PORT': _env('ARCADE_CALM_CDP_PORT', '9423'),
        }, kind=CHROME),
        _gate('review', ['node', 'tools/arcade_review_test.mjs'], {
            'ARCADE_REVIEW_PORT': _env('ARCADE_REVIEW_PORT', '8826'),
            'ARCADE_REVIEW_CDP_PORT': _env('ARCADE_REVIEW_CDP_PORT', '9426'),
        }, kind=CHROME),
        _gate('compact_touch', ['node', 'tools/arcade_compact_touch_test.mjs'], {
            'ARCADE_COMPACT_PORT': _env('ARCADE_COMPACT_PORT', '8827'),
            'ARCADE_COMPACT_CDP': _env('ARCADE_COMPACT_CDP', '9427'),
        }, kind=CHROME),
        _gate('gameplay_all', ['node', 'tools/arcade_gameplay_test.mjs', '--suite=all', '--repeat=1'], {
            'ARCADE_GAMEPLAY_PORT': _env('ARCADE_GAMEPLAY_PORT', '8824'),
            'ARCADE_GAMEPLAY_CDP_PORT': _env('ARCADE_GAMEPLAY_CDP_PORT', '9424'),
        }, 2, kind=CHROME),
        _gate('gameplay_base', ['node', 'tools/arcade_gameplay_test.mjs', '--suite=base', '--repeat=2'], {
            'ARCADE_GAMEPLAY_PORT': _env('ARCADE_GAMEPLAY_BASE_PORT', '8825'),
            'ARCADE_GAMEPLAY_CDP_PORT': _env('ARCADE_GAMEPLAY_BASE_CDP_PORT', '9425'),
        }, 2, kind=CHROME, profiles=P_CHROME_RELEASE),
        # 0.20 生涯首航 V2 新增纯 Node 门禁（无 Chrome、无端口占用）。
        _gate('career_continuation', ['node', 'tools/career_continuation_test.mjs']),
        _gate('career_recommendation', ['node', 'tools/career_recommendation_test.mjs']),
        _gate('career_route_consistency', ['node', 'tools/career_route_consistency_test.mjs']),
        _gate('career_receipt_feedback', ['node', 'tools/career_receipt_feedback_test.mjs']),
        _gate('career_mailbox_flow', ['node', 'tools/career_mailbox_flow_test.mjs']),
        _gate('career_town_flow', ['node', 'tools/career_town_flow_test.mjs']),
        _gate('career_town_recommend_preload', ['node', 'tools/career_town_recommend_preload_test.mjs']),
        _gate('career_origin_letter', ['node', 'tools/career_origin_letter_test.mjs']),
        _gate('career_archive', ['node', 'tools/career_archive_test.mjs']),
        _gate('career_passive_entry', ['node', 'tools/career_passive_entry_test.mjs']),
        _gate('career_narrative_voice', ['node', 'tools/career_narrative_voice_test.mjs']),
        # 0.20 零种子完整首航：Chrome 长跑门禁，独占 CDP，串行运行时放最后。
        _gate('career_flow_e2e', ['node', 'tools/career_flow_e2e_test.mjs'], {
            'CAREER_FLOW_PORT': _env('CAREER_FLOW_PORT', '9901'),
            'CAREER_FLOW_CDP': _env('CAREER_FLOW_CDP', '10301'),
        }, kind=CHROME, profiles=P_ALL, args_by_profile={
            STATIC: ['node', 'tools/career_flow_e2e_test.mjs', '--static-only'],
            'release': ['node', 'tools/career_flow_e2e_test.mjs'],
            'full': ['node', 'tools/career_flow_e2e_test.mjs'],
        }),
    ]


def selected_gates(profile):
    """Return gate descriptors enabled for ``profile`` (registry order)."""
    return [gate for gate in gates() if profile in gate['profiles']]


def args_for(gate, profile):
    return gate['args_by_profile'].get(profile, gate['args'])


def effective_kind(gate, profile):
    """Chrome-capable gates become static in the static profile when their
    per-profile args request a static-only mode (96 --static / flow --static-only)."""
    if gate['kind'] == CHROME and profile == STATIC:
        args = args_for(gate, profile)
        if '--static' in args or '--static-only' in args:
            return STATIC
    return gate['kind']


def format_duration(seconds):
    return str(round(seconds, 3)) + 's'


def run(label, args, env=None, attempts=1):
    """Execute one gate with retries. Returns a result dict with real timings.

    ``status`` is one of pass / fail / error. Exit code 0 with no environment
    failure is the only path to ``pass``. RETRY lines are preserved.
    """
    started = time.monotonic()
    wall_started = time.time()
    print('\n=== ' + label + ' ===', flush=True)
    child_env = os.environ.copy()
    if env:
        child_env.update(env)
    used = 0
    last_exit = None
    status = 'fail'
    error = None
    for attempt in range(1, attempts + 1):
        used = attempt
        try:
            result = subprocess.run(args, cwd=str(ROOT), env=child_env)
            last_exit = result.returncode
            if result.returncode == 0:
                status = 'pass'
                break
        except OSError as exc:
            last_exit = None
            error = str(exc)
            status = 'error'
            break
        if attempt < attempts:
            print('RETRY ' + label + ' (' + str(attempt) + '/' + str(attempts) +
                  ' failed, exit ' + str(last_exit) + ')', flush=True)
    if status == 'fail':
        print('FAILED ' + label + ' (exit ' + str(last_exit) + ')', flush=True)
    elif status == 'error':
        print('ERROR ' + label + ' (' + str(error) + ')', flush=True)
    duration = time.monotonic() - started
    if status == 'pass':
        print('PASS ' + label + ' in ' + format_duration(duration), flush=True)
    return {
        'label': label,
        'status': status,
        'exit': last_exit,
        'attempts': used,
        'duration_s': round(duration, 3),
        'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(wall_started)),
        'error': error,
    }


def run_static_parallel(items, workers):
    """Run independent static gates in a bounded thread pool, preserving order."""
    results = [None] * len(items)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for index, (label, args, env, attempts) in enumerate(items):
            futures[pool.submit(run, label, args, env, attempts)] = index
        for future in concurrent.futures.as_completed(futures):
            results[futures[future]] = future.result()
    return results


def build_summary(profile, results, total_duration, workers):
    passed = sum(1 for item in results if item['status'] == 'pass')
    failed = [item['label'] for item in results if item['status'] != 'pass']
    return {
        'profile': profile,
        'outcome': 'passed' if not failed else 'failed',
        # Distinct labels so release success is never mistaken for full success.
        'verdict': {
            'static': 'static passed' if not failed else 'static failed',
            'release': 'release passed (not full)' if not failed else 'release failed',
            'full': 'full passed' if not failed else 'full failed',
        }[profile],
        'fully_passed': profile == 'full' and not failed,
        'static_parallel_workers': workers,
        'totals': {
            'items': len(results),
            'passed': passed,
            'failed': len(failed),
            'failed_labels': failed,
            'duration_s': round(total_duration, 3),
        },
        'results': results,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Run Arcade regression gates in static / release / full layers.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=('Profiles:\n'
                '  static   validation, build, pure Node gates, 96 --static, flow --static-only\n'
                '  release  static + serial critical Chrome set (not the full set)\n'
                '  full     complete historical gate set, strictly serial (default)\n\n'
                'A JSON summary is printed after PROFILE SUMMARY with real timings.'),
    )
    parser.add_argument('--profile', choices=('static', 'release', 'full'), default='full',
                        help='gate profile (default: full, backward compatible)')
    parser.add_argument('--workers', type=int, default=3,
                        help='max parallel workers for static gates, 1..4 (default: 3); Chrome always serial')
    parsed = parser.parse_args(argv)
    profile = parsed.profile
    workers = parsed.workers
    if not 1 <= workers <= 4:
        parser.error('--workers must be between 1 and 4')

    enabled = selected_gates(profile)
    static_items = []
    chrome_items = []
    for gate in enabled:
        entry = (gate['label'], args_for(gate, profile), gate['env'], gate['attempts'])
        (static_items if effective_kind(gate, profile) == STATIC else chrome_items).append(entry)

    print('PROFILE ' + profile + '  static=' + str(len(static_items)) +
          '  chrome=' + str(len(chrome_items)) +
          '  staticWorkers=' + str(workers if profile != 'full' else 1), flush=True)
    started = time.monotonic()
    results = []
    if profile == 'full':
        # full keeps the exact historical serial order, including interleaved
        # static gates, so the combined list is executed as-is.
        serial = [(gate['label'], args_for(gate, profile), gate['env'], gate['attempts'])
                  for gate in enabled]
        for label, cmd, env, attempts in serial:
            results.append(run(label, cmd, env, attempts))
    else:
        if static_items:
            if workers == 1:
                for label, cmd, env, attempts in static_items:
                    results.append(run(label, cmd, env, attempts))
            else:
                results.extend(run_static_parallel(static_items, workers))
        # Chrome gates run strictly serially, after all static gates.
        for label, cmd, env, attempts in chrome_items:
            results.append(run(label, cmd, env, attempts))

    total_duration = time.monotonic() - started
    summary = build_summary(profile, results, total_duration, workers if profile != 'full' else 1)
    print('\nPROFILE SUMMARY\n' + json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if profile == 'full':
        print('\n' + ('ALL GATES PASSED' if not summary['totals']['failed'] else
                      'GATES FAILED: ' + ', '.join(summary['totals']['failed_labels'])))
    else:
        print('\n' + summary['verdict'].upper())
    return 0 if not summary['totals']['failed'] else 1


if __name__ == '__main__':
    sys.exit(main())
