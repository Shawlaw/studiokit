/*!
 * StudioKit Arcade Life — 材料商店（0.17 / D17-20）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.market
 * （同时镜像一份 window.ArcadeCareerMarket，便于测试直接调用），不读 DOM、
 * 不写存储、不发请求。
 *
 * bridge.js 在玩家主动打开材料商店时调用：
 *
 *   window.ArcadeCareerUI.market.open(ctx);    // 打开（重复打开复用同一面板并重读价目/账目）
 *   window.ArcadeCareerUI.market.render(ctx);  // 面板已打开时重读价目/账目并重绘
 *   window.ArcadeCareerUI.market.close();      // 关闭并把焦点还给打开前的元素
 *
 * ctx（bridge 构造，见 docs/arcade-life/ADR-interfaces.md §17 / §18.7 / §19.9）：
 *   { state, api, commission, commissionRun, materials, items, careerId,
 *     profile, wallet, announce(text), reducedMotion, openTown, openHangar,
 *     openReceipt, openSettings, reducedMotion }
 * 兼容：ctx.db（或 api.db / window.ArcadeCareer.db）可直接拿到 career-db 模块；
 *       materials 取用顺序 ctx.materials → api.materials →
 *       window.ArcadeCareer.materials → window.ArcadeCareerMaterials；
 *       careerId 只取 ctx / 已投影上下文；缺失时保持只读，不创建生涯身份；
 *
 * 数据与价格来源（D17-19 materials.js 定稿）：
 *   materials.listMaterials() -> [{ itemId, name, buyPrice, sellPrice, aliases, sources }]
 *   materials.buyPlan({ items:{<itemId>:<count>}, wallet:{credits,items} })
 *       -> { ok:true, items, cost, creditsDelta, balanceAfter, grants:{items}, unitPrices, missing }
 *   materials.sellPlan({ items:{...}, wallet })
 *       -> { ok:true, items, credits, balanceAfter, unitPrices, missing }
 * 兼容旧/测试形状：listMarket()/catalog()/materials 数组；previewBuy/previewSell/planBuy/planSell；
 *   plan 结果平铺或包在 { plan:{...} } 里。价格与 credits 只从 materials 返回的 plan 读取，
 *   UI 绝不自定价格；plan 不可用时按钮禁用并显示「价目牌还没挂出来」。
 *
 * 写库（只经 career-db）：
 *   买：db.purchase({ careerId, purchaseId:'market-buy:<careerId>:<item>:<seq>',
 *                    cost, grants:{ items:{<item>:<n>} }, contentVersion })
 *   卖：db.sellItems({ careerId, saleId:'market-sell:<careerId>:<item>:<seq>',
 *                    items, credits, contentVersion })
 *   每次玩家操作使用新的序号；请求中所有买卖按钮禁用，完成重读钱包与持有量；
 *   同一操作重复提交由 purchaseId/saleId 幂等保护，不重复扣款/加钱。
 *
 * 硬约束：
 * - 不读 localStorage、不写 localStorage、不发网络请求、不碰旧机库 meta:v1；
 * - materials 缺失 → 只显示「价目牌还没挂出来。」，不抛异常、不创建生涯；
 * - career-db 缺失/不可用 → 显示「账房没开门。」，价目仍只读展示，按钮禁用；
 * - 无 careerId → 只读展示价目与按钮禁用，提示「还不能记账…」；
 * - 失败显示可归因文本（余额不足/材料不足/仓里放不下/账房退回/重复），绝不伪造成功；
 * - 覆盖当前页面的轻量浮层：按钮 + Esc + 点遮罩关闭；焦点返回；Tab 不逃逸；
 *   role=dialog + aria-modal + aria-labelledby；prefers-reduced-motion 下无动画；
 *   320/375/390/430 宽不横向溢出，所有按钮热区 ≥44px；
 * - 全部文案为戏内语言：不出现「系统 / 生涯模式 / 奖励 / 解锁 / 签到 / 概率」等
 *   系统化或营销式措辞；不解释规则；
 * - 样式只在本文件注入的 <style>（ADR §17 集中样式偏差见证据 D-1）；
 * - 任何异常 fail-open：面板保持可关闭，游戏页不受影响。
 */
(function (root) {
  'use strict';

  const VERSION = '0.18.0';
  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet';
  const TITLE_ID = 'ac-career-market-title';
  const LEDE_ID = 'ac-career-market-lede';
  const STATUS_ID = 'ac-career-market-status';
  const STYLE_ID = 'ac-career-market-style';

  const PANEL_TITLE = '材料商店';
  const CLOSE_LABEL = '收起材料商店';
  const PANEL_LEDE = '旧港货栈把五样材料摆上价目牌，买进卖出都记在账上。';
  const WALLET_LABEL = '手头';
  const WALLET_CREDITS = '信用点';
  const WALLET_UNREADABLE = '账目还看不清。';
  const WALLET_CLOSED = '账目暂时打不开。';
  const MATERIALS_UNAVAILABLE = '价目牌还没挂出来。';
  const LEDGER_CLOSED = '账房没开门。';
  const NO_CAREER_NOTICE = '还不能记账：货栈只认得下过港口活计的人。';
  const NO_CAREER_STATUS = '还不能记账。';
  const BUSY_LABEL = '还在办，稍等。';
  const HELD_LABEL = '仓里';
  const BUY_PRICE_LABEL = '买价';
  const SELL_PRICE_LABEL = '卖价';
  const SOURCE_LABEL = '来路：旧港工作点或材料商店可取得';
  const TOOL_NOTICE = '这处活计还没引入，商店先只能看看。';

  const BUY_ONE_LABEL = '买 1';
  const BUY_FIVE_LABEL = '买 5';
  const SELL_ONE_LABEL = '卖 1';
  const SELL_ALL_LABEL = '全部卖出';

  const TEXT_BUY_OK = '买好了：';
  const TEXT_SELL_OK = '卖掉了：';
  const TEXT_DUP = '这笔先前就记过账了：';
  const TEXT_BUY_FAIL = '这次没买成：';
  const TEXT_SELL_FAIL = '这次没卖成：';
  const TEXT_SHORT_CREDITS = '信用点不够：';
  const TEXT_SHORT_ITEMS = '材料不够：';
  const TEXT_PARTIAL_SELL = '卖了一部分：';

  const CODE_PURCHASED = 'purchased';
  const CODE_SOLD = 'sold';
  const CODE_DUPLICATE = 'duplicate';
  const CODE_PARTIAL = 'partial-sale';

  /* 失败原因 → 可归因戏内文本（未知原因使用通用兜底，不暴露系统词）。 */
  const REASON_TEXT = {
    insufficient: '信用点还不够。',
    'insufficient-items': '仓里没有这些材料。',
    'item-cap': '仓里放不下这些材料了。',
    'balance-cap': '账上放不下这么多信用点了。',
    'cost-cap': '这笔价码太高，账房收不下。',
    'payout-cap': '这一笔太沉了，账房收不下。',
    'bad-cost': '价码对不上。',
    'bad-credits': '账目对不上。',
    'bad-cost-items': '要的材料清单对不上。',
    'bad-items': '清单对不上。',
    'bad-count': '数量对不上。',
    'bad-grants': '这批材料对不上。',
    'bad-purchase-id': '这笔没记上号。',
    'bad-sale-id': '这笔没记上号。',
    'bad-career-id': '货栈还没记上你。',
    'unknown-item': '价目牌上没有这一样。',
    'duplicate-item': '同一样材料写了两次。',
    'not-configured': '价目牌还没挂出来。',
    'no-wallet': '账上还没有你的名字。',
    'wallet-unavailable': '账目暂时打不开。',
    'core-unavailable': '账房还没开张。',
    'core-error': '账房那边卡住了。',
    constraint: '刚才那笔还在路上。',
    'duplicate-sale': '这笔先前就记过账了。',
    'connection-lost': '本机的册子暂时连不上。',
    blocked: '本机的册子暂时连不上。',
    'no-indexeddb': '这台机器存不下按册。',
    'load-failed': '账目读不出来。',
    'wallet-read-failed': '账目读不出来。',
    'db-unavailable': '账房没开门。',
    'purchase-failed': '账房那边卡住了。',
    'purchase-rejected': '账房把单子退回来了。',
    'purchase-threw': '账房那边卡住了。',
    'sell-failed': '账房那边卡住了。',
    'sell-rejected': '账房把单子退回来了。',
    'sell-threw': '账房那边卡住了。',
    'plan-error': '价目牌对不上。',
    'no-price': '价目牌上没写这一样。',
    'bad-plan': '价目牌对不上。',
    'materials-unavailable': '价目牌还没挂出来。',
    'materials-empty': '价目牌还没挂出来。',
    'no-buy-plan': '价目牌还没挂出来。',
    'no-sell-plan': '价目牌还没挂出来。',
    'chunk-guard': '这一趟分得太碎，先停手。',
  };

  const STYLE_TEXT = [
    '.ac-career-market {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-market__lede {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-market__wallet {',
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
    '.ac-career-market__wallet-value {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-weight: 600;',
    '}',
    '.ac-career-market__notice {',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-market__list {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-market__card {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 12px;',
    '  background: rgba(11, 16, 32, 0.35);',
    '}',
    '.ac-career-market__card-head {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 6px;',
    '  min-width: 0;',
    '}',
    '.ac-career-market__name {',
    '  margin: 0;',
    '  min-width: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  line-height: 1.5;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-market__held {',
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
    '.ac-career-market__held[data-empty="true"] {',
    '  opacity: 0.7;',
    '}',
    '.ac-career-market__prices {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 4px 14px;',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-market__sell-price {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '}',
    '.ac-career-market__source {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-market__actions {',
    '  display: grid;',
    '  grid-template-columns: repeat(2, minmax(0, 1fr));',
    '  gap: 8px;',
    '  margin-top: 2px;',
    '  min-width: 0;',
    '}',
    '.ac-career-market__actions .ac-career-btn {',
    '  width: 100%;',
    '  min-width: 0;',
    '  min-height: 44px;',
    '  padding: 6px 8px;',
    '  white-space: normal;',
    '  line-height: 1.35;',
    '  overflow-wrap: anywhere;',
    '}',
    '@media (max-width: 340px) {',
    '  .ac-career-market__actions {',
    '    grid-template-columns: minmax(0, 1fr);',
    '  }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .ac-career-market,',
    '  .ac-career-market * {',
    '    animation: none;',
    '    transition: none;',
    '  }',
    '}',
    '.ac-career-overlay.is-reduced-motion .ac-career-market,',
    '.ac-career-overlay.is-reduced-motion .ac-career-market * {',
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
  let opSeq = 0;
  /* 每次页面会话独立的操作前缀：刷新后 opSeq 归零也不会撞上旧 purchaseId/saleId。 */
  const OP_SESSION_TAG = (function () {
    try {
      const bytes = new Uint8Array(8);
      (rootWindow().crypto || window.crypto).getRandomValues(bytes);
      return Array.prototype.map.call(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
      return String(Date.now().toString(16)) + Math.floor(Math.random() * 1e6).toString(16);
    }
  })();

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

  function positiveInt(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || Math.floor(num) !== num || num <= 0) return null;
    return num;
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

  function cloneMap(map) {
    const out = {};
    if (!isObject(map)) return out;
    Object.keys(map).forEach(function (key) {
      const count = positiveInt(map[key]);
      if (count !== null) out[key] = count;
    });
    return out;
  }

  function sumMap(map) {
    let total = 0;
    if (!isObject(map)) return total;
    Object.keys(map).forEach(function (key) {
      total += numberOrZero(map[key]);
    });
    return total;
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
      reducedMotion: ctx.reducedMotion === true || prefersReducedMotion(),
      careerView: typeof ctx.careerView === 'function' ? ctx.careerView
        : isObject(ctx.api) && typeof ctx.api.careerView === 'function' ? ctx.api.careerView : null,
      announce: typeof ctx.announce === 'function' ? ctx.announce : null,
      onCareerDataChanged: typeof ctx.onCareerDataChanged === 'function' ? ctx.onCareerDataChanged : null,
    };
  }

  function materialsOf(context) {
    const win = rootWindow();
    const candidates = [
      context && context.raw && context.raw.materials,
      context && context.api && context.api.materials,
      win && win.ArcadeCareer && win.ArcadeCareer.materials,
      win && win.ArcadeCareerMaterials,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const mod = candidates[i];
      if (isObject(mod)) return mod;
    }
    return null;
  }

  function dbOf(context) {
    const win = rootWindow();
    const candidates = [
      context && context.raw && context.raw.db,
      context && context.api && context.api.db,
      win && win.ArcadeCareer && win.ArcadeCareer.db,
      win && win.ArcadeCareerDb,
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
   * 价目归一化
   * ------------------------------------------------------------------ */

  function priceFrom(entry, keys) {
    for (let i = 0; i < keys.length; i += 1) {
      const value = entry[keys[i]];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
    }
    if (isObject(entry.price)) {
      return priceFrom(entry.price, keys);
    }
    return 0;
  }

  function readAliasSources(materials, itemsContent) {
    const map = {};
    function add(alias, canonical) {
      const a = cleanText(alias);
      const c = cleanText(canonical);
      if (!a || !c || a === c) return;
      map[a] = c;
    }
    const sources = [
      itemsContent && itemsContent.materialAliases,
      materials && materials.materialAliases,
      materials && materials.MATERIAL_ALIASES,
      materials && materials.aliases,
      materials && materials.aliasMap,
      materials && materials.ALIASES,
    ];
    sources.forEach(function (bag) {
      if (!isObject(bag)) return;
      Object.keys(bag).forEach(function (key) {
        const value = bag[key];
        if (typeof value === 'string') add(key, value);
        else if (Array.isArray(value)) {
          value.forEach(function (alias) {
            if (typeof alias === 'string') add(alias, key);
          });
        }
      });
    });
    if (materials && typeof materials.aliasOf === 'function') {
      ['crystal'].forEach(function (alias) {
        try {
          const canonical = materials.aliasOf(alias);
          if (typeof canonical === 'string' && canonical) add(alias, canonical);
        } catch (err) {
          /* ignore */
        }
      });
    }
    /* ADR §19.5：crystal 是 0.16 遗留别名，读取时映射到 starcrystal。 */
    add('crystal', 'starcrystal');
    return map;
  }

  function sourceHintOf() {
    /* 只披露通用地点，不枚举 materials 的全游戏来源，也不读取 registry。 */
    return SOURCE_LABEL;
  }

  function normalizeMaterialEntry(entry, index, aliasMap) {
    if (!isObject(entry)) return null;
    const itemId = cleanText(entry.itemId || entry.id || entry.materialId || entry.key);
    if (!itemId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(itemId)) return null;
    const name = cleanText(entry.name || entry.title || entry.label) || itemId;
    const buyPrice = priceFrom(entry, ['buyPrice', 'buy', 'priceBuy', 'buyCredits', 'buyingPrice']);
    const sellPrice = priceFrom(entry, ['sellPrice', 'sell', 'priceSell', 'sellCredits', 'sellingPrice']);
    if (buyPrice <= 0 && sellPrice <= 0) return null;
    const aliases = [];
    function pushAlias(value) {
      const alias = cleanText(value);
      if (!alias || alias === itemId || aliases.indexOf(alias) >= 0) return;
      aliases.push(alias);
    }
    if (Array.isArray(entry.aliases)) entry.aliases.forEach(pushAlias);
    if (typeof entry.alias === 'string') pushAlias(entry.alias);
    if (Array.isArray(entry.legacyIds)) entry.legacyIds.forEach(pushAlias);
    Object.keys(aliasMap).forEach(function (alias) {
      if (aliasMap[alias] === itemId) pushAlias(alias);
    });
    return {
      itemId: itemId,
      name: name,
      buyPrice: buyPrice,
      sellPrice: sellPrice,
      aliases: aliases,
      sourceHint: sourceHintOf(entry, materials, itemId, aliases, context),
      order: index,
    };
  }

  function normalizeMaterialList(raw, aliasMap, materials, context) {
    let entries = null;
    if (Array.isArray(raw)) entries = raw;
    else if (isObject(raw)) {
      if (Array.isArray(raw.materials)) entries = raw.materials;
      else if (Array.isArray(raw.items)) entries = raw.items;
      else if (Array.isArray(raw.list)) entries = raw.list;
      else {
        const keys = Object.keys(raw).filter(function (key) {
          return isObject(raw[key]) && key !== 'ok' && key !== 'reason';
        });
        if (keys.length) {
          entries = keys.map(function (key) {
            const copy = {};
            const value = raw[key];
            Object.keys(value).forEach(function (field) {
              copy[field] = value[field];
            });
            if (!copy.itemId) copy.itemId = key;
            return copy;
          });
        }
      }
    }
    if (!entries) return null;
    const list = [];
    entries.forEach(function (entry, index) {
      const normalized = normalizeMaterialEntry(entry, index, aliasMap, materials, context);
      if (normalized) list.push(normalized);
    });
    return list.length ? list : null;
  }

  function readMarketList(materials) {
    if (!materials) return null;
    const names = ['listMaterials', 'listMarket', 'catalog', 'list'];
    for (let i = 0; i < names.length; i += 1) {
      const fn = materials[names[i]];
      if (typeof fn !== 'function') continue;
      try {
        return fn.call(materials);
      } catch (err) {
        return { ok: false, reason: 'plan-error' };
      }
    }
    if (typeof materials.materials === 'function') {
      try {
        return materials.materials.call(materials);
      } catch (err) {
        return { ok: false, reason: 'plan-error' };
      }
    }
    if (Array.isArray(materials.materials)) return materials.materials;
    if (Array.isArray(materials.MATERIALS)) return materials.MATERIALS;
    return null;
  }

  function pickPlanFns(materials) {
    return {
      buy: pickMethod(materials, ['buyPlan', 'previewBuy', 'planBuy', 'buyPreview', 'quoteBuy']),
      sell: pickMethod(materials, ['sellPlan', 'previewSell', 'planSell', 'sellPreview', 'quoteSell']),
    };
  }

  function contentVersionOf(state) {
    if (state && state.itemsContent && typeof state.itemsContent.contentVersion === 'string' && state.itemsContent.contentVersion) {
      return state.itemsContent.contentVersion;
    }
    if (state && state.materialsModule && typeof state.materialsModule.contentVersion === 'string' && state.materialsModule.contentVersion) {
      return state.materialsModule.contentVersion;
    }
    return VERSION;
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

  function walletReady(state) {
    return !!(state && state.wallet && state.wallet.ok !== false);
  }

  function walletItems(state) {
    return state && state.wallet && walletReady(state) && isObject(state.wallet.items) ? state.wallet.items : {};
  }

  function walletCredits(state) {
    if (!walletReady(state)) return 0;
    return numberOrZero(state.wallet.credits);
  }

  function planWallet(state) {
    if (!walletReady(state)) return null;
    return { credits: numberOrZero(state.wallet.credits), items: cloneMap(state.wallet.items) };
  }

  function heldFor(state, material) {
    if (!material) return 0;
    const items = walletItems(state);
    let total = numberOrZero(items[material.itemId]);
    material.aliases.forEach(function (alias) {
      total += numberOrZero(items[alias]);
    });
    return total;
  }

  function lotsForSell(state, material) {
    const items = walletItems(state);
    const lots = [];
    const canonical = numberOrZero(items[material.itemId]);
    if (canonical > 0) lots.push({ itemId: material.itemId, count: canonical });
    material.aliases.forEach(function (alias) {
      const count = numberOrZero(items[alias]);
      if (count > 0) lots.push({ itemId: alias, count: count });
    });
    return lots;
  }

  /* ------------------------------------------------------------------ *
   * plan 结果归一化
   * ------------------------------------------------------------------ */

  function planBag(result) {
    if (!isObject(result)) return [];
    const bag = [];
    if (isObject(result.plan)) bag.push(result.plan);
    bag.push(result);
    return bag;
  }

  function planFailed(result) {
    if (!isObject(result)) return { ok: false, reason: 'bad-plan' };
    const plan = isObject(result.plan) ? result.plan : null;
    const failure = (result.ok === false && result) || (plan && plan.ok === false && plan) || null;
    if (!failure) return null;
    return {
      ok: false,
      reason: cleanText(failure.reason) || 'trade-rejected',
      missing: Array.isArray(failure.missing) ? failure.missing : [],
    };
  }

  function firstPositiveInt(bag, keys) {
    for (let i = 0; i < bag.length; i += 1) {
      const obj = bag[i];
      if (!isObject(obj)) continue;
      for (let j = 0; j < keys.length; j += 1) {
        const value = positiveInt(obj[keys[j]]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  function normalizeBuyPlan(result, material, count) {
    const failed = planFailed(result);
    if (failed) return failed;
    const bag = planBag(result);
    if (!bag.length) return { ok: false, reason: 'bad-plan' };
    const cost = firstPositiveInt(bag, ['cost', 'costCredits', 'totalCost', 'totalCredits', 'total', 'price', 'buyPrice']);
    if (cost === null) return { ok: false, reason: 'no-price' };
    let grantItems = null;
    for (let i = 0; i < bag.length; i += 1) {
      const grants = bag[i].grants;
      if (isObject(grants) && isObject(grants.items)) {
        grantItems = grants.items;
        break;
      }
    }
    const items = {};
    let grantCount = 0;
    if (grantItems) {
      Object.keys(grantItems).forEach(function (itemId) {
        const value = positiveInt(grantItems[itemId]);
        if (value !== null) {
          items[itemId] = value;
          grantCount += value;
        }
      });
    }
    if (!items[material.itemId] || grantCount !== count) {
      const merged = {};
      Object.keys(items).forEach(function (itemId) {
        merged[itemId] = items[itemId];
      });
      merged[material.itemId] = count;
      return { ok: true, cost: cost, grants: { items: merged } };
    }
    return { ok: true, cost: cost, grants: { items: items } };
  }

  function normalizeSellPlan(result, requestedItems) {
    const failed = planFailed(result);
    if (failed) return failed;
    const bag = planBag(result);
    if (!bag.length) return { ok: false, reason: 'bad-plan' };
    const credits = firstPositiveInt(bag, ['credits', 'payout', 'creditsGained', 'totalCredits', 'total', 'price', 'sellPrice']);
    if (credits === null) return { ok: false, reason: 'no-price' };
    let planItems = null;
    for (let i = 0; i < bag.length; i += 1) {
      if (isObject(bag[i].items)) {
        planItems = bag[i].items;
        break;
      }
    }
    const requested = cloneMap(requestedItems);
    if (planItems) {
      const normalized = cloneMap(planItems);
      const planKeys = Object.keys(normalized);
      const requestKeys = Object.keys(requested);
      const sameKeys =
        planKeys.length === requestKeys.length &&
        planKeys.every(function (key) {
          return requestKeys.indexOf(key) >= 0;
        });
      if (sameKeys && sumMap(normalized) === sumMap(requested)) {
        return { ok: true, credits: credits, items: normalized };
      }
    }
    return { ok: true, credits: credits, items: requested };
  }

  function describeReason(reason) {
    const code = cleanText(reason);
    if (!code) return '';
    return REASON_TEXT[code] || '';
  }

  function missingOf(missing, kind) {
    if (!Array.isArray(missing)) return null;
    for (let i = 0; i < missing.length; i += 1) {
      const item = missing[i];
      if (!isObject(item)) continue;
      if (cleanText(item.kind) !== kind) continue;
      return item;
    }
    return null;
  }

  function isSplitReason(reason) {
    return reason === 'payout-cap' || reason === 'bad-credits';
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
    if (!p || !p.statusEl) return;
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

  function setPending(p, pending) {
    p.pending = pending || '';
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
      materials: null,
      materialsModule: null,
      listError: '',
      planFns: { buy: null, sell: null },
      careerId: '',
      wallet: null,
      walletError: '',
      db: null,
      itemsContent: null,
      aliasMap: {},
      contentVersion: VERSION,
      toolIntroduced: false,
    };
  }

  function renderAll(p) {
    if (!p || !p.doc) return;
    try {
      if (p.pending) p.sheet.setAttribute('aria-busy', 'true');
      else p.sheet.removeAttribute('aria-busy');
    } catch (err) {
      /* ignore */
    }
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

  function canTrade(state) {
    const db = state && state.db;
    return !!(db && typeof db.purchase === 'function' && typeof db.sellItems === 'function');
  }

  function renderWallet(p) {
    const state = p.state || emptyState();
    const el = p.walletEl;
    if (!el) return;
    clearNode(el);
    if (!state.materials || !state.careerId) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!walletReady(state)) {
      el.textContent = state.walletError ? WALLET_CLOSED + (describeReason(state.walletError) || '') : WALLET_UNREADABLE;
      return;
    }
    el.appendChild(make(p.doc, 'span', 'ac-career-market__wallet-label', WALLET_LABEL + ' '));
    el.appendChild(make(p.doc, 'span', 'ac-career-market__wallet-value', state.wallet.credits + ' ' + WALLET_CREDITS));
  }

  function renderNotice(p) {
    const state = p.state || emptyState();
    const el = p.noticeEl;
    if (!el) return;
    let text = '';
    if (!state.toolIntroduced) text = TOOL_NOTICE;
    else if (!state.materials) text = MATERIALS_UNAVAILABLE;
    else if (!state.careerId) text = NO_CAREER_NOTICE;
    else if (!canTrade(state)) text = LEDGER_CLOSED;
    else if (!walletReady(state) && state.walletError) text = WALLET_CLOSED + (describeReason(state.walletError) || '');
    el.textContent = text;
    el.hidden = !text;
  }

  function renderList(p) {
    const state = p.state || emptyState();
    const list = p.listEl;
    if (!list) return;
    clearNode(list);
    if (!state.materials) return;
    state.materials.forEach(function (material) {
      list.appendChild(buildCard(p, material));
    });
    restoreActionFocus(p);
  }

  function safeDomId(itemId) {
    return 'ac-career-market-' + String(itemId).replace(/[^A-Za-z0-9_-]/g, '-');
  }

  function actionBlock(p, material, action, count) {
    const state = p.state || emptyState();
    if (!state.materials) return { code: 'materials-unavailable', text: MATERIALS_UNAVAILABLE };
    if (!state.toolIntroduced) return { code: 'tool-locked', text: TOOL_NOTICE };
    if (!state.careerId) return { code: 'no-career', text: NO_CAREER_STATUS };
    if (!canTrade(state)) return { code: 'db', text: LEDGER_CLOSED };
    if (!walletReady(state)) return { code: 'wallet', text: WALLET_CLOSED };
    const fns = state.planFns || {};
    if (action === 'buy' && (!fns.buy || typeof fns.buy.fn !== 'function')) {
      return { code: 'no-buy-plan', text: MATERIALS_UNAVAILABLE };
    }
    if ((action === 'sell' || action === 'sell-all') && (!fns.sell || typeof fns.sell.fn !== 'function')) {
      return { code: 'no-sell-plan', text: MATERIALS_UNAVAILABLE };
    }
    if (action === 'buy' && typeof count === 'number' && count <= 0) return { code: 'bad-count', text: '数量对不上。' };
    if (p.pending) return { code: 'pending', text: BUSY_LABEL };
    return null;
  }

  function makeActionButton(p, material, action, count, label, primary) {
    const button = make(p.doc, 'button', primary ? 'ac-career-btn ac-career-btn--primary' : 'ac-career-btn', label);
    button.type = 'button';
    button.setAttribute('data-action', action);
    button.setAttribute('data-item-id', material.itemId);
    if (typeof count === 'number') button.setAttribute('data-count', String(count));
    const priceText =
      action === 'buy'
        ? BUY_PRICE_LABEL + ' ' + material.buyPrice + ' ' + WALLET_CREDITS
        : SELL_PRICE_LABEL + ' ' + material.sellPrice + ' ' + WALLET_CREDITS;
    button.setAttribute('aria-label', label + ' ' + material.name + '，' + priceText);
    const block = actionBlock(p, material, action, count);
    if (block) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
    return button;
  }

  function buildCard(p, material) {
    const doc = p.doc;
    const state = p.state || emptyState();
    const held = heldFor(state, material);
    const safeId = safeDomId(material.itemId);
    const titleId = safeId + '-title';
    const pricesId = safeId + '-prices';
    const sourceId = safeId + '-source';
    const card = make(doc, 'section', 'ac-career-market__card');
    card.setAttribute('data-item-id', material.itemId);
    card.setAttribute('aria-labelledby', titleId);

    const head = make(doc, 'div', 'ac-career-market__card-head');
    const name = make(doc, 'h3', 'ac-career-market__name', material.name);
    name.id = titleId;
    head.appendChild(name);
    const heldEl = make(doc, 'span', 'ac-career-market__held', HELD_LABEL + ' ' + held);
    heldEl.setAttribute('data-held', String(held));
    heldEl.setAttribute('data-empty', held > 0 ? 'false' : 'true');
    head.appendChild(heldEl);
    card.appendChild(head);

    const prices = make(doc, 'p', 'ac-career-market__prices');
    prices.id = pricesId;
    const buyPrice = make(doc, 'span', 'ac-career-market__buy-price', BUY_PRICE_LABEL + ' ' + material.buyPrice);
    const sellPrice = make(doc, 'span', 'ac-career-market__sell-price', SELL_PRICE_LABEL + ' ' + material.sellPrice);
    prices.appendChild(buyPrice);
    prices.appendChild(sellPrice);
    card.appendChild(prices);

    if (material.sourceHint) {
      const source = make(doc, 'p', 'ac-career-market__source', material.sourceHint);
      source.id = sourceId;
      card.appendChild(source);
    }

    const actions = make(doc, 'div', 'ac-career-market__actions');
    const buyOne = makeActionButton(p, material, 'buy', 1, BUY_ONE_LABEL, true);
    const buyFive = makeActionButton(p, material, 'buy', 5, BUY_FIVE_LABEL, false);
    const sellOne = makeActionButton(p, material, 'sell', 1, SELL_ONE_LABEL, false);
    const sellAll = makeActionButton(p, material, 'sell-all', null, SELL_ALL_LABEL, false);
    [buyOne, buyFive].forEach(function (button) {
      button.setAttribute('aria-describedby', pricesId);
    });
    [sellOne, sellAll].forEach(function (button) {
      button.setAttribute('aria-describedby', material.sourceHint ? pricesId + ' ' + sourceId : pricesId);
    });
    actions.appendChild(buyOne);
    actions.appendChild(buyFive);
    actions.appendChild(sellOne);
    actions.appendChild(sellAll);
    card.appendChild(actions);
    return card;
  }

  function restoreActionFocus(p) {
    const want = p.focusAfterRender;
    if (!want) return;
    p.focusAfterRender = null;
    let selector = '[data-action="' + want.action + '"][data-item-id="' + want.itemId + '"]';
    if (typeof want.count === 'number') selector += '[data-count="' + want.count + '"]';
    let node = null;
    try {
      node = p.doc.querySelector(selector);
    } catch (err) {
      node = null;
    }
    if (node && !node.disabled) safelyFocus(node);
    else safelyFocus(p.closeBtn);
  }

  /* ------------------------------------------------------------------ *
   * 数据装载（价目模块 → 材料表 → careerId → 钱包）
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
    state.careerId = resolveCareerIdSync(context);
    state.itemsContent = isObject(context.items) ? context.items : null;
    state.materialsModule = materialsOf(context);
    state.db = dbOf(context);
    state.aliasMap = readAliasSources(state.materialsModule, state.itemsContent);
    state.planFns = pickPlanFns(state.materialsModule);
    state.contentVersion = contentVersionOf(state);
    if (isObject(context.wallet) && context.wallet.ok !== false) {
      const normalized = normalizeWallet(context.wallet);
      if (normalized) state.wallet = normalized;
    }
    p.state = state;
    p.pending = '';
    p.focusAfterRender = null;
    renderAll(p);
    if (!state.materialsModule) return Promise.resolve();

    let listed = null;
    try {
      listed = readMarketList(state.materialsModule);
    } catch (err) {
      listed = { ok: false, reason: 'plan-error' };
    }
    return Promise.resolve(listed)
      .then(function (raw) {
        if (!isLive(p, token)) return null;
        if (isObject(raw) && raw.ok === false) {
          state.materials = null;
          state.listError = cleanText(raw.reason) || 'materials-unavailable';
        } else {
          const list = normalizeMaterialList(raw, state.aliasMap, state.materialsModule, context);
          if (list) {
            state.materials = list;
            state.listError = '';
          } else {
            state.materials = null;
            state.listError = 'materials-unavailable';
          }
        }
        renderAll(p);
        if (!state.materials) return null;
        return ensureToolIntroduced(p, token, context, state);
      })
      .then(function () {
        if (!isLive(p, token)) return null;
        if (!state.materials) return null;
        return readWalletState(p, token, context, state);
      })
      .then(function () {
        if (!isLive(p, token)) return null;
        renderAll(p);
        return null;
      })
      .catch(function () {
        if (!isLive(p, token)) return null;
        if (!state.wallet) state.walletError = 'load-failed';
        renderAll(p);
        return null;
      });
  }

  function ensureToolIntroduced(p, token, context, state) {
    const reader = typeof context.careerView === 'function'
      ? context.careerView
      : isObject(context.api) && typeof context.api.careerView === 'function' ? context.api.careerView : null;
    if (!reader || !state.careerId) return Promise.resolve();
    let returned = null;
    try {
      returned = reader.call(context, { surface: 'shop' });
    } catch (err) {
      return Promise.resolve();
    }
    return Promise.resolve(returned).then(
      function (view) {
        if (!isLive(p, token)) return;
        state.toolIntroduced = !!(isObject(view) && Array.isArray(view.tools)
          && view.tools.some(function (tool) { return isObject(tool) && tool.toolId === 'shop'; }));
        renderAll(p);
      },
      function () {
        state.toolIntroduced = false;
        renderAll(p);
      }
    );
  }

  function readWalletState(p, token, context, state) {
    const db = state.db;
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
    const db = p.state && p.state.db;
    const careerId = p.state && p.state.careerId;
    if (!db || !careerId || typeof db.readWallet !== 'function') return Promise.resolve();
    let returned = null;
    try {
      returned = db.readWallet(careerId);
    } catch (err) {
      return Promise.resolve();
    }
    return Promise.resolve(returned).then(
      function (wallet) {
        if (!panel || panel !== p) return;
        const normalized = normalizeWallet(wallet);
        if (!normalized) return;
        if (normalized.ok !== false) {
          p.state.wallet = normalized;
          p.state.walletError = '';
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

  function buildPlanRequest(state, action, items) {
    const request = {
      items: cloneMap(items),
      wallet: planWallet(state),
      careerId: state.careerId || '',
      action: action,
    };
    return request;
  }

  function onListClick(p, event) {
    const target = event && event.target;
    const button = target && typeof target.closest === 'function' ? target.closest('[data-action]') : null;
    if (!button || button.disabled) return;
    const action = button.getAttribute('data-action');
    const itemId = button.getAttribute('data-item-id');
    const material = findMaterial(p.state, itemId);
    if (!material) return;
    if (action === 'buy') handleBuy(p, material, numberOrZero(button.getAttribute('data-count')) || 1);
    else if (action === 'sell') handleSellOne(p, material);
    else if (action === 'sell-all') handleSellAll(p, material);
  }

  function findMaterial(state, itemId) {
    const list = state && Array.isArray(state.materials) ? state.materials : [];
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].itemId === itemId) return list[i];
    }
    return null;
  }

  function handleBuy(p, material, count) {
    const block = actionBlock(p, material, 'buy', count);
    if (block) {
      if (block.code !== 'pending') applyStatus(p, block.text, block.code);
      return;
    }
    const state = p.state;
    const planFn = state.planFns.buy;
    const items = {};
    items[material.itemId] = count;
    opSeq += 1;
    const seq = opSeq;
    setPending(p, 'buy');
    let returned = null;
    try {
      returned = planFn.fn.call(state.materialsModule, buildPlanRequest(state, 'buy', items));
    } catch (err) {
      settleBuyFailure(p, material, count, 'plan-error', null);
      return;
    }
    Promise.resolve(returned).then(
      function (result) {
        if (!panel || panel !== p) return;
        const plan = normalizeBuyPlan(result, material, count);
        if (!plan.ok) {
          settleBuyFailure(p, material, count, plan.reason, plan.missing);
          return;
        }
        const request = {
          careerId: state.careerId,
          purchaseId: 'market-buy:' + state.careerId + ':' + material.itemId + ':' + OP_SESSION_TAG + ':' + seq,
          cost: plan.cost,
          grants: plan.grants,
          now: nowIso(),
        };
        if (state.contentVersion) request.contentVersion = state.contentVersion;
        let purchased = null;
        try {
          purchased = state.db.purchase(request);
        } catch (err) {
          settleBuyFailure(p, material, count, 'purchase-threw', null);
          return;
        }
        Promise.resolve(purchased).then(
          function (response) {
            if (!panel || panel !== p) return;
            if (response && response.ok) settleBuySuccess(p, material, count, plan, response);
            else settleBuyFailure(p, material, count, (response && response.reason) || 'purchase-rejected', null);
          },
          function () {
            if (!panel || panel !== p) return;
            settleBuyFailure(p, material, count, 'purchase-failed', null);
          }
        );
      },
      function () {
        if (!panel || panel !== p) return;
        settleBuyFailure(p, material, count, 'plan-error', null);
      }
    );
  }

  function settleBuySuccess(p, material, count, plan, result) {
    const duplicate = !!(result && result.duplicate === true);
    const receipt = result && isObject(result.receipt) ? result.receipt : null;
    const cost = receipt && positiveInt(receipt.cost) !== null ? positiveInt(receipt.cost) : plan.cost;
    p.pending = '';
    p.focusAfterRender = { itemId: material.itemId, action: 'buy', count: count };
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      const message = duplicate
        ? TEXT_DUP + material.name + ' ×' + count + '，' + cost + ' ' + WALLET_CREDITS + '。'
        : TEXT_BUY_OK + material.name + ' ×' + count + '，' + cost + ' ' + WALLET_CREDITS + '。';
      applyStatus(p, message, duplicate ? CODE_DUPLICATE : CODE_PURCHASED);
    });
  }

  function settleBuyFailure(p, material, count, reason, missing) {
    p.pending = '';
    p.focusAfterRender = { itemId: material.itemId, action: 'buy', count: count };
    const message = buyFailureMessage(p, material, count, reason, missing);
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, message, reason || 'purchase-rejected');
    });
  }

  function buyFailureMessage(p, material, count, reason, missing) {
    const state = p.state || emptyState();
    if (reason === 'insufficient') {
      const lack = missingOf(missing, 'credits');
      let short = lack ? numberOrZero(lack.need) - numberOrZero(lack.have) : 0;
      if (short <= 0) short = material.buyPrice * count - walletCredits(state);
      return TEXT_SHORT_CREDITS + (short > 0 ? '还差 ' + short + ' ' + WALLET_CREDITS + '。' : '先攒一攒。');
    }
    if (reason === 'insufficient-items') {
      const lack = missingOf(missing, 'items');
      const short = lack ? numberOrZero(lack.need) - numberOrZero(lack.have) : 0;
      return TEXT_SHORT_ITEMS + (short > 0 ? '还差 ' + short + ' ' + material.name + '。' : '还差的材料凑不齐。');
    }
    const direct = describeReason(reason);
    return TEXT_BUY_FAIL + (direct || '账房把单子退回来了。');
  }

  function handleSellOne(p, material) {
    const block = actionBlock(p, material, 'sell', 1);
    if (block) {
      if (block.code !== 'pending') applyStatus(p, block.text, block.code);
      return;
    }
    const state = p.state;
    const lots = lotsForSell(state, material);
    const itemId = lots.length ? lots[0].itemId : material.itemId;
    const items = {};
    items[itemId] = 1;
    opSeq += 1;
    const seq = opSeq;
    setPending(p, 'sell');
    planSell(state, items).then(
      function (plan) {
        if (!panel || panel !== p) return;
        if (!plan.ok) {
          settleSellFailure(p, material, 1, plan.reason, plan.missing, 'sell');
          return;
        }
        const request = {
          careerId: state.careerId,
          saleId: 'market-sell:' + state.careerId + ':' + material.itemId + ':' + OP_SESSION_TAG + ':' + seq,
          items: plan.items,
          credits: plan.credits,
          now: nowIso(),
        };
        if (state.contentVersion) request.contentVersion = state.contentVersion;
        let sold = null;
        try {
          sold = state.db.sellItems(request);
        } catch (err) {
          settleSellFailure(p, material, 1, 'sell-threw', null, 'sell');
          return;
        }
        Promise.resolve(sold).then(
          function (response) {
            if (!panel || panel !== p) return;
            if (response && response.ok) settleSellSuccess(p, material, 1, plan.credits, response);
            else settleSellFailure(p, material, 1, (response && response.reason) || 'sell-rejected', null, 'sell');
          },
          function () {
            if (!panel || panel !== p) return;
            settleSellFailure(p, material, 1, 'sell-failed', null, 'sell');
          }
        );
      },
      function () {
        if (!panel || panel !== p) return;
        settleSellFailure(p, material, 1, 'plan-error', null, 'sell');
      }
    );
  }

  function planSell(state, items) {
    const fn = state.planFns && state.planFns.sell;
    if (!fn || typeof fn.fn !== 'function') return Promise.resolve({ ok: false, reason: 'no-sell-plan' });
    let returned = null;
    try {
      returned = fn.fn.call(state.materialsModule, buildPlanRequest(state, 'sell', items));
    } catch (err) {
      return Promise.resolve({ ok: false, reason: 'plan-error' });
    }
    return Promise.resolve(returned).then(
      function (result) {
        return normalizeSellPlan(result, items);
      },
      function () {
        return { ok: false, reason: 'plan-error' };
      }
    );
  }

  function handleSellAll(p, material) {
    const block = actionBlock(p, material, 'sell-all', null);
    if (block) {
      if (block.code !== 'pending') applyStatus(p, block.text, block.code);
      return;
    }
    const state = p.state;
    const lots = lotsForSell(state, material);
    if (!lots.length) {
      applyStatus(p, TEXT_SHORT_ITEMS + '仓里没有 ' + material.name + ' 可卖。', 'insufficient-items');
      return;
    }
    setPending(p, 'sell-all');
    const queue = lots.map(function (lot) {
      return { itemId: lot.itemId, count: lot.count };
    });
    runSellQueue(p, material, queue, { sold: 0, credits: 0, chunks: 0 }, 0);
  }

  function splitQueue(queue, lot) {
    const first = Math.floor(lot.count / 2);
    const second = lot.count - first;
    queue.shift();
    if (second > 0) queue.unshift({ itemId: lot.itemId, count: second });
    if (first > 0) queue.unshift({ itemId: lot.itemId, count: first });
  }

  function runSellQueue(p, material, queue, tally, guard) {
    if (!panel || panel !== p) return;
    if (!queue.length) {
      settleSellAllSuccess(p, material, tally);
      return;
    }
    if (guard > 200) {
      settleSellPartial(p, material, tally, 'chunk-guard');
      return;
    }
    const state = p.state;
    const lot = queue[0];
    const items = {};
    items[lot.itemId] = lot.count;
    planSell(state, items).then(function (plan) {
      if (!panel || panel !== p) return;
      if (!plan.ok) {
        if (isSplitReason(plan.reason) && lot.count > 1) {
          splitQueue(queue, lot);
          runSellQueue(p, material, queue, tally, guard + 1);
          return;
        }
        if (tally.sold > 0) settleSellPartial(p, material, tally, plan.reason);
        else settleSellFailure(p, material, lot.count, plan.reason, plan.missing, 'sell-all');
        return;
      }
      opSeq += 1;
      const seq = opSeq;
      const request = {
        careerId: state.careerId,
        saleId: 'market-sell:' + state.careerId + ':' + OP_SESSION_TAG + ':' + seq,
        items: plan.items,
        credits: plan.credits,
        now: nowIso(),
      };
      if (state.contentVersion) request.contentVersion = state.contentVersion;
      let sold = null;
      try {
        sold = state.db.sellItems(request);
      } catch (err) {
        if (tally.sold > 0) settleSellPartial(p, material, tally, 'sell-threw');
        else settleSellFailure(p, material, lot.count, 'sell-threw', null, 'sell-all');
        return;
      }
      Promise.resolve(sold).then(
        function (response) {
          if (!panel || panel !== p) return;
          if (response && response.ok) {
            tally.sold += lot.count;
            tally.credits += receiptCredits(response, plan.credits);
            tally.chunks += 1;
            queue.shift();
            runSellQueue(p, material, queue, tally, guard + 1);
            return;
          }
          const reason = (response && response.reason) || 'sell-rejected';
          if (isSplitReason(reason) && lot.count > 1) {
            splitQueue(queue, lot);
            runSellQueue(p, material, queue, tally, guard + 1);
            return;
          }
          if (tally.sold > 0) settleSellPartial(p, material, tally, reason);
          else settleSellFailure(p, material, lot.count, reason, null, 'sell-all');
        },
        function () {
          if (!panel || panel !== p) return;
          if (tally.sold > 0) settleSellPartial(p, material, tally, 'sell-failed');
          else settleSellFailure(p, material, lot.count, 'sell-failed', null, 'sell-all');
        }
      );
    });
  }

  function receiptCredits(result, fallback) {
    const receipt = result && isObject(result.receipt) ? result.receipt : null;
    if (receipt && positiveInt(receipt.credits) !== null) return positiveInt(receipt.credits);
    return positiveInt(fallback) || 0;
  }

  function settleSellSuccess(p, material, count, plannedCredits, result) {
    const duplicate = !!(result && result.duplicate === true);
    const credits = receiptCredits(result, plannedCredits);
    p.pending = '';
    p.focusAfterRender = { itemId: material.itemId, action: 'sell', count: count };
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      const message = duplicate
        ? TEXT_DUP + material.name + ' ×' + count + '，' + credits + ' ' + WALLET_CREDITS + '。'
        : TEXT_SELL_OK + material.name + ' ×' + count + '，+' + credits + ' ' + WALLET_CREDITS + '。';
      applyStatus(p, message, duplicate ? CODE_DUPLICATE : CODE_SOLD);
    });
  }

  function settleSellAllSuccess(p, material, tally) {
    p.pending = '';
    p.focusAfterRender = { itemId: material.itemId, action: 'sell-all', count: null };
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      const message = TEXT_SELL_OK + material.name + ' ×' + tally.sold + '，+' + tally.credits + ' ' + WALLET_CREDITS + '。';
      applyStatus(p, message, CODE_SOLD);
    });
  }

  function settleSellPartial(p, material, tally, reason) {
    p.pending = '';
    p.focusAfterRender = { itemId: material.itemId, action: 'sell-all', count: null };
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      const detail = describeReason(reason) || '账房把剩下的单子退回来了。';
      const message =
        TEXT_PARTIAL_SELL + material.name + ' ×' + tally.sold + '，+' + tally.credits + ' ' + WALLET_CREDITS + '；剩下的没卖成：' + detail;
      applyStatus(p, message, CODE_PARTIAL);
    });
  }

  function settleSellFailure(p, material, count, reason, missing, action) {
    p.pending = '';
    p.focusAfterRender = { itemId: material.itemId, action: action === 'sell-all' ? 'sell-all' : 'sell', count: action === 'sell-all' ? null : 1 };
    const message = sellFailureMessage(material, reason, missing);
    refreshWallet(p).then(function () {
      if (!panel || panel !== p) return;
      renderAll(p);
      applyStatus(p, message, reason || 'sell-rejected');
    });
  }

  function sellFailureMessage(material, reason, missing) {
    if (reason === 'insufficient-items') {
      const lack = missingOf(missing, 'items');
      const short = lack ? numberOrZero(lack.need) - numberOrZero(lack.have) : 0;
      return TEXT_SHORT_ITEMS + (short > 0 ? '还差 ' + short + ' ' + material.name + '。' : '仓里没有 ' + material.name + ' 可卖。');
    }
    const direct = describeReason(reason);
    return TEXT_SELL_FAIL + (direct || '账房把单子退回来了。');
  }

  /* ------------------------------------------------------------------ *
   * 面板生命周期
   * ------------------------------------------------------------------ */

  function buildPanel(doc, context) {
    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    const overlay = make(doc, 'div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', 'market');
    overlay.setAttribute('data-market', '1');
    if (context.reducedMotion) overlay.classList.add('is-reduced-motion');

    const sheet = make(doc, 'div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('aria-describedby', LEDE_ID);
    sheet.setAttribute('tabindex', '-1');
    sheet.setAttribute('data-market-sheet', '1');

    const head = make(doc, 'div', 'ac-career-sheet__head');
    const heading = make(doc, 'h2', 'ac-career-sheet__title', PANEL_TITLE);
    heading.id = TITLE_ID;
    const closeBtn = make(doc, 'button', 'ac-career-icon-btn ac-career-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', CLOSE_LABEL);
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make(doc, 'div', 'ac-career-sheet__body');
    const wrap = make(doc, 'div', 'ac-career-market');
    const lede = make(doc, 'p', 'ac-career-market__lede', PANEL_LEDE);
    lede.id = LEDE_ID;
    const walletEl = make(doc, 'p', 'ac-career-market__wallet');
    walletEl.hidden = true;
    const noticeEl = make(doc, 'p', 'ac-career-market__notice');
    noticeEl.hidden = true;
    const listEl = make(doc, 'div', 'ac-career-market__list');
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
      focusAfterRender: null,
    };

    function onKeyDown(event) {
      if (!event) return;
      /* 只处理最上层 career 面板：town→market→... 叠层时 Esc 不得一次关两层。 */
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
   * 打开材料商店。重复打开时复用同一面板并重读价目/账目（不重建、不叠层）。
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
   * 按新的上下文重读价目/账目并重绘（面板未打开时返回 null，不创建 DOM）。
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

  /** 关闭材料商店并把焦点还给打开前的元素（可重复调用）。 */
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
    root.ArcadeCareerUI.market = api;
    try {
      root.ArcadeCareerMarket = api;
    } catch (err) {
      /* 别名挂载失败不影响主入口 */
    }
  }

  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
