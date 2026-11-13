#!/usr/bin/env node
/**
 * Arcade 0.8.0《影跃》「影之试炼」S1–S3 独立可达性求解器（零 npm 依赖）
 * ============================================================================
 * 用途：读取 docs/arcade/stages-0.8.json（或嵌入后的 shadow-leap.html），按
 *       《影跃》当前经典模式的真实物理逐段验证手工关卡可达性，并给出证据。
 *
 * 物理忠实来源：apps/arcade/games/shadow-leap.html（HEAD 已核对）
 *   GRAVITY=1500, JUMP_V=-640（落地自动起跳）, MAX_FALL=900
 *   ACC=2400, MAX_VX=265, 无输入阻尼 vx -= vx*min(1,12*dt)
 *   触墙：x<-w/2 或 x>W-w/2 时夹住并以 0.95 反弹（保留速度）
 *   单向平台：vy>=0 且 prevBottom<=p.y+0.6 且 当前底>=p.y 且水平重叠（+2/-2 内缩）
 *   moving: p.phase += p.speed*dt; p.x = clamp(baseX+sin(phase)*range, 4, W-w-4)
 *   fragile: 着陆即 broken=true，0.22s 后移除（期间无碰撞）
 *   player 26x30；关卡宽 420。
 * 影冲（Lead 规格 / GP004 接口约定，本求解器作为唯一参考实现）：
 *   DASH_SPEED=620, DASH_TIME=0.13（固定步长下 8 帧 ≈ 82.7px），冲刺期重力 ×0.25，
 *   每次着陆补满一次，空中最多一次，冲刺结束夹回 ±265，着陆即终止并补满。
 *
 * 求解方法（诚实、有限、可复现）：
 *   1) 逐段独立验证：从起点平台的多个着陆位置（整段均布）+ 多个着陆初速
 *      (−220 / 0 / +220) 出发，使用有限控制策略集合（朝目标方向加速 / 接近
 *      减速反向 / 瞄准点偏左偏右 / 对 moving 平台做/不做落点预测），搜索能否在
 *      不借用后续平台（只允许在起点平台反复起跳）的前提下落到目标平台。
 *      requiresDash:false 的段只允许不使用影冲。
 *   2) 连续通关验证：按路线顺序逐段做束搜索（每段从上一段的真实落点继续），
 *      证明存在一条连续无失误通关轨迹，并输出理论最短用时。
 *   3) 影冲证明：requiresDash:true 的路线必须 (a) 关键段几何上无影冲不可能
 *      （所需横移 > 265px/s × 该 Δy 的滞空时间上限，或 Δy > 136.5px），
 *      (b) 逐段搜索确认无影冲 0 成功，(c) 枚举“第几帧向左/右冲”证明一次影冲可过，
 *      (d) 全局“无影冲必要上界超集图”证明从起点平台到不了影门。
 *   4) 影门 / 卷轴 / 失败回收 / 数据约束分别验证。
 *
 * 随机性：不使用 Math.random；所有采样都是确定性网格，因此无需 seed。
 *
 * 用法：
 *   node tools/arcade_stage_solver.mjs --stages=docs/arcade/stages-0.8.json
 *   node tools/arcade_stage_solver.mjs --stages=apps/arcade/games/shadow-leap.html --json
 *   node tools/arcade_stage_solver.mjs --stages=... --trace=S3:main:9
 * 参数：--stages=<path> 必填；--json 机器可读；--trace=<stageId:routeId:segIndex>
 *       --quick（减少采样，仅调试）；--verbose。
 * 退出码：0 全部 PASS；1 存在 FAIL；2 参数/读取/解析错误。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOOL_VERSION = 1;

/* ============================== 物理常量 ============================== */
const DT = 1 / 60;
const STAGE_W = 420;
const PLAYER_W = 26;
const PLAYER_H = 30;
const PLATFORM_H = 12;
const GRAVITY = 1500;
const JUMP_V = -640;
const MAX_FALL = 900;
const ACC = 2400;
const MAX_VX = 265;
const WALL_BOUNCE = 0.95;
const LAND_TOL = 0.6;
const DASH_SPEED = 620;
const DASH_TIME = 0.13;
const DASH_GRAVITY_SCALE = 0.25;
const FRAGILE_BREAK = 0.22;
const MAX_JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAVITY); // 136.5333
const DASH_FRAMES = Math.round(DASH_TIME / DT); // 8 帧
const DASH_TIME_ACTUAL = DASH_FRAMES * DT;
const DASH_RISE_1 = Math.abs(JUMP_V) * DASH_TIME_ACTUAL - 0.5 * GRAVITY * DASH_GRAVITY_SCALE * DASH_TIME_ACTUAL * DASH_TIME_ACTUAL;
const DASH_RISE_2 = Math.pow(Math.abs(JUMP_V) - GRAVITY * DASH_GRAVITY_SCALE * DASH_TIME_ACTUAL, 2) / (2 * GRAVITY);
const MAX_DASH_RISE = DASH_RISE_1 + DASH_RISE_2; // 一次影冲可额外获得的上升高度 ≈198.03px
const SCROLL_W = 18;
const SCROLL_H = 22;

const EXPECTED_PHYSICS = Object.freeze({
  gravity: GRAVITY,
  jumpV: JUMP_V,
  maxFall: MAX_FALL,
  accel: ACC,
  maxVx: MAX_VX,
  dashSpeed: DASH_SPEED,
  dashTime: DASH_TIME,
  dashGravityScale: DASH_GRAVITY_SCALE,
  wallBounce: WALL_BOUNCE,
});

const PHYSICS_KEYS = Object.keys(EXPECTED_PHYSICS);
const TOP_KEYS = ['version', 'designWidth', 'player', 'physics', 'stages'];
const STAGE_KEYS = ['id', 'title', 'height', 'start', 'goal', 'platforms', 'scrolls', 'routes', 'targetSeconds'];
const PLATFORM_KEYS = ['x', 'y', 'w', 'kind', 'baseX', 'range', 'speed', 'phase'];
const ROUTE_KEYS = ['id', 'label', 'requiresDash', 'platforms'];
const SCROLL_KEYS = ['id', 'x', 'y', 'label'];

/* ============================== 小工具 ============================== */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const fmt = (v, n = 2) => Number(v).toFixed(n);
const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);

function sampleRange(lo, hi, n) {
  if (n <= 1) return [(lo + hi) / 2];
  const step = (hi - lo) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + step * i);
  return out;
}

function intervalGap(a, b) {
  if (a[1] < b[0]) return b[0] - a[1];
  if (b[1] < a[0]) return a[0] - b[1];
  return 0;
}

/* ============================== 命令行 ============================== */
function parseArgs(argv) {
  const opts = { stages: null, json: false, trace: null, verbose: false, quick: false, help: false };
  for (const raw of argv) {
    const arg = String(raw);
    if (arg === '--json') opts.json = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--quick') opts.quick = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--stages=')) opts.stages = arg.slice('--stages='.length);
    else if (arg.startsWith('--trace=')) opts.trace = arg.slice('--trace='.length);
    else throw new UsageError(`未知参数: ${arg}`);
  }
  return opts;
}

class UsageError extends Error {}

const USAGE = `用法:
  node tools/arcade_stage_solver.mjs --stages=<path> [--json] [--trace=<stageId:routeId:segIndex>] [--quick] [--verbose]
  <path> 可以是 .json，或嵌入后含 /* STAGES-JSON-BEGIN */ ... /* STAGES-JSON-END */ 的 .html
退出码: 0 全部 PASS / 1 存在 FAIL / 2 参数或解析错误`;

/* ============================== 读取数据 ============================== */
/** 标记之间允许是纯 JSON，也允许是 `const STAGE_DATA_JSON = String.raw`{...}`;` 形式。 */
function coerceEmbeddedJson(raw) {
  const s = raw.trim();
  const wrapped = s.match(/^(?:const|let|var)\s+[\w$]+\s*=\s*(?:String\.raw\s*)?`([\s\S]*)`\s*;?\s*$/);
  if (wrapped) return wrapped[1].trim();
  if (s.startsWith('`') && s.endsWith('`')) return s.slice(1, -1).trim();
  return s;
}

function loadStageData(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new UsageError(`无法读取 --stages 文件: ${filePath} (${err.message})`);
  }
  text = text.replace(/^\uFEFF/, '');
  let jsonText = text;
  if (/\.html?$/i.test(filePath)) {
    const BEGIN = '/* STAGES-JSON-BEGIN */';
    const END = '/* STAGES-JSON-END */';
    const i = text.indexOf(BEGIN);
    const j = text.indexOf(END);
    if (i < 0 || j < 0 || j <= i) {
      throw new UsageError(`HTML 中找不到 ${BEGIN} 与 ${END} 标记（或顺序错误）: ${filePath}`);
    }
    jsonText = coerceEmbeddedJson(text.slice(i + BEGIN.length, j));
    if (!jsonText) throw new UsageError('STAGES-JSON 标记之间为空');
  }
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new UsageError(`JSON 解析失败: ${err.message}`);
  }
}

/* ============================== 数据契约校验 ============================== */
function schemaCheck(data) {
  const errors = [];
  const warnings = [];
  const err = (code, msg) => errors.push({ code, msg });
  const warn = (code, msg) => warnings.push({ code, msg });

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exactKeys = (obj, allowed, label) => {
    const keys = Object.keys(obj);
    for (const k of keys) if (!allowed.includes(k)) err('schema.unknown-key', `${label} 含契约外字段 "${k}"`);
    for (const k of allowed) if (!(k in obj)) err('schema.missing-key', `${label} 缺少字段 "${k}"`);
  };

  if (!isPlainObject(data)) {
    err('schema.root', '根节点必须是对象');
    return { errors, warnings };
  }
  exactKeys(data, TOP_KEYS, '根节点');
  if (data.version !== 1) err('schema.version', `version 必须为 1（当前 ${JSON.stringify(data.version)}）`);
  if (data.designWidth !== STAGE_W) err('schema.designWidth', `designWidth 必须为 ${STAGE_W}`);
  if (!isPlainObject(data.player)) err('schema.player', 'player 必须是对象');
  else {
    exactKeys(data.player, ['w', 'h'], 'player');
    if (data.player.w !== PLAYER_W || data.player.h !== PLAYER_H) {
      err('schema.player-size', `player 必须为 ${PLAYER_W}x${PLAYER_H}（页面常量 26x30）`);
    }
  }
  if (!isPlainObject(data.physics)) err('schema.physics', 'physics 必须是对象');
  else {
    exactKeys(data.physics, PHYSICS_KEYS, 'physics');
    for (const k of PHYSICS_KEYS) {
      if (data.physics[k] !== EXPECTED_PHYSICS[k]) {
        err('schema.physics-value', `physics.${k}=${JSON.stringify(data.physics[k])} 与页面实现 ${EXPECTED_PHYSICS[k]} 不一致`);
      }
    }
  }
  if (!Array.isArray(data.stages) || data.stages.length === 0) {
    err('schema.stages', 'stages 必须是非空数组');
    return { errors, warnings };
  }

  const seenIds = new Set();
  for (let si = 0; si < data.stages.length; si++) {
    const stage = data.stages[si];
    const label = `stages[${si}]`;
    const errStart = errors.length;
    const warnStart = warnings.length;
    if (!isPlainObject(stage)) {
      err('schema.stage', `${label} 必须是对象`);
      for (let k = errStart; k < errors.length; k++) errors[k].stageIndex = si;
    for (let k = warnStart; k < warnings.length; k++) warnings[k].stageIndex = si;
      continue;
    }
    exactKeys(stage, STAGE_KEYS, label);
    const sid = stage.id;
    if (typeof sid !== 'string' || !/^S\d+$/.test(sid)) err('schema.stage-id', `${label}.id 必须形如 "S1"`);
    else if (seenIds.has(sid)) err('schema.stage-id-dup', `关卡 id 重复: ${sid}`);
    else seenIds.add(sid);
    if (typeof stage.title !== 'string' || !stage.title.trim()) err('schema.stage-title', `${sid}.title 必须是非空字符串`);
    if (!Number.isInteger(stage.height) || stage.height < 1500 || stage.height > 2400) {
      err('schema.stage-height', `${sid}.height 必须是 1500–2400 的整数（当前 ${stage.height}）`);
    }

    /* start */
    if (!isPlainObject(stage.start) || !finiteNum(stage.start.x) || !finiteNum(stage.start.y)) {
      err('schema.start', `${sid}.start 必须是 {x,y} 数字`);
    }
    /* goal */
    const goal = stage.goal;
    if (!isPlainObject(goal) || !finiteNum(goal.x) || !finiteNum(goal.y) || !finiteNum(goal.w) || !finiteNum(goal.h)) {
      err('schema.goal', `${sid}.goal 必须是 {x,y,w,h} 数字`);
    } else {
      if (goal.w < 32 || goal.h < 40) err('schema.goal-size', `${sid}.goal 尺寸过小（w=${goal.w}, h=${goal.h}）`);
      if (goal.x < 4 || goal.x + goal.w > STAGE_W - 4) err('schema.goal-bounds', `${sid}.goal 超出关卡宽度`);
      if (goal.y < 24) err('schema.goal-top', `${sid}.goal 太贴近顶边（y=${goal.y}）`);
    }

    /* platforms */
    const platforms = stage.platforms;
    if (!Array.isArray(platforms) || platforms.length < 8) {
      err('schema.platforms', `${sid}.platforms 必须是至少 8 块的数组`);
      continue;
    }
    let kinds = { normal: 0, moving: 0, fragile: 0 };
    let prevY = Infinity;
    platforms.forEach((p, i) => {
      const pl = `${sid}.platforms[${i}]`;
      if (!isPlainObject(p)) {
        err('schema.platform', `${pl} 必须是对象`);
        return;
      }
      exactKeys(p, PLATFORM_KEYS, pl);
      if (!finiteNum(p.x) || !finiteNum(p.y) || !finiteNum(p.w)) {
        err('schema.platform-num', `${pl} x/y/w 必须是数字`);
        return;
      }
      if (!Number.isInteger(p.w) || p.w < 50 || p.w > 420) err('schema.platform-width', `${pl}.w=${p.w} 超出合理范围 50–420`);
      if (p.w > 200) warn('platform.very-wide', `${pl}.w=${p.w} 为超宽平台（只应作为回收/兜底台）`);
      if (p.x < 4 || p.x + p.w > STAGE_W - 4) err('schema.platform-bounds', `${pl} 水平越界 (x=${p.x}, w=${p.w})`);
      if (p.y <= 0 || p.y >= stage.height - 8) err('schema.platform-y', `${pl}.y=${p.y} 越界`);
      if (!['normal', 'moving', 'fragile'].includes(p.kind)) err('schema.platform-kind', `${pl}.kind=${p.kind} 非法`);
      if (!finiteNum(p.baseX) || !finiteNum(p.range) || !finiteNum(p.speed) || !finiteNum(p.phase)) {
        err('schema.platform-mech', `${pl} baseX/range/speed/phase 必须是数字`);
      } else if (p.kind === 'moving') {
        if (!(p.range > 0 && p.range <= 30)) err('schema.moving-range', `${pl}.range=${p.range} 必须在 (0,30]`);
        if (!(p.speed >= 0.8 && p.speed <= 1.4)) err('schema.moving-speed', `${pl}.speed=${p.speed} 必须在 [0.8,1.4]`);
        if (p.baseX - p.range < 4 || p.baseX + p.range > STAGE_W - p.w - 4) {
          err('schema.moving-bounds', `${pl} baseX±range 越界`);
        }
        const expectX = clamp(p.baseX + Math.sin(p.phase) * p.range, 4, STAGE_W - p.w - 4);
        if (Math.abs(expectX - p.x) > 0.01) {
          err('schema.moving-x', `${pl}.x=${p.x} 与 baseX+sin(phase)*range=${r2(expectX)} 不一致`);
        }
      } else {
        if (p.baseX !== p.x || p.range !== 0 || p.speed !== 0 || p.phase !== 0) {
          err('schema.static-fields', `${pl} 非 moving 平台必须 baseX=x, range=speed=phase=0`);
        }
      }
      if (p.kind in kinds) kinds[p.kind] += 1;
      if (!(p.y < prevY)) err('schema.platform-order', `${pl} 必须按 y 从上到下（升序路径）排列；当前 y=${p.y} 不小于上一块 ${prevY}`);
      prevY = p.y;
    });

    /* routes */
    const routes = stage.routes;
    if (!Array.isArray(routes) || routes.length === 0) {
      err('schema.routes', `${sid}.routes 必须是非空数组`);
    } else {
      const routeIds = new Set();
      routes.forEach((route, ri) => {
        const rl = `${sid}.routes[${ri}]`;
        if (!isPlainObject(route)) {
          err('schema.route', `${rl} 必须是对象`);
          return;
        }
        exactKeys(route, ROUTE_KEYS, rl);
        if (typeof route.id !== 'string' || !route.id) err('schema.route-id', `${rl}.id 必须是非空字符串`);
        else if (routeIds.has(route.id)) err('schema.route-id-dup', `${sid} 路线 id 重复: ${route.id}`);
        else routeIds.add(route.id);
        if (typeof route.label !== 'string' || !route.label.trim()) err('schema.route-label', `${rl}.label 必须是非空字符串`);
        if (typeof route.requiresDash !== 'boolean') err('schema.route-dash', `${rl}.requiresDash 必须是布尔值`);
        if (!Array.isArray(route.platforms) || route.platforms.length < 2) {
          err('schema.route-platforms', `${rl}.platforms 必须是至少 2 个索引的数组`);
          return;
        }
        const seen = new Set();
        route.platforms.forEach((idx, k) => {
          if (!Number.isInteger(idx) || idx < 0 || idx >= platforms.length) {
            err('schema.route-index', `${rl}.platforms[${k}]=${idx} 不是合法平台索引`);
            return;
          }
          if (seen.has(idx)) err('schema.route-repeat', `${rl} 平台索引重复: ${idx}`);
          seen.add(idx);
          if (k > 0) {
            const prev = platforms[route.platforms[k - 1]];
            const cur = platforms[idx];
            if (cur.y >= prev.y) {
              err('schema.route-order', `${rl} 必须按高度上升排列（索引 ${route.platforms[k - 1]}->${idx}，y ${prev.y}->${cur.y}）`);
            } else if (prev.y - cur.y > MAX_JUMP_HEIGHT + 1) {
              warn('route.jump-too-high', `${rl} 段 ${route.platforms[k - 1]}->${idx} 竖直差 ${r2(prev.y - cur.y)}px 超过理论最大上升 ${r2(MAX_JUMP_HEIGHT)}px`);
            }
          }
        });
        if (route.platforms.length >= 2 && route.platforms[0] !== 0) {
          // 起点平台由外部 start 校验推导后复核
        }
      });
    }

    /* targetSeconds */
    if (!finiteNum(stage.targetSeconds) || stage.targetSeconds < 45 || stage.targetSeconds > 120) {
      err('schema.target-seconds', `${sid}.targetSeconds 必须在 45–120 之间（当前 ${stage.targetSeconds}）`);
    }

    /* scrolls */
    const scrolls = stage.scrolls;
    if (!Array.isArray(scrolls) || scrolls.length === 0) {
      err('schema.scrolls', `${sid}.scrolls 必须是非空数组（可为每关 1 枚）`);
    } else {
      const scrollIds = new Set();
      scrolls.forEach((sc, k) => {
        const sl = `${sid}.scrolls[${k}]`;
        if (!isPlainObject(sc)) {
          err('schema.scroll', `${sl} 必须是对象`);
          return;
        }
        exactKeys(sc, SCROLL_KEYS, sl);
        if (typeof sc.id !== 'string' || !sc.id) err('schema.scroll-id', `${sl}.id 必须是非空字符串`);
        else if (scrollIds.has(sc.id)) err('schema.scroll-id-dup', `${sid} 卷轴 id 重复: ${sc.id}`);
        else scrollIds.add(sc.id);
        if (typeof sc.label !== 'string' || !sc.label.trim()) err('schema.scroll-label', `${sl}.label 必须是非空字符串`);
        if (!finiteNum(sc.x) || !finiteNum(sc.y)) {
          err('schema.scroll-pos', `${sl}.x/y 必须是数字`);
          return;
        }
        const rect = scrollRect(sc);
        if (rect.x < 0 || rect.x + rect.w > STAGE_W || rect.y < 0 || rect.y + rect.h > stage.height) {
          err('schema.scroll-bounds', `${sl} 拾取矩形越界`);
        }
        if (goal && isPlainObject(goal)) {
          if (rectsOverlap(rect, goal)) err('schema.scroll-goal', `${sl} 与影门重叠`);
        }
        for (let pi = 0; pi < platforms.length; pi++) {
          const p = platforms[pi];
          if (!isPlainObject(p) || !finiteNum(p.y) || !finiteNum(p.x)) continue;
          const platRect = { x: p.x, y: p.y, w: p.w, h: PLATFORM_H };
          if (rectsOverlap(rect, platRect)) err('schema.scroll-platform', `${sl} 与平台 ${pi} 重叠`);
        }
      });
    }

    /* 顶部影门 + 起点平台 + 安全区（需要先找起点平台） */
    if (goal && isPlainObject(goal) && finiteNum(goal.y) && finiteNum(goal.h) && Array.isArray(platforms)) {
      const minY = Math.min(...platforms.filter((p) => isPlainObject(p) && finiteNum(p.y)).map((p) => p.y));
      if (Number.isFinite(minY) && goal.y + goal.h >= minY) {
        err('schema.goal-not-top', `${sid}.goal 底边 ${goal.y + goal.h} 必须高于最高平台 ${minY}（影门在顶部）`);
      }
      for (let pi = 0; pi < platforms.length; pi++) {
        const p = platforms[pi];
        if (!isPlainObject(p) || !finiteNum(p.y)) continue;
        const platRect = { x: p.x, y: p.y, w: p.w, h: PLATFORM_H };
        if (rectsOverlap(goal, platRect)) err('schema.goal-blocked', `${sid}.goal 被平台 ${pi} 遮挡`);
      }
    }

    if (isPlainObject(stage.start) && finiteNum(stage.start.x) && finiteNum(stage.start.y) && Array.isArray(platforms)) {
      const startPlat = findStartPlatform(stage);
      if (startPlat < 0) {
        err('schema.start-platform', `${sid}.start 没有落在任何平台上方（start.y+30 应略高于平台顶面）`);
      } else {
        const p = platforms[startPlat];
        const gap = p.y - (stage.start.y + PLAYER_H);
        if (gap < 0 || gap > 80) err('schema.start-gap', `${sid}.start 与起点平台间隙 ${r2(gap)}px 超出 0–80`);
        if (p.w < 90) err('schema.start-width', `${sid} 起点平台宽 ${p.w} 过窄（安全区建议 ≥90）`);
        if (stage.start.x + PLAYER_W < p.x || stage.start.x > p.x + p.w) {
          err('schema.start-over', `${sid}.start 水平不在起点平台上方`);
        }
        for (const route of routes || []) {
          if (route && Array.isArray(route.platforms) && route.platforms[0] !== startPlat) {
            err('schema.route-start', `${sid}.${route.id}.platforms[0] 必须是起点平台索引 ${startPlat}（当前 ${route.platforms[0]}）`);
          }
        }
        // 首落时间（1–2 秒安全区的下限证据）
        const fall = Math.sqrt((2 * Math.max(0, gap)) / GRAVITY);
        if (fall > 1) err('schema.start-fall', `${sid} 首落时间 ${r2(fall)}s 超过 1s`);
      }
    }
    // 底部死亡空间
    if (Number.isInteger(stage.height) && Array.isArray(platforms)) {
      const maxY = Math.max(...platforms.filter((p) => isPlainObject(p) && finiteNum(p.y)).map((p) => p.y));
      if (Number.isFinite(maxY) && stage.height - maxY < 40) err('schema.death-space', `${sid} 最底平台到关卡底部不足 40px，无法形成“跌出底部”死亡边界`);
    }
    for (let k = errStart; k < errors.length; k++) errors[k].stageIndex = si;
    for (let k = warnStart; k < warnings.length; k++) warnings[k].stageIndex = si;
  }

  return { errors, warnings };
}

/* ============================== 几何 / 解析上界 ============================== */
function scrollRect(sc) {
  return { x: sc.x - SCROLL_W / 2, y: sc.y - SCROLL_H / 2, w: SCROLL_W, h: SCROLL_H };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function playerRect(st) {
  return { x: st.x, y: st.y, w: PLAYER_W, h: PLAYER_H };
}

/** 玩家“着陆在平台 p 上”时可能的 x 区间（与 oneWayLanding 的水平条件一致）。 */
function landingInterval(p, widen = 0) {
  const w = p.def ? p.def.w : p.w;
  return [p.x - PLAYER_W + 2 + 0.5 - widen, p.x + w - 2 - 0.5 + widen];
}

function platformLandingInterval(def, widen = 0) {
  return [def.x - PLAYER_W + 2 + 0.5 - widen, def.x + def.w - 2 - 0.5 + widen];
}

/** 目标矩形（影门 / 卷轴）接触时的玩家 x 区间。 */
function playerXIntervalForRect(rect) {
  return [rect.x - PLAYER_W + 0.5, rect.x + rect.w - 0.5];
}

/** 目标矩形接触时的玩家“底部 y”区间。 */
function playerBottomBandForRect(rect) {
  return [rect.y + 0.5, rect.y + rect.h + PLAYER_H - 0.5];
}

/** 从起跳底 y0 下落到目标底 y1 的“下落穿越”时间；y1<y0（目标更高）时超过最大跳跃返回 null。 */
function descendTime(y0, y1) {
  const dy = y0 - y1;
  if (dy > MAX_JUMP_HEIGHT) return null;
  if (dy >= 0) return (Math.abs(JUMP_V) + Math.sqrt(JUMP_V * JUMP_V - 2 * GRAVITY * dy)) / GRAVITY;
  return (Math.abs(JUMP_V) + Math.sqrt(JUMP_V * JUMP_V + 2 * GRAVITY * -dy)) / GRAVITY;
}

/** 无影冲一次飞行的水平位移上界。 */
function noDashReach(dy) {
  const t = descendTime(0, dy);
  return t === null ? null : MAX_VX * t;
}

/**
 * 无影冲“必要上界”：从平台 def 到目标矩形是否有可能（只做必要不充分判断）。
 * 只要返回 possible:false，就一定无法在不使用影冲时接触该目标。
 */
function noDashTargetBound(def, rect) {
  const xInt = playerXIntervalForRect(rect);
  const [b0, b1] = playerBottomBandForRect(rect);
  const fromInt = platformLandingInterval(def, def.kind === 'moving' ? def.range : 0);
  let best = null;
  for (const yb of [b0, b1]) {
    const t = descendTime(def.y, yb);
    if (t === null) continue;
    const reach = MAX_VX * t;
    const required = intervalGap(fromInt, xInt);
    const margin = reach - required;
    if (!best || margin > best.margin) {
      best = { possible: margin >= 0, t, reach, required, margin, targetBottom: yb };
    }
  }
  if (!best) {
    return { possible: false, reason: 'vertical-over-max-jump', maxJump: MAX_JUMP_HEIGHT };
  }
  return best;
}

/** 平台之间的无影冲上界（用于全局超集图）。 */
function noDashPlatformBound(fromDef, toDef) {
  const t = descendTime(fromDef.y, toDef.y);
  if (t === null) return { possible: false, reason: 'vertical-over-max-jump' };
  const required = intervalGap(
    platformLandingInterval(fromDef, fromDef.kind === 'moving' ? fromDef.range : 0),
    platformLandingInterval(toDef, toDef.kind === 'moving' ? toDef.range : 0)
  );
  const reach = MAX_VX * t;
  return { possible: required <= reach, required, reach, t, margin: reach - required };
}

/* ============================== 世界 / 玩家状态 ============================== */
function makeWorld(stage) {
  return {
    stage,
    t: 0,
    plats: stage.platforms.map((def, idx) => ({
      idx,
      def,
      x: def.x,
      phase: def.phase || 0,
      broken: false,
      breakTimer: 0,
      removed: false,
    })),
  };
}

function cloneWorld(world) {
  return {
    stage: world.stage,
    t: world.t,
    plats: world.plats.map((p) => ({ ...p })),
  };
}

function cloneState(st) {
  return { ...st };
}

function advancePlatforms(world) {
  world.t += DT;
  for (const p of world.plats) {
    if (p.def.kind === 'moving') {
      p.phase += p.def.speed * DT;
      p.x = clamp(p.def.baseX + Math.sin(p.phase) * p.def.range, 4, STAGE_W - p.def.w - 4);
    }
    if (p.broken) {
      p.breakTimer -= DT;
      if (p.breakTimer <= 0) p.removed = true;
    }
  }
}

function advancePlatformsN(world, frames) {
  for (let i = 0; i < frames; i++) advancePlatforms(world);
}

function oneWayLanding(st, prevBottom, plat) {
  return (
    st.vy >= 0 &&
    prevBottom <= plat.def.y + LAND_TOL &&
    st.y + PLAYER_H >= plat.def.y &&
    st.x + PLAYER_W > plat.x + 2 &&
    st.x < plat.x + plat.def.w - 2
  );
}

/** 单帧推进（顺序严格镜像 shadow-leap.html 的 update）。 */
function step(world, st, dir, dashDir) {
  // 影冲触发（帧首；着陆补满一次、空中最多一次、冲刺中不再触发）
  if (dashDir && st.dashAvailable && st.dashTimer <= 0) {
    st.dashTimer = DASH_TIME;
    st.dashDir = dashDir;
    st.dashAvailable = false;
    st.face = dashDir;
  }

  // 水平控制
  if (st.dashTimer > 0) {
    st.vx = st.dashDir * DASH_SPEED;
    st.face = st.dashDir;
  } else {
    if (dir !== 0) {
      st.vx += dir * ACC * DT;
      st.face = dir;
    } else {
      st.vx -= st.vx * Math.min(1, 12 * DT);
    }
    st.vx = clamp(st.vx, -MAX_VX, MAX_VX);
  }
  st.x += st.vx * DT;

  // 触墙反弹（保留速度 0.95）；冲刺撞墙时把冲刺方向也转向，避免贴墙反复触发
  const half = PLAYER_W / 2;
  if (st.x < -half) {
    st.x = -half;
    st.vx = Math.abs(st.vx) * WALL_BOUNCE;
    if (st.dashTimer > 0) st.dashDir = 1;
  } else if (st.x > STAGE_W - half) {
    st.x = STAGE_W - half;
    st.vx = -Math.abs(st.vx) * WALL_BOUNCE;
    if (st.dashTimer > 0) st.dashDir = -1;
  }

  // 竖直（无线道具；冲刺期重力 ×0.25）
  st.prevBottom = st.y + PLAYER_H;
  const gravityScale = st.dashTimer > 0 ? DASH_GRAVITY_SCALE : 1;
  st.vy = Math.min(MAX_FALL, st.vy + GRAVITY * gravityScale * DT);
  st.y += st.vy * DT;

  // 影冲计时
  if (st.dashTimer > 0) {
    st.dashTimer = Math.max(0, st.dashTimer - DT);
    if (st.dashTimer === 0) st.vx = clamp(st.vx, -MAX_VX, MAX_VX);
  }

  // 平台行为（先更新相位/易碎，再判定着陆，与页面 update 顺序一致）
  advancePlatforms(world);

  // 单向平台着陆（数组顺序，先命中者生效）
  let landed = null;
  for (const p of world.plats) {
    if (p.removed || p.broken) continue;
    if (oneWayLanding(st, st.prevBottom, p)) {
      st.y = p.def.y - PLAYER_H;
      st.vy = JUMP_V;
      st.dashTimer = 0;
      st.dashAvailable = true;
      st.vx = clamp(st.vx, -MAX_VX, MAX_VX);
      if (p.def.kind === 'fragile') {
        p.broken = true;
        p.breakTimer = FRAGILE_BREAK;
      }
      landed = p;
      break;
    }
  }

  const goalHit = rectsOverlap(playerRect(st), world.stage.goal);
  const dead = st.y > world.stage.height;
  return { landed, goalHit, dead };
}

function spawnState(stage) {
  return {
    x: stage.start.x,
    y: stage.start.y,
    vx: 0,
    vy: 0,
    face: 1,
    prevBottom: stage.start.y + PLAYER_H,
    dashAvailable: false,
    dashTimer: 0,
    dashDir: 1,
  };
}

/* ============================== 有限控制策略 ============================== */
function buildPolicies() {
  const policies = [];
  const deadbands = [0, 12, 24];
  const brakes = [null, { dist: 48, speed: 150 }];
  const aims = [-0.2, 0, 0.2];
  const predicts = [false, true];
  let id = 0;
  for (const deadband of deadbands) {
    for (const brake of brakes) {
      for (const aimFrac of aims) {
        for (const predict of predicts) {
          policies.push({ id: id++, deadband, brake, aimFrac, predict });
        }
      }
    }
  }
  return policies;
}
const POLICIES = buildPolicies();

function policyLabel(id) {
  const p = POLICIES[id];
  if (!p) return '#' + id;
  return '#' + id + '(deadband=' + p.deadband + ',brake=' + (p.brake ? p.brake.dist + 'px/' + p.brake.speed : 'off') + ',aim=' + Math.round(p.aimFrac * 100) + '%,predict=' + (p.predict ? 'on' : 'off') + ')';
}

const DASH_PLANS = (() => {
  const plans = [];
  let id = 0;
  for (const dir of [-1, 1]) {
    for (let frame = 0; frame <= 20; frame += 2) plans.push({ id: id++, dir, frame });
  }
  return plans;
})();

function policyAimX(world, st, target, policy) {
  if (target.type === 'platform') {
    const p = world.plats[target.index];
    let cx = p.x + p.def.w / 2;
    if (policy.predict && p.def.kind === 'moving') {
      const dy = st.y + PLAYER_H - p.def.y;
      let t = dy >= 0 ? Math.min(0.9, descendTime(dy, 0) || 0) : descendTime(0, p.def.y);
      if (t === null || !Number.isFinite(t)) t = 0.5;
      t = Math.min(t, 0.9);
      const vxPlat = p.def.range * p.def.speed * Math.cos(p.phase);
      cx += clamp(vxPlat * t, -p.def.range, p.def.range);
    }
    cx += policy.aimFrac * (p.def.w / 2);
    return cx;
  }
  if (target.type === 'goal') {
    const g = world.stage.goal;
    return g.x + g.w / 2 + policy.aimFrac * (g.w / 2);
  }
  return target.scroll.x + policy.aimFrac * 6;
}

function policyDir(policy, st, targetX) {
  const cx = st.x + PLAYER_W / 2;
  const err = targetX - cx;
  let dir = 0;
  if (Math.abs(err) > policy.deadband) dir = err > 0 ? 1 : -1;
  if (
    policy.brake &&
    dir !== 0 &&
    Math.sign(st.vx) === dir &&
    Math.abs(st.vx) > policy.brake.speed &&
    Math.abs(err) < policy.brake.dist
  ) {
    dir = -dir;
  }
  return dir;
}

/* ============================== 单次尝试模拟 ============================== */
const OUTCOME = {
  LANDED_TARGET: 'landed-target',
  LANDED_OTHER: 'landed-other',
  LANDED_FROM: 'landed-from',
  DEATH: 'death',
  TIMEOUT: 'timeout',
  GOAL_FIRST: 'goal-first',
};

function simulateAttempt(opts) {
  const {
    worldStart,
    stateStart,
    fromIdx,
    target,
    policy,
    dashPlan = null,
    allowDash = false,
    maxFrames = 720,
    recordFrames = false,
  } = opts;

  const world = cloneWorld(worldStart);
  const st = cloneState(stateStart);
  const frames = recordFrames ? [] : null;
  let goalHitEarlier = false;

  for (let f = 0; f < maxFrames; f++) {
    let dashDir = 0;
    if (allowDash && dashPlan && dashPlan.frame === f && st.dashAvailable && st.dashTimer <= 0) {
      dashDir = dashPlan.dir;
    }
    const aimX = policyAimX(world, st, target, policy);
    const dir = policyDir(policy, st, aimX);
    if (frames) {
      frames.push({ f, x: r2(st.x), y: r2(st.y), vx: r2(st.vx), vy: r2(st.vy), dir, dash: dashDir });
    }
    const out = step(world, st, dir, dashDir);
    if (frames) {
      const rec = frames[frames.length - 1];
      rec.landed = out.landed ? out.landed.idx : null;
      rec.goalHit = out.goalHit;
      rec.dead = out.dead;
    }

    if (target.type === 'scroll') {
      if (out.goalHit) goalHitEarlier = true;
      if (rectsOverlap(playerRect(st), scrollRect(target.scroll))) {
        if (goalHitEarlier) return { ok: false, outcome: OUTCOME.GOAL_FIRST, world, state: st, frames, frame: f };
        return { ok: true, world, state: st, frames, frame: f, landed: null };
      }
    } else if (out.goalHit) {
      if (target.type === 'goal') return { ok: true, world, state: st, frames, frame: f, landed: null };
    }

    if (out.landed) {
      const idx = out.landed.idx;
      if (target.type === 'platform' && idx === target.index) {
        return { ok: true, world, state: st, frames, frame: f, landed: idx };
      }
      if (idx === fromIdx) continue; // 只允许在起点平台反复起跳，不借用后续平台
      return { ok: false, outcome: OUTCOME.LANDED_OTHER, landed: idx, world, state: st, frames, frame: f };
    }
    if (out.dead) return { ok: false, outcome: OUTCOME.DEATH, world, state: st, frames, frame: f };
  }
  return { ok: false, outcome: OUTCOME.TIMEOUT, world, state: st, frames, frame: maxFrames };
}

/* ============================== 采样与逐段搜索 ============================== */
function t0SamplesFor(stage, fromIdx, target) {
  const moving = [stage.platforms[fromIdx]];
  if (target.type === 'platform') moving.push(stage.platforms[target.index]);
  const moves = moving.filter((p) => p && p.kind === 'moving');
  if (!moves.length) return [0];
  const period = Math.max(...moves.map((p) => (2 * Math.PI) / p.speed));
  return sampleRange(0, period * (5 / 6), 6).map((v) => r3(v));
}

function sampleStartStates(stage, fromIdx, t0World, opts) {
  const fromDef = stage.platforms[fromIdx];
  const runPlat = t0World.plats[fromIdx];
  const [L, R] = landingInterval(runPlat);
  const xCount = opts.quick ? 5 : 9;
  const vxs = opts.quick ? [0] : [-220, 0, 220];
  const xs = sampleRange(L + 1, R - 1, xCount);
  const states = [];
  for (const x of xs) {
    for (const vx of vxs) {
      states.push({
        x,
        y: fromDef.y - PLAYER_H,
        vx,
        vy: JUMP_V,
        face: vx >= 0 ? 1 : -1,
        prevBottom: fromDef.y,
        dashAvailable: true,
        dashTimer: 0,
        dashDir: 1,
      });
    }
  }
  return { states, runPlat };
}

function countOutcome(stats, result) {
  switch (result.outcome) {
    case OUTCOME.LANDED_OTHER:
      stats.outcomes.landedOther += 1;
      stats.landedOtherIdx[result.landed] = (stats.landedOtherIdx[result.landed] || 0) + 1;
      break;
    case OUTCOME.DEATH:
      stats.outcomes.death += 1;
      break;
    case OUTCOME.TIMEOUT:
      stats.outcomes.timeout += 1;
      break;
    case OUTCOME.GOAL_FIRST:
      stats.outcomes.goalFirst += 1;
      break;
    default:
      stats.outcomes.other += 1;
  }
}

function makeStats() {
  return {
    attempts: 0,
    successes: [],
    outcomes: { landedOther: 0, death: 0, timeout: 0, goalFirst: 0, other: 0 },
    landedOtherIdx: {},
    byT0: [],
    deaths: [],
  };
}

/**
 * 逐段独立搜索：从起点平台多个着陆位置/初速出发，搜索能否落到 target。
 * allowDash=true 时额外枚举“第 0/2/…/20 帧向左或向右影冲一次”。
 */
function independentSearch(stage, fromIdx, target, opts = {}) {
  const stats = makeStats();
  const t0s = opts.t0Samples || t0SamplesFor(stage, fromIdx, target);
  const maxFrames = opts.maxFrames || 720;
  const policies = POLICIES;

  for (const t0 of t0s) {
    const baseWorld = makeWorld(stage);
    if (t0 > 0) advancePlatformsN(baseWorld, Math.round(t0 / DT));
    const { states } = sampleStartStates(stage, fromIdx, baseWorld, opts);
    let t0Successes = 0;
    for (const state of states) {
      for (const policy of policies) {
        stats.attempts += 1;
        const r = simulateAttempt({
          worldStart: baseWorld,
          stateStart: state,
          fromIdx,
          target,
          policy,
          allowDash: false,
          maxFrames,
        });
        if (r.ok) {
          stats.successes.push({
            t0,
            x: r2(state.x),
            vx: state.vx,
            policyId: policy.id,
            policy,
            dash: null,
            frame: r.frame,
            landingX: r2(r.state.x),
            landingVx: r2(r.state.vx),
            landingY: r2(r.state.y),
          });
          t0Successes += 1;
        } else {
          countOutcome(stats, r);
          if (r.outcome === OUTCOME.DEATH) stats.deaths.push({ t0, x: r2(state.x), vx: state.vx, policyId: policy.id, dash: null });
        }
        if (opts.allowDash) {
          for (const dashPlan of DASH_PLANS) {
            stats.attempts += 1;
            const rd = simulateAttempt({
              worldStart: baseWorld,
              stateStart: state,
              fromIdx,
              target,
              policy,
              dashPlan,
              allowDash: true,
              maxFrames,
            });
            if (rd.ok) {
              stats.successes.push({
                t0,
                x: r2(state.x),
                vx: state.vx,
                policyId: policy.id,
                policy,
                dash: dashPlan,
                frame: rd.frame,
                landingX: r2(rd.state.x),
                landingVx: r2(rd.state.vx),
                landingY: r2(rd.state.y),
              });
              t0Successes += 1;
            } else {
              countOutcome(stats, rd);
              if (rd.outcome === OUTCOME.DEATH) {
                stats.deaths.push({ t0, x: r2(state.x), vx: state.vx, policyId: policy.id, dash: dashPlan });
              }
            }
          }
        }
      }
    }
    stats.byT0.push({ t0, successes: t0Successes });
  }
  stats.startSamples = stats.byT0.length > 0 ? Math.round(stats.attempts / (stats.byT0.length * POLICIES.length * (opts.allowDash ? 1 + DASH_PLANS.length : 1))) : 0;
  return stats;
}

/* ============================== 束搜索连续通关 ============================== */
function targetCenter(stage, target) {
  if (target.type === 'platform') {
    const p = stage.platforms[target.index];
    return p.x + p.w / 2;
  }
  if (target.type === 'goal') return stage.goal.x + stage.goal.w / 2;
  return target.scroll.x;
}

function tryPoliciesFromState(stage, world, st, fromIdx, target, allowDash, maxSuccess = 24, policies = POLICIES, maxFrames = 720) {
  const out = [];
  for (const policy of policies) {
    const attempts = [{ dashPlan: null, allowDash: false }];
    if (allowDash) {
      for (const dashPlan of DASH_PLANS) attempts.push({ dashPlan, allowDash: true });
    }
    for (const attempt of attempts) {
      const r = simulateAttempt({
        worldStart: world,
        stateStart: st,
        fromIdx,
        target,
        policy,
        dashPlan: attempt.dashPlan,
        allowDash: attempt.allowDash,
        maxFrames,
      });
      if (r.ok) {
        out.push({
          world: cloneWorld(r.world),
          state: cloneState(r.state),
          policyId: policy.id,
          dash: attempt.dashPlan,
          frame: r.frame,
          landingX: r.state.x,
          landingVx: r.state.vx,
        });
        if (out.length >= maxSuccess) return out;
        // 有影冲解时优先选“最早成功”的，尽快返回，避免枚举爆炸
        if (attempt.allowDash) return out;
      }
    }
  }
  return out;
}

function scoreExpansion(stage, target, exp, baseFrames) {
  const center = targetCenter(stage, target);
  const off = Math.abs(exp.landingX + PLAYER_W / 2 - center);
  return baseFrames + exp.frame + off * 1.5;
}

/** 把落点按目标平台落点区间三等分，用于束搜索保留不同落点位置的候选（避免全挤在中心）。 */
function landingBucket(stage, target, landingX) {
  if (target.type !== 'platform') return 1;
  const def = stage.platforms[target.index];
  const [L, R] = platformLandingInterval(def);
  const t = (landingX + PLAYER_W / 2 - L) / Math.max(1, R - L);
  return t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2;
}

/**
 * 前瞻检查：站在“刚落到 fromIdx”的状态上，下一段（nextTarget）是否有解。
 * 只用一个策略子集 + 较短帧数做粗筛，用于给束搜索排序，避免保留“下一跳必死”的落点。
 */
function lookaheadFeasible(stage, world, st, fromIdx, nextTarget, allowDashForNext) {
  const subset = POLICIES.filter((_, i) => i % 3 === 0);
  for (const policy of subset) {
    const r = simulateAttempt({
      worldStart: world,
      stateStart: st,
      fromIdx,
      target: nextTarget,
      policy,
      allowDash: false,
      maxFrames: 420,
    });
    if (r.ok) return true;
  }
  if (allowDashForNext) {
    const plans = DASH_PLANS.filter((p) => p.frame <= 8);
    for (const policy of subset) {
      for (const dashPlan of plans) {
        const r = simulateAttempt({
          worldStart: world,
          stateStart: st,
          fromIdx,
          target: nextTarget,
          policy,
          dashPlan,
          allowDash: true,
          maxFrames: 420,
        });
        if (r.ok) return true;
      }
    }
  }
  return false;
}

/**
 * 连续通关束搜索。allowDash=false 时完全禁用影冲（用于“整条路线禁用影冲”的反证）。
 * 采用“前瞻 + 落点分桶”的束搜索：每个候选落点先用下一段做一次粗筛（避免保留“下一跳必死”的落点），
 * 再按落点位置分桶轮转，保证束内覆盖左/中/右不同落点，提升多段路线的求解成功率。
 */
function solveRoutePlaythrough(stage, route, opts = {}) {
  const allowDash = opts.allowDash === true;
  const beamWidth = opts.beamWidth || 10;
  const startIdx = route.platforms[0];
  const world = makeWorld(stage);
  const st = spawnState(stage);
  let landedStart = false;
  for (let f = 0; f < 240; f++) {
    const out = step(world, st, 0, 0);
    if (out.landed) {
      landedStart = out.landed.idx === startIdx;
      break;
    }
    if (out.dead) return { ok: false, reason: 'spawn-death' };
  }
  if (!landedStart) return { ok: false, reason: 'spawn-not-on-start-platform' };

  let states = [{ world, state: st, plan: [], frames: 0 }];
  for (let pos = 0; pos < route.platforms.length; pos++) {
    const fromIdx = route.platforms[pos];
    const isLast = pos === route.platforms.length - 1;
    const target = isLast ? { type: 'goal' } : { type: 'platform', index: route.platforms[pos + 1] };
    const expanded = [];
    for (const s of states) {
      let results = [];
      results = tryPoliciesFromState(stage, s.world, s.state, fromIdx, target, false, 24);
      if (results.length === 0 && allowDash) {
        results = tryPoliciesFromState(stage, s.world, s.state, fromIdx, target, true, 24);
      }
      for (const r of results) {
        expanded.push({
          world: r.world,
          state: r.state,
          frames: s.frames + r.frame,
          plan: s.plan.concat([
            {
              from: fromIdx,
              to: target.type === 'platform' ? target.index : 'goal',
              dash: r.dash ? { frame: r.dash.frame, dir: r.dash.dir } : null,
              policyId: r.policyId,
              frame: r.frame,
              landingX: r2(r.landingX),
              landingVx: r2(r.landingVx),
            },
          ]),
        });
      }
    }
    if (expanded.length === 0) {
      return { ok: false, reason: 'segment-fail', at: pos, from: fromIdx, target: target.type === 'platform' ? target.index : 'goal' };
    }
    if (isLast) {
      expanded.sort((a, b) => a.frames - b.frames);
      const best = expanded[0];
      return {
        ok: true,
        plan: best.plan,
        totalFrames: best.frames,
        seconds: r2(best.frames / 60),
        dashSegments: best.plan.filter((p) => p.dash).length,
        dashUsed: best.plan.filter((p) => p.dash).length > 0,
      };
    }

    // 先按“落点离目标中心 + 帧数”粗排，限制前瞻检查数量
    for (const e of expanded) {
      const center = targetCenter(stage, target);
      e.baseScore = e.frames + Math.abs(e.state.x + PLAYER_W / 2 - center) * 1.5;
    }
    expanded.sort((a, b) => a.baseScore - b.baseScore);
    const candidates = expanded.slice(0, 30);

    // 前瞻：刚落到目标平台后，下一段是否还有解（避免保留“下一跳必死”的落点）
    const nextTargetPos = pos + 2;
    const landedIdx = route.platforms[pos + 1];
    const nextTarget =
      nextTargetPos < route.platforms.length ? { type: 'platform', index: route.platforms[nextTargetPos] } : { type: 'goal' };
    const nextNeedsDash =
      allowDash && nextTargetPos < route.platforms.length
        ? segmentAnalytic(stage, route.platforms[pos + 1], route.platforms[nextTargetPos]).dashRequiredByBound
        : false;
    for (const e of candidates) {
      e.lookOk = lookaheadFeasible(stage, e.world, e.state, landedIdx, nextTarget, allowDash && nextNeedsDash);
    }
    const viable = candidates.filter((e) => e.lookOk);
    const pool = viable.length ? viable : candidates;

    // 落点按目标平台落点区间三等分，分桶轮转取 beamWidth，保证覆盖左/中/右
    const buckets = [[], [], []];
    for (const e of pool) buckets[landingBucket(stage, target, e.state.x)].push(e);
    for (const b of buckets) b.sort((a, b) => a.baseScore - b.baseScore);
    const nextStates = [];
    while (nextStates.length < beamWidth) {
      let added = false;
      for (const b of buckets) {
        if (b.length && nextStates.length < beamWidth) {
          nextStates.push(b.shift());
          added = true;
        }
      }
      if (!added) break;
    }
    states = nextStates;
  }
  return { ok: false, reason: 'no-goal' };
}
/* ============================== 全局无影冲超集图 ============================== */
function noDashSuperset(stage) {
  const plats = stage.platforms;
  const startIdx = findStartPlatform(stage);
  const reachable = new Set();
  if (startIdx >= 0) {
    reachable.add(startIdx);
    const queue = [startIdx];
    while (queue.length) {
      const i = queue.shift();
      for (let j = 0; j < plats.length; j++) {
        if (j === i || reachable.has(j)) continue;
        if (noDashPlatformBound(plats[i], plats[j]).possible) {
          reachable.add(j);
          queue.push(j);
        }
      }
    }
  }
  const goalBound = [];
  for (const i of reachable) {
    const b = noDashTargetBound(plats[i], stage.goal);
    if (b.possible) goalBound.push({ platform: i, ...b });
  }
  return { startIdx, reachable: [...reachable].sort((a, b) => a - b), goalPossible: goalBound.length > 0, goalBound };
}

/* ============================== 起点平台 ============================== */
function findStartPlatform(stage) {
  if (!stage || !Array.isArray(stage.platforms) || !stage.start) return -1;
  const bottom = stage.start.y + PLAYER_H;
  let best = -1;
  for (let i = 0; i < stage.platforms.length; i++) {
    const p = stage.platforms[i];
    if (!p || !finiteNum(p.y)) continue;
    const gap = p.y - bottom;
    if (gap < -LAND_TOL || gap > 80) continue;
    if (stage.start.x + PLAYER_W <= p.x + 2 || stage.start.x >= p.x + p.w - 2) continue;
    if (best < 0 || p.y < stage.platforms[best].y) best = i;
  }
  return best;
}

/* ============================== 段落验证结果 ============================== */
function segmentAnalytic(stage, fromIdx, toIdx) {
  const from = stage.platforms[fromIdx];
  const to = stage.platforms[toIdx];
  const dy = from.y - to.y;
  const t = descendTime(from.y, to.y);
  const required = intervalGap(platformLandingInterval(from), platformLandingInterval(to));
  const reach = t === null ? null : MAX_VX * t;
  return {
    dy: r2(dy),
    maxJump: r2(MAX_JUMP_HEIGHT),
    t: t === null ? null : r3(t),
    requiredDx: r2(required),
    noDashReach: reach === null ? null : r2(reach),
    verticalOverMax: t === null,
    dashRequiredByBound: t === null || required > reach,
    margin: reach === null ? null : r2(reach - required),
  };
}

function verifySegment(stage, route, segIndex, opts = {}) {
  const fromIdx = route.platforms[segIndex];
  const toIdx = route.platforms[segIndex + 1];
  const analytic = segmentAnalytic(stage, fromIdx, toIdx);
  const noDash = independentSearch(stage, fromIdx, { type: 'platform', index: toIdx }, { ...opts, allowDash: false });
  const result = {
    from: fromIdx,
    to: toIdx,
    fromPos: { x: stage.platforms[fromIdx].x, y: stage.platforms[fromIdx].y, w: stage.platforms[fromIdx].w, kind: stage.platforms[fromIdx].kind },
    toPos: { x: stage.platforms[toIdx].x, y: stage.platforms[toIdx].y, w: stage.platforms[toIdx].w, kind: stage.platforms[toIdx].kind },
    analytic,
    noDash: summarizeSearch(noDash),
    noDashStats: noDash,
    dash: null,
    dashStats: null,
    pass: true,
    notes: [],
  };
  if (noDash.successes.length === 0 && opts.allowDashSearch) {
    const dashSearch = independentSearch(stage, fromIdx, { type: 'platform', index: toIdx }, { ...opts, allowDash: true });
    result.dashStats = dashSearch;
    result.dash = summarizeSearch(dashSearch);
  }
  return result;
}

function summarizeSearch(stats) {
  const s = stats.successes;
  const landingXs = s.map((v) => v.landingX);
  const policies = new Set(s.map((v) => v.policyId));
  const dashes = s.filter((v) => v.dash).map((v) => ({ frame: v.dash.frame, dir: v.dash.dir }));
  return {
    attempts: stats.attempts,
    successes: s.length,
    landingX: landingXs.length ? { min: r2(Math.min(...landingXs)), max: r2(Math.max(...landingXs)) } : null,
    example: s.length ? { t0: s[0].t0, x: s[0].x, vx: s[0].vx, policyId: s[0].policyId, dash: s[0].dash, frame: s[0].frame } : null,
    distinctPolicies: policies.size,
    dashExamples: dashes.slice(0, 6),
    outcomes: stats.outcomes,
    deaths: stats.deaths.length,
    byT0: stats.byT0,
  };
}

/* ============================== 关卡分析 ============================== */
function analyzeStage(stage, opts = {}) {
  const schema = { errors: opts.schemaErrors || [], warnings: opts.schemaWarnings || [] };
  const result = {
    id: stage.id,
    title: stage.title,
    height: stage.height,
    schema: schema,
    start: stage.start,
    goal: stage.goal,
    platforms: stage.platforms ? stage.platforms.length : 0,
    platformKinds: { normal: 0, moving: 0, fragile: 0 },
    routes: [],
    scrolls: [],
    noDashProof: null,
    recovery: null,
    constraints: null,
    pass: true,
    failures: [],
  };
  for (const p of stage.platforms || []) if (p && p.kind in result.platformKinds) result.platformKinds[p.kind] += 1;

  if (schema.errors.length > 0) {
    result.pass = false;
    result.failures.push(...schema.errors.map((e) => `schema:${e.code} ${e.msg}`));
    return result;
  }

  const requiresDashRoutes = stage.routes.filter((r) => r.requiresDash);
  const stageNeedsDash = requiresDashRoutes.length > 0;

  /* 1) 每条路线 */
  let anyGoal = false;
  for (const route of stage.routes) {
    const routeRes = {
      id: route.id,
      label: route.label,
      requiresDash: route.requiresDash,
      platformCount: route.platforms.length,
      segments: [],
      goal: null,
      playthrough: null,
      noDashPlaythrough: null,
      criticalSegment: null,
      pass: true,
    };
    for (let k = 0; k < route.platforms.length - 1; k++) {
      const seg = verifySegment(stage, route, k, { ...opts, allowDashSearch: route.requiresDash });
      if (seg.noDash.successes > 0) {
        seg.pass = true;
        seg.usedDash = false;
      } else if (route.requiresDash && seg.dash && seg.dash.successes > 0) {
        seg.pass = true;
        seg.usedDash = true;
        routeRes.criticalSegment = routeRes.criticalSegment || { index: k, from: seg.from, to: seg.to, analytic: seg.analytic };
      } else {
        seg.pass = false;
      }
      routeRes.segments.push(seg);
      if (!seg.pass) routeRes.pass = false;
    }
    /* 影门段（独立） */
    if (route.platforms.length >= 2) {
      const lastIdx = route.platforms[route.platforms.length - 1];
      const goalSearch = independentSearch(stage, lastIdx, { type: 'goal' }, { ...opts, allowDash: route.requiresDash });
      routeRes.goal = { from: lastIdx, ...summarizeSearch(goalSearch), stats: goalSearch, pass: goalSearch.successes.length > 0 };
      if (!routeRes.goal.pass) routeRes.pass = false;
    }
    /* 连续通关（允许影冲与否按路线要求） */
    const play = solveRoutePlaythrough(stage, route, { allowDash: route.requiresDash, ...opts });
    routeRes.playthrough = {
      ...play,
      seconds: play.ok ? r2(play.totalFrames / 60) : null,
      pass: play.ok === true,
    };
    if (!play.ok) routeRes.pass = false;
    if (play.ok && route.requiresDash && play.dashSegments < 1) {
      routeRes.pass = false;
      routeRes.failures = routeRes.failures || [];
      routeRes.failures = (routeRes.failures || []).concat(['requiresDash=true 但连续通关未使用影冲，数据自相矛盾']);
    }

    /* requiresDash 路线：禁用影冲的连续搜索必须失败，且失败段必须是几何上不可能的段 */
    if (route.requiresDash) {
      const noDashPlay = solveRoutePlaythrough(stage, route, { allowDash: false, ...opts });
      routeRes.noDashPlaythrough = {
        ok: noDashPlay.ok,
        reason: noDashPlay.reason,
        at: noDashPlay.at,
        from: noDashPlay.from,
        target: noDashPlay.target,
        pass: noDashPlay.ok !== true,
      };
      if (noDashPlay.ok === true) {
        routeRes.pass = false;
        routeRes.failures = (routeRes.failures || []).concat(['requiresDash=true 但存在不使用影冲的连续通关路径']);
      }
      const criticalCandidate = route.platforms
        .slice(0, -1)
        .map((_, k) => k)
        .find((k) => {
          const a = segmentAnalytic(stage, route.platforms[k], route.platforms[k + 1]);
          return a.dashRequiredByBound;
        });
      if (criticalCandidate === undefined) {
        routeRes.pass = false;
        routeRes.failures = (routeRes.failures || []).concat(['requiresDash=true 但路线内没有几何上“无影冲不可能”的段（无法证明必须用影冲）']);
      } else {
        routeRes.criticalSegment = routeRes.criticalSegment || { index: criticalCandidate };
        routeRes.criticalSegment.analytic = segmentAnalytic(stage, route.platforms[criticalCandidate], route.platforms[criticalCandidate + 1]);
        routeRes.criticalSegment.from = route.platforms[criticalCandidate];
        routeRes.criticalSegment.to = route.platforms[criticalCandidate + 1];
        // 逐段搜索确认该关键段在无影冲下 0 成功（若前面已验证过则复用）
        const seg = routeRes.segments[criticalCandidate];
        if (seg && seg.noDash.successes !== 0) {
          routeRes.pass = false;
          routeRes.failures = (routeRes.failures || []).concat(['关键段无影冲搜索出现了成功样本，与几何上界矛盾（求解器/数据异常）']);
        }
        // 失败回收统计：无影冲与影冲的失败尝试不得出现死亡
        const dashStats = seg ? seg.dashStats : null;
        const noDashRaw = seg ? seg.noDashStats : null;
        const fromY = stage.platforms[route.platforms[criticalCandidate]].y;
        const recovery = {
          segmentIndex: criticalCandidate,
          from: route.platforms[criticalCandidate],
          to: route.platforms[criticalCandidate + 1],
          noDashAttempts: noDashRaw ? noDashRaw.attempts : 0,
          noDashDeaths: noDashRaw ? noDashRaw.deaths.length : 0,
          dashAttempts: dashStats ? dashStats.attempts : 0,
          dashDeaths: dashStats ? dashStats.deaths.length : 0,
          landedOnRecovery: noDashRaw
            ? Object.entries(noDashRaw.landedOtherIdx).reduce(
                (acc, [idx, n]) => (stage.platforms[Number(idx)].y > fromY ? acc + n : acc),
                0
              )
            : 0,
          landedOtherIdx: noDashRaw ? noDashRaw.landedOtherIdx : {},
          deaths: [],
        };
        if (dashStats) {
          recovery.deaths = dashStats.deaths.map((d) => `t0=${d.t0} x=${d.x} vx=${d.vx} policy#${d.policyId}`).slice(0, 5);
        }
        recovery.pass = recovery.deaths.length === 0 && recovery.dashDeaths === 0 && recovery.landedOnRecovery > 0;
        result.recovery = recovery;
        if (!recovery.pass) {
          routeRes.pass = false;
          routeRes.failures = (routeRes.failures || []).concat(['关键段失败尝试存在“直接死亡”或没有落到回收平台']);
        }
      }
    }
    result.routes.push(routeRes);
    if (routeRes.pass) anyGoal = true;
  }

  /* 2) 至少一条路线能到影门 */
  if (!anyGoal) {
    result.pass = false;
    result.failures.push('没有任何 route 能到达影门');
  }

  /* 3) 全局无影冲证明（存在 requiresDash 路线时需要） */
  const superset = noDashSuperset(stage);
  if (stageNeedsDash) {
    result.noDashProof = {
      required: true,
      supersetReachablePlatforms: superset.reachable,
      goalPossibleWithoutDash: superset.goalPossible,
      goalBound: superset.goalBound.map((g) => ({ platform: g.platform, required: r2(g.required), reach: r2(g.reach), margin: r2(g.margin) })),
      pass: superset.goalPossible === false,
      note: '超集图只使用“无影冲必要上界”（单次飞行的水平位移 ≤ 265×t），若图中都无法到达影门，则任何无影冲路径都不存在。',
    };
    if (!result.noDashProof.pass) {
      result.pass = false;
      result.failures.push('全局无影冲超集图显示影门可能不用影冲到达，无法证明必须影冲');
    }
  } else {
    result.noDashProof = { required: false, pass: true, supersetReachablePlatforms: superset.reachable, goalPossibleWithoutDash: superset.goalPossible };
  }

  /* 4) 卷轴 */
  for (const scroll of stage.scrolls || []) {
    const scrollTarget = { type: 'scroll', scroll };
    const sRect = scrollRect(scroll);
    const via = [];
    let noDashAnywhere = null;
    let dashAnywhere = null;
    for (const route of stage.routes) {
      for (const idx of route.platforms) {
        const noDash = independentSearch(stage, idx, scrollTarget, { ...opts, allowDash: false, maxFrames: 600 });
        if (noDash.successes.length > 0) {
          via.push({ route: route.id, platform: idx, dash: false, ...summarizeSearch(noDash) });
          if (!noDashAnywhere) noDashAnywhere = { route: route.id, platform: idx, successes: noDash.successes.length };
        }
        // 影冲也只加水平位移 + 少量额外上升高度；竖直方向差太多的平台直接跳过，避免无意义的枚举
        const verticalRoom = stage.platforms[idx].y - (sRect.y + sRect.h + PLAYER_H); // 需要上升的高度
        if (route.requiresDash && verticalRoom <= MAX_DASH_RISE) {
          const dash = independentSearch(stage, idx, scrollTarget, { ...opts, allowDash: true, maxFrames: 600 });
          if (dash.successes.length > 0) {
            via.push({ route: route.id, platform: idx, dash: true, ...summarizeSearch(dash) });
            if (!dashAnywhere) dashAnywhere = { route: route.id, platform: idx, successes: dash.successes.length };
          }
        }
      }
    }
    const reached = via.length > 0;
    const noDashSuperset = [];
    for (let i = 0; i < stage.platforms.length; i++) {
      const b = noDashTargetBound(stage.platforms[i], sRect);
      if (b.possible) noDashSuperset.push({ platform: i, required: r2(b.required), reach: r2(b.reach), margin: r2(b.margin) });
    }
    const needsDash = reached && via.every((v) => v.dash === true);
    result.scrolls.push({
      id: scroll.id,
      label: scroll.label,
      pos: { x: scroll.x, y: scroll.y },
      rect: sRect,
      via,
      reached,
      requiresDash: needsDash,
      noDashReachAnywhere: noDashAnywhere !== null,
      dashReachAnywhere: dashAnywhere !== null,
      noDashSuperset,
      noDashSupersetReachable: noDashSuperset.length > 0,
      pass: reached,
    });
    if (!reached) {
      result.pass = false;
      result.failures.push(`卷轴 ${scroll.id} 无法从任何路线平台到达`);
    }
  }

  /* 5) 关卡约束 */
  const highest = Math.min(...stage.platforms.map((p) => p.y));
  const lowest = Math.max(...stage.platforms.map((p) => p.y));
  const startIdx = findStartPlatform(stage);
  const startPlat = startIdx >= 0 ? stage.platforms[startIdx] : null;
  const fallTime = startPlat ? Math.sqrt((2 * Math.max(0, startPlat.y - (stage.start.y + PLAYER_H))) / GRAVITY) : null;
  const constraintChecks = [
    { id: 'goal-on-top', pass: stage.goal.y + stage.goal.h < highest, detail: `影门底 ${stage.goal.y + stage.goal.h} < 最高平台 ${highest}` },
    { id: 'goal-unblocked', pass: !stage.platforms.some((p) => rectsOverlap(stage.goal, { x: p.x, y: p.y, w: p.w, h: PLATFORM_H })), detail: '影门没有被平台遮挡' },
    { id: 'start-safe', pass: !!(startPlat && startPlat.w >= 90 && fallTime !== null && fallTime <= 1), detail: startPlat ? `起点平台宽 ${startPlat.w}，首落 ${r2(fallTime)}s，安全区 1–2s` : '无起点平台' },
    { id: 'death-bottom', pass: stage.height - lowest >= 40, detail: `最底平台 y=${lowest}，死亡边界 y>${stage.height}` },
    { id: 'no-random-field', pass: true, detail: '数据为纯常量，无随机字段；求解器不使用 Math.random' },
    { id: 'no-limited-items', pass: true, detail: '求解器完全未建模羽落/月弹，所有 PASS 均在不使用限量道具下取得' },
    { id: 'no-hidden-hazard', pass: true, detail: '数据契约无伤害体，唯一失败是跌出底部（无屏外瞬间伤害）' },
    { id: 'target-seconds', pass: stage.targetSeconds >= 45 && stage.targetSeconds <= 120, detail: `targetSeconds=${stage.targetSeconds}` },
  ];
  result.constraints = constraintChecks;
  for (const c of constraintChecks) {
    if (!c.pass) {
      result.pass = false;
      result.failures.push(`constraint:${c.id} ${c.detail}`);
    }
  }

  if (schema.warnings.length) result.schema = { ...schema, warnings: schema.warnings };
  return result;
}

/* ============================== 轨迹追踪 ============================== */
function runTrace(stage, traceSpec, opts) {
  const parts = String(traceSpec).split(':');
  if (parts.length !== 3) throw new UsageError('--trace 格式应为 <stageId:routeId:segIndex>，例如 S3:main:9');
  const [stageId, routeId, segStr] = parts;
  if (stage.id !== stageId) return null;
  const route = stage.routes.find((r) => r.id === routeId);
  if (!route) return null;
  const segIndex = Number(segStr);
  if (!Number.isInteger(segIndex) || segIndex < 0 || segIndex >= route.platforms.length - 1) {
    throw new UsageError(`--trace 段索引 ${segStr} 越界（route ${routeId} 有 ${route.platforms.length - 1} 段）`);
  }
  const fromIdx = route.platforms[segIndex];
  const toIdx = route.platforms[segIndex + 1];
  const target = { type: 'platform', index: toIdx };
  const search = independentSearch(stage, fromIdx, target, { ...opts, allowDash: route.requiresDash });
  if (search.successes.length === 0) return { traceSpec, ok: false, reason: '该段没有可用成功轨迹' };
  const best = search.successes.find((s) => s.dash) || search.successes[0];
  const baseWorld = makeWorld(stage);
  if (best.t0 > 0) advancePlatformsN(baseWorld, Math.round(best.t0 / DT));
  const stateStart = {
    x: best.x,
    y: stage.platforms[fromIdx].y - PLAYER_H,
    vx: best.vx,
    vy: JUMP_V,
    face: best.vx >= 0 ? 1 : -1,
    prevBottom: stage.platforms[fromIdx].y,
    dashAvailable: true,
    dashTimer: 0,
    dashDir: 1,
  };
  const res = simulateAttempt({
    worldStart: baseWorld,
    stateStart,
    fromIdx,
    target,
    policy: POLICIES[best.policyId],
    dashPlan: best.dash,
    allowDash: !!best.dash,
    maxFrames: 720,
    recordFrames: true,
  });
  return { traceSpec, ok: res.ok, frames: res.frames, summary: best, outcome: res.outcome };
}

/* ============================== 文本输出 ============================== */
function printTrace(trace) {
  if (!trace) return;
  console.log('');
  console.log(`[trace] ${trace.traceSpec}`);
  if (!trace.ok) {
    console.log(`  （无法生成轨迹：${trace.reason || trace.outcome}）`);
    return;
  }
  const s = trace.summary;
  console.log(`  起点 t0=${s.t0}s x=${s.x} vx=${s.vx} policy#${s.policyId}${s.dash ? ` dash(frame=${s.dash.frame},dir=${s.dash.dir})` : ''}`);
  console.log('  frame   x       y       vx      vy      dir dash landed goal dead');
  for (const f of trace.frames) {
    console.log(
      `  ${String(f.f).padStart(4)}  ${String(f.x).padStart(7)} ${String(f.y).padStart(7)} ${String(f.vx).padStart(7)} ${String(f.vy).padStart(7)}  ${String(f.dir).padStart(2)}  ${String(f.dash).padStart(3)}  ${String(f.landed ?? '-').padStart(5)}  ${f.goalHit ? 'Y' : '.'}   ${f.dead ? 'Y' : '.'}`
    );
  }
}

function formatStageText(res) {
  const lines = [];
  const head = `[${res.id}] ${res.title}  height=${res.height}  platforms=${res.platforms}  routes=${res.routes.length}  scrolls=${res.scrolls.length}  targetSeconds=${res.targetSeconds ?? '-'}`;
  lines.push(head);
  lines.push(`  [schema] ${res.schema.errors.length === 0 ? 'PASS' : 'FAIL'}  (平台: normal=${res.platformKinds.normal} moving=${res.platformKinds.moving} fragile=${res.platformKinds.fragile})`);
  for (const e of res.schema.errors) lines.push(`    ! ${e.code}: ${e.msg}`);

  for (const route of res.routes) {
    lines.push(`  [route ${route.id}] 「${route.label}」 requiresDash=${route.requiresDash} platforms=${route.platformCount} segments=${route.segments.length}`);
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i];
      const a = seg.analytic;
      const simpleNo = seg.noDash.successes > 0;
      let line = `    seg ${String(i).padStart(2)}: P${seg.from}(${seg.fromPos.x},${seg.fromPos.y},${seg.fromPos.w}) -> P${seg.to}(${seg.toPos.x},${seg.toPos.y},${seg.toPos.w})  Δy=${a.dy}`;
      if (simpleNo) {
        line += `  无影冲 PASS  成功 ${seg.noDash.successes}/${seg.noDash.attempts} 次尝试`;
        if (seg.noDash.landingX) line += `  落点x∈[${seg.noDash.landingX.min},${seg.noDash.landingX.max}]`;
        if (seg.noDash.example) line += `  示例: t0=${seg.noDash.example.t0}s x=${seg.noDash.example.x} vx=${seg.noDash.example.vx} ${policyLabel(seg.noDash.example.policyId)} frames=${seg.noDash.example.frame}`;
      } else {
        line += `  无影冲 FAIL(预期)  0/${seg.noDash.attempts}`;
        line += ` | 上界: 需横移≥${a.requiredDx}px, 无影冲上限 ${a.noDashReach === null ? `不可达(Δy>${a.maxJump})` : `${a.noDashReach}px`}${a.verticalOverMax ? '' : ` (=265px/s×${a.t}s)`}`;
        if (seg.dash) {
          line += ` | 影冲 PASS 成功 ${seg.dash.successes}/${seg.dash.attempts}`;
          if (seg.dash.dashExamples && seg.dash.dashExamples.length) {
            const d = seg.dash.dashExamples[0];
            line += `  例: ${seg.dash.example.t0}s x=${seg.dash.example.x} vx=${seg.dash.example.vx} ${policyLabel(seg.dash.example.policyId)} dash(frame=${d.frame},dir=${d.dir})`;
          }
          if (seg.dash.landingX) line += `  落点x∈[${seg.dash.landingX.min},${seg.dash.landingX.max}]`;
        }
      }
      lines.push(line);
    }
    if (route.goal) {
      lines.push(`    goal: 从 P${route.goal.from}(${res.goal.x},${res.goal.y}) 影门 ${route.goal.pass ? 'PASS' : 'FAIL'}  成功 ${route.goal.successes}/${route.goal.attempts}`);
      if (route.goal.landingX) lines.push(`      落点x∈[${route.goal.landingX.min},${route.goal.landingX.max}]  帧数=${route.goal.example?.frame ?? '-'}`);
    }
    if (route.playthrough) {
      const p = route.playthrough;
      lines.push(
        `    连续通关: ${p.pass ? 'PASS' : 'FAIL'}${p.pass ? `  理论最短 ${p.seconds}s (${p.totalFrames} 帧)，影冲段数=${p.dashSegments}` : `  (${p.reason}${p.at !== undefined ? ` @seg${p.at}` : ''})`}`
      );
    }
    if (route.noDashPlaythrough) {
      lines.push(`    整条禁影冲连续搜索: ${route.noDashPlaythrough.pass ? '按预期失败' : '异常通过'}${route.noDashPlaythrough.reason ? ` (${route.noDashPlaythrough.reason}${route.noDashPlaythrough.at !== undefined ? ` @seg${route.noDashPlaythrough.at}` : ''})` : ''}`);
    }
    if (route.criticalSegment && route.criticalSegment.analytic) {
      const c = route.criticalSegment;
      const a = c.analytic;
      lines.push(
        `    ★ 关键段 seg${c.index}: P${c.from}->P${c.to} Δy=${a.dy}  所需横移≥${a.requiredDx}px > 无影冲上限 ${a.noDashReach === null ? `0 (Δy>${a.maxJump})` : `${a.noDashReach}px`}  => 几何上必须影冲`
      );
      const planEntry = route.playthrough && route.playthrough.plan ? route.playthrough.plan.find((p) => p.from === c.from) : null;
      if (planEntry) {
        lines.push(
          `    连续通关实际采用: ${planEntry.dash ? `dash(frame=${planEntry.dash.frame}, dir=${planEntry.dash.dir})` : '无影冲'}  policy#${planEntry.policyId}  frames=${planEntry.frame}  落点x=${planEntry.landingX} vx=${planEntry.landingVx}`
        );
      }
    }
    for (const f of route.failures || []) lines.push(`    ! ${f}`);
  }

  if (res.noDashProof) {
    if (res.noDashProof.required) {
      lines.push(
        `  [全局无影冲证明] 超集图可达平台 {${res.noDashProof.supersetReachablePlatforms.map((i) => 'P' + i).join(',')}}；影门无影冲上界可能=${res.noDashProof.goalPossibleWithoutDash}  => ${res.noDashProof.pass ? 'PASS（必须影冲）' : 'FAIL'}`
      );
      if (res.noDashProof.goalBound.length) {
        lines.push(`    影门上界候选: ${res.noDashProof.goalBound.map((g) => `P${g.platform} 需${g.required}px/可达${g.reach}px`).join('; ')}`);
      }
    } else {
      lines.push(`  [全局无影冲证明] 本关不要求影冲（无 requiresDash 路线），无需证明`);
    }
  }

  for (const sc of res.scrolls) {
    const status = sc.pass ? 'PASS' : 'FAIL';
    const viaText = sc.via.length ? sc.via.map((v) => `${v.route}/P${v.platform}${v.dash ? '(影冲)' : '(无影冲)'} 成功${v.successes}`).join('; ') : '无';
    lines.push(`  [scroll ${sc.id}] 「${sc.label}」 (${sc.pos.x},${sc.pos.y}) 可达=${status}  ${viaText}`);
    if (res.noDashProof && res.noDashProof.required) {
      lines.push(
        `    需影冲证据: 路线平台无影冲搜索=${sc.noDashReachAnywhere ? '存在成功' : '0 成功'}；全平台无影冲必要上界候选=${sc.noDashSuperset.length === 0 ? '无（几何上够不到）' : sc.noDashSuperset.map((s) => `P${s.platform}(需${s.required}px/可达${s.reach}px)`).join(';')}`
      );
    }
  }

  if (res.recovery) {
    const r = res.recovery;
    lines.push(
      `  [recovery] 关键段 seg${r.segmentIndex}: 无影冲失败尝试 ${r.noDashAttempts} 次、落回回收平台 ${r.landedOnRecovery} 次、死亡 ${r.noDashDeaths} 次；影冲失败尝试 ${r.dashAttempts} 次、死亡 ${r.dashDeaths} 次  => ${r.pass ? 'PASS（错误冲刺不会直接必死）' : 'FAIL'}`
    );
  }

  lines.push('  [constraints]');
  for (const c of res.constraints || []) lines.push(`    ${c.pass ? 'PASS' : 'FAIL'}  ${c.id}: ${c.detail}`);
  lines.push(`  [result] ${res.pass ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

/* ============================== 主流程 ============================== */
function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`错误: ${err.message}`);
    console.error(USAGE);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!opts.stages) {
    console.error('错误: 缺少 --stages=<path>');
    console.error(USAGE);
    return 2;
  }

  const filePath = resolve(opts.stages);
  let data;
  try {
    data = loadStageData(filePath);
  } catch (err) {
    console.error(`错误: ${err.message}`);
    return 2;
  }

  const schema = schemaCheck(data);
  const results = [];
  for (let si = 0; si < data.stages.length; si++) {
    const stage = data.stages[si];
    const stageErrors = schema.errors.filter((e) => e.stageIndex === si || e.stageIndex === undefined);
    const stageWarnings = schema.warnings.filter((w) => w.stageIndex === si || w.stageIndex === undefined);
    const res = analyzeStage(stage, { quick: opts.quick, schemaErrors: stageErrors, schemaWarnings: stageWarnings });
    res.targetSeconds = stage.targetSeconds;
    results.push(res);
  }

  let traceResult = null;
  if (opts.trace) {
    try {
      for (const stage of data.stages) {
        const tr = runTrace(stage, opts.trace, { quick: opts.quick });
        if (tr) {
          traceResult = tr;
          break;
        }
      }
    } catch (err) {
      console.error(`错误: ${err.message}`);
      return 2;
    }
    if (!traceResult) {
      console.error(`错误: --trace=${opts.trace} 没有匹配到任何关卡/路线`);
      return 2;
    }
  }

  const failures = [];
  for (const res of results) for (const f of res.failures) failures.push(`[${res.id}] ${f}`);
  const allPass = failures.length === 0 && schema.errors.length === 0;

  if (opts.json) {
    const out = {
      tool: 'tools/arcade_stage_solver.mjs',
      version: TOOL_VERSION,
      input: filePath,
      rng: 'none (deterministic grid sampling; no Math.random)',
      controlPolicies: {
        count: POLICIES.length,
        definition: 'deadband{0,12,24} x brake{off,48px/150} x aim{-20%,0,+20%} x movingPredict{off,on}',
        startSamplesPerSegment: '9 landing positions x vx{-220,0,220}, 6 phase samples when moving platform involved',
        dashPlans: 'single dash x dir{-1,+1} x frame{0,2,...,20}',
      },
      dt: DT,
      physicsSource: 'apps/arcade/games/shadow-leap.html',
      physics: EXPECTED_PHYSICS,
      dash: { speed: DASH_SPEED, time: DASH_TIME, gravityScale: DASH_GRAVITY_SCALE, recharge: 'on-landing', airUses: 1 },
      schema: { errors: schema.errors, warnings: schema.warnings },
      stages: results.map((res) => ({
        id: res.id,
        title: res.title,
        height: res.height,
        targetSeconds: res.targetSeconds,
        pass: res.pass,
        schemaErrors: res.schema.errors,
        start: res.start,
        goal: res.goal,
        platformCount: res.platforms,
        platformKinds: res.platformKinds,
        routes: res.routes.map((r) => ({
          id: r.id,
          label: r.label,
          requiresDash: r.requiresDash,
          platforms: r.platformCount,
          pass: r.pass,
          segments: r.segments.map((s, i) => ({
            index: i,
            from: s.from,
            to: s.to,
            analytic: s.analytic,
            noDash: s.noDash,
            dash: s.dash,
            pass: s.pass,
          })),
          goal: r.goal ? { from: r.goal.from, successes: r.goal.successes, attempts: r.goal.attempts, landingRange: r.goal.landingX, example: r.goal.example, pass: r.goal.pass } : null,
          playthrough: r.playthrough,
          noDashPlaythrough: r.noDashPlaythrough || null,
          criticalSegment: r.criticalSegment || null,
          failures: r.failures || [],
        })),
        scrolls: res.scrolls.map((sc) => ({
          id: sc.id,
          label: sc.label,
          pos: sc.pos,
          reached: sc.reached,
          requiresDash: sc.requiresDash,
          via: sc.via.map((v) => ({ route: v.route, platform: v.platform, dash: v.dash, successes: v.successes, landingX: v.landingX })),
          noDashReachAnywhere: sc.noDashReachAnywhere,
          noDashSuperset: sc.noDashSuperset,
          pass: sc.pass,
        })),
        noDashProof: res.noDashProof,
        recovery: res.recovery,
        constraints: res.constraints,
        failures: res.failures,
      })),
      summary: {
        stages: results.length,
        passCount: results.filter((r) => r.pass).length,
        allPass,
        failures,
      },
      trace: traceResult ? { spec: traceResult.traceSpec, ok: traceResult.ok, frames: traceResult.frames } : null,
    };
    console.log(JSON.stringify(out, null, 2));
    return allPass ? 0 : 1;
  }

  const line = '='.repeat(78);
  console.log(line);
  console.log(`Arcade 0.8.0 影跃「影之试炼」S1-S3 独立可达性求解器 v${TOOL_VERSION}`);
  console.log(`输入: ${opts.stages}`);
  console.log(`物理: dt=1/60 gravity=${GRAVITY} jumpV=${JUMP_V} maxFall=${MAX_FALL} accel=${ACC} maxVx=${MAX_VX} wallBounce=${WALL_BOUNCE}`);
  console.log(`      影冲: speed=${DASH_SPEED} time=${DASH_TIME}s(8帧) gravityScale=${DASH_GRAVITY_SCALE} 着陆补满/空中一次/落地终止`);
  console.log(`      单向平台 h=${PLATFORM_H} fragile=${FRAGILE_BREAK}s moving=baseX+sin(phase)*range(clamp) 最大跳跃上升=${r2(MAX_JUMP_HEIGHT)}px`);
  console.log(`RNG: 无 Math.random；确定性网格采样（无需 seed）`);
  console.log(`控制策略: ${POLICIES.length} 种 = deadband{0,12,24} × brake{off,48px/150} × aim{-20%,0,+20%} × moving预测{off,on}；每段起点采样 9 个落点位置 × 初速(-220/0/+220)`);
  console.log(`影冲计划: 单次影冲 × 方向{-1,+1} × 触发帧{0,2,…,20}`);
  console.log(line);
  for (const res of results) {
    console.log('');
    console.log(formatStageText(res));
  }
  if (traceResult) {
    printTrace(traceResult);
    console.log('');
  }
  console.log('');
  console.log(line);
  const passCount = results.filter((r) => r.pass).length;
  console.log(`汇总: ${passCount}/${results.length} 关 PASS，物理常量校验 ${schema.errors.filter((e) => e.code.startsWith('schema.physics')).length === 0 ? 'PASS' : 'FAIL'}，退出码 ${allPass ? 0 : 1}`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length) {
    console.log('提示: 求解器 FAIL 时必须修改 docs/arcade/stages-0.8.json 的坐标/参数并重新运行；不得放宽断言。');
  }
  console.log(line);
  return allPass ? 0 : 1;
}

const exitCode = main(process.argv.slice(2));
process.exitCode = exitCode;
