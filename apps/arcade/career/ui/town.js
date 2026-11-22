/*!
 * StudioKit Arcade Life — 旧港告示板（0.16 / D16-01）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.town，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.town.open(ctx);
 *   window.ArcadeCareerUI.town.render(ctx);
 *   window.ArcadeCareerUI.town.close();
 *
 * ctx（bridge 构造，见 docs/arcade-life/ADR-interfaces.md §18.7）：
 *   { state, api, commission, commissionRun, commissions, items, careerId,
 *     openTown, openHangar, openReceipt, openSettings, announce(text), reducedMotion }
 *
 * 约束：
 * - 覆盖当前页面的轻量浮层（position:fixed，可滚动），按钮 + Esc + 点遮罩关闭；
 * - 关闭后焦点返回打开前的元素；键盘 Tab 可在面板内遍历（不逃逸到游戏页）；
 * - 重复 open 复用同一面板（不重建、不叠层）；
 * - 只读 ctx.commission（listAvailable / start / getWallet）；不读写 IndexedDB、localStorage；
 * - ctx.commission 缺失或调用失败时显示「告示板暂不可用」并保持面板可用（降级不抛错）；
 * - 委托行来自 ctx.commissions.commissions；不可接的行显示「暂未开放」；
 * - 成功接单显示戏内提示，并只使用 commission.start 返回的 url 导航（window.location.assign）；
 * - 样式集中在本文件注入的 <style>（不新建 CSS 文件，不引用外部字体/图片）；
 * - 全部文案为戏内语言；无网络请求、无声音、无动画。
 */
(function (root) {
  'use strict';

  const VERSION = '0.16.0';
  const PANEL_KEY = 'town';
  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet';
  const TITLE_ID = 'ac-career-town-title';
  const DESC_ID = 'ac-career-town-desc';
  const STYLE_ID = 'ac-career-town-style';

  const PANEL_LABEL = '旧港告示板';
  const LOCATION_TEXT = '旧码头门房边的木牌，纸角被海风吹得发卷。';
  const BOARD_UNAVAILABLE = '告示板暂不可用';
  const LIST_EMPTY = '木牌上还空着，港务处没挂出新单子。';
  const LOCKED_LABEL = '暂未开放';
  const START_LABEL = '接单';
  const STARTING_LABEL = '照单登记…';
  const START_OK = '单子已经接下，港里给你留了位置。';
  const START_NO_URL = '单子已经接下，但从这里找不到去机位的路。';
  const START_FAILED = '这次没接上，告示板那边说还没排到。';
  const HANGAR_LABEL = '去机库';
  const RECEIPT_LABEL = '钱包与收据';
  const SETTINGS_LABEL = '线索提示';
  const CLOSE_LABEL = '收起告示板';
  const HANGAR_FAILED = '机库那边灯还亮着，门暂时没开。';
  const RECEIPT_FAILED = '账房今天没开窗，收据先拿不到。';
  const SETTINGS_FAILED = '线索提示那边暂时没应声。';
  const WALLET_HINT = '工钱和材料记在收据上。';
  const WALLET_EMPTY = '工钱 0 · 材料：暂无';
  const MATERIAL_FALLBACK = { alloy: '合金', crystal: '棱晶' };

  /* 接单失败原因 → 可归因戏内文本（未知原因使用通用兜底，不暴露系统词）。 */
  const START_FAIL_TEXT = {
    'not-unlocked': '这张单子还没轮到你接。',
    locked: '这张单子还没轮到你接。',
    'already-active': '手上还有一张没跑完的单子。',
    'run-conflict': '手上还有一张没跑完的单子。',
    'run-active': '手上还有一张没跑完的单子。',
    'no-career': '港务处还没记上你的名字，先去信箱看看地址。',
    'career-missing': '港务处还没记上你的名字，先去信箱看看地址。',
    'career-unavailable': '港务处还没记上你的名字，先去信箱看看地址。',
    'db-unavailable': '港务处的册子翻不开，过一会儿再试。',
    'storage-unavailable': '港务处的册子翻不开，过一会儿再试。',
    'wallet-missing': '港务处还没给你立账户，先去信箱看看地址。',
    'run-create-failed': '单子没能登记上，过一会儿再试。',
    'ticket-failed': '单子没能登记上，过一会儿再试。',
    'bad-commission-id': '这张单子的字看不清了，先看看别的。',
    'missing-commission': '这张单子的字看不清了，先看看别的。',
    'invalid-commission': '这张单子的字看不清了，先看看别的。',
    'unknown-commission': '这张单子的字看不清了，先看看别的。',
    'content-unavailable': '告示板那边今天没把单子备好，先看看别的。',
    'content-invalid': '告示板那边今天没把单子备好，先看看别的。',
    'unsupported-content': '告示板那边今天没把单子备好，先看看别的。',
    'core-unavailable': '告示板那边今天没把单子备好，先看看别的。',
    exception: '告示板那边卡了一下，过一会儿再试。',
  };

  const STYLE_TEXT = [
    '.ac-career-town {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-town__location {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__wallet {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: baseline;',
    '  gap: 4px 10px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.5);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__wallet-label {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '}',
    '.ac-career-town__wallet-value {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-weight: 600;',
    '}',
    '.ac-career-town__notice {',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(255, 210, 63, 0.08);',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__list {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding: 0;',
    '  list-style: none;',
    '}',
    '.ac-career-town__empty {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__row {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 4px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.55);',
    '}',
    '.ac-career-town__row-head {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: baseline;',
    '  gap: 2px 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-town__row-title {',
    '  margin: 0;',
    '  font-size: 13.5px;',
    '  font-weight: 600;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__row-issuer {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11.5px;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__row-summary {',
    '  margin: 0;',
    '  font-size: 12.5px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__row-meta {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 2px 10px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11.5px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__row-actions {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  padding-top: 2px;',
    '}',
    '.ac-career-town__row-actions .ac-career-btn,',
    '.ac-career-town__footer .ac-career-btn {',
    '  flex: 1 1 120px;',
    '  min-height: 44px;',
    '}',
    '.ac-career-town__locked {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  min-height: 44px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '}',
    '.ac-career-town__footer {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  padding-top: 4px;',
    '}',
    '@media (max-width: 375px) {',
    '  .ac-career-town__row {',
    '    padding: 9px;',
    '  }',
    '}',
  ].join('\n');

  let panel = null;
  let styleInjected = false;

  function documentOf() {
    return typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function idText(value) {
    return cleanText(value).replace(/\s+/g, '');
  }

  function numberOrZero(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  /** 面板专用样式只在第一次真正打开时注入一次；不新建 CSS 文件、不引用外部资源。 */
  function ensureStyle(doc) {
    if (styleInjected || !doc) return;
    try {
      if (typeof doc.getElementById === 'function' && doc.getElementById(STYLE_ID)) {
        styleInjected = true;
        return;
      }
      if (typeof doc.createElement !== 'function' || !(doc.head || doc.documentElement)) return;
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE_TEXT;
      (doc.head || doc.documentElement).appendChild(style);
      styleInjected = true;
    } catch (err) {
      /* 样式失败不影响面板可用性（共享 clue-surface.css 仍是主样式）。 */
    }
  }

  function focusableIn(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return [];
    const nodes = scope.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || node.disabled) continue;
      if (node.hidden) continue;
      if (typeof node.closest === 'function' && node.closest('[hidden]')) continue;
      if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) continue;
      out.push(node);
    }
    return out;
  }

  function safelyFocus(node) {
    if (!node || typeof node.focus !== 'function') return;
    try {
      node.focus();
    } catch (err) {
      /* 焦点失败不影响面板可用性 */
    }
  }

  function rootWindow() {
    return typeof window !== 'undefined' && window ? window : null;
  }

  /** 只接受相对地址或同源 http(s) 地址，拒绝协议相对/javascript: 之类的返回 url。 */
  function safeNavUrl(value) {
    const url = cleanText(value);
    if (!url) return '';
    if (url.indexOf('javascript:') === 0 || url.indexOf('data:') === 0) return '';
    if (url.indexOf('//') === 0) return '';
    const win = rootWindow();
    try {
      const base = win && win.location && win.location.href ? win.location.href : '';
      if (base) {
        const resolved = new URL(url, base);
        const origin = new URL(base);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return '';
        if (resolved.origin !== origin.origin) return '';
        return url;
      }
    } catch (err) {
      /* 无 URL 构造能力时只允许明显相对的地址 */
    }
    return /^[./#?]/.test(url) ? url : '';
  }

  function careerIdOf(context) {
    const candidates = [
      context.careerId,
      context.commissionRun && context.commissionRun.careerId,
      context.api && context.api.commissionRun && context.api.commissionRun.careerId,
      context.profile && context.profile.careerId,
      context.state && context.state.careerId,
      context.wallet && context.wallet.careerId,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const id = idText(candidates[i]);
      if (id) return id;
    }
    return null;
  }

  function commissionOf(context) {
    if (isObject(context.commission)) return context.commission;
    if (context.api && isObject(context.api.commission)) return context.api.commission;
    return null;
  }

  /**
   * commission-core 的内容由调用方注入（ADR §18.1）。bridge 0.16 已会 configure；
   * 这里再做一次仅内存的幂等兜底（不写 IndexedDB / localStorage），保证直接注入 ctx 的
   * 场景、以及 bridge 未来回归时「告示板」仍能读到 ctx.commissions 的 4 条委托。
   */
  function ensureCommissionContent(commission, context) {
    if (!commission || typeof commission.configure !== 'function') return;
    const content = context && isObject(context.commissions) ? context.commissions : null;
    if (!content || !Array.isArray(content.commissions) || !content.commissions.length) return;
    let ready = 0;
    if (typeof commission.getCommissions === 'function') {
      try {
        const list = commission.getCommissions();
        ready = Array.isArray(list) ? list.length : 0;
      } catch (err) {
        ready = 0;
      }
    }
    if (ready > 0) return;
    try {
      commission.configure({ content: content });
    } catch (err) {
      /* 内容注入失败时走「告示板暂不可用」降级，不抛错 */
    }
  }

  function openerOf(context, name) {
    if (context && typeof context[name] === 'function') return context[name];
    if (context && isObject(context.api) && typeof context.api[name] === 'function') return context.api[name];
    return null;
  }

  function materialNamesOf(context) {
    const names = Object.create(null);
    const items = context && isObject(context.items) ? context.items : null;
    const list = items && Array.isArray(items.materials) ? items.materials : [];
    list.forEach((entry) => {
      if (!isObject(entry)) return;
      const itemId = idText(entry.itemId);
      const name = cleanText(entry.name);
      if (itemId && name) names[itemId] = name;
    });
    Object.keys(MATERIAL_FALLBACK).forEach((itemId) => {
      if (!names[itemId]) names[itemId] = MATERIAL_FALLBACK[itemId];
    });
    return names;
  }

  function rewardTextOf(reward, materialNames) {
    if (!isObject(reward)) return '';
    const parts = [];
    const credits = numberOrZero(reward.credits);
    if (credits > 0) parts.push('工钱 ' + credits);
    const items = isObject(reward.items) ? reward.items : {};
    const materials = [];
    Object.keys(items).forEach((itemId) => {
      const count = numberOrZero(items[itemId]);
      if (count > 0) materials.push((materialNames[itemId] || cleanText(itemId)) + ' ×' + count);
    });
    if (materials.length) parts.push('材料 ' + materials.join('、'));
    return parts.join(' · ');
  }

  function commissionRowsOf(context) {
    const bundle = context && isObject(context.commissions) ? context.commissions : null;
    const raw = bundle && Array.isArray(bundle.commissions) ? bundle.commissions : [];
    const rows = [];
    raw.forEach((entry) => {
      if (!isObject(entry)) return;
      const commissionId = idText(entry.commissionId);
      if (!commissionId) return;
      rows.push({
        commissionId: commissionId,
        title: cleanText(entry.title) || '未命名的单子',
        summary: cleanText(entry.summary),
        issuer: cleanText(entry.issuer),
        rewardText: rewardTextOf(entry.reward, materialNamesOf(context)),
        durationHint: cleanText(entry.durationHint),
      });
    });
    return rows;
  }

  function idsFromUnlockEntries(entries) {
    const ids = Object.create(null);
    entries.forEach((entry) => {
      if (typeof entry === 'string') {
        const id = idText(entry);
        if (id) ids[id] = true;
        return;
      }
      if (!isObject(entry)) return;
      const nested = isObject(entry.commission) ? entry.commission : entry;
      const id = idText(entry.commissionId) || idText(nested.commissionId) || idText(entry.id);
      if (!id) return;
      const status = (cleanText(entry.state) || cleanText(entry.status)).toLowerCase();
      const locked =
        entry.unlocked === false ||
        entry.locked === true ||
        entry.available === false ||
        status === 'locked' ||
        status === 'unavailable';
      if (!locked) ids[id] = true;
    });
    return ids;
  }

  /**
   * 把 listAvailable 的返回规整成 commissionId 集合。
   * 兼容数组、{list/available/unlocked/commissions/entries/rows} 与 {unlocked:{id:true}}；
   * 无法识别或 ok:false 时返回 null（调用方走「告示板暂不可用」降级）。
   */
  function normalizeUnlocked(result) {
    if (Array.isArray(result)) return idsFromUnlockEntries(result);
    if (!isObject(result)) return null;
    const lists = [result.list, result.available, result.unlocked, result.commissions, result.entries, result.rows];
    for (let i = 0; i < lists.length; i += 1) {
      if (Array.isArray(lists[i])) return idsFromUnlockEntries(lists[i]);
    }
    if (isObject(result.unlocked)) {
      const ids = Object.create(null);
      Object.keys(result.unlocked).forEach((key) => {
        if (result.unlocked[key]) ids[idText(key)] = true;
      });
      return ids;
    }
    if (result.ok === true) return Object.create(null);
    return null;
  }

  function walletTextOf(wallet, materialNames) {
    const data = isObject(wallet) ? (isObject(wallet.wallet) ? wallet.wallet : wallet) : null;
    if (!data) return '';
    if (data.ok === false) return '';
    const credits = numberOrZero(data.credits);
    const items = isObject(data.items) ? data.items : {};
    const materials = [];
    Object.keys(items).forEach((itemId) => {
      const count = numberOrZero(items[itemId]);
      if (count > 0) materials.push((materialNames[itemId] || cleanText(itemId)) + ' ×' + count);
    });
    const materialText = materials.length ? materials.join('、') : '暂无';
    return '工钱 ' + credits + ' · 材料：' + materialText;
  }

  function failTextOf(result) {
    const reason = result && isObject(result) ? (cleanText(result.reason) || cleanText(result.error)).toLowerCase() : '';
    return START_FAIL_TEXT[reason] || START_FAILED;
  }

  /**
   * 构建面板（不挂载）。render(ctx) 用它返回可检查的 sheet；open(ctx) 负责挂载与监听。
   * @param {object} ctx
   * @param {boolean} mounted 是否即将挂载（决定清理与焦点行为）
   */
  function buildPanel(ctx, mounted) {
    const doc = documentOf();
    if (!doc) return null;
    const context = isObject(ctx) ? ctx : {};
    let materialNames = materialNamesOf(context);
    const rectOf = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    function make(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    const overlay = make('div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', PANEL_KEY);
    if (context.reducedMotion) overlay.classList.add('is-reduced-motion');

    const sheet = make('div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('aria-describedby', DESC_ID);
    sheet.setAttribute('tabindex', '-1');

    const head = make('div', 'ac-career-sheet__head');
    const heading = make('h2', 'ac-career-sheet__title', PANEL_LABEL);
    heading.id = TITLE_ID;
    const closeBtn = make('button', 'ac-career-icon-btn ac-career-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', CLOSE_LABEL);
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make('div', 'ac-career-sheet__body');
    const townView = make('div', 'ac-career-town');
    townView.setAttribute('data-view', 'town');

    const location = make('p', 'ac-career-town__location', LOCATION_TEXT);
    location.id = DESC_ID;

    const notice = make('p', 'ac-career-town__notice', BOARD_UNAVAILABLE);
    notice.hidden = true;

    const wallet = make('div', 'ac-career-town__wallet');
    const walletLabel = make('span', 'ac-career-town__wallet-label', '随身：');
    const walletValue = make('span', 'ac-career-town__wallet-value', WALLET_HINT);
    wallet.appendChild(walletLabel);
    wallet.appendChild(walletValue);

    const list = make('ul', 'ac-career-town__list');
    const empty = make('p', 'ac-career-town__empty', LIST_EMPTY);
    empty.hidden = true;

    const statusLine = make('p', 'ac-career-status');
    statusLine.hidden = true;

    const footer = make('div', 'ac-career-town__footer');
    const hangarBtn = make('button', 'ac-career-btn ac-career-btn--ghost', HANGAR_LABEL);
    hangarBtn.type = 'button';
    hangarBtn.setAttribute('data-town-action', 'hangar');
    const receiptBtn = make('button', 'ac-career-btn ac-career-btn--ghost', RECEIPT_LABEL);
    receiptBtn.type = 'button';
    receiptBtn.setAttribute('data-town-action', 'receipt');
    const settingsBtn = make('button', 'ac-career-btn ac-career-btn--ghost', SETTINGS_LABEL);
    settingsBtn.type = 'button';
    settingsBtn.setAttribute('data-town-action', 'settings');
    footer.appendChild(hangarBtn);
    footer.appendChild(receiptBtn);
    footer.appendChild(settingsBtn);

    townView.appendChild(location);
    townView.appendChild(wallet);
    townView.appendChild(notice);
    townView.appendChild(list);
    townView.appendChild(empty);
    townView.appendChild(statusLine);
    townView.appendChild(footer);

    body.appendChild(townView);
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);

    const liveRegion = make('div', 'ac-career-sr-only');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    overlay.appendChild(liveRegion);

    let liveContext = context;
    let requestSeq = 0;
    let alive = true;
    const startingIds = Object.create(null);

    function announce(text) {
      const value = cleanText(text);
      if (!value) return;
      if (typeof liveContext.announce === 'function') {
        try {
          liveContext.announce(value);
          return;
        } catch (err) {
          /* 回落到面板自带的 polite 区域 */
        }
      }
      liveRegion.textContent = '';
      liveRegion.textContent = value;
    }

    function setStatus(text) {
      const value = cleanText(text);
      statusLine.textContent = value;
      statusLine.hidden = !value;
    }

    function setNotice(text) {
      const value = cleanText(text);
      notice.textContent = value;
      notice.hidden = !value;
    }

    function isCurrent() {
      if (!alive) return false;
      if (!mounted) return true;
      return !!(panel && panel.overlay === overlay);
    }

    function actionButton(commissionId) {
      const button = make('button', 'ac-career-btn ac-career-btn--primary', START_LABEL);
      button.type = 'button';
      button.setAttribute('data-town-action', 'start');
      button.setAttribute('data-commission-id', commissionId);
      button.setAttribute('aria-label', '接下「' + (rowTitle(commissionId) || '这张单子') + '」');
      return button;
    }

    function rowTitle(commissionId) {
      const rows = commissionRowsOf(liveContext);
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].commissionId === commissionId) return rows[i].title;
      }
      return '';
    }

    function renderRow(row, unlockedSet, boardReady) {
      const item = make('li', 'ac-career-town__row');
      item.setAttribute('data-commission-id', row.commissionId);

      const rowHead = make('div', 'ac-career-town__row-head');
      rowHead.appendChild(make('h3', 'ac-career-town__row-title', row.title));
      if (row.issuer) rowHead.appendChild(make('span', 'ac-career-town__row-issuer', row.issuer));
      item.appendChild(rowHead);

      if (row.summary) item.appendChild(make('p', 'ac-career-town__row-summary', row.summary));

      const meta = make('p', 'ac-career-town__row-meta');
      if (row.rewardText) meta.appendChild(make('span', 'ac-career-town__reward', row.rewardText));
      if (row.durationHint) meta.appendChild(make('span', 'ac-career-town__duration', '时长：' + row.durationHint));
      if (meta.childNodes.length) item.appendChild(meta);

      const actions = make('div', 'ac-career-town__row-actions');
      const unlocked = boardReady && !!unlockedSet && !!unlockedSet[row.commissionId];
      if (unlocked) {
        actions.appendChild(actionButton(row.commissionId));
      } else {
        actions.appendChild(make('span', 'ac-career-town__locked', LOCKED_LABEL));
      }
      item.appendChild(actions);
      return item;
    }

    function renderWallet() {
      const commission = commissionOf(liveContext);
      if (!commission || typeof commission.getWallet !== 'function') {
        walletValue.textContent = WALLET_HINT;
        return;
      }
      let result = null;
      try {
        result = commission.getWallet({ careerId: careerIdOf(liveContext) });
      } catch (err) {
        result = null;
      }
      const apply = (value) => {
        if (!isCurrent()) return;
        const text = walletTextOf(value, materialNames);
        walletValue.textContent = text || WALLET_HINT;
      };
      if (result && typeof result.then === 'function') {
        result.then(apply, () => apply(null));
        return;
      }
      apply(result);
    }

    function applyUnlocked(unlockedSet, initial) {
      const boardReady = !!unlockedSet;
      /* initial：先画「暂未开放」占位，不立刻报「暂不可用」，等 listAvailable 结果再决定。 */
      setNotice(boardReady || initial ? '' : BOARD_UNAVAILABLE);
      while (list.firstChild) list.removeChild(list.firstChild);
      const rows = commissionRowsOf(liveContext);
      rows.forEach((row) => list.appendChild(renderRow(row, unlockedSet, boardReady)));
      const hasRows = rows.length > 0;
      list.hidden = !hasRows;
      empty.hidden = hasRows || !boardReady;
    }

    function loadUnlocks() {
      requestSeq += 1;
      const seq = requestSeq;
      const commission = commissionOf(liveContext);
      if (!commission) {
        applyUnlocked(null);
        return;
      }
      ensureCommissionContent(commission, liveContext);
      if (typeof commission.listAvailable !== 'function') {
        applyUnlocked(null);
        return;
      }
      let result = null;
      try {
        result = commission.listAvailable({ careerId: careerIdOf(liveContext), ensure: true });
      } catch (err) {
        result = null;
      }
      const settle = (value) => {
        if (!isCurrent() || seq !== requestSeq) return;
        applyUnlocked(normalizeUnlocked(value));
      };
      if (result && typeof result.then === 'function') {
        result.then(settle, () => settle(null));
        return;
      }
      settle(result);
    }

    function restoreButton(button) {
      if (!button) return;
      button.disabled = false;
      button.textContent = START_LABEL;
    }

    function settleStart(result, button, commissionId) {
      delete startingIds[commissionId];
      const failed = !result || (isObject(result) && result.ok === false);
      if (failed) {
        restoreButton(button);
        const text = failTextOf(result);
        setStatus(text);
        announce(text);
        return;
      }
      setStatus(START_OK);
      announce(START_OK);
      const navUrl = safeNavUrl(result && isObject(result) ? result.url : '');
      if (!navUrl) {
        restoreButton(button);
        setStatus(START_NO_URL);
        announce(START_NO_URL);
        return;
      }
      try {
        const win = rootWindow();
        if (win && win.location && typeof win.location.assign === 'function') {
          win.location.assign(navUrl);
        }
      } catch (err) {
        restoreButton(button);
        setStatus(START_NO_URL);
        announce(START_NO_URL);
      }
    }

    function startCommission(commissionId, button) {
      const id = idText(commissionId);
      if (!id || startingIds[id]) return;
      const commission = commissionOf(liveContext);
      if (!commission || typeof commission.start !== 'function') {
        setNotice(BOARD_UNAVAILABLE);
        setStatus(BOARD_UNAVAILABLE);
        announce(BOARD_UNAVAILABLE);
        return;
      }
      startingIds[id] = true;
      if (button) {
        button.disabled = true;
        button.textContent = STARTING_LABEL;
      }
      setStatus('');
      let result = null;
      try {
        result = commission.start({ commissionId: id, careerId: careerIdOf(liveContext) });
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => settleStart(value, button, id),
          () => settleStart(null, button, id)
        );
        return;
      }
      settleStart(result, button, id);
    }

    function openOther(name, failText) {
      const opener = openerOf(liveContext, name);
      if (typeof opener !== 'function') {
        setStatus(failText);
        announce(failText);
        return;
      }
      let result = null;
      try {
        result = opener();
      } catch (err) {
        result = { ok: false };
      }
      const settle = (value) => {
        if (value && isObject(value) && value.ok === false) {
          setStatus(failText);
          announce(failText);
        }
      };
      if (result && typeof result.then === 'function') {
        result.then(settle, () => settle({ ok: false }));
        return;
      }
      settle(result);
    }

    function onClick(event) {
      const target = event && event.target && typeof event.target.closest === 'function'
        ? event.target.closest('[data-town-action]')
        : null;
      if (!target || !townView.contains(target)) return;
      const action = cleanText(target.getAttribute('data-town-action'));
      if (action === 'start') {
        startCommission(target.getAttribute('data-commission-id'), target);
        return;
      }
      if (action === 'hangar') {
        openOther('openHangar', HANGAR_FAILED);
        return;
      }
      if (action === 'receipt') {
        openOther('openReceipt', RECEIPT_FAILED);
        return;
      }
      if (action === 'settings') {
        openOther('openSettings', SETTINGS_FAILED);
      }
    }

    function refresh(next) {
      if (!isCurrent()) return sheet;
      const context2 = isObject(next) ? next : {};
      if (context2.reducedMotion) overlay.classList.add('is-reduced-motion');
      else overlay.classList.remove('is-reduced-motion');
      liveContext = context2;
      materialNames = materialNamesOf(context2);
      setStatus('');
      /* 保留上一次的行与提示，直到新结果到达再整体替换，避免异步模块出现空列表/告示闪烁。 */
      renderWallet();
      loadUnlocks();
      return sheet;
    }

    function destroy() {
      alive = false;
      requestSeq += 1;
    }

    townView.addEventListener('click', onClick, false);
    closeBtn.addEventListener('click', () => close(), false);

    /**
     * 首次填充内容。由 open()/render() 在面板对象就绪后调用：
     * 同步返回的 listAvailable / getWallet 结果必须等到「当前面板」确定后才被接受，
     * 否则会被 isCurrent() 当作过期结果丢弃（真实模块是 Promise，假 ctx 可能同步）。
     */
    function start() {
      applyUnlocked(null, true);
      renderWallet();
      loadUnlocks();
    }

    return {
      doc: doc,
      overlay: overlay,
      sheet: sheet,
      previousFocus: rectOf,
      mounted: !!mounted,
      context: context,
      refresh: refresh,
      start: start,
      destroy: destroy,
      announce: announce,
      setStatus: setStatus,
      closeBtn: closeBtn,
    };
  }

  /** 关闭告示板并把焦点还给打开前的元素（可重复调用）。 */
  function close() {
    const current = panel;
    panel = null;
    if (!current) return false;
    if (typeof current.destroy === 'function') current.destroy();
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

  /**
   * 打开旧港告示板。
   * @param {object} [ctx] bridge 上下文（缺失字段按空处理，不抛异常）
   * @returns {{ok:boolean, reason?:string, panel?:Element}} 结构化结果；无 DOM 时返回 {ok:false, reason:'ui-unavailable'}
   */
  function open(ctx) {
    const doc = documentOf();
    if (!doc) return { ok: false, reason: 'ui-unavailable' };
    ensureStyle(doc);

    /* 幂等：重复 open 复用同一面板，只刷新内容并保持焦点。 */
    if (panel && panel.overlay && panel.overlay.parentNode && panel.doc === doc) {
      try {
        panel.refresh(ctx);
      } catch (err) {
        /* 刷新失败不破坏已有面板 */
      }
      const sheet = panel.sheet;
      if (!sheet.contains(doc.activeElement)) safelyFocus(panel.closeBtn || sheet);
      return { ok: true, panel: sheet };
    }

    const built = buildPanel(ctx, true);
    if (!built) return { ok: false, reason: 'ui-unavailable' };
    const previousFocus = built.previousFocus;

    function onKeyDown(event) {
      if (!event) return;
      /* 只处理最上层面板的键盘事件；下层面板（如机库/收据叠在告示板上）不抢 Esc/Tab。 */
      const stacks = doc.querySelectorAll ? doc.querySelectorAll('[data-career-panel]') : [];
      if (stacks && stacks.length > 1 && stacks[stacks.length - 1] !== built.overlay) return;
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
      if (key === 'Escape' || key === 'Esc' || code === 27) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        close();
        return;
      }
      if (key !== 'Tab' && code !== 9) return;
      const items = focusableIn(built.sheet);
      if (!items.length) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(built.sheet);
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = doc.activeElement;
      const outside = !built.sheet.contains(activeEl);
      if (event.shiftKey) {
        if (activeEl === first || activeEl === built.sheet || outside) {
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

    /* 点遮罩关闭：必须在遮罩上按下并抬起，面板内拖动/选字不会误关。 */
    let pressedBackdrop = false;
    built.overlay.addEventListener('pointerdown', (event) => {
      pressedBackdrop = !!(event && event.target === built.overlay);
    }, false);
    built.overlay.addEventListener('pointercancel', () => {
      pressedBackdrop = false;
    }, false);
    built.overlay.addEventListener('click', (event) => {
      const onBackdrop = !!(event && event.target === built.overlay) && pressedBackdrop;
      pressedBackdrop = false;
      if (onBackdrop) close();
    }, false);

    if (!doc.body) return { ok: false, reason: 'ui-unavailable' };
    try {
      doc.body.appendChild(built.overlay);
    } catch (err) {
      return { ok: false, reason: 'ui-unavailable' };
    }

    doc.addEventListener('keydown', onKeyDown, true);

    panel = {
      doc: doc,
      overlay: built.overlay,
      sheet: built.sheet,
      previousFocus: previousFocus,
      onKeyDown: onKeyDown,
      closeBtn: built.closeBtn,
      refresh: built.refresh,
      destroy: built.destroy,
    };
    /* 面板对象确定后再接受内容结果（含假 ctx 的同步返回）。 */
    built.start();

    safelyFocus(built.closeBtn);
    return { ok: true, panel: built.sheet };
  }

  /**
   * 渲染告示板内容。
   * - 面板已打开：原地刷新（不叠层、不抢焦点），返回 sheet；
   * - 面板未打开：构建后返回未挂载的 sheet（可供测试检查 DOM 结构，不产生全局副作用）。
   * @param {object} [ctx]
   * @returns {Element|null}
   */
  function render(ctx) {
    const doc = documentOf();
    if (!doc) return null;
    if (panel && panel.overlay && panel.overlay.parentNode) {
      try {
        panel.refresh(ctx);
      } catch (err) {
        /* ignore */
      }
      return panel.sheet;
    }
    ensureStyle(doc);
    const built = buildPanel(ctx, false);
    if (!built) return null;
    built.start();
    return built.sheet;
  }

  const api = {
    version: VERSION,
    open: open,
    render: render,
    close: close,
  };

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.town = api;
})(typeof window !== 'undefined' ? window : globalThis);
