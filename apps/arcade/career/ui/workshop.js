/*!
 * StudioKit Arcade Life — 制造台（0.17 / D17-21）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.workshop
 * （同时镜像一份 window.ArcadeCareerWorkshop，便于测试直接调用），不读 DOM、
 * 不写存储、不发请求。
 *
 * bridge.js 在玩家从告示板点「制造台」时调用：
 *
 *   window.ArcadeCareerUI.workshop.open(ctx);    // 打开（重复打开复用同一面板并重读账目）
 *   window.ArcadeCareerUI.workshop.render(ctx);  // 面板已打开时按新上下文重读账目并重绘
 *   window.ArcadeCareerUI.workshop.close();      // 关闭并把焦点还给打开前的元素
 *
 * ctx（bridge 构造，见 docs/arcade-life/ADR-interfaces.md §19.9）：
 *   { state, api, crafting, items, commission, commissionRun, commissions,
 *     announce(text), reducedMotion, openTown, openHangar, openReceipt }
 * 兼容：ctx.db（或 api.db / window.ArcadeCareer.db）可直接拿到 career-db 模块；
 *       careerId 缺失时用 ctx.commission.listAvailable({ensure:true}) 取；
 *       ctx.crafting 缺失时按 bridge 已装载的 careerDir 惰性注入同源 crafting.js
 *       （只装载本地静态模块，不访问网络；见证据 DEVIATIONS D-3）。
 *
 * 硬约束：
 * - 成本/材料/名称/效果文案只来自内容（ctx.items → crafting.configure），UI 不提交金额；
 * - 制造只经 career-db.purchase：crafting.applyPlan 组装请求（purchaseId
 *   craft:<careerId>:<moduleId>:<level>），DB 在同一事务内校验余额与材料并原子写入；
 *   失败零写入、可归因；重复制造同一层由 crafting.plan 幂等拦截（「已经有一件」）；
 * - 不写 localStorage、不碰旧机库 studiokit:arcade:meta:v1、不改经典/挑战/割草；
 * - 覆盖当前页面的轻量浮层：按钮 + Esc + 点遮罩关闭；焦点返回；Tab 不逃逸；
 *   role=dialog + aria-modal + aria-labelledby；prefers-reduced-motion 下无动画；
 *   320/375/390/430 宽不横向溢出，所有按钮热区 ≥44px；
 * - 全部文案为戏内语言：不出现「生涯模式 / 职业系统 / 解锁 / 奖励 / 签到 / 概率」等
 *   系统化或营销式措辞；降级只说「制造台还没通电」「账房还没开门」；
 * - 样式只在本文件注入的 <style>（不新建 CSS 文件、不引用外部字体/图片）；
 * - 任何异常 fail-open：面板保持可关闭，游戏页不受影响。
 */
(function (root) {
  'use strict';

  const VERSION = '0.18.0';
  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet';
  const TITLE_ID = 'ac-career-workshop-title';
  const LEDE_ID = 'ac-career-workshop-lede';
  const STATUS_ID = 'ac-career-workshop-status';
  const STYLE_ID = 'ac-career-workshop-style';

  const PANEL_TITLE = '制造台';
  const CLOSE_LABEL = '收起制造台';
  const PANEL_LEDE = '图样钉在墙上，材料得自个儿凑。';
  const WALLET_LABEL = '手头';
  const WALLET_CREDITS = '信用点';
  const WALLET_UNREADABLE = '账目还看不清。';
  const WALLET_CLOSED = '账目暂时打不开：';
  const ITEMS_UNAVAILABLE = '制造台还没通电。';
  const CRAFTING_MISSING = '制造台还没通电。';
  const LEDGER_CLOSED = '账房还没开门。';
  const NO_CAREER_NOTICE = '还不能上工：制造台只认得下过港口活计的人。';
  const NO_CAREER_STATUS = '还不能上工。';
  const BUSY_LABEL = '还在造，稍等。';

  const CRAFT_LABEL = '动手造';
  const OWNED_LABEL = '已经有一件';
  const LEDGER_BUTTON_LABEL = '账房没开门';
  const POWER_BUTTON_LABEL = '还没通电';
  const NO_CAREER_BUTTON_LABEL = '还不能上工';

  const BADGE_READY = '已经有一件';
  const BADGE_LEVELS = '已备下 ';
  const BADGE_LEVEL_SUFFIX = ' 层';
  const BADGE_IDLE = '还没动工';

  const TEXT_CRAFT_OK = '造好了：';
  const TEXT_CRAFT_DUP = '已经有一件：';
  const TEXT_CRAFT_FAIL = '这次没造出来：';
  const TEXT_SHORT_CREDITS = '信用点不够：';
  const TEXT_SHORT_MATERIALS = '材料不够：';

  /* 失败原因 → 可归因戏内文本（未知原因使用通用兜底，不暴露系统词）。 */
  const REASON_TEXT = {
    insufficient: '信用点还不够。',
    'insufficient-items': '还差的材料凑不齐。',
    'item-cap': '仓里放不下这些材料了。',
    'balance-cap': '账上放不下这么多信用点。',
    'bad-cost': '价码对不上。',
    'bad-cost-items': '要的材料清单对不上。',
    'bad-grants': '图样上的条目对不上。',
    'bad-purchase-id': '这笔没记上号。',
    'bad-career-id': '港务处还没记上你。',
    'no-wallet': '账上还没有你的名字。',
    'wallet-unavailable': '账房还没开门。',
    'core-unavailable': '账房还没开门。',
    'core-error': '账房那边卡住了。',
    constraint: '刚才那笔还在路上。',
    'connection-lost': '本机的册子暂时连不上。',
    blocked: '本机的册子暂时连不上。',
    'no-indexeddb': '这台机器存不下按册。',
    'load-failed': '账目读不出来。',
    'wallet-read-failed': '账目读不出来。',
    'db-unavailable': '账房还没开门。',
    'crafting-missing': '制造台还没通电。',
    'items-missing': '制造台还没通电。',
    'not-configured': '制造台还没通电。',
    'unknown-module': '制造台没有这一样图纸。',
    'bad-level': '这一层还没排上。',
    'already-owned': '已经有一件。',
    'price-changed': '报价变了，按新价再确认一次。',
    'purchase-failed': '制造台那边卡住了。',
    'purchase-rejected': '制造台把单子退回来了。',
    'purchase-threw': '制造台那边卡住了。',
    'craft-rejected': '制造台把单子退回来了。',
  };

  const STYLE_TEXT = [
    '.ac-career-workshop {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__lede {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-workshop__wallet {',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.5);',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-workshop__wallet-value {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-weight: 600;',
    '}',
    '.ac-career-workshop__notice {',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-workshop__list {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__card {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 12px;',
    '  background: rgba(11, 16, 32, 0.35);',
    '}',
    '.ac-career-workshop__card[data-owned-level="0"] {',
    '  border-style: dashed;',
    '}',
    '.ac-career-workshop__card-head {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: center;',
    '  gap: 6px;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__name {',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  line-height: 1.5;',
    '  overflow-wrap: anywhere;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__badge {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  max-width: 100%;',
    '  min-height: 20px;',
    '  padding: 1px 8px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 999px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-workshop__badge[data-badge="owned"] {',
    '  border-color: var(--ac-career-accent, #ffd23f);',
    '  color: var(--ac-career-accent, #ffd23f);',
    '}',
    '.ac-career-workshop__effect {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-workshop__rows {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__row {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: center;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  padding-top: 8px;',
    '  border-top: 1px dashed var(--ac-career-line, #2a3560);',
    '}',
    '.ac-career-workshop__row[data-owned="true"] {',
    '  opacity: 0.72;',
    '}',
    '.ac-career-workshop__row-main {',
    '  display: flex;',
    '  flex: 1 1 132px;',
    '  flex-wrap: wrap;',
    '  align-items: baseline;',
    '  gap: 4px 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__level {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '  line-height: 1.6;',
    '}',
    '.ac-career-workshop__cost {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '  min-width: 0;',
    '}',
    '.ac-career-workshop__shortfall {',
    '  flex: 1 1 100%;',
    '  margin: 0;',
    '  padding-left: 8px;',
    '  border-left: 2px solid var(--ac-career-danger, #ff5d5d);',
    '  color: #ffd9d9;',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-workshop__row .ac-career-btn {',
    '  flex: 0 1 auto;',
    '  min-width: 0;',
    '  min-height: 44px;',
    '}',
    '@media (max-width: 360px) {',
    '  .ac-career-workshop__row .ac-career-btn {',
    '    flex: 1 1 100%;',
    '    width: 100%;',
    '  }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .ac-career-workshop,',
    '  .ac-career-workshop * {',
    '    animation: none;',
    '    transition: none;',
    '  }',
    '}',
    '.ac-career-overlay.is-reduced-motion .ac-career-workshop,',
    '.ac-career-overlay.is-reduced-motion .ac-career-workshop * {',
    '  animation: none !important;',
    '  transition: none !important;',
    '}',
  ];

  /* 载入时抓一次自身 URL：bridge 注入 ui/workshop.js 后，用它推出同目录的 crafting.js。 */
  const SELF_URL = (function () {
    try {
      const doc = typeof document !== 'undefined' ? document : null;
      const script = doc && doc.currentScript ? doc.currentScript : null;
      return script && typeof script.src === 'string' ? script.src : '';
    } catch (err) {
      return '';
    }
  })();

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  let panel = null;
  let craftingLoad = null;

  function rootWindow() {
    try {
      if (typeof window !== 'undefined' && window) return window;
    } catch (err) {
      /* 继续回退 */
    }
    return root || null;
  }

  function documentOf() {
    const win = rootWindow();
    const doc = win && win.document ? win.document : null;
    return doc && typeof doc.createElement === 'function' ? doc : null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function numberOrZero(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.floor(num);
  }

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (err) {
      return '';
    }
  }

  function prefersReducedMotion() {
    try {
      const win = rootWindow();
      if (win && typeof win.matchMedia === 'function') {
        return !!win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
    } catch (err) {
      /* 视作未开启 */
    }
    return false;
  }

  function make(doc, tag, className, textValue) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (textValue !== undefined && textValue !== null) node.textContent = String(textValue);
    return node;
  }

  function clearNode(node) {
    if (!node) return;
    try {
      node.textContent = '';
    } catch (err) {
      /* ignore */
    }
  }

  function safelyFocus(node) {
    if (!node || typeof node.focus !== 'function') return;
    try {
      node.focus();
    } catch (err) {
      /* 焦点失败不影响面板可用性 */
    }
  }

  function focusableIn(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return [];
    const nodes = scope.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || node.disabled) continue;
      if (typeof node.tabIndex === 'number' && node.tabIndex < 0) continue;
      if (node.hidden) continue;
      if (typeof node.closest === 'function' && node.closest('[hidden]')) continue;
      if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) continue;
      out.push(node);
    }
    return out;
  }

  function ensureStyle(doc) {
    try {
      if (doc.getElementById(STYLE_ID)) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE_TEXT.join('\n');
      (doc.head || doc.documentElement).appendChild(style);
    } catch (err) {
      /* 样式注入失败时仍可读（继承 clue-surface.css 的浮层样式） */
    }
  }

  function ensurePeriod(text) {
    const value = cleanText(text);
    if (!value) return '';
    return /[。！？!?]$/.test(value) ? value : value + '。';
  }

  /* ------------------------------------------------------------------ *
   * ctx 解析（全部容错，缺字段按空处理）
   * ------------------------------------------------------------------ */

  function normalizeContext(input) {
    const ctx = isObject(input) ? input : {};
    const win = rootWindow();
    const bridge = win && win.ArcadeCareer && typeof win.ArcadeCareer === 'object' ? win.ArcadeCareer : null;
    return {
      raw: ctx,
      api: isObject(ctx.api) ? ctx.api : bridge,
      items: ctx.items,
      careerId: cleanText(ctx.careerId),
      commissionRun: isObject(ctx.commissionRun) ? ctx.commissionRun : null,
      wallet: isObject(ctx.wallet) ? ctx.wallet : null,
      commission: ctx.commission || null,
      crafting: ctx.crafting || null,
      db: ctx.db || null,
      reducedMotion: ctx.reducedMotion === true || prefersReducedMotion(),
      announce: typeof ctx.announce === 'function' ? ctx.announce : null,
    };
  }

  function dbOf(context) {
    const win = rootWindow();
    const candidates = [
      context && context.db,
      context && context.api && context.api.db,
      win && win.ArcadeCareer && win.ArcadeCareer.db,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const db = candidates[i];
      if (isObject(db)) return db;
    }
    return null;
  }

  function commissionOf(context) {
    const win = rootWindow();
    const candidates = [
      context && context.commission,
      context && context.api && context.api.commission,
      win && win.ArcadeCareer && win.ArcadeCareer.commission,
      win && win.ArcadeCareerCommission,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const mod = candidates[i];
      if (isObject(mod)) return mod;
    }
    return null;
  }

  /* 制造模块探测：ctx → ctx.api → 全局 → 惰性注入后的全局。 */
  function craftingOf(context) {
    const win = rootWindow();
    const candidates = [
      context && context.crafting,
      context && context.api && context.api.crafting,
      win && win.ArcadeCareerCrafting,
      win && win.ArcadeCareer && win.ArcadeCareer.crafting,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const mod = candidates[i];
      if (isObject(mod) && typeof mod.plan === 'function' && typeof mod.listRecipes === 'function') return mod;
    }
    return null;
  }

  /** bridge 已解析的 career 目录（绝对 URL）；退回本脚本同目录（去掉 ui/）。 */
  function careerDirOf() {
    const win = rootWindow();
    try {
      const bridge = win && win.ArcadeCareer ? win.ArcadeCareer : null;
      const info = bridge && typeof bridge.info === 'function' ? bridge.info() : null;
      if (isObject(info) && typeof info.careerDir === 'string' && info.careerDir) return info.careerDir;
    } catch (err) {
      /* 回退自身 URL */
    }
    if (SELF_URL) {
      const uiIndex = SELF_URL.lastIndexOf('/ui/');
      if (uiIndex >= 0) return SELF_URL.slice(0, uiIndex + 1);
      const slash = SELF_URL.lastIndexOf('/');
      if (slash >= 0) return SELF_URL.slice(0, slash + 1);
    }
    return '';
  }

  function configureCrafting(mod, items) {
    if (!mod || typeof mod.configure !== 'function') return null;
    if (!isObject(items)) return null;
    try {
      return mod.configure({ items: items });
    } catch (err) {
      return null;
    }
  }

  /** bridge 没预载 crafting.js 时，按 careerDir 惰性注入同源静态模块（不访问网络）。 */
  function injectCrafting(context) {
    const doc = documentOf();
    const dir = careerDirOf();
    if (!doc || !dir) return Promise.resolve(null);
    if (craftingLoad) return craftingLoad;
    const url = String(dir).replace(/\/+$/, '') + '/crafting.js';
    craftingLoad = new Promise(function (resolve) {
      let settled = false;
      let timer = null;
      function done(mod) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        craftingLoad = null;
        resolve(mod || null);
      }
      timer = setTimeout(function () {
        done(craftingOf(context));
      }, 4000);
      try {
        const script = doc.createElement('script');
        script.src = url;
        script.async = false;
        script.onload = function () {
          done(craftingOf(context));
        };
        script.onerror = function () {
          done(null);
        };
        (doc.head || doc.documentElement).appendChild(script);
      } catch (err) {
        done(null);
      }
    });
    return craftingLoad;
  }

  function pickCareerId(value, depth) {
    const level = typeof depth === 'number' ? depth : 0;
    if (level > 3 || value === null || value === undefined) return '';
    if (typeof value === 'string') {
      return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) ? value : '';
    }
    if (!isObject(value)) return '';
    const direct = ['careerId', 'careerID', 'career_id'];
    for (let i = 0; i < direct.length; i += 1) {
      const candidate = value[direct[i]];
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    const nested = ['career', 'profile', 'data', 'result', 'value', 'state', 'context'];
    for (let j = 0; j < nested.length; j += 1) {
      const found = pickCareerId(value[nested[j]], level + 1);
      if (found) return found;
    }
    return '';
  }

  function resolveCareerIdSync(context) {
    const win = rootWindow();
    const candidates = [
      context.careerId,
      context.commissionRun && context.commissionRun.careerId,
      context.wallet && context.wallet.careerId,
      context.api && context.api.commissionRun && context.api.commissionRun.careerId,
      win && win.ArcadeCareer && win.ArcadeCareer.commissionRun && win.ArcadeCareer.commissionRun.careerId,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const id = cleanText(candidates[i]);
      if (id) return id;
    }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * 内容 / 钱包规整
   * ------------------------------------------------------------------ */

  function normalizeItems(raw) {
    if (!isObject(raw)) return null;
    if (!Array.isArray(raw.modules) && !Array.isArray(raw.materials)) return null;
    const materials = [];
    if (Array.isArray(raw.materials)) {
      raw.materials.forEach(function (entry) {
        if (!isObject(entry)) return;
        const itemId = cleanText(entry.itemId);
        if (!itemId) return;
        materials.push({ itemId: itemId, name: cleanText(entry.name) || itemId });
      });
    }
    return {
      modules: Array.isArray(raw.modules) ? raw.modules.length : 0,
      materials: materials,
      contentVersion: cleanText(raw.contentVersion) || VERSION,
    };
  }

  function normalizeWallet(raw) {
    if (!isObject(raw)) return null;
    return {
      ok: raw.ok !== false,
      reason: cleanText(raw.reason),
      careerId: cleanText(raw.careerId),
      credits: numberOrZero(raw.credits),
      items: isObject(raw.items) ? raw.items : {},
      equipment: isObject(raw.equipment) ? raw.equipment : {},
    };
  }

  function materialName(state, itemId) {
    const materials = state && state.items && Array.isArray(state.items.materials) ? state.items.materials : [];
    for (let i = 0; i < materials.length; i += 1) {
      if (materials[i].itemId === itemId) return materials[i].name;
    }
    return itemId;
  }

  function equipmentOf(state) {
    return state && state.wallet && isObject(state.wallet.equipment) ? state.wallet.equipment : {};
  }

  function walletReady(state) {
    return !!(state && state.wallet && state.wallet.ok !== false);
  }

  function describeReason(reason) {
    const code = cleanText(reason);
    if (!code) return '';
    return REASON_TEXT[code] || '';
  }

  function recipeLabel(recipe) {
    const name = cleanText(recipe && recipe.name) || cleanText(recipe && recipe.moduleId);
    const level = recipe && typeof recipe.level === 'number' ? recipe.level : 1;
    return name + ' · 第 ' + level + ' 层';
  }

  function findRecipe(state, moduleId, level) {
    const recipes = state && Array.isArray(state.recipes) ? state.recipes : [];
    for (let i = 0; i < recipes.length; i += 1) {
      if (recipes[i].moduleId === moduleId && recipes[i].level === level) return recipes[i];
    }
    return null;
  }

  function groupRecipes(recipes) {
    const groups = [];
    const index = Object.create(null);
    recipes.forEach(function (recipe) {
      let group = index[recipe.moduleId];
      if (!group) {
        group = {
          moduleId: recipe.moduleId,
          name: recipe.name,
          effect: recipe.effect,
          levels: [],
        };
        index[recipe.moduleId] = group;
        groups.push(group);
      }
      group.levels.push(recipe);
    });
    return groups;
  }

  function costText(state, recipe, plan) {
    const quote = isObject(plan) && plan.ok === true && plan.owned !== true ? plan : recipe;
    const parts = [quote.cost + ' ' + WALLET_CREDITS];
    Object.keys(quote.costItems || {}).forEach(function (itemId) {
      parts.push(materialName(state, itemId) + ' ' + quote.costItems[itemId]);
    });
    return parts.join(' · ');
  }

  function safePlan(p, recipe) {
    const state = p && p.state ? p.state : null;
    if (!state || !state.crafting || typeof state.crafting.plan !== 'function') return null;
    const wallet = walletReady(state) ? { credits: state.wallet.credits, items: state.wallet.items } : null;
    try {
      return state.crafting.plan({
        moduleId: recipe.moduleId,
        level: recipe.level,
        equipment: equipmentOf(state),
        wallet: wallet,
      });
    } catch (err) {
      return null;
    }
  }

  function shortfallText(p, recipe, plan) {
    const state = p && p.state ? p.state : null;
    if (!state || !walletReady(state)) return '';
    const value = plan === undefined ? safePlan(p, recipe) : plan;
    if (!isObject(value) || value.ok !== true || value.owned === true) return '';
    const missing = isObject(value.missing) ? value.missing : null;
    if (!missing) return '';
    const parts = [];
    if (numberOrZero(missing.credits) > 0) parts.push(numberOrZero(missing.credits) + ' ' + WALLET_CREDITS);
    if (isObject(missing.items)) {
      Object.keys(missing.items).forEach(function (itemId) {
        parts.push(numberOrZero(missing.items[itemId]) + ' ' + materialName(state, itemId));
      });
    }
    return parts.length ? '还差 ' + parts.join('、') : '';
  }

  /** 只算信用点差额（失败文案只说钱，不把材料混进「信用点不够」）。 */
  function creditShortText(p, recipe, plan) {
    const state = p && p.state ? p.state : null;
    if (!state || !walletReady(state)) return '';
    const value = plan === undefined ? safePlan(p, recipe) : plan;
    if (!isObject(value) || value.ok !== true || value.owned === true) return '';
    const missing = isObject(value.missing) ? value.missing : null;
    const credits = numberOrZero(missing && missing.credits);
    return credits > 0 ? '还差 ' + credits + ' ' + WALLET_CREDITS : '';
  }

  /** 只算材料差额（「材料不够」只列材料）。 */
  function materialShortText(p, recipe, plan) {
    const state = p && p.state ? p.state : null;
    if (!state || !walletReady(state)) return '';
    const value = plan === undefined ? safePlan(p, recipe) : plan;
    if (!isObject(value) || value.ok !== true || value.owned === true) return '';
    const missing = isObject(value.missing) && isObject(value.missing.items) ? value.missing.items : null;
    if (!missing) return '';
    const parts = [];
    Object.keys(missing).forEach(function (itemId) {
      parts.push(numberOrZero(missing[itemId]) + ' ' + materialName(state, itemId));
    });
    return parts.length ? '还差 ' + parts.join('、') : '';
  }

  /* ------------------------------------------------------------------ *
   * 状态行 / 播报
   * ------------------------------------------------------------------ */

  function announceTo(p, message) {
    const value = cleanText(message);
    if (!value) return;
    if (p.context && typeof p.context.announce === 'function') {
      try {
        p.context.announce(value);
        return;
      } catch (err) {
        /* 回落到面板自带的 polite 区域 */
      }
    }
    if (!p.liveEl) return;
    try {
      p.liveEl.textContent = '';
      p.liveEl.textContent = value;
    } catch (err) {
      /* ignore */
    }
  }

  function applyStatus(p, message, code) {
    if (!p.statusEl) return;
    const value = cleanText(message);
    p.statusText = value;
    p.statusCode = cleanText(code);
    p.statusEl.textContent = value;
    p.statusEl.hidden = !value;
    try {
      p.statusEl.setAttribute('data-reason', p.statusCode);
    } catch (err) {
      /* ignore */
    }
    if (value) announceTo(p, value);
  }

  function setPending(p, key) {
    p.pending = key || '';
    try {
      if (p.pending) p.sheet.setAttribute('aria-busy', 'true');
      else p.sheet.removeAttribute('aria-busy');
    } catch (err) {
      /* ignore */
    }
    renderAll(p);
  }

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  function emptyState() {
    return {
      items: null,
      crafting: null,
      careerId: '',
      wallet: null,
      walletError: '',
      recipes: [],
      commissionChecked: false,
    };
  }

  function renderAll(p) {
    if (!p || !p.doc) return;
    /* 任何一块渲染失败都不能把异常抛回游戏页（fail-open）。 */
    try {
      renderWallet(p);
    } catch (err) {
      /* ignore */
    }
    try {
      renderNotice(p);
    } catch (err) {
      /* ignore */
    }
    try {
      renderList(p);
    } catch (err) {
      /* ignore */
    }
  }

  function documentNode(p, tag, className, textValue) {
    return make(p.doc, tag, className, textValue);
  }

  function renderWallet(p) {
    const state = p.state || emptyState();
    const el = p.walletEl;
    if (!el) return;
    clearNode(el);
    if (!state.items || !state.careerId) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!walletReady(state)) {
      el.textContent = state.walletError ? WALLET_CLOSED + (describeReason(state.walletError) || '') : WALLET_UNREADABLE;
      return;
    }
    el.appendChild(documentNode(p, 'span', 'ac-career-workshop__wallet-value', WALLET_LABEL + ' ' + state.wallet.credits + ' ' + WALLET_CREDITS));
    state.items.materials.forEach(function (mat) {
      el.appendChild(p.doc.createTextNode(' · '));
      el.appendChild(
        documentNode(p, 'span', 'ac-career-workshop__wallet-value', mat.name + ' ×' + numberOrZero(state.wallet.items[mat.itemId]))
      );
    });
  }

  function renderNotice(p) {
    const state = p.state || emptyState();
    const el = p.noticeEl;
    if (!el) return;
    if (!state.items) {
      el.hidden = false;
      el.textContent = ITEMS_UNAVAILABLE;
      return;
    }
    if (!state.crafting) {
      el.hidden = false;
      el.textContent = CRAFTING_MISSING;
      return;
    }
    if (!state.careerId) {
      el.hidden = false;
      el.textContent = NO_CAREER_NOTICE;
      return;
    }
    if (!walletReady(state) && state.walletError) {
      el.hidden = false;
      el.textContent = WALLET_CLOSED + (describeReason(state.walletError) || '');
      return;
    }
    el.hidden = true;
    el.textContent = '';
  }

  function refreshRecipes(p) {
    const state = p && p.state ? p.state : null;
    if (!state) return [];
    if (!state.crafting || typeof state.crafting.listRecipes !== 'function') {
      state.recipes = [];
      return state.recipes;
    }
    try {
      const list = state.crafting.listRecipes(equipmentOf(state));
      state.recipes = Array.isArray(list) ? list : [];
    } catch (err) {
      state.recipes = Array.isArray(state.recipes) ? state.recipes : [];
    }
    return state.recipes;
  }

  function renderList(p) {
    const state = p.state || emptyState();
    const list = p.listEl;
    if (!list) return;
    clearNode(list);
    if (!state.items || !state.crafting) return;
    const recipes = refreshRecipes(p);
    if (!recipes.length) return;
    groupRecipes(recipes).forEach(function (group) {
      list.appendChild(buildCard(p, group));
    });
  }

  function craftBlock(p, recipe, plan) {
    const state = p.state;
    if (recipe.owned === true) return { disabled: true, label: OWNED_LABEL, code: 'owned' };
    if (!state.crafting) return { disabled: true, label: POWER_BUTTON_LABEL, code: 'crafting-missing' };
    if (!state.careerId) return { disabled: true, label: NO_CAREER_BUTTON_LABEL, code: 'no-career' };
    if (!walletReady(state)) return { disabled: true, label: LEDGER_BUTTON_LABEL, code: 'wallet' };
    if (p.pending) return { disabled: true, label: CRAFT_LABEL, code: 'pending' };
    /* 余额/材料不足不禁用按钮：点击后由 DB 在同一事务内判定，失败可见差额。 */
    if (isObject(plan) && plan.ok === false && plan.reason === 'bad-level') {
      return { disabled: true, label: CRAFT_LABEL, code: 'bad-level' };
    }
    return { disabled: false, label: CRAFT_LABEL, code: '' };
  }

  function buildBadge(doc, textValue, kind) {
    const badge = make(doc, 'span', 'ac-career-workshop__badge', textValue);
    if (kind) badge.setAttribute('data-badge', kind);
    return badge;
  }

  function moduleBadgeText(group) {
    let ownedLevel = 0;
    group.levels.forEach(function (recipe) {
      if (recipe.owned === true && recipe.level > ownedLevel) ownedLevel = recipe.level;
    });
    if (ownedLevel <= 0) return BADGE_IDLE;
    if (group.levels.length <= 1) return BADGE_READY;
    return BADGE_LEVELS + ownedLevel + BADGE_LEVEL_SUFFIX;
  }

  function ownedLevelOf(group) {
    let ownedLevel = 0;
    group.levels.forEach(function (recipe) {
      if (recipe.owned === true && recipe.level > ownedLevel) ownedLevel = recipe.level;
    });
    return ownedLevel;
  }

  function buildCard(p, group) {
    const doc = p.doc;
    const state = p.state;
    const ownedLevel = ownedLevelOf(group);
    const card = make(doc, 'section', 'ac-career-workshop__card');
    card.setAttribute('data-module-id', group.moduleId);
    card.setAttribute('data-owned-level', String(ownedLevel));

    const head = make(doc, 'div', 'ac-career-workshop__card-head');
    const name = make(doc, 'h3', 'ac-career-workshop__name', group.name);
    name.id = 'ac-career-workshop-' + String(group.moduleId).replace(/[^A-Za-z0-9_-]/g, '-');
    head.appendChild(name);
    head.appendChild(buildBadge(doc, moduleBadgeText(group), ownedLevel > 0 ? 'owned' : 'idle'));
    card.appendChild(head);

    const effect = ensurePeriod(group.effect);
    if (effect) card.appendChild(make(doc, 'p', 'ac-career-workshop__effect', '「' + effect + '」'));

    const rows = make(doc, 'div', 'ac-career-workshop__rows');
    group.levels.forEach(function (recipe) {
      rows.appendChild(buildRow(p, recipe));
    });
    card.appendChild(rows);
    return card;
  }

  function buildRow(p, recipe) {
    const doc = p.doc;
    const state = p.state;
    const owned = recipe.owned === true;
    const plan = owned ? null : safePlan(p, recipe);
    const row = make(doc, 'div', 'ac-career-workshop__row');
    row.setAttribute('data-level', String(recipe.level));
    row.setAttribute('data-owned', owned ? 'true' : 'false');

    const main = make(doc, 'div', 'ac-career-workshop__row-main');
    main.appendChild(make(doc, 'span', 'ac-career-workshop__level', '第 ' + recipe.level + ' 层'));
    main.appendChild(make(doc, 'span', 'ac-career-workshop__cost', costText(state, recipe, plan)));
    row.appendChild(main);

    const short = owned ? '' : shortfallText(p, recipe, plan);
    if (short) row.appendChild(make(doc, 'p', 'ac-career-workshop__shortfall', short));

    const block = craftBlock(p, recipe, plan);
    const button = make(doc, 'button', block.disabled ? 'ac-career-btn' : 'ac-career-btn ac-career-btn--primary', block.label);
    button.type = 'button';
    button.setAttribute('data-action', 'craft');
    button.setAttribute('data-module-id', recipe.moduleId);
    button.setAttribute('data-level', String(recipe.level));
    if (block.code) button.setAttribute('data-block', block.code);
    if (block.disabled) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
    row.appendChild(button);
    return row;
  }

  /* ------------------------------------------------------------------ *
   * 数据装载（内容 → 制造模块 → careerId → 钱包）
   * ------------------------------------------------------------------ */

  function isLive(p, token) {
    return panel === p && p.loadToken === token;
  }

  function loadData(p) {
    if (!p) return Promise.resolve();
    p.loadToken = (p.loadToken || 0) + 1;
    const token = p.loadToken;
    const context = p.context || normalizeContext(null);
    const state = emptyState();
    state.items = normalizeItems(context.items);
    state.careerId = resolveCareerIdSync(context);
    state.crafting = craftingOf(context);
    p.state = state;
    p.pending = '';
    if (state.crafting) configureCrafting(state.crafting, context.items);
    if (context.wallet && isObject(context.wallet) && context.wallet.ok !== false) {
      const normalized = normalizeWallet(context.wallet);
      if (normalized) state.wallet = normalized;
    }
    renderAll(p);
    if (!state.items) return Promise.resolve();
    return ensureCrafting(p, token, context, state)
      .then(function () {
        if (!isLive(p, token)) return null;
        renderAll(p);
        return ensureCareerId(p, token, context, state);
      })
      .then(function () {
        if (!isLive(p, token)) return null;
        return readWalletState(p, token, context, state);
      })
      .then(function () {
        if (!isLive(p, token)) return null;
        if (!state.crafting) {
          state.crafting = craftingOf(context);
          if (state.crafting) configureCrafting(state.crafting, context.items);
        }
        renderAll(p);
      })
      .catch(function () {
        if (!isLive(p, token)) return null;
        if (!state.wallet) state.walletError = 'load-failed';
        renderAll(p);
      });
  }

  function ensureCrafting(p, token, context, state) {
    if (state.crafting) return Promise.resolve();
    return injectCrafting(context).then(function (mod) {
      if (!isLive(p, token)) return;
      if (!mod) return;
      state.crafting = mod;
      configureCrafting(mod, context.items);
    });
  }

  function ensureCareerId(p, token, context, state) {
    if (state.careerId) return Promise.resolve();
    const commission = commissionOf(context);
    if (!commission || typeof commission.listAvailable !== 'function') return Promise.resolve();
    let returned = null;
    try {
      returned = commission.listAvailable({ ensure: true });
    } catch (err) {
      return Promise.resolve();
    }
    return Promise.resolve(returned).then(
      function (result) {
        if (!isLive(p, token)) return;
        state.commissionChecked = true;
        const careerId = pickCareerId(result);
        if (careerId) state.careerId = careerId;
      },
      function () {
        state.commissionChecked = true;
      }
    );
  }

  function readWalletState(p, token, context, state) {
    const db = dbOf(context);
    const syncId = !state.careerId && state.wallet ? cleanText(state.wallet.careerId) : '';
    if (!state.careerId && syncId) state.careerId = syncId;
    if (!state.careerId) return Promise.resolve();
    if (!db || typeof db.readWallet !== 'function') {
      if (!state.wallet) state.walletError = 'db-unavailable';
      return Promise.resolve();
    }
    let returned = null;
    try {
      returned = db.readWallet(state.careerId);
    } catch (err) {
      if (!state.wallet) state.walletError = 'wallet-read-failed';
      return Promise.resolve();
    }
    return Promise.resolve(returned).then(
      function (wallet) {
        if (!isLive(p, token)) return;
        const normalized = normalizeWallet(wallet);
        if (!normalized) {
          if (!state.wallet) state.walletError = 'wallet-unavailable';
          return;
        }
        if (normalized.ok !== false) {
          state.wallet = normalized;
          state.walletError = '';
          if (!state.careerId && normalized.careerId) state.careerId = normalized.careerId;
        } else if (!state.wallet) {
          state.wallet = normalized;
          state.walletError = normalized.reason || 'wallet-unavailable';
        }
      },
      function () {
        if (!isLive(p, token)) return;
        if (!state.wallet) state.walletError = 'wallet-read-failed';
      }
    );
  }

  function refreshWallet(p) {
    const db = dbOf(p.context);
    const state = p.state;
    if (!state || !state.careerId || !db || typeof db.readWallet !== 'function') return Promise.resolve();
    let returned = null;
    try {
      returned = db.readWallet(state.careerId);
    } catch (err) {
      return Promise.resolve();
    }
    return Promise.resolve(returned).then(
      function (wallet) {
        if (!panel || panel !== p) return;
        const normalized = normalizeWallet(wallet);
        if (!normalized) return;
        if (normalized.ok !== false) {
          state.wallet = normalized;
          state.walletError = '';
        }
      },
      function () {
        /* 保留旧账目，下一次操作再读 */
      }
    );
  }

  /* ------------------------------------------------------------------ *
   * 玩家动作
   * ------------------------------------------------------------------ */

  function onListClick(p, event) {
    const target = event && event.target;
    const button = target && typeof target.closest === 'function' ? target.closest('[data-action]') : null;
    if (!button || button.disabled) return;
    const action = button.getAttribute('data-action');
    if (action !== 'craft') return;
    const moduleId = cleanText(button.getAttribute('data-module-id'));
    const level = Number(button.getAttribute('data-level'));
    if (!moduleId || !Number.isFinite(level)) return;
    handleCraft(p, moduleId, level);
  }

  function handleCraft(p, moduleId, level) {
    const state = p.state;
    if (!state || !state.items) {
      applyStatus(p, ITEMS_UNAVAILABLE, 'items-missing');
      return;
    }
    if (!state.crafting) {
      applyStatus(p, CRAFTING_MISSING, 'crafting-missing');
      return;
    }
    const recipe = findRecipe(state, moduleId, level);
    if (!recipe) {
      applyStatus(p, TEXT_CRAFT_FAIL + (describeReason('unknown-module') || '制造台没有这一样图纸。'), 'unknown-module');
      return;
    }
    if (!state.careerId) {
      applyStatus(p, NO_CAREER_STATUS, 'no-career');
      return;
    }
    const db = dbOf(p.context);
    if (!db || typeof db.purchase !== 'function') {
      applyStatus(p, LEDGER_CLOSED, 'db-unavailable');
      return;
    }
    const plan = safePlan(p, recipe);
    if (!isObject(plan)) {
      applyStatus(p, CRAFTING_MISSING, 'crafting-missing');
      return;
    }
    if (plan.ok === false) {
      settleCraftRefusal(p, recipe, plan, plan);
      return;
    }
    const applied = state.crafting.applyPlan({
      plan: plan,
      careerId: state.careerId,
      now: nowIso(),
      contentVersion: state.items ? state.items.contentVersion : '',
    });
    if (!isObject(applied) || applied.ok !== true) {
      settleCraftRefusal(p, recipe, plan, applied);
      return;
    }
    setPending(p, recipe.moduleId + ':' + recipe.level);
    let returned = null;
    try {
      returned = db.purchase(applied.request);
    } catch (err) {
      settleCraftFailure(p, recipe, 'purchase-threw');
      return;
    }
    Promise.resolve(returned).then(
      function (result) {
        if (!panel || panel !== p) return;
        if (result && result.ok) settleCraftSuccess(p, recipe, result);
        else settleCraftFailure(p, recipe, (result && result.reason) || 'purchase-rejected');
      },
      function () {
        if (!panel || panel !== p) return;
        settleCraftFailure(p, recipe, 'purchase-failed');
      }
    );
  }

  function settleCraftSuccess(p, recipe, result) {
    const duplicate = !!(result && result.duplicate === true);
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, (duplicate ? TEXT_CRAFT_DUP : TEXT_CRAFT_OK) + recipeLabel(recipe) + '。', duplicate ? 'duplicate' : 'crafted');
    });
  }

  function settleCraftRefusal(p, recipe, plan, applied) {
    const reason = applied && typeof applied.reason === 'string' ? applied.reason : 'craft-rejected';
    if (reason === 'already-owned') {
      p.pending = '';
      renderAll(p);
      applyStatus(p, TEXT_CRAFT_DUP + recipeLabel(recipe) + '。', 'owned');
      return;
    }
    if (reason === 'wallet-unavailable' || reason === 'core-unavailable' || reason === 'no-wallet') {
      applyStatus(p, LEDGER_CLOSED, reason);
      return;
    }
    if (reason === 'insufficient') {
      const credit = creditShortText(p, recipe, plan);
      applyStatus(p, TEXT_SHORT_CREDITS + (credit ? credit + '。' : '先攒一攒。'), reason);
      return;
    }
    if (reason === 'insufficient-items') {
      const materials = materialShortText(p, recipe, plan);
      applyStatus(p, TEXT_SHORT_MATERIALS + (materials ? materials + '。' : '还差的材料凑不齐。'), reason);
      return;
    }
    applyStatus(p, TEXT_CRAFT_FAIL + (describeReason(reason) || '制造台把单子退回来了。'), reason);
  }

  function settleCraftFailure(p, recipe, reason) {
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      const plan = safePlan(p, recipe);
      let message = '';
      if (reason === 'insufficient') {
        const credit = creditShortText(p, recipe, plan);
        message = TEXT_SHORT_CREDITS + (credit ? credit + '。' : '先攒一攒。');
      } else if (reason === 'insufficient-items') {
        const materials = materialShortText(p, recipe, plan);
        message = TEXT_SHORT_MATERIALS + (materials ? materials + '。' : '还差的材料凑不齐。');
      } else if (reason === 'price-changed') {
        message = '报价变了，按新价再确认一次。';
      } else {
        message = TEXT_CRAFT_FAIL + (describeReason(reason) || '制造台把单子退回来了。');
      }
      applyStatus(p, message, reason);
    });
  }

  /* ------------------------------------------------------------------ *
   * 面板生命周期
   * ------------------------------------------------------------------ */

  function buildPanel(doc, context) {
    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    const overlay = make(doc, 'div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', 'workshop');
    overlay.setAttribute('data-workshop', '1');
    if (context.reducedMotion) overlay.classList.add('is-reduced-motion');

    const sheet = make(doc, 'div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('aria-describedby', LEDE_ID);
    sheet.setAttribute('tabindex', '-1');
    sheet.setAttribute('data-workshop-sheet', '1');

    const head = make(doc, 'div', 'ac-career-sheet__head');
    const heading = make(doc, 'h2', 'ac-career-sheet__title', PANEL_TITLE);
    heading.id = TITLE_ID;
    const closeBtn = make(doc, 'button', 'ac-career-icon-btn ac-career-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', CLOSE_LABEL);
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make(doc, 'div', 'ac-career-sheet__body');
    const wrap = make(doc, 'div', 'ac-career-workshop');
    const lede = make(doc, 'p', 'ac-career-workshop__lede', PANEL_LEDE);
    lede.id = LEDE_ID;
    const walletEl = make(doc, 'p', 'ac-career-workshop__wallet');
    walletEl.hidden = true;
    const noticeEl = make(doc, 'p', 'ac-career-workshop__notice');
    noticeEl.hidden = true;
    const listEl = make(doc, 'div', 'ac-career-workshop__list');
    const statusEl = make(doc, 'p', 'ac-career-status');
    statusEl.id = STATUS_ID;
    statusEl.hidden = true;
    wrap.appendChild(lede);
    wrap.appendChild(walletEl);
    wrap.appendChild(noticeEl);
    wrap.appendChild(listEl);
    wrap.appendChild(statusEl);
    body.appendChild(wrap);
    sheet.appendChild(head);
    sheet.appendChild(body);

    const liveEl = make(doc, 'div', 'ac-career-sr-only');
    liveEl.setAttribute('role', 'status');
    liveEl.setAttribute('aria-live', 'polite');
    liveEl.setAttribute('aria-atomic', 'true');

    overlay.appendChild(sheet);
    overlay.appendChild(liveEl);
    if (!doc.body) return null;
    try {
      doc.body.appendChild(overlay);
    } catch (err) {
      return null;
    }

    const p = {
      doc: doc,
      overlay: overlay,
      sheet: sheet,
      body: body,
      closeBtn: closeBtn,
      walletEl: walletEl,
      noticeEl: noticeEl,
      listEl: listEl,
      statusEl: statusEl,
      liveEl: liveEl,
      previousFocus: previousFocus,
      onKeyDown: null,
      context: context,
      state: emptyState(),
      loadToken: 0,
      pending: '',
      statusText: '',
      statusCode: '',
    };

    function onKeyDown(event) {
      if (!event) return;
      /* 只处理最上层 career 面板：town→workshop 叠层时 Esc 不得一次关两层。 */
      const panels = doc.querySelectorAll('[data-career-panel]');
      if (panels.length && panels[panels.length - 1] !== overlay) return;
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
      if (key === 'Escape' || key === 'Esc' || code === 27) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        close();
        return;
      }
      if (key !== 'Tab' && code !== 9) return;
      const items = focusableIn(sheet);
      if (!items.length) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(sheet);
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = doc.activeElement;
      const outside = !sheet.contains(activeEl);
      if (event.shiftKey) {
        if (activeEl === first || activeEl === sheet || outside) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          safelyFocus(last);
        }
        return;
      }
      if (activeEl === last || outside) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(first);
      }
    }
    p.onKeyDown = onKeyDown;

    let pressedBackdrop = false;
    overlay.addEventListener(
      'pointerdown',
      function (event) {
        pressedBackdrop = !!(event && event.target === overlay);
      },
      false
    );
    overlay.addEventListener(
      'pointercancel',
      function () {
        pressedBackdrop = false;
      },
      false
    );
    overlay.addEventListener(
      'click',
      function (event) {
        const onBackdrop = !!(event && event.target === overlay) && pressedBackdrop;
        pressedBackdrop = false;
        if (onBackdrop) close();
      },
      false
    );
    closeBtn.addEventListener('click', function () {
      close();
    }, false);
    listEl.addEventListener('click', function (event) {
      onListClick(p, event);
    }, false);
    doc.addEventListener('keydown', onKeyDown, true);

    return p;
  }

  /**
   * 打开制造台。重复打开时复用同一面板并重读账目（不重建、不叠层）。
   * @param {object} [ctx] bridge 上下文（缺失字段按空处理，不抛异常）
   * @returns {Element|null} 面板元素；无 DOM 或挂载失败时返回 null
   */
  function open(ctx) {
    const doc = documentOf();
    if (!doc) return null;
    const context = normalizeContext(ctx);
    if (panel && panel.doc === doc && panel.overlay && panel.overlay.parentNode) {
      panel.context = context;
      if (context.reducedMotion) panel.overlay.classList.add('is-reduced-motion');
      else panel.overlay.classList.remove('is-reduced-motion');
      applyStatus(panel, '', '');
      loadData(panel);
      safelyFocus(panel.closeBtn);
      return panel.sheet;
    }
    close();
    ensureStyle(doc);
    const built = buildPanel(doc, context);
    if (!built) return null;
    panel = built;
    applyStatus(panel, '', '');
    loadData(panel);
    safelyFocus(panel.closeBtn);
    return panel.sheet;
  }

  /**
   * 按新的上下文重读账目并重绘（面板未打开时返回 null，不创建 DOM）。
   * @param {object} [ctx]
   * @returns {Element|null}
   */
  function render(ctx) {
    if (!panel) return null;
    const doc = documentOf();
    if (!doc || panel.doc !== doc) return null;
    const context = normalizeContext(ctx === undefined || ctx === null ? panel.context.raw : ctx);
    panel.context = context;
    if (context.reducedMotion) panel.overlay.classList.add('is-reduced-motion');
    else panel.overlay.classList.remove('is-reduced-motion');
    loadData(panel);
    return panel.sheet;
  }

  /** 关闭制造台并把焦点还给打开前的元素（可重复调用）。 */
  function close() {
    const current = panel;
    panel = null;
    if (!current) return false;
    try {
      current.doc.removeEventListener('keydown', current.onKeyDown, true);
    } catch (err) {
      /* ignore */
    }
    try {
      if (current.overlay.parentNode) current.overlay.parentNode.removeChild(current.overlay);
    } catch (err) {
      /* ignore */
    }
    const previous = current.previousFocus;
    if (previous && typeof previous.focus === 'function') {
      const connected = typeof previous.isConnected === 'boolean' ? previous.isConnected : true;
      if (connected) safelyFocus(previous);
    }
    return true;
  }

  function isOpen() {
    return !!panel;
  }

  const api = {
    VERSION: VERSION,
    open: open,
    close: close,
    render: render,
    isOpen: isOpen,
  };

  if (root) {
    root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
    root.ArcadeCareerUI.workshop = api;
    try {
      root.ArcadeCareerWorkshop = api;
    } catch (err) {
      /* 别名挂载失败不影响主入口 */
    }
  }

  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
