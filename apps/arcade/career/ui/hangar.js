/*!
 * StudioKit Arcade Life — 机库 / 飞船商店（0.16 / D16-06）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.hangar
 * （同时镜像一份 window.ArcadeCareerHangar，便于测试直接调用），不读 DOM、
 * 不写存储、不发请求。
 *
 * bridge.js 在玩家主动打开机库时调用：
 *
 *   window.ArcadeCareerUI.hangar.open(ctx);    // 打开（重复打开复用同一面板并重读账目）
 *   window.ArcadeCareerUI.hangar.render(ctx);  // 面板已打开时按新上下文重读账目并重绘
 *   window.ArcadeCareerUI.hangar.close();      // 关闭并把焦点还给打开前的元素
 *
 * ctx（bridge 构造，见 docs/arcade-life/ADR-interfaces.md §17 / §18.7）：
 *   { state, api, commission, commissionRun, commissions, items, careerId,
 *     profile, wallet, announce(text), reducedMotion, openTown, openReceipt,
 *     openSettings, rental? }
 * 兼容：ctx.db（或 api.db / window.ArcadeCareer.db）可直接拿到 career-db 模块；
 *       careerId 只取 ctx / 已投影上下文；缺失时保持只读，不创建生涯身份；
 *       rental 缺失时租用按钮标注「码头暂未开放」，绝不扣费。
 *
 * 硬约束：
 * - 只经 career-db 写：购买走 purchase（cost 与 costItems 只来自 items.json + 玩家点击，
 *   原子校验/扣减，余额或材料不足整笔失败、零写入；同一 purchaseId 重复返回原收据），
 *   切换/租用走 writeEquipment（零成本、不入账本）；不写 localStorage、不碰旧机库
 *   studiokit:arcade:meta:v1；
 * - items 内容缺失时显示「机库暂不可用」，不抛异常；
 * - 无 careerId（commission 模块尚未落地/尚未登记）时只读展示飞船与价格，购买按钮禁用
 *   并提示「还不能登记」；
 * - 余额/材料不足显示差额（还差 X 信用点 / Y 合金），不自动扣款、不伪造成功；
 * - 覆盖当前页面的轻量浮层：按钮 + Esc + 点遮罩关闭；焦点返回；Tab 不逃逸；
 *   role=dialog + aria-modal + aria-labelledby；prefers-reduced-motion 下无动画；
 *   320/375/390/430 宽不横向溢出，所有按钮热区 ≥44px；
 * - 全部文案为戏内语言：不出现「生涯模式 / 职业系统 / 解锁 / 奖励 / 签到 / 概率」等
 *   系统化或营销式措辞；不解释系统规则；
 * - 样式只在本文件注入的 <style>（不新建 CSS 文件、不引用外部字体/图片）；
 * - 任何异常 fail-open：面板保持可关闭，游戏页不受影响。
 */
(function (root) {
  'use strict';

  const VERSION = '0.18.0';
  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet';
  const TITLE_ID = 'ac-career-hangar-title';
  const LEDE_ID = 'ac-career-hangar-lede';
  const STATUS_ID = 'ac-career-hangar-status';
  const STYLE_ID = 'ac-career-hangar-style';

  const PANEL_TITLE = '机库';
  const CLOSE_LABEL = '收起机库';
  const PANEL_LEDE = '港务处的旧机库，登记过的机子才算出海。';
  const WALLET_LABEL = '手头';
  const WALLET_CREDITS = '信用点';
  const WALLET_UNREADABLE = '账目还看不清。';
  const WALLET_CLOSED = '账目暂时打不开：';
  const ITEMS_UNAVAILABLE = '机库暂不可用。';
  const NO_CAREER_NOTICE = '还不能登记：机库里只认得下过港口活计的人。';
  const TOOL_NOTICE = '这处活计还没引入，机库先只能看看。';
  const NO_CAREER_STATUS = '还不能登记。';
  const BUY_LABEL = '登记这架';
  const BUY_OWNED_LABEL = '已入列';
  const EQUIP_LABEL = '换上这架';
  const EQUIP_CURRENT_LABEL = '正在用这架';
  const EQUIP_UNOWNED_LABEL = '还没入列';
  const RENT_LABEL = '免费租用出击';
  const RENT_CLOSED_LABEL = '码头暂未开放';
  const RENT_CLOSED_STATUS = '码头暂未开放。';
  const RENT_FAILED = '码头这次没给钥匙';
  const BUSY_LABEL = '还在办，稍等。';
  const LEDGER_CLOSED = '账目暂时打不开。';

  const BADGE_CURRENT = '当前机体';
  const BADGE_OWNED = '已入列';
  const BADGE_RENTAL = '可免费租用';

  const TEXT_BUY_OK = '登记好了：';
  const TEXT_BUY_DUP = '这架先前就登记过了：';
  const TEXT_BUY_FAIL = '这次没登记上：';
  const TEXT_EQUIP_OK = '现在飞的是';
  const TEXT_EQUIP_FAIL = '没换成：';
  const TEXT_RENT_OK = '租好了，码头把机子留给你：';
  const TEXT_SHORT_CREDITS = '信用点不够：';
  const TEXT_SHORT_MATERIALS = '材料不够：';

  /* 失败原因 → 可归因戏内文本（未知原因使用通用兜底，不暴露系统词）。 */
  const REASON_TEXT = {
    insufficient: '信用点还不够。',
    'insufficient-items': '还差的材料凑不齐。',
    'item-cap': '仓里放不下这些材料了。',
    'bad-cost': '价码对不上。',
    'bad-cost-items': '要的材料清单对不上。',
    'bad-grants': '登记条目对不上。',
    'bad-purchase-id': '这笔没记上号。',
    'bad-career-id': '港务处还没记上你。',
    'no-wallet': '账上还没有你的名字。',
    'wallet-unavailable': '账目暂时打不开。',
    'core-unavailable': '账房还没开张。',
    'core-error': '账房那边卡住了。',
    constraint: '刚才那笔还在路上。',
    'connection-lost': '本机的册子暂时连不上。',
    blocked: '本机的册子暂时连不上。',
    'no-indexeddb': '这台机器存不下按册。',
    'load-failed': '账目读不出来。',
    'wallet-read-failed': '账目读不出来。',
    'db-unavailable': '账目暂时打不开。',
    'purchase-failed': '账房那边卡住了。',
    'purchase-rejected': '账房把单子退回来了。',
    'purchase-threw': '账房那边卡住了。',
    'equip-failed': '换不上。',
    'equip-rejected': '换不上。',
    'equip-threw': '换不上。',
    'rental-unavailable': '码头暂未开放。',
    'rental-failed': '码头这次没给钥匙。',
    'rental-rejected': '码头这次没给钥匙。',
    'rental-threw': '码头这次没给钥匙。',
  };

  const STYLE_TEXT = [
    '.ac-career-hangar {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-hangar__lede {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__wallet {',
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
    '.ac-career-hangar__wallet-value {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-weight: 600;',
    '}',
    '.ac-career-hangar__notice {',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__list {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-hangar__card {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 12px;',
    '  background: rgba(11, 16, 32, 0.35);',
    '}',
    '.ac-career-hangar__card[data-current="true"] {',
    '  border-color: var(--ac-career-accent, #ffd23f);',
    '}',
    '.ac-career-hangar__card-head {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: center;',
    '  gap: 6px;',
    '  min-width: 0;',
    '}',
    '.ac-career-hangar__name {',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  line-height: 1.5;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__badge {',
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
    '.ac-career-hangar__badge[data-badge="current"] {',
    '  border-color: var(--ac-career-accent, #ffd23f);',
    '  color: var(--ac-career-accent, #ffd23f);',
    '}',
    '.ac-career-hangar__desc {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__spec {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 2px 10px;',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '}',
    '.ac-career-hangar__price {',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__req,',
    '.ac-career-hangar__rent {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__shortfall {',
    '  margin: 0;',
    '  padding-left: 8px;',
    '  border-left: 2px solid var(--ac-career-danger, #ff5d5d);',
    '  color: #ffd9d9;',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-hangar__actions {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 8px;',
    '  margin-top: 2px;',
    '  min-width: 0;',
    '}',
    '.ac-career-hangar__actions .ac-career-btn {',
    '  flex: 1 1 auto;',
    '  min-width: 0;',
    '  min-height: 44px;',
    '}',
    '@media (max-width: 360px) {',
    '  .ac-career-hangar__actions {',
    '    flex-direction: column;',
    '  }',
    '  .ac-career-hangar__actions .ac-career-btn {',
    '    width: 100%;',
    '  }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .ac-career-hangar,',
    '  .ac-career-hangar * {',
    '    animation: none;',
    '    transition: none;',
    '  }',
    '}',
    '.ac-career-overlay.is-reduced-motion .ac-career-hangar,',
    '.ac-career-overlay.is-reduced-motion .ac-career-hangar * {',
    '  animation: none !important;',
    '  transition: none !important;',
    '}',
  ];

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  let panel = null;
  let unsubscribeCareerChanges = null;
  const CAREER_CHANGE_REASONS = ['career-imported', 'career-archived', 'career-unarchived', 'career-reset'];

  function subscribeCareerChanges(context, onChange) {
    const subscribe = typeof context.onCareerDataChanged === 'function'
      ? context.onCareerDataChanged
      : isObject(context.api) && typeof context.api.onCareerDataChanged === 'function'
        ? context.api.onCareerDataChanged : null;
    if (!subscribe) return null;
    try {
      const unsubscribe = subscribe.call(context, onChange);
      return typeof unsubscribe === 'function' ? unsubscribe : null;
    } catch (err) {
      return null;
    }
  }

  function bindCareerChanges(target, context) {
    unsubscribeCareerPanelChanges();
    unsubscribeCareerChanges = subscribeCareerChanges(context, (change) => {
      if (panel !== target) return;
      const reason = cleanText(change && change.reason);
      if (CAREER_CHANGE_REASONS.indexOf(reason) < 0) return;
      close();
    });
  }

  function unsubscribeCareerPanelChanges() {
    if (!unsubscribeCareerChanges) return;
    try { unsubscribeCareerChanges(); } catch (err) { /* ignore */ }
    unsubscribeCareerChanges = null;
  }

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

  function finiteNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
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

  function pickMethod(target, names) {
    if (!target || typeof target !== 'object') return null;
    for (let i = 0; i < names.length; i += 1) {
      const fn = target[names[i]];
      if (typeof fn === 'function') return { name: names[i], fn: fn };
    }
    return null;
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
      profile: isObject(ctx.profile) ? ctx.profile : null,
      wallet: isObject(ctx.wallet) ? ctx.wallet : null,
      commission: ctx.commission || null,
      rental: ctx.rental || null,
      db: ctx.db || null,
      reducedMotion: ctx.reducedMotion === true || prefersReducedMotion(),
      careerView: typeof ctx.careerView === 'function' ? ctx.careerView
        : isObject(ctx.api) && typeof ctx.api.careerView === 'function' ? ctx.api.careerView : null,
      announce: typeof ctx.announce === 'function' ? ctx.announce : null,
      onCareerDataChanged: typeof ctx.onCareerDataChanged === 'function' ? ctx.onCareerDataChanged : null,
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

  function rentalOf(context) {
    const win = rootWindow();
    const candidates = [
      context && context.rental,
      context && context.api && context.api.rental,
      win && win.ArcadeCareerRental,
      win && win.ArcadeCareer && win.ArcadeCareer.rental,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const mod = candidates[i];
      if (isObject(mod)) return mod;
    }
    return null;
  }

  const RENT_METHOD_NAMES = ['start', 'rent', 'rentShip', 'rentAndLaunch', 'launch', 'begin', 'reserve'];

  function pickRentMethod(rental) {
    return pickMethod(rental, RENT_METHOD_NAMES);
  }

  /** 从 listAvailable/ensureCareer 一类返回值里取 careerId（浅层多键 + 一层嵌套）。 */
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
      context.profile && context.profile.careerId,
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
   * 内容与钱包规整
   * ------------------------------------------------------------------ */

  function normalizeItems(raw) {
    if (!isObject(raw) || !Array.isArray(raw.ships)) return null;
    const ships = [];
    raw.ships.forEach(function (entry, index) {
      if (!isObject(entry)) return;
      const shipId = cleanText(entry.shipId);
      if (!shipId) return;
      const requires = {};
      if (isObject(entry.requires)) {
        Object.keys(entry.requires).forEach(function (itemId) {
          const count = numberOrZero(entry.requires[itemId]);
          if (itemId && count > 0) requires[itemId] = count;
        });
      }
      ships.push({
        shipId: shipId,
        name: cleanText(entry.name) || shipId,
        price: numberOrZero(entry.price),
        rental: entry.rental === true,
        stats: isObject(entry.stats) ? entry.stats : {},
        requires: requires,
        description: cleanText(entry.description),
        order: index,
      });
    });
    if (!ships.length) return null;
    /* 免费租用机置顶，其余按价码从低到高；同价保持内容顺序。 */
    ships.sort(function (a, b) {
      if (a.rental !== b.rental) return a.rental ? -1 : 1;
      if (a.price !== b.price) return a.price - b.price;
      return a.order - b.order;
    });
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
      ships: ships,
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

  function requiresText(state, ship) {
    const keys = Object.keys(ship.requires || {});
    return keys
      .map(function (itemId) {
        return materialName(state, itemId) + ' ' + ship.requires[itemId];
      })
      .join('、');
  }

  function haveItem(state, itemId) {
    const wallet = state && state.wallet;
    if (!wallet || !isObject(wallet.items)) return 0;
    return numberOrZero(wallet.items[itemId]);
  }

  function creditShortText(state, ship) {
    if (!state || !state.wallet || state.wallet.ok === false) return '';
    const need = ship.price - state.wallet.credits;
    return need > 0 ? '还差 ' + need + ' ' + WALLET_CREDITS : '';
  }

  function materialShortParts(state, ship) {
    const parts = [];
    Object.keys(ship.requires || {}).forEach(function (itemId) {
      const lack = ship.requires[itemId] - haveItem(state, itemId);
      if (lack > 0) parts.push(lack + ' ' + materialName(state, itemId));
    });
    return parts;
  }

  function shortfallText(state, ship) {
    const parts = materialShortParts(state, ship);
    const credit = creditShortText(state, ship);
    if (credit) parts.unshift(credit.replace(/^还差 /, ''));
    if (!parts.length) return '';
    return '还差 ' + parts.join('、');
  }

  function describeReason(reason) {
    const code = cleanText(reason);
    if (!code) return '';
    return REASON_TEXT[code] || '';
  }

  function statsText(stats) {
    if (!isObject(stats)) return '';
    const parts = [];
    const lives = finiteNumber(stats.lives);
    const energy = finiteNumber(stats.energy);
    if (lives !== null) parts.push('机体 ' + Math.floor(lives));
    if (energy !== null) parts.push('能量 ' + Math.floor(energy));
    percentPart(parts, '火力', stats.firepower);
    percentPart(parts, '机动', stats.speed);
    percentPart(parts, '牵引', stats.magnet);
    return parts.join(' · ');
  }

  function percentPart(parts, label, value) {
    const num = finiteNumber(value);
    if (num === null) return;
    const pct = Math.round(num * 1000) / 10;
    const shown = pct > 0 ? '+' + pct : String(pct);
    parts.push(label + ' ' + shown + '%');
  }

  /* ------------------------------------------------------------------ *
   * 状态判定
   * ------------------------------------------------------------------ */

  function findShip(state, shipId) {
    const ships = state && state.items && Array.isArray(state.items.ships) ? state.items.ships : [];
    for (let i = 0; i < ships.length; i += 1) {
      if (ships[i].shipId === shipId) return ships[i];
    }
    return null;
  }

  function defaultShipId(state) {
    const ships = state && state.items && Array.isArray(state.items.ships) ? state.items.ships : [];
    for (let i = 0; i < ships.length; i += 1) {
      if (ships[i].rental) return ships[i].shipId;
    }
    return ships.length ? ships[0].shipId : '';
  }

  function equipmentOf(state) {
    return state && state.wallet && isObject(state.wallet.equipment) ? state.wallet.equipment : {};
  }

  function ownedShip(state, shipId) {
    return equipmentOf(state)['ship:' + shipId + ':owned'] === true;
  }

  function currentShipId(state) {
    const equipped = cleanText(equipmentOf(state).equippedShip);
    if (equipped && findShip(state, equipped)) return equipped;
    return defaultShipId(state);
  }

  function walletReady(state) {
    return !!(state && state.wallet && state.wallet.ok !== false);
  }

  function purchaseBlock(p, ship) {
    const state = p.state;
    if (!state || !state.items) return { code: 'items-unavailable', label: BUY_LABEL, text: ITEMS_UNAVAILABLE };
    if (!state.toolIntroduced) return { code: 'tool-locked', label: BUY_LABEL, text: TOOL_NOTICE };
    if (ownedShip(state, ship.shipId)) return { code: 'owned', label: BUY_OWNED_LABEL, text: '这架已经在册上了。' };
    if (!state.careerId) return { code: 'no-career', label: NO_CAREER_STATUS.replace('。', ''), text: NO_CAREER_STATUS };
    if (!walletReady(state)) return { code: 'wallet', label: LEDGER_CLOSED.replace('。', ''), text: LEDGER_CLOSED };
    const db = dbOf(p.context);
    if (!db || typeof db.purchase !== 'function') {
      return { code: 'db', label: LEDGER_CLOSED.replace('。', ''), text: LEDGER_CLOSED };
    }
    if (p.pending) return { code: 'pending', label: BUY_LABEL, text: BUSY_LABEL };
    return null;
  }

  function equipBlock(p, ship) {
    const state = p.state;
    if (!state || !state.items) return { code: 'items-unavailable', label: EQUIP_LABEL, text: ITEMS_UNAVAILABLE };
    if (!state.toolIntroduced) return { code: 'tool-locked', label: EQUIP_LABEL, text: TOOL_NOTICE };
    if (currentShipId(state) === ship.shipId) {
      return { code: 'current', label: EQUIP_CURRENT_LABEL, text: '现在用的就是这架。' };
    }
    if (!ownedShip(state, ship.shipId) && ship.rental !== true) {
      return { code: 'unowned', label: EQUIP_UNOWNED_LABEL, text: '这架还没入列。' };
    }
    if (!state.careerId) return { code: 'no-career', label: NO_CAREER_STATUS.replace('。', ''), text: NO_CAREER_STATUS };
    const db = dbOf(p.context);
    if (!db || typeof db.writeEquipment !== 'function') {
      return { code: 'db', label: LEDGER_CLOSED.replace('。', ''), text: LEDGER_CLOSED };
    }
    if (p.pending) return { code: 'pending', label: EQUIP_LABEL, text: BUSY_LABEL };
    return null;
  }

  function rentBlock(p, ship) {
    const state = p.state;
    if (ship.rental !== true) return null;
    if (!state || !state.items) return { code: 'items-unavailable', label: RENT_LABEL, text: ITEMS_UNAVAILABLE };
    if (!state.toolIntroduced) return { code: 'tool-locked', label: RENT_LABEL, text: TOOL_NOTICE };
    const method = pickRentMethod(state.rental);
    if (!state.rental || !method) {
      return { code: 'rental-unavailable', label: RENT_CLOSED_LABEL, text: RENT_CLOSED_STATUS };
    }
    if (!state.careerId) return { code: 'no-career', label: NO_CAREER_STATUS.replace('。', ''), text: NO_CAREER_STATUS };
    if (p.pending) return { code: 'pending', label: RENT_LABEL, text: BUSY_LABEL };
    return null;
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

  function setPending(p, shipId) {
    p.pending = shipId || '';
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
    return { items: null, careerId: '', wallet: null, walletError: '', rental: null, commissionChecked: false, toolIntroduced: false };
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
    el.appendChild(documentNode(p, 'span', 'ac-career-hangar__wallet-label', WALLET_LABEL + ' '));
    el.appendChild(
      documentNode(p, 'span', 'ac-career-hangar__wallet-value', state.wallet.credits + ' ' + WALLET_CREDITS)
    );
    const materials = state.items.materials;
    materials.forEach(function (mat) {
      el.appendChild(p.doc.createTextNode(' · '));
      el.appendChild(documentNode(p, 'span', 'ac-career-hangar__wallet-label', mat.name + ' '));
      el.appendChild(
        documentNode(p, 'span', 'ac-career-hangar__wallet-value', '×' + haveItem(state, mat.itemId))
      );
    });
  }

  function documentNode(p, tag, className, textValue) {
    return make(p.doc, tag, className, textValue);
  }

  function renderNotice(p) {
    const state = p.state || emptyState();
    const el = p.noticeEl;
    if (!el) return;
    if (!state.toolIntroduced) {
      el.hidden = false;
      el.textContent = TOOL_NOTICE;
      return;
    }
    if (!state.items) {
      el.hidden = false;
      el.textContent = ITEMS_UNAVAILABLE;
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

  function renderList(p) {
    const state = p.state || emptyState();
    const list = p.listEl;
    if (!list) return;
    clearNode(list);
    if (!state.items) return;
    state.items.ships.forEach(function (ship) {
      list.appendChild(buildCard(p, ship));
    });
  }

  function safeDomId(shipId) {
    return 'ac-career-hangar-' + String(shipId).replace(/[^A-Za-z0-9_-]/g, '-');
  }

  function buildCard(p, ship) {
    const doc = p.doc;
    const state = p.state;
    const isCurrent = currentShipId(state) === ship.shipId;
    const isOwned = ownedShip(state, ship.shipId);
    const safeId = safeDomId(ship.shipId);
    const titleId = safeId + '-title';
    const card = make(doc, 'section', 'ac-career-hangar__card');
    card.setAttribute('data-ship-id', ship.shipId);
    card.setAttribute('data-current', isCurrent ? 'true' : 'false');
    card.setAttribute('data-owned', isOwned ? 'true' : 'false');
    card.setAttribute('data-rental', ship.rental ? 'true' : 'false');
    card.setAttribute('aria-labelledby', titleId);

    const head = make(doc, 'div', 'ac-career-hangar__card-head');
    const name = make(doc, 'h3', 'ac-career-hangar__name', ship.name);
    name.id = titleId;
    head.appendChild(name);
    if (isCurrent) head.appendChild(makeBadge(doc, BADGE_CURRENT, 'current'));
    if (isOwned) head.appendChild(makeBadge(doc, BADGE_OWNED, 'owned'));
    if (ship.rental) head.appendChild(makeBadge(doc, BADGE_RENTAL, 'rental'));
    card.appendChild(head);

    if (ship.description) card.appendChild(make(doc, 'p', 'ac-career-hangar__desc', ship.description));

    const spec = statsText(ship.stats);
    if (spec) card.appendChild(make(doc, 'p', 'ac-career-hangar__spec', spec));

    const price = make(doc, 'p', 'ac-career-hangar__price', ship.price + ' ' + WALLET_CREDITS);
    price.id = safeId + '-price';
    card.appendChild(price);

    const describedBy = [price.id];
    const reqKeys = Object.keys(ship.requires || {});
    if (reqKeys.length) {
      const req = make(doc, 'p', 'ac-career-hangar__req', '另需 ' + requiresText(state, ship));
      req.id = safeId + '-req';
      card.appendChild(req);
      describedBy.push(req.id);
    }
    if (ship.rental) {
      const rent = make(doc, 'p', 'ac-career-hangar__rent', '租用 0（免费）');
      rent.id = safeId + '-rent';
      card.appendChild(rent);
      describedBy.push(rent.id);
    }

    const shortParts = isOwned ? [] : materialShortParts(state, ship);
    const creditShort = isOwned ? '' : creditShortText(state, ship);
    if (creditShort) shortParts.unshift(creditShort.replace(/^还差 /, ''));
    if (shortParts.length) {
      const short = make(doc, 'p', 'ac-career-hangar__shortfall', '还差 ' + shortParts.join('、'));
      short.id = safeId + '-short';
      card.appendChild(short);
      describedBy.push(short.id);
    }

    const actions = make(doc, 'div', 'ac-career-hangar__actions');
    const buyBlock = purchaseBlock(p, ship);
    actions.appendChild(
      actionButton(p, ship, 'buy', buyBlock ? buyBlock.label : BUY_LABEL, buyBlock, {
        className: 'ac-career-btn ac-career-btn--primary',
        describedBy: buyBlock && buyBlock.code === 'owned' ? null : describedBy.join(' '),
      })
    );
    const equipBlockValue = equipBlock(p, ship);
    actions.appendChild(
      actionButton(p, ship, 'equip', equipBlockValue ? equipBlockValue.label : EQUIP_LABEL, equipBlockValue, {
        className: 'ac-career-btn',
        describedBy: null,
      })
    );
    if (ship.rental) {
      const rentBlockValue = rentBlock(p, ship);
      actions.appendChild(
        actionButton(p, ship, 'rent', rentBlockValue ? rentBlockValue.label : RENT_LABEL, rentBlockValue, {
          className: 'ac-career-btn ac-career-btn--ghost',
          describedBy: safeId + '-rent',
        })
      );
    }
    card.appendChild(actions);
    return card;
  }

  function makeBadge(doc, textValue, kind) {
    const badge = make(doc, 'span', 'ac-career-hangar__badge', textValue);
    if (kind) badge.setAttribute('data-badge', kind);
    return badge;
  }

  function actionButton(p, ship, action, label, block, options) {
    const opts = isObject(options) ? options : {};
    const button = make(p.doc, 'button', opts.className || 'ac-career-btn', label);
    button.type = 'button';
    button.setAttribute('data-action', action);
    button.setAttribute('data-ship-id', ship.shipId);
    if (block) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    } else if (p.pending) {
      button.disabled = true;
    }
    if (opts.describedBy) button.setAttribute('aria-describedby', opts.describedBy);
    return button;
  }

  /* ------------------------------------------------------------------ *
   * 数据装载（内容 → careerId → 钱包）
   * ------------------------------------------------------------------ */

  function isLive(p, token) {
    return panel === p && p.loadToken === token;
  }

  function loadData(p) {
    if (!p) return Promise.resolve();
    p.loadToken = (p.loadToken || 0) + 1;
    const token = p.loadToken;
    const context = p.context || normalizeContext(null);
    const items = normalizeItems(context.items);
    const state = emptyState();
    state.items = items;
    state.careerId = resolveCareerIdSync(context);
    state.rental = rentalOf(context);
    p.state = state;
    p.pending = '';
    if (context.wallet && isObject(context.wallet) && context.wallet.ok !== false) {
      const normalized = normalizeWallet(context.wallet);
      if (normalized) state.wallet = normalized;
    }
    renderAll(p);
    if (!items) return Promise.resolve();
    return ensureToolIntroduced(p, token, context, state)
      .then(function () {
        if (!isLive(p, token)) return null;
        return readWalletState(p, token, context, state);
      })
      .then(function () {
        if (!isLive(p, token)) return null;
        state.rental = rentalOf(context);
        renderAll(p);
      })
      .catch(function () {
        if (!isLive(p, token)) return null;
        if (!state.wallet) state.walletError = 'load-failed';
        renderAll(p);
      });
  }

  function ensureToolIntroduced(p, token, context, state) {
    const reader = typeof context.careerView === 'function'
      ? context.careerView
      : isObject(context.api) && typeof context.api.careerView === 'function' ? context.api.careerView : null;
    if (!reader || !state.careerId) return Promise.resolve();
    let returned = null;
    try {
      returned = reader.call(context, { surface: 'tools' });
    } catch (err) {
      return Promise.resolve();
    }
    return Promise.resolve(returned).then(
      function (view) {
        if (!isLive(p, token)) return;
        state.toolIntroduced = !!(isObject(view) && Array.isArray(view.tools)
          && view.tools.some(function (tool) { return isObject(tool) && tool.toolId === 'hangar'; }));
        renderAll(p);
      },
      function () {
        state.toolIntroduced = false;
        renderAll(p);
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
    const shipId = button.getAttribute('data-ship-id');
    const ship = findShip(p.state, shipId);
    if (!ship) return;
    if (action === 'buy') handleBuy(p, ship);
    else if (action === 'equip') handleEquip(p, ship);
    else if (action === 'rent') handleRent(p, ship);
  }

  function handleBuy(p, ship) {
    const block = purchaseBlock(p, ship);
    if (block) {
      if (block.code !== 'pending') applyStatus(p, block.text, block.code);
      return;
    }
    const state = p.state;
    const db = dbOf(p.context);
    const grants = { equipment: {} };
    grants.equipment['ship:' + ship.shipId + ':owned'] = true;
    const request = {
      careerId: state.careerId,
      purchaseId: 'hangar:' + state.careerId + ':' + ship.shipId,
      cost: ship.price,
      grants: grants,
      now: nowIso(),
    };
    if (state.items && state.items.contentVersion) request.contentVersion = state.items.contentVersion;
    const costItems = {};
    Object.keys(ship.requires || {}).forEach(function (itemId) {
      costItems[itemId] = ship.requires[itemId];
    });
    if (Object.keys(costItems).length) request.costItems = costItems;
    setPending(p, ship.shipId);
    let returned = null;
    try {
      returned = db.purchase(request);
    } catch (err) {
      settleBuyFailure(p, ship, 'purchase-threw');
      return;
    }
    Promise.resolve(returned).then(
      function (result) {
        if (!panel || panel !== p) return;
        if (result && result.ok) settleBuySuccess(p, ship, result);
        else settleBuyFailure(p, ship, (result && result.reason) || 'purchase-rejected');
      },
      function () {
        if (!panel || panel !== p) return;
        settleBuyFailure(p, ship, 'purchase-failed');
      }
    );
  }

  function settleBuySuccess(p, ship, result) {
    const duplicate = !!(result && result.duplicate === true);
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, (duplicate ? TEXT_BUY_DUP : TEXT_BUY_OK) + ship.name + '。', duplicate ? 'duplicate' : 'purchased');
    });
  }

  function settleBuyFailure(p, ship, reason) {
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      let message = '';
      if (reason === 'insufficient') {
        const short = creditShortText(p.state, ship);
        message = TEXT_SHORT_CREDITS + (short ? short + '。' : '先攒一攒。');
      } else if (reason === 'insufficient-items') {
        const parts = materialShortParts(p.state, ship);
        message = TEXT_SHORT_MATERIALS + (parts.length ? '还差 ' + parts.join('、') + '。' : '还差的材料凑不齐。');
      } else {
        message = TEXT_BUY_FAIL + (describeReason(reason) || '账房把单子退回来了。');
      }
      applyStatus(p, message, reason);
    });
  }

  function handleEquip(p, ship) {
    const block = equipBlock(p, ship);
    if (block) {
      if (block.code !== 'pending') applyStatus(p, block.text, block.code);
      return;
    }
    const db = dbOf(p.context);
    const patch = { equippedShip: ship.shipId };
    setPending(p, ship.shipId);
    let returned = null;
    try {
      returned = db.writeEquipment({ careerId: p.state.careerId, patch: patch, now: nowIso() });
    } catch (err) {
      settleEquipFailure(p, 'equip-threw');
      return;
    }
    Promise.resolve(returned).then(
      function (result) {
        if (!panel || panel !== p) return;
        if (result && result.ok) settleEquipSuccess(p, ship, result);
        else settleEquipFailure(p, (result && result.reason) || 'equip-rejected');
      },
      function () {
        if (!panel || panel !== p) return;
        settleEquipFailure(p, 'equip-failed');
      }
    );
  }

  function settleEquipSuccess(p, ship, result) {
    const state = p.state;
    if (state && state.wallet && isObject(result && result.equipment)) {
      state.wallet.equipment = result.equipment;
    }
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, TEXT_EQUIP_OK + ship.name + '。', 'equipped');
    });
  }

  function settleEquipFailure(p, reason) {
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, TEXT_EQUIP_FAIL + (describeReason(reason) || '账房把单子退回来了。'), reason);
    });
  }

  function handleRent(p, ship) {
    const block = rentBlock(p, ship);
    if (block) {
      if (block.code !== 'pending') applyStatus(p, block.text, block.code);
      return;
    }
    const state = p.state;
    const method = pickRentMethod(state.rental);
    if (!method) {
      applyStatus(p, RENT_CLOSED_STATUS, 'rental-unavailable');
      return;
    }
    const request = {
      careerId: state.careerId,
      shipId: ship.shipId,
      ship: { shipId: ship.shipId, name: ship.name, price: ship.price, rental: ship.rental === true },
      cost: 0,
    };
    if (state.items && state.items.contentVersion) request.contentVersion = state.items.contentVersion;
    setPending(p, ship.shipId);
    let returned = null;
    try {
      returned = method.fn.call(state.rental, request);
    } catch (err) {
      settleRentFailure(p, 'rental-threw');
      return;
    }
    Promise.resolve(returned).then(
      function (result) {
        if (!panel || panel !== p) return;
        if (result && result.ok === false) {
          settleRentFailure(p, result.reason || 'rental-rejected');
          return;
        }
        settleRentSuccess(p, ship);
      },
      function () {
        if (!panel || panel !== p) return;
        settleRentFailure(p, 'rental-failed');
      }
    );
  }

  function settleRentSuccess(p, ship) {
    p.pending = '';
    /* 租用零成本：不调用 purchase，只重读账目确认没动过钱。 */
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, TEXT_RENT_OK + ship.name + '。', 'rented');
    });
  }

  function settleRentFailure(p, reason) {
    p.pending = '';
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, RENT_FAILED + '：' + (describeReason(reason) || '码头这次没给钥匙。'), reason);
    });
  }

  /* ------------------------------------------------------------------ *
   * 面板生命周期
   * ------------------------------------------------------------------ */

  function buildPanel(doc, context) {
    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    const overlay = make(doc, 'div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', 'hangar');
    overlay.setAttribute('data-hangar', '1');
    if (context.reducedMotion) overlay.classList.add('is-reduced-motion');

    const sheet = make(doc, 'div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('aria-describedby', LEDE_ID);
    sheet.setAttribute('tabindex', '-1');
    sheet.setAttribute('data-hangar-sheet', '1');

    const head = make(doc, 'div', 'ac-career-sheet__head');
    const heading = make(doc, 'h2', 'ac-career-sheet__title', PANEL_TITLE);
    heading.id = TITLE_ID;
    const closeBtn = make(doc, 'button', 'ac-career-icon-btn ac-career-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', CLOSE_LABEL);
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make(doc, 'div', 'ac-career-sheet__body');
    const wrap = make(doc, 'div', 'ac-career-hangar');
    const lede = make(doc, 'p', 'ac-career-hangar__lede', PANEL_LEDE);
    lede.id = LEDE_ID;
    const walletEl = make(doc, 'p', 'ac-career-hangar__wallet');
    walletEl.hidden = true;
    const noticeEl = make(doc, 'p', 'ac-career-hangar__notice');
    noticeEl.hidden = true;
    const listEl = make(doc, 'div', 'ac-career-hangar__list');
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
      /* 只处理最上层 career 面板：town→hangar→receipt 叠层时 Esc 不得一次关两层。 */
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
   * 打开机库。重复打开时复用同一面板并重读账目（不重建、不叠层）。
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
      bindCareerChanges(panel, context);
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
    bindCareerChanges(panel, context);
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
    bindCareerChanges(panel, context);
    loadData(panel);
    return panel.sheet;
  }

  /** 关闭机库并把焦点还给打开前的元素（可重复调用）。 */
  function close() {
    const current = panel;
    panel = null;
    unsubscribeCareerPanelChanges();
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
    root.ArcadeCareerUI.hangar = api;
    try {
      root.ArcadeCareerHangar = api;
    } catch (err) {
      /* 别名挂载失败不影响主入口 */
    }
  }

  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
