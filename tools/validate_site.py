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
    'apps/arcade/DESIGN-0.6.0.md', 'apps/arcade/DESIGN-0.8.1.md', 'apps/arcade/DESIGN-0.8.2.md',
    'apps/arcade/DESIGN-0.8.6.md', 'apps/arcade/DESIGN-0.9.0.md', 'apps/arcade/DESIGN-0.10.0.md',
    'apps/arcade/DESIGN-0.11.0.md', 'apps/arcade/DESIGN-0.11.1.md', 'apps/arcade/DESIGN-0.11.2.md', 'apps/arcade/DESIGN-0.11.3.md', 'apps/arcade/DESIGN-0.11.4.md', 'apps/arcade/DESIGN-0.11.5.md', 'apps/arcade/DESIGN-0.12.0.md', 'apps/arcade/DESIGN-0.12.1.md', 'apps/arcade/DESIGN-0.12.2.md', 'apps/arcade/DESIGN-0.12.3.md', 'apps/arcade/DESIGN-0.12.4.md', 'apps/arcade/DESIGN-0.12.5.md', 'apps/arcade/DESIGN-0.12.6.md', 'apps/arcade/DESIGN-0.12.7.md', 'apps/arcade/DESIGN-0.13.1.md', 'apps/arcade/DESIGN-0.13.2.md', 'apps/arcade/DESIGN-0.13.3.md', 'apps/arcade/DESIGN-0.14.0.md', 'apps/arcade/DESIGN-0.15.0.md', 'apps/arcade/DESIGN-0.16.0.md', 'apps/arcade/DESIGN-0.17.0.md', 'apps/arcade/DESIGN-0.18.0.md', 'apps/arcade/DESIGN-0.19.0.md', 'apps/arcade/DESIGN-0.20.0.md', 'apps/arcade/DESIGN-0.21.0.md', 'apps/arcade/DESIGN-0.21.1.md', 'apps/arcade/DESIGN-0.21.2.md', 'apps/arcade/DESIGN-0.22.0.md', 'apps/arcade/DESIGN-0.23.0.md', 'apps/arcade/DESIGN-0.24.0.md', 'apps/arcade/DESIGN-0.24.1.md',
    'apps/arcade/career/ui/market.js', 'apps/arcade/career/ui/workshop.js',
    'apps/arcade/engine.js', 'apps/arcade/arcade.css', 'apps/arcade/sw.js',
    'apps/arcade/manifest.webmanifest',
    'apps/arcade/career/registry.js', 'apps/arcade/career/discovery.js',
    'apps/arcade/career/career-core.js', 'apps/arcade/career/career-db.js',
    'apps/arcade/career/bridge.js', 'apps/arcade/career/router.js',
    'apps/arcade/career/entry-router.js', 'apps/arcade/career/backup.js',
    'apps/arcade/career/commission-core.js', 'apps/arcade/career/star-combat-config.js',
    'apps/arcade/career/commission-schema.js', 'apps/arcade/career/materials.js',
    'apps/arcade/career/crafting.js', 'apps/arcade/career/professions.js',
    'apps/arcade/career/story-evidence.js', 'apps/arcade/career/route-planner.js',
    'apps/arcade/career/campaign-core.js', 'apps/arcade/career/ending-reducer.js',
    'apps/arcade/career/ui/world-state.js',
    'apps/arcade/career/content/campaign.json', 'apps/arcade/career/content/side-stories.json',
    'apps/arcade/career/content/npc.json', 'apps/arcade/career/content/ending-combat.json',
    'apps/arcade/career/content/ending-research.json', 'apps/arcade/career/content/ending-rescue.json',
    'apps/arcade/career/content/chapter-00.json', 'apps/arcade/career/content/chapter-02.json',
    'apps/arcade/career/content/chapter-03.json', 'apps/arcade/career/content/chapter-04.json',
    'apps/arcade/career/content/chapter-05.json',
    'apps/arcade/career/rental.js', 'apps/arcade/career/alternatives.js',
    'apps/arcade/career/content/registry.json', 'apps/arcade/career/content/clues.json',
    'apps/arcade/career/content/commissions.json', 'apps/arcade/career/content/items.json',
    'apps/arcade/career/content/chapter-01.json',
    'apps/arcade/career/ui/clue-surface.js', 'apps/arcade/career/ui/clue-surface.css',
    'apps/arcade/career/ui/mailbox.js', 'apps/arcade/career/ui/settings.js',
    'apps/arcade/career/ui/town.js', 'apps/arcade/career/ui/hangar.js',
    'apps/arcade/career/ui/receipt.js',
    'apps/arcade/icons/icon-192.png', 'apps/arcade/icons/icon-512.png',
    'apps/arcade/icons/maskable-512.png', 'apps/arcade/icons/apple-touch-icon.png',
    'apps/arcade/games/star-raid.html', 'apps/arcade/games/shadow-leap.html',
    'apps/arcade/games/pendulum-tower.html', 'apps/arcade/games/snowbells.html',
    'apps/arcade/games/block-drop.html', 'apps/arcade/games/road-rush.html',
    'apps/arcade/games/gold-miner.html',
    'apps/arcade/games/memory-flip.html', 'apps/arcade/games/merge-2048.html',
    'apps/arcade/games/brick-breaker.html', 'apps/arcade/games/gravity-flip.html',
    'apps/arcade/games/snake-run.html', 'apps/arcade/games/mole-whack.html',
    'apps/arcade/games/blackjack.html', 'apps/arcade/games/gomoku.html',
    'apps/arcade/games/solitaire.html',
    'apps/restaurant-compare/index.html', 'apps/restaurant-compare/README.md', 'apps/restaurant-compare/CHANGELOG.md',
    'templates/single-page-tool/index.html', 'tools/build_site.py', 'tools/new_tool.py',
    'tools/arcade_zen_scores_test.mjs', 'tools/arcade_calm_games_test.mjs', 'tools/arcade_compact_touch_test.mjs',
    'tools/arcade_design_check.py', 'tools/arcade_stage_coverage.mjs',
    'tools/arcade_run_all_gates.py',
    'tools/career_registry_test.mjs', 'tools/career_discovery_test.mjs',
    'tools/career_db_test.mjs', 'tools/career_backup_test.mjs',
    'tools/career_entry_router_test.mjs', 'tools/career_discovery_accessibility_test.mjs',
    'tools/career_games_reachability_test.mjs', 'tools/career_pwa_offline_test.mjs',
    'tools/career_commission_test.mjs', 'tools/career_star_combat_config_test.mjs',
    'tools/career_materials_test.mjs', 'tools/career_professions_test.mjs',
    'tools/career_story_evidence_test.mjs', 'tools/career_route_planner_test.mjs',
    'tools/career_mission_fixture_runner.mjs',
    'tools/career_96_missions_test.mjs', 'tools/career_economy_balance_test.mjs',
    'tools/career_campaign_core_test.mjs', 'tools/career_ending_reducer_test.mjs',
    'tools/career_world_state_test.mjs', 'tools/career_graph_reachability_test.mjs',
    'tools/career_campaign_e2e_test.mjs',
    'tools/career_crystal_alias_test.mjs',
    'tools/career_rental_test.mjs', 'tools/career_alternatives_test.mjs',
    'tools/career_run_resume_test.mjs', 'tools/career_first_flight_test_016.mjs',
    'tools/career_mobile_016_test.mjs',
    'tools/career_legacy_baseline_test.mjs',
]

# 0.9 挑战模式：每款游戏一个生成数据文件（tools/arcade_09_data.mjs 生成，入库）。
ARCADE_CHALLENGE_GAMES = [
    'shadow-leap', 'snowbells', 'star-raid', 'pendulum-tower', 'block-drop',
    'road-rush', 'gold-miner', 'brick-breaker', 'gravity-flip', 'snake-run',
    'mole-whack', 'memory-flip', 'merge-2048',
]
# 0.10.0 新增的平和棋牌小游戏：没有 6 关挑战，但必须同样具备开始/暂停/续玩/道具/测试钩子。
ARCADE_CALM_GAMES = ['blackjack', 'gomoku', 'solitaire']
ARCADE_ALL_GAMES = ARCADE_CHALLENGE_GAMES + ARCADE_CALM_GAMES

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
        if "const ARCADE_VERSION = '0.24.1'" not in source:
            ok = fail('Arcade ARCADE_VERSION drifted; update registry/README/CHANGELOG together') and ok
        for update_marker in ('function checkForUpdate', 'function onUpdate', 'function applyUpdate', "type === 'arcade-sw-update-ready'"):
            if update_marker not in source:
                ok = fail(f'Arcade PWA update-detection marker missing in engine.js: {update_marker}') and ok
        # 0.13.2：更新检测必须回答「线上最新版本」，不能再拿页面自身的 ARCADE_VERSION 冒充。
        # 0.13.3：Cloudflare Pages 的 pretty URL 会去掉 .html，游戏识别不能精确比较文件名。
        for marker in ('function detectCurrentGame', '.html$/i', 'pretty URL', "GAMES.find((g) => g.id.toLowerCase() === file)"):
            if marker not in source:
                ok = fail(f'Arcade 0.13.3 extensionless-URL game detection marker missing in engine.js: {marker}') and ok
        for marker in ('function publishedVersion', 'function compareVersions', 'latestVersion:', 'updateReason:', 'function workerVersion', 'compareVersions(newest, pageVersion)'):
            if marker not in source:
                ok = fail(f'Arcade 0.13.2 update-version marker missing in engine.js: {marker}') and ok
        check_body = source.split('async function checkForUpdate', 1)[-1].split('async function applyUpdate', 1)[0]
        if 'version: ARCADE_VERSION' in check_body or 'updateFound: !!(registration.waiting' in check_body:
            ok = fail('Arcade checkForUpdate must not report the installed page version as latest') and ok
        if source.count("file: '") < 16:
            ok = fail('Arcade GAMES list should contain at least 16 games') and ok
        if "const RUNS_KEY = 'studiokit:arcade:runs:v1'" not in source:
            ok = fail('Arcade run-save key changed; requires migration review') and ok
        if "const PLAYTIME_KEY = 'studiokit:arcade:playtime:v1'" not in source:
            ok = fail('Arcade playtime key changed; requires migration review') and ok
        if 'function installDisplayMode' not in source:
            ok = fail('Arcade fullscreen/immersive helper is missing') and ok
        for marker in ('const Playtime =', 'function formatDuration', 'const Share =', 'const Offline =', 'arcade-precache', 'function createToolbelt', 'PLAYTIME_REST_MS'):
            if marker not in source:
                ok = fail(f'Arcade 0.8.0 marker missing in engine.js: {marker}') and ok
        # 0.13.2：iOS 主屏 PWA 的 window focus/blur 不可靠；游玩计时必须能自愈，
        # 不能再把 focus 当成开始/恢复计时的必要条件（漏一次 focus 就永久停摆）。
        for marker in ('function canTrack', 'function syncSegment', 'markActive', 'resumeIfPlaying'):
            if marker not in source:
                ok = fail(f'Arcade 0.13.2 playtime self-heal marker missing in engine.js: {marker}') and ok
        for stale in ('|| !focused', 'focused = false', 'let focused = true'):
            if stale in source:
                ok = fail(f'Arcade playtime must not gate on unreliable window focus: {stale}') and ok
        # 0.9 平台地基：挑战记录 key + A.Challenge 共享帮助（不改既有版本断言）。
        if "const CHALLENGE_KEY = 'studiokit:arcade:challenge:v1'" not in source:
            ok = fail('Arcade challenge storage key missing/changed: expected studiokit:arcade:challenge:v1') and ok
        if 'const Challenge = {' not in source:
            ok = fail('Arcade A.Challenge shared helper is missing from engine.js') and ok
        if '\n    Challenge,' not in source:
            ok = fail('window.Arcade.Challenge export is missing from engine.js') and ok
        # 0.8.1：积分记录存储 key + A.Scores 共享帮助（新 key，不改既有 Schema）。
        if "const SCORES_KEY = 'studiokit:arcade:scores:v1'" not in source:
            ok = fail('Arcade scores storage key missing/changed: expected studiokit:arcade:scores:v1') and ok
        # 0.13.1：引擎通用游戏数据（星海突击机库等），独立 key + 备份 gameMeta。
        if "const META_KEY = 'studiokit:arcade:meta:v1'" not in source:
            ok = fail('Arcade game-meta storage key missing/changed: expected studiokit:arcade:meta:v1') and ok
        for marker in ('const GameMeta = {', 'gameMeta: GameMeta.exportData()', 'GameMeta.clearAll()', '\n    GameMeta,'):
            if marker not in source:
                ok = fail(f'Arcade 0.13.1 GameMeta marker missing in engine.js: {marker}') and ok
        if 'const Scores = {' not in source:
            ok = fail('Arcade A.Scores shared helper is missing from engine.js') and ok
        if '\n    Scores,' not in source:
            ok = fail('window.Arcade.Scores export is missing from engine.js') and ok
        if 'recordPlay(gameId, score, meta) {' not in source:
            ok = fail('Arcade Progress.recordPlay mode-aware signature missing (0.8.1 zen scores)') and ok
        # 0.14.0：同种弹种叠加 + 星海割草（engine 可选第 4 按钮，其余游戏零变化）。
        for marker in ('dom.ovBtn4', 'o.btn4', 'onBtn4'):
            if marker not in source:
                ok = fail(f'Arcade 0.14.0 optional fourth overlay button marker missing in engine.js: {marker}') and ok
        star_raid = root / 'apps/arcade/games/star-raid.html'
        star_source = star_raid.read_text(encoding='utf-8')
        for stale in ('buffs[type] = Math.max(buffs[type], WEAPONS[type].duration)', 'buffs[p.type] = Math.max(buffs[p.type], WEAPONS[p.type].duration)'):
            if stale in star_source:
                ok = fail('Arcade ammo buff must stack duration, not reset to a fixed value: ' + stale) and ok
        for marker in ('data-ov-btn4', 'const BUFF_STACK_CAP', 'function grantBuff', 'const MOW =', 'function startMow', 'function quitMow', 'function bossMowFire', 'function stageClearMow', '星海割草', 'buffPermanent'):
            if marker not in star_source:
                ok = fail(f'Arcade 0.14.0 star-raid marker missing: {marker}') and ok
        # 0.14.0：割草模式不参与积分/货币，且必须有「无结算/无存档」守护。
        for marker in ("if (mode === 'mow') return null;", "if (mode === 'mow') return quitMow();", 'mowKills += 1'):
            if marker not in star_source:
                ok = fail(f'Arcade 0.14.0 mow no-score guard missing: {marker}') and ok
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
            for marker in ('rel="manifest"', 'data-playtime-section', 'data-scores-section', 'data-scores-body', 'data-scores-empty', 'data-offline', 'data-install', 'data-share', 'data-random', 'data-update-check', 'data-update-banner', 'data-update-reload', '无签到', 'data-hall-version>0.24.1', '发现新版本 v${latest}（当前 v${current}）', '已是最新版本（v'):
                if marker not in index_source:
                    ok = fail(f'Arcade hub 0.13.2 marker missing: {marker}') and ok
            # 0.11.4：iOS 26+ 独立模式顶部系统模糊根因，禁止回归。
            for forbidden in ('viewport-fit=cover', 'apple-mobile-web-app-status-bar-style'):
                if forbidden in index_source:
                    ok = fail(f'Arcade hub must not declare {forbidden} (iOS standalone top blur)') and ok
        arcade_block = root / 'apps/arcade/games/block-drop.html'
        if arcade_block.exists():
            block_source = arcade_block.read_text(encoding='utf-8')
            for marker in ('data-ov-btn3', 'data-hud-zen', 'data-zen-freeze', 'zenSpeedLevel', 'startZen', 'zenInfo', 'zenLineClearScenario'):
                if marker not in block_source:
                    ok = fail(f'Arcade block-drop marker missing: {marker}') and ok
        # 0.11.4：所有 Arcade 页面都不得声明 viewport-fit=cover（iOS 顶缘系统模糊根因）。
        for arcade_html in sorted((root / 'apps/arcade').rglob('*.html')):
            if 'viewport-fit=cover' in arcade_html.read_text(encoding='utf-8'):
                ok = fail(f'{arcade_html.relative_to(root)} must not declare viewport-fit=cover (iOS standalone top blur)') and ok
        # 0.17.0 Arcade Life：16 款游戏的只读微线索适配 + 独立生涯数据层（内容/契约，不含剧透）。
        career_dir = root / 'apps/arcade/career'
        if career_dir.is_dir():
            for game_id in ARCADE_ALL_GAMES:
                game_file = root / 'apps/arcade/games' / f'{game_id}.html'
                if not game_file.exists():
                    ok = fail(f'Arcade game page missing: {game_file.relative_to(root)}') and ok
                    continue
                game_source = game_file.read_text(encoding='utf-8')
                if '<script src="../career/bridge.js"></script>' not in game_source:
                    ok = fail(f'{game_file.relative_to(root)}: missing career bridge script tag') and ok
                if 'const career = window.ArcadeCareer || null;' not in game_source:
                    ok = fail(f'{game_file.relative_to(root)}: missing career handle declaration') and ok
                if 'career.observe(' not in game_source:
                    ok = fail(f'{game_file.relative_to(root)}: missing career.observe hook') and ok
                if 'career.finish(' not in game_source:
                    ok = fail(f'{game_file.relative_to(root)}: missing career.finish call') and ok
            clues_file = career_dir / 'content' / 'clues.json'
            registry_file = career_dir / 'content' / 'registry.json'
            if clues_file.exists() and registry_file.exists():
                try:
                    clue_data = json.loads(clues_file.read_text(encoding='utf-8'))
                    reg_data = json.loads(registry_file.read_text(encoding='utf-8'))
                except json.JSONDecodeError as exc:
                    ok = fail(f'Arcade career content JSON invalid: {exc}') and ok
                else:
                    clues = clue_data.get('clues') or []
                    clue_ids = {c.get('clueId') for c in clues if isinstance(c, dict)}
                    reg_games = reg_data.get('games') or []
                    reg_ids = {g.get('gameId') for g in reg_games if isinstance(g, dict)}
                    if len(clues) != len(ARCADE_ALL_GAMES):
                        ok = fail(f'Arcade career clues must contain {len(ARCADE_ALL_GAMES)} entries, found {len(clues)}') and ok
                    if reg_ids != set(ARCADE_ALL_GAMES):
                        ok = fail('Arcade career registry gameId set must match the 16 arcade games') and ok
                    for game_id in ARCADE_ALL_GAMES:
                        if f'CL-{game_id}' not in clue_ids:
                            ok = fail(f'Arcade career clue missing for {game_id}') and ok
                    for game in reg_games:
                        if isinstance(game, dict) and not game.get('watch'):
                            ok = fail(f'Arcade career registry game {game.get("gameId")} has no watch events') and ok
            else:
                ok = fail('Arcade career content (clues/registry JSON) is missing') and ok
            if 'studiokit:arcade:career' in arcade_engine.read_text(encoding='utf-8'):
                ok = fail('Career storage must live outside engine.js (isolation)') and ok
            sw_file = root / 'apps/arcade/sw.js'
            if sw_file.exists():
                sw_source = sw_file.read_text(encoding='utf-8')
                for marker in ("'./career/bridge.js'", "'./career/content/clues.json'", "'./career/ui/mailbox.js'"):
                    if marker not in sw_source:
                        ok = fail(f'Arcade sw.js CORE_PATHS missing career resource: {marker}') and ok
        else:
            ok = fail('Arcade career runtime directory is missing') and ok
        # 0.16 First Flight：告示板/委托/机库/收据/职业入口的静态契约（内容与接口，不含剧透）。
        career_root = root / 'apps/arcade/career'
        if career_root.is_dir():
            try:
                commissions = json.loads((career_root / 'content/commissions.json').read_text(encoding='utf-8'))
                chapter1 = json.loads((career_root / 'content/chapter-01.json').read_text(encoding='utf-8'))
                items = json.loads((career_root / 'content/items.json').read_text(encoding='utf-8'))
                registry_data = json.loads((career_root / 'content/registry.json').read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError) as exc:
                ok = fail(f'Arcade 0.16 career content JSON invalid: {exc}') and ok
            else:
                commission_list = commissions.get('commissions') or []
                if len(commission_list) != 96:
                    ok = fail(f'Arcade 0.17 commissions must be 96 (16 games x 6 tiers), found {len(commission_list)}') and ok
                commission_ids = set()
                per_game_tiers = {}
                kind_re = re.compile(r'^[a-z0-9][a-z0-9._-]{0,79}$')
                for commission in commission_list:
                    if not isinstance(commission, dict):
                        continue
                    commission_id = commission.get('commissionId')
                    commission_ids.add(commission_id)
                    game_id = commission.get('gameId')
                    tier = commission.get('tier')
                    if game_id not in ARCADE_ALL_GAMES:
                        ok = fail(f'Arcade 0.17 commission {commission_id}: unknown gameId') and ok
                    if not isinstance(tier, int) or tier < 1 or tier > 6:
                        ok = fail(f'Arcade 0.17 commission {commission_id}: tier must be 1..6') and ok
                    elif not str(commission_id).startswith(f'{game_id}.T{tier}'):
                        ok = fail(f'Arcade 0.17 commission {commission_id}: id/tier mismatch') and ok
                    per_game_tiers.setdefault(game_id, set()).add(tier)
                    objective = commission.get('objective') or {}
                    if not kind_re.match(str(objective.get('kind') or '')):
                        ok = fail(f'Arcade 0.17 commission {commission_id}: invalid objective kind') and ok
                    if not isinstance(objective.get('atLeast'), int) or objective.get('atLeast') < 1:
                        ok = fail(f'Arcade 0.17 commission {commission_id}: atLeast must be >=1') and ok
                    min_value = objective.get('minValue')
                    if min_value is not None:
                        if not isinstance(min_value, dict) or not kind_re.match(str(min_value.get('field') or '')) or not isinstance(min_value.get('value'), (int, float)):
                            ok = fail(f'Arcade 0.17 commission {commission_id}: invalid minValue') and ok
                    if not isinstance(commission.get('unlock'), dict):
                        ok = fail(f'Arcade 0.17 commission {commission_id}: missing unlock') and ok
                    salary = commission.get('repeatSalaryCredits')
                    if not isinstance(salary, int) or salary < 0 or salary > 400:
                        ok = fail(f'Arcade 0.17 commission {commission_id}: bad repeatSalaryCredits') and ok
                    if isinstance(tier, int) and tier >= 4 and not commission.get('chapterGate'):
                        ok = fail(f'Arcade 0.17 commission {commission_id}: T4-T6 must declare chapterGate') and ok
                for game_id in ARCADE_ALL_GAMES:
                    if per_game_tiers.get(game_id) != {1, 2, 3, 4, 5, 6}:
                        ok = fail(f'Arcade 0.17 game {game_id}: must define T1-T6') and ok
                origins = chapter1.get('origins') or []
                if len(origins) != len(ARCADE_ALL_GAMES):
                    ok = fail(f'Arcade 0.16 chapter-01 origins must be {len(ARCADE_ALL_GAMES)}, found {len(origins)}') and ok
                if {o.get('gameId') for o in origins if isinstance(o, dict)} != set(ARCADE_ALL_GAMES):
                    ok = fail('Arcade 0.16 chapter-01 origins must cover all 16 games') and ok
                ships = items.get('ships') or []
                if len(ships) != 4:
                    ok = fail(f'Arcade 0.16 items.json must define 4 ships, found {len(ships)}') and ok
                prices = {s.get('price') for s in ships if isinstance(s, dict)}
                if prices != {260, 480, 520, 540}:
                    ok = fail(f'Arcade 0.16 ship prices changed: {sorted(prices)}') and ok
                materials = items.get('materials') or []
                if len(materials) != 5:
                    ok = fail(f'Arcade 0.17 items.json must define 5 materials, found {len(materials)}') and ok
                for material in materials:
                    if not isinstance(material, dict) or not material.get('itemId'):
                        continue
                    buy = material.get('buyPrice')
                    sell = material.get('sellPrice')
                    if not isinstance(buy, int) or not isinstance(sell, int) or sell > buy * 0.6:
                        ok = fail(f'Arcade 0.17 material {material.get("itemId")}: sell price must be <= buy*0.6') and ok
            bridge_source = (career_root / 'bridge.js').read_text(encoding='utf-8')
            for marker in ('TICKET_KEY', "commission-core.js", "lazy: true", 'getCommissionLoadout', 'openTown', 'openHangar', 'openReceipt', 'openMarket', 'openWorkshop', "materials.js", "crafting.js", "storyEvidence"):
                if marker not in bridge_source:
                    ok = fail(f'Arcade 0.16 bridge marker missing: {marker}') and ok
            sw_file = root / 'apps/arcade/sw.js'
            if sw_file.exists():
                sw_source = sw_file.read_text(encoding='utf-8')
                for resource in ('commission-core.js', 'star-combat-config.js', 'rental.js', 'alternatives.js',
                                 'commission-schema.js', 'materials.js', 'crafting.js', 'professions.js',
                                 'story-evidence.js', 'route-planner.js',
                                 'content/commissions.json', 'content/items.json', 'content/chapter-01.json',
                                 'ui/town.js', 'ui/hangar.js', 'ui/receipt.js', 'ui/market.js', 'ui/workshop.js'):
                    if f"'./career/{resource}'" not in sw_source:
                        ok = fail(f'Arcade 0.16 sw.js CORE_PATHS missing career resource: {resource}') and ok
            for page_name, marker in (('pendulum-tower.html', 'careerGoal'), ('star-raid.html', 'career-mission-line')):
                page_file = root / 'apps/arcade/games' / page_name
                if page_file.exists() and marker not in page_file.read_text(encoding='utf-8'):
                    ok = fail(f'Arcade 0.16 {page_name} career marker missing: {marker}') and ok
        # 0.8.6：所有经典/禅模式「再来一局」必须回到模式选择，不得直接 startGame/startZenRound。
        # 只在同一个 showOverlay/show 调用的参数范围内判断（遇到 } 即停），避免把后面紧邻的
        # function startGame() 定义误判成结算回调。
        replay_direct = re.compile(
            r"btn\s*:\s*['\"]再来一局['\"][^}]{0,160}?(?:onBtn|onBtn2)\s*:\s*(?:\(\s*\)\s*=>\s*)?(?:startGame|startZenRound)\b"
        )
        for game_id in ARCADE_ALL_GAMES:
            game_page = root / f'apps/arcade/games/{game_id}.html'
            if not game_page.exists():
                ok = fail(f'Arcade game page missing: {game_page.relative_to(root)}') and ok
                continue
            game_source = game_page.read_text(encoding='utf-8')
            if replay_direct.search(game_source):
                ok = fail(f'{game_page.relative_to(root)}: 再来一局仍直接重开，未返回模式选择') and ok
        # 0.10.0：三款平和棋牌必须共用 Arcade 接入契约（暂停/续玩/2 个可选道具/测试钩子）。
        for game_id in ARCADE_CALM_GAMES:
            game_page = root / f'apps/arcade/games/{game_id}.html'
            if not game_page.exists():
                continue
            calm_source = game_page.read_text(encoding='utf-8')
            for marker in ('A.createRunAutosave(', 'A.createToolbelt(', 'A.bindPause(', 'window.__arcadeTest', 'data-pause', 'data-ov-btn'):
                if marker not in calm_source:
                    ok = fail(f'{game_page.relative_to(root)}: calm-game marker missing: {marker}') and ok
        snake_page = root / 'apps/arcade/games/snake-run.html'
        if snake_page.exists():
            snake_source = snake_page.read_text(encoding='utf-8')
            for marker in ('data-dir="U"', 'data-dir="L"', 'data-dir="D"', 'data-dir="R"', 'function queueSteer', "addEventListener('pointermove', readSwipe)"):
                if marker not in snake_source:
                    ok = fail(f'Arcade snake steering marker missing: {marker}') and ok
        arcade_sw = root / 'apps/arcade/sw.js'
        if arcade_sw.exists():
            sw_source = arcade_sw.read_text(encoding='utf-8')
            for marker in ("const VERSION = '0.24.1'", 'arcade-precache', 'skipWaiting', 'clients.claim', "type === 'arcade-sw-version'", "type: 'arcade-sw-update-ready'", 'notifyUpdateReady', 'isUpdateActivation', 'replacedOldVersion'):
                if marker not in sw_source:
                    ok = fail(f'Arcade service worker marker missing: {marker}') and ok
            # 0.13.2：activate 广播必须用「旧版本缓存是否还在」判断升级接管；
            # 模块级 firstActivation 标志每个 SW 实例都从 true 开始，永远不会广播。
            if 'firstActivation' in sw_source and '!firstActivation' in sw_source:
                ok = fail('Arcade SW must not gate update broadcast on firstActivation (never fires)') and ok
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
                if arcade and arcade.get('version') != '0.24.1':
                    ok = fail('Arcade registry version must match engine 0.24.1') and ok
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

    # 根 README 的状态徽章写死了可用工具数；注册表变化时必须同步，否则徽章会说谎。
    readme_path = root / 'README.md'
    if readme_path.exists() and registry_path.exists():
        try:
            registry = json.loads(registry_path.read_text(encoding='utf-8'))
            available = sum(
                1 for tool in registry.get('tools', [])
                if isinstance(tool, dict) and tool.get('status') == 'available'
            )
            badge = re.search(r'已上线 (\d+) 个工具', readme_path.read_text(encoding='utf-8'))
            if badge and int(badge.group(1)) != available:
                ok = fail(
                    f'README status badge says {badge.group(1)} available tools, '
                    f'registry has {available}; update the badge with the registry'
                ) and ok
        except (ValueError, OSError):
            pass

    if ok:
        print(f'PASS: StudioKit validation succeeded ({root})')
    return ok

if __name__ == '__main__':
    raise SystemExit(0 if validate() else 1)
