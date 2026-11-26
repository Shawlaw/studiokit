/*!
 * StudioKit Arcade Life — 旧港告示板（0.16 / D16-01；0.20 首航改版）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.town，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.town.open(ctx);
 *   window.ArcadeCareerUI.town.render(ctx);
 *   window.ArcadeCareerUI.town.close();
 *
 * 首屏只读消费 bridge 传入的 ctx（ADR §18.7 / §20.9）：
 *   originLetter()                   → null 或 {sourceGame, c0Letter: {from, body, address}}
 *   campaign.state(input)            → 章节状态（只用当前章标题/玩家语言提示）
 *   campaign.recommend(input)        → null 或 {commissionId, goal, reason, kind}
 *   commission.listAvailable(input)  → 真实可接单集合（推荐只允许在其中）
 *   commission.continuations(input)  → 可选；live run（issued/active）集合
 * 任一接口缺失、抛错或返回异常时安全回退旧告示板列表，不阻塞接单。
 *
 * 约束：
 * - 覆盖当前页面的轻量浮层（position:fixed，可滚动），按钮 + Esc + 点遮罩关闭；
 * - 关闭后焦点返回打开前的元素；键盘 Tab 可在面板内遍历（不逃逸到游戏页）；
 * - 重复 open 复用同一面板（不重建、不叠层、不因重绘抢走用户焦点）；
 * - 只读 ctx 注入的模块；不读写 IndexedDB / localStorage；不发网络请求；
 * - 全部文案为戏内语言：不显示 C 码、active/locked、长 token、96 条重复时长；
 * - 卡片接单前显示游戏名与 objective.atLeast 的可读目标（无字段时退到 summary）；
 * - 失败优先使用结果里的明确 message，未知原因才兜底；失败提供重接/回告示板路径；
 * - 样式集中在本文件注入的 <style>，按钮 ≥44px，320–430 及紧凑视口可用。
 */
(function (root) {
  'use strict';

  const VERSION = '0.18.0';
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
  const START_LABEL = '接下这单';
  const CONTINUE_LABEL = '继续这张单';
  const STARTING_LABEL = '正在替你登记…';
  const START_OK = '你接下了这张单子，港里给你留了位置。';
  const CONTINUE_OK = '你接着上回那张单子继续。';
  const START_NO_URL = '你接下了单子，但这里找不到去机位的路，要再试一次吗？';
  const START_FAILED = '这次没接上，你想过一会儿再试吗？';
  const HANGAR_LABEL = '去机库';
  const RECEIPT_LABEL = '钱包与收据';
  const SETTINGS_LABEL = '线索提示';
  const MARKET_LABEL = '材料商店';
  const WORKSHOP_LABEL = '制造台';
  const ALT_TITLE = '港务处代办';
  const ALT_EMPTY = '港务处今天没有跑腿的活。';
  const ALT_BUY_LABEL = '请他们代办';
  const FREE_LIST_TITLE = '想自由接单？';
  const RECOMMEND_TITLE = '你想先走这条路吗？';
  const RECOMMEND_KIND_TEXT = { milestone: '能推进这一段', step: '能积攒下一步所需' };
  const RECOMMEND_GOAL_TITLE = '你愿意完成';
  const FIRST_PATROL_ID = 'star-raid.T1';
  const RENTAL_LEAD = '阿砾：标准舰可以免费借。';
  const CAMPAIGN_SUBTITLE = '你想继续哪一段？';
  const INTRO_GOAL = '告示板上钉着今天的活，你想先接哪一张？';
  const CLOSE_LABEL = '收起告示板';
  const HANGAR_FAILED = '机库那边灯还亮着，门暂时没开。';
  const RECEIPT_FAILED = '账房今天没开窗，收据先拿不到。';
  const SETTINGS_FAILED = '线索提示那边暂时没应声。';
  const WALLET_HINT = '工钱和材料记在收据上。';
  const MATERIAL_FALLBACK = { alloy: '合金', crystal: '棱晶' };

  /* kind → 玩家语言的动作短语；只用于 objective.kind + atLeast，不输出内部 kind。 */
  const OBJECTIVE_ACTIONS = {
    'pair.match': '配好 {n} 组牌',
    'tile.created': '合成出 {n} 级方块',
    'hand.settled': '打完 {n} 手牌',
    'move.legal': '落子 {n} 手',
    'session.finish': '完成 {n} 局',
    'foundation.move': '归位 {n} 张牌',
    'stock.face_up': '翻开 {n} 次牌堆',
    'bell.unique': '敲响 {n} 种雪铃',
    'height.reached': '爬到 {n} 层高',
    'brick.destroyed': '打掉 {n} 块砖',
    'stage.clear': '通过 {n} 关',
    'distance.reached': '跑出 {n} 段距离',
    'gravity.flip': '翻转 {n} 次重力',
    'fruit.eaten': '吃到 {n} 个果子',
    'combo.reached': '连中 {n} 次',
    'mole.hit': '敲中 {n} 只地鼠',
    'lines.cleared': '消掉 {n} 行',
    'boss.defeated': '击退 {n} 个头目',
    'wave.completed': '清理 {n} 波来袭',
    'scroll.collected': '找回 {n} 枚卷轴',
    'tower.floor_stable': '稳稳叠到 {n} 层',
    'mineral.returned': '带回 {n} 份矿物',
  };

  /* 游戏 id → 戏内显示名（与 content/registry.json 的 displayName 一致；registry 不可用时兜底）。 */
  const GAME_LABELS = {
    'memory-flip': '记忆翻牌',
    'merge-2048': '2048 合成',
    blackjack: '二十一点',
    gomoku: '五子棋',
    solitaire: '纸牌接龙',
    snowbells: '雪铃',
    'brick-breaker': '砖块计划',
    'gravity-flip': '重力翻转',
    'snake-run': '贪吃蛇',
    'mole-whack': '打地鼠',
    'block-drop': '俄罗斯方块',
    'star-raid': '星海突击',
    'road-rush': '极速车道',
    'shadow-leap': '影跃',
    'pendulum-tower': '层塔',
    'gold-miner': '黄金矿工',
  };

  /* 接单失败 reason → 可归因戏内文本（未知原因使用通用兜底，不暴露系统词）。 */
  const START_FAIL_TEXT = {
    'not-unlocked': '你想接的这张单子还没开放，要不要看看别的？',
    locked: '你想接的这张单子还没开放，要不要看看别的？',
    'already-active': '你手上还有一张没跑完的单子，要先继续它吗？',
    'run-conflict': '你手上还有一张没跑完的单子，要先继续它吗？',
    'run-active': '你手上还有一张没跑完的单子，要先继续它吗？',
    'no-career': '港务处还没记上你的名字，你想先去信箱看看地址吗？',
    'career-missing': '港务处还没记上你的名字，你想先去信箱看看地址吗？',
    'career-unavailable': '港务处还没记上你的名字，你想先去信箱看看地址吗？',
    'db-unavailable': '港务处的册子翻不开，你想过一会儿再试吗？',
    'storage-unavailable': '港务处的册子翻不开，你想过一会儿再试吗？',
    'wallet-missing': '港务处还没给你立账户，你想先去信箱看看地址吗？',
    'run-create-failed': '单子没能登记上，你想过一会儿再试吗？',
    'ticket-failed': '单子没能登记上，你想过一会儿再试吗？',
    'bad-commission-id': '这张单子的字看不清了，你想先看看别的吗？',
    'missing-commission': '这张单子的字看不清了，你想先看看别的吗？',
    'invalid-commission': '这张单子的字看不清了，你想先看看别的吗？',
    'unknown-commission': '这张单子的字看不清了，你想先看看别的吗？',
    'content-unavailable': '告示板今天没把单子备好，你想先看看别的吗？',
    'content-invalid': '告示板今天没把单子备好，你想先看看别的吗？',
    'unsupported-content': '告示板今天没把单子备好，你想先看看别的吗？',
    'core-unavailable': '告示板今天没把单子备好，你想先看看别的吗？',
    exception: '告示板那边卡了一下，你想过一会儿再试吗？',
    'career-archived': '生涯已封存。你想先在生涯设置里解冻吗？',
  };

  const STYLE_TEXT = [
    '.ac-career-town {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '}',
    '.ac-career-town__campaign {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.55);',
    '}',
    '.ac-career-town__campaign .ac-career-town__subtitle {',
    '  margin: 0;',
    '  font-size: 13.5px;',
    '  font-weight: 600;',
    '}',
    '.ac-career-town__scope {',
    '  display: grid;',
    '  gap: 6px;',
    '  min-width: 0;',
    '}',
    '.ac-career-town__free-body > .ac-career-btn {',
    '  align-self: flex-start;',
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
    '.ac-career-town__intro {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.55);',
    '}',
    '.ac-career-town__intro-line,',
    '.ac-career-town__chapter-note {',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12.5px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__intro-line--meta {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11.5px;',
    '}',
    '.ac-career-town__intro-line--role {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-weight: 600;',
    '}',
    '.ac-career-town__free {',
    '  min-width: 0;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.4);',
    '}',
    '.ac-career-town__free > summary {',
    '  display: flex;',
    '  align-items: center;',
    '  min-height: 44px;',
    '  padding: 8px 10px;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12.5px;',
    '  font-weight: 600;',
    '  cursor: pointer;',
    '  list-style-position: inside;',
    '}',
    '[data-town-flight] > summary::before {',
    '  content: "▸";',
    '  margin-inline-end: 6px;',
    '}',
    '[data-town-flight][open] > summary::before {',
    '  content: "▾";',
    '}',
    '.ac-career-town__free > summary:focus-visible {',
    '  outline: 2px solid var(--ac-career-line, #2a3560);',
    '  outline-offset: 2px;',
    '}',
    '.ac-career-town__free-body {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  padding: 0 10px 10px;',
    '}',
    '.ac-career-town__row--recommend {',
    '  border-color: var(--ac-career-ink, #eef1ff);',
    '  background: rgba(255, 210, 63, 0.08);',
    '}',
    '.ac-career-town__row-heading {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 2px 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-town__row-tag {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11.5px;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-town__retry {',
    '  align-self: flex-start;',
    '  min-height: 44px;',
    '  padding: 8px 12px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 8px;',
    '  background: transparent;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font: inherit;',
    '  font-size: 12px;',
    '  cursor: pointer;',
    '}',
    '.ac-career-town__retry:focus-visible {',
    '  outline: 2px solid var(--ac-career-ink, #eef1ff);',
    '  outline-offset: 2px;',
    '}',
    '.ac-career-town__back {',
    '  align-self: flex-start;',
    '  min-height: 44px;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  padding: 8px 12px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '}',
    '.ac-career-town__back:focus-visible {',
    '  outline: 2px solid var(--ac-career-ink, #eef1ff);',
    '  outline-offset: 2px;',
    '}',
    '.ac-career-town__more {',
    '  min-width: 0;',
    '  flex: 1 1 120px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.4);',
    '}',
    '.ac-career-town__more > summary {',
    '  display: flex;',
    '  align-items: center;',
    '  min-height: 44px;',
    '  padding: 8px 10px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  cursor: pointer;',
    '}',
    '.ac-career-town__more > summary:focus-visible {',
    '  outline: 2px solid var(--ac-career-ink, #eef1ff);',
    '  outline-offset: 2px;',
    '}',
    '.ac-career-town__more-body {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  padding: 0 10px 10px;',
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
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function idText(value) {
    return cleanText(value).replace(/\s+/g, '');
  }

  function numberOrZero(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  function rootWindow() {
    return typeof window !== 'undefined' && window ? window : null;
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

  /** 节点自身及所有祖先都必须可见：排除 hidden、closed details、display:none 与零矩形。 */
  function isVisibleInTree(node, scope) {
    for (let cur = node; cur; cur = cur.parentNode) {
      if (cur.hidden === true) return false;
      if (typeof cur.getAttribute === 'function' && cur.getAttribute('aria-hidden') === 'true') return false;
      if (cur.tagName === 'DETAILS' && cur.open !== true && !(node.tagName === 'SUMMARY' && node.parentNode === cur)) return false;
      if (typeof cur.getAttribute === 'function') {
        const style = cleanText(cur.getAttribute('style')).toLowerCase();
        if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style)) return false;
      }
      if (cur === scope) break;
    }
    if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) return false;
    return true;
  }

  function focusableIn(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return [];
    const nodes = scope.querySelectorAll('button, [href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || node.disabled) continue;
      if (typeof node.closest === 'function' && node.closest('[hidden]')) continue;
      if (!isVisibleInTree(node, scope)) continue;
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
   * 这里再做一次仅内存的幂等兜底（不写 IndexedDB / localStorage）。
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

  /** objective.kind + atLeast → 玩家语言；不显示内部 kind 字符串。 */
  function objectiveTextOf(objective) {
    if (!isObject(objective)) return '';
    const atLeast = numberOrZero(objective.atLeast);
    if (!atLeast) return '';
    const template = OBJECTIVE_ACTIONS[cleanText(objective.kind)];
    return template ? template.replace('{n}', String(atLeast)) : '';
  }

  /** 从多个真实来源取游戏名；registry 是 window.ArcadeCareer.registry / ctx.registry 的可选实例。 */
  function gameNameOf(gameId, context) {
    const id = idText(gameId);
    if (!id) return '';
    const bundle = isObject(context) ? context : null;
    const api = bundle && isObject(bundle.api) ? bundle.api : null;
    const win = rootWindow();
    const career = win && isObject(win.ArcadeCareer) ? win.ArcadeCareer : null;
    const registries = [
      bundle && bundle.registry,
      api && api.registry,
      career && career.registry,
      win && win.ArcadeCareerRegistry,
    ];
    for (let i = 0; i < registries.length; i += 1) {
      const registry = registries[i];
      if (!registry) continue;
      if (typeof registry.getGame === 'function') {
        try {
          const game = registry.getGame(id);
          const name = game && (cleanText(game.displayName) || cleanText(game.name));
          if (name) return name;
        } catch (err) {
          /* 继续回退 */
        }
      }
      if (typeof registry.listGames === 'function') {
        try {
          const games = registry.listGames();
          if (Array.isArray(games)) {
            for (let j = 0; j < games.length; j += 1) {
              if (!isObject(games[j])) continue;
              if (idText(games[j].gameId || games[j].id) !== id) continue;
              const name = cleanText(games[j].displayName || games[j].name || games[j].title);
              if (name) return name;
            }
          }
        } catch (err) {
          /* 继续回退 */
        }
      }
      /* registry 内容对象：games 为数组或以 id 为键的映射。 */
      const games = registry.games;
      if (Array.isArray(games)) {
        for (let j = 0; j < games.length; j += 1) {
          if (!isObject(games[j])) continue;
          if (idText(games[j].gameId || games[j].id) !== id) continue;
          const name = cleanText(games[j].displayName || games[j].name || games[j].title);
          if (name) return name;
        }
      } else if (isObject(games) && isObject(games[id])) {
        const name = cleanText(games[id].displayName || games[id].name || games[id].title);
        if (name) return name;
      }
    }
    if (Object.prototype.hasOwnProperty.call(GAME_LABELS, id)) return GAME_LABELS[id];
    return '';
  }

  function commissionRowsOf(context) {
    const bundle = context && isObject(context.commissions) ? context.commissions : null;
    const raw = bundle && Array.isArray(bundle.commissions) ? bundle.commissions : [];
    const rows = [];
    raw.forEach((entry) => {
      if (!isObject(entry)) return;
      const commissionId = idText(entry.commissionId);
      if (!commissionId) return;
      const gameId = idText(entry.gameId);
      rows.push({
        commissionId: commissionId,
        gameId: gameId,
        gameName: cleanText(entry.gameName) || gameNameOf(gameId, context),
        title: cleanText(entry.title) || '未命名的单子',
        summary: cleanText(entry.summary),
        issuer: cleanText(entry.issuer),
        objective: isObject(entry.objective) ? entry.objective : null,
        rewardText: rewardTextOf(entry.reward, materialNamesOf(context)),
      });
    });
    return rows;
  }

  function arrivalLineOf(context) {
    const state = context.state;
    if (!isObject(state) || !state.portSeenAt) return '';
    const arrival = context.chapterZero && context.chapterZero.arrival;
    const fallback = cleanText(arrival && arrival.body) || '旧物已经收下了。';
    if (typeof context.originLetter !== 'function') return fallback;
    /* 投递只保存到港时间。多来源档案里的首封信可能不是实际投递的那封。 */
    const sourceGames = new Set(Object.values(isObject(state.clues) ? state.clues : {})
      .map((clue) => clue && idText(clue.sourceGame)).filter(Boolean));
    if (sourceGames.size !== 1) return fallback;
    let origin = null;
    try {
      origin = context.originLetter();
    } catch (err) {
      return fallback;
    }
    if (!isObject(origin) || !sourceGames.has(origin.sourceGame) || !isObject(origin.c0Letter)) return fallback;
    const sender = cleanText(origin.c0Letter.from);
    const body = cleanText(origin.c0Letter.body);
    const firstSentence = body.match(/^[^。！？]+[。！？]/);
    return sender && firstSentence ? sender + '：' + firstSentence[0] : fallback;
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
    if (result.ok === false) return null;
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

  /** continuations → {commissionId: run}；只保留 issued/active 且非 ending.* 的真实委托单。 */
  function normalizeContinuations(result) {
    const out = Object.create(null);
    if (!isObject(result) || result.ok === false || !Array.isArray(result.runs)) return out;
    result.runs.forEach((run) => {
      if (!isObject(run)) return;
      const id = idText(run.commissionId);
      const status = cleanText(run.status).toLowerCase();
      if (!id || /^ending\./i.test(id)) return;
      if (status !== 'issued' && status !== 'active') return;
      out[id] = {
        commissionId: id,
        runId: cleanText(run.runId),
        gameId: idText(run.gameId),
        status: status,
      };
    });
    return out;
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

  function failureTextOf(result, fallback) {
    const explicit = isObject(result) ? cleanText(result.message) : '';
    if (explicit && !/^[a-z][a-z0-9._-]{6,}$/i.test(explicit)) return explicit;
    const reason = isObject(result) ? (cleanText(result.reason) || cleanText(result.error)).toLowerCase() : '';
    return START_FAIL_TEXT[reason] || fallback;
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

    const introSection = make('section', 'ac-career-town__intro');
    introSection.setAttribute('data-town-intro', 'true');
    const introRole = make('p', 'ac-career-town__intro-line ac-career-town__intro-line--role');
    introRole.setAttribute('data-town-role', 'true');
    introRole.hidden = true;
    const introGreeting = make('p', 'ac-career-town__intro-line');
    introGreeting.setAttribute('data-town-arrival', 'true');
    const introGoal = make('p', 'ac-career-town__intro-line');
    introSection.appendChild(introGreeting);
    introSection.appendChild(introRole);
    introSection.appendChild(introGoal);

    const notice = make('p', 'ac-career-town__notice', BOARD_UNAVAILABLE);
    notice.hidden = true;

    const wallet = make('div', 'ac-career-town__wallet');
    const walletLabel = make('span', 'ac-career-town__wallet-label', '随身：');
    const walletValue = make('span', 'ac-career-town__wallet-value', WALLET_HINT);
    wallet.appendChild(walletLabel);
    wallet.appendChild(walletValue);

    /* 首屏推荐：一张卡片（真实 availableIds 内），其余委托折叠。 */
    const recommendList = make('ul', 'ac-career-town__list ac-career-town__recommend-list');
    recommendList.setAttribute('data-town-recommend', 'true');
    recommendList.hidden = true;

    const scope = make('div', 'ac-career-town__scope');
    scope.setAttribute('data-town-scope', 'true');
    const flightDetails = make('details', 'ac-career-town__free');
    flightDetails.setAttribute('data-town-flight', 'true');
    flightDetails.hidden = true;
    flightDetails.appendChild(make('summary', null, '看看出航'));
    const flightBody = make('div', 'ac-career-town__free-body');
    const flightRental = make('p', 'ac-career-town__intro-line ac-career-town__intro-line--meta');
    flightRental.setAttribute('data-town-rental', 'true');
    const flightList = make('ul', 'ac-career-town__list');
    flightBody.appendChild(flightRental);
    flightBody.appendChild(flightList);
    flightDetails.appendChild(flightBody);
    scope.appendChild(flightDetails);
    const freeDetails = make('details', 'ac-career-town__free');
    freeDetails.setAttribute('data-town-free', 'true');
    freeDetails.open = false;
    const freeSummary = make('summary', null, FREE_LIST_TITLE);
    const freeList = make('ul', 'ac-career-town__list');
    freeList.setAttribute('data-town-free-list', 'true');
    const freeBody = make('div', 'ac-career-town__free-body');
    freeDetails.appendChild(freeSummary);
    freeDetails.appendChild(freeBody);
    freeBody.appendChild(freeList);
    scope.appendChild(freeDetails);

    const empty = make('p', 'ac-career-town__empty', LIST_EMPTY);
    empty.hidden = true;

    /* 0.16 非战斗代办（alternatives.js）：明码标价、只扣费，不产生战斗奖章。 */
    const altHeading = make('h3', 'ac-career-town__subtitle', ALT_TITLE);
    const altList = make('ul', 'ac-career-town__list ac-career-town__alts');
    const altEmpty = make('p', 'ac-career-town__empty', ALT_EMPTY);
    altEmpty.hidden = true;

    const statusLine = make('p', 'ac-career-status');
    statusLine.hidden = true;
    const backLink = make('a', 'ac-career-town__back', '回告示板');
    backLink.href = '#';
    backLink.hidden = true;
    backLink.setAttribute('data-town-action', 'back-to-board');
    backLink.addEventListener('click', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      setStatus('');
      showStatusRetry(null);
      safelyFocus(freeSummary);
    }, false);

    /* 0.18 章节/终局只读卡：只显示当前章，不提前列出后续章节标题。 */
    const campaignSection = make('section', 'ac-career-town__campaign');
    campaignSection.setAttribute('data-town-campaign', 'true');
    campaignSection.hidden = true;
    const campaignHeading = make('h3', 'ac-career-town__subtitle', CAMPAIGN_SUBTITLE);
    const campaignCurrent = make('p', 'ac-career-town__campaign-current ac-career-town__chapter-note');
    const campaignEndings = make('div', 'ac-career-town__campaign-endings');
    campaignSection.appendChild(campaignHeading);
    campaignSection.appendChild(campaignCurrent);
    campaignSection.appendChild(campaignEndings);

    /* 机库属于出航选项；商店和制造台收进「港口其它去处」。 */
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
    const more = make('details', 'ac-career-town__more');
    more.setAttribute('data-town-more', 'true');
    more.open = false;
    const moreSummary = make('summary', null, '港口其它去处');
    more.appendChild(moreSummary);
    const moreBody = make('div', 'ac-career-town__more-body');
    const marketBtn = make('button', 'ac-career-btn ac-career-btn--ghost', MARKET_LABEL);
    marketBtn.type = 'button';
    marketBtn.setAttribute('data-town-action', 'market');
    const workshopBtn = make('button', 'ac-career-btn ac-career-btn--ghost', WORKSHOP_LABEL);
    workshopBtn.type = 'button';
    workshopBtn.setAttribute('data-town-action', 'workshop');
    moreBody.appendChild(marketBtn);
    moreBody.appendChild(workshopBtn);
    more.appendChild(moreBody);
    flightBody.appendChild(hangarBtn);
    footer.appendChild(receiptBtn);
    footer.appendChild(settingsBtn);
    footer.appendChild(more);

    townView.appendChild(introSection);
    townView.appendChild(location);
    townView.appendChild(notice);
    townView.appendChild(campaignSection);
    townView.appendChild(recommendList);
    townView.appendChild(scope);
    townView.appendChild(empty);
    townView.appendChild(wallet);
    townView.appendChild(altHeading);
    townView.appendChild(altList);
    townView.appendChild(altEmpty);
    townView.appendChild(statusLine);
    townView.appendChild(backLink);
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
    let unlockedSet = null;
    let continuations = Object.create(null);
    let failedStart = null;
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

    /** 失败后给一键重接按钮（仍走 commission.start）与回告示板链接。 */
    function showStatusRetry(failed) {
      failedStart = failed;
      if (!failed) {
        backLink.hidden = true;
        return;
      }
      backLink.hidden = false;
    }

    function actionButton(row, continuing, recommended) {
      const button = make('button', 'ac-career-btn ac-career-btn--primary', continuing ? CONTINUE_LABEL : START_LABEL);
      button.type = 'button';
      button.setAttribute('data-town-action', 'start');
      button.setAttribute('data-commission-id', row.commissionId);
      if (continuing) button.setAttribute('data-town-continuing', 'true');
      /* 首屏主动作的稳定选择器：E2E/触控无需用易与折叠列表重名的 commissionId 定位。 */
      if (recommended) button.setAttribute('data-town-recommend-start', 'true');
      button.setAttribute('aria-label', (continuing ? '继续「' : '接下「') + row.title + '」');
      return button;
    }

    function rowGoalText(row) {
      return objectiveTextOf(row.objective) || row.summary || '到告示板看看这张单子的要求。';
    }

    /** renderRow：严格要求真实 DOM（make 创建）；classList 可用，不手写 className 比较。 */
    function renderRow(row, boardReady, options) {
      const opts = isObject(options) ? options : {};
      const item = make('li', 'ac-career-town__row');
      item.setAttribute('data-commission-id', row.commissionId);
      if (opts.recommended && typeof item.classList.add === 'function') {
        item.classList.add('ac-career-town__row--recommend');
        item.setAttribute('data-town-recommend-id', row.commissionId);
      }
      /* 目标属性供测试/读屏定位：始终是带游戏名的完整世界目标，不用委托标题兜底。 */
      const fullGoalText = (row.gameName ? row.gameName + '：' : '') + rowGoalText(row);
      item.setAttribute('data-town-goal', fullGoalText);
      if (opts.kindText) {
        /* E2E 用 data-town-recommend-kind 判定 milestone/step；值保持玩家语言，
           保留 data-town-kind 兼容旧选择器（文案不变）。 */
        if (opts.recommended) item.setAttribute('data-town-recommend-kind', opts.kindText);
        item.setAttribute('data-town-kind', opts.kindText);
      }
      if (opts.reason) item.setAttribute('data-town-reason', opts.reason);
      if (opts.gameName) item.setAttribute('data-town-game', opts.gameName);

      if (opts.recommended) {
        const heading = make('div', 'ac-career-town__row-heading');
        heading.appendChild(make('span', 'ac-career-town__row-tag', RECOMMEND_TITLE));
        if (opts.kindText) heading.appendChild(make('span', 'ac-career-town__row-tag', opts.kindText));
        if (row.gameName) heading.appendChild(make('span', 'ac-career-town__row-tag', row.gameName));
        item.appendChild(heading);
      }

      const rowHead = make('div', 'ac-career-town__row-head');
      const title = make('h3', 'ac-career-town__row-title', opts.titleOverride || row.title);
      rowHead.appendChild(title);
      if (row.issuer) rowHead.appendChild(make('span', 'ac-career-town__row-issuer', row.issuer));
      item.appendChild(rowHead);

      /* 每张卡接单前只显示一行完整目标（带游戏名 + objective.atLeast 可读数量）。
         推荐卡不重复目标行；推荐理由单独一行。 */
      item.appendChild(make('p', 'ac-career-town__row-summary',
        opts.recommended ? RECOMMEND_GOAL_TITLE + '：' + fullGoalText : fullGoalText));
      if (opts.recommended && opts.reason) {
        item.appendChild(make('p', 'ac-career-town__row-summary', opts.reason));
      }

      const meta = make('p', 'ac-career-town__row-meta');
      if (row.rewardText) meta.appendChild(make('span', 'ac-career-town__reward', row.rewardText));
      if (meta.childNodes.length) item.appendChild(meta);

      const actions = make('div', 'ac-career-town__row-actions');
      const live = !!continuations[row.commissionId];
      const unlocked = boardReady && !!unlockedSet && !!unlockedSet[row.commissionId];
      /* 继续按钮必须同时满足：真实解锁 + 真实 live run；未解锁的 run 只显示锁定态。 */
      const continuing = unlocked && live;
      if (unlocked) {
        actions.appendChild(actionButton(row, continuing, !!opts.recommended));
      } else {
        actions.appendChild(make('span', 'ac-career-town__locked', LOCKED_LABEL));
      }
      item.appendChild(actions);

      /* 失败后对该单保留一键重接（同一 commissionId，仍走 commission.start）。 */
      if (failedStart === row.commissionId && unlocked) {
        const retry = make('button', 'ac-career-town__retry', CONTINUE_LABEL);
        retry.type = 'button';
        retry.setAttribute('data-town-action', 'retry');
        retry.setAttribute('data-commission-id', row.commissionId);
        actions.appendChild(retry);
      }
      return item;
    }

    function rentalHintOf() {
      const items = isObject(liveContext && liveContext.items) ? liveContext.items : null;
      const ships = items && Array.isArray(items.ships) ? items.ships : [];
      for (let i = 0; i < ships.length; i += 1) {
        const ship = ships[i];
        if (!isObject(ship) || ship.rental !== true) continue;
        const name = cleanText(ship.name || ship.shipId);
        return name ? '阿砾：「' + name + '」租机免费。' : RENTAL_LEAD;
      }
      return RENTAL_LEAD;
    }

    function currentChapterView() {
      const campaign = isObject(liveContext && liveContext.campaign) ? liveContext.campaign : null;
      if (!campaign || typeof campaign.state !== 'function') return null;
      let model = null;
      try {
        model = campaign.state({
          quests: Array.isArray(liveContext.quests) ? liveContext.quests : [],
          claims: Array.isArray(liveContext.claims) ? liveContext.claims : [],
          profile: liveContext.profile || null,
          wallet: liveContext.wallet || null,
        });
      } catch (err) {
        return null;
      }
      if (!isObject(model) || model.ok === false || !Array.isArray(model.chapters)) return null;
      const chapters = model.chapters;
      const currentId = isObject(model.currentChapter)
        ? idText(model.currentChapter.chapterId)
        : idText(model.currentChapter);
      const current = chapters.filter((chapter) => isObject(chapter) && chapter.chapterId === currentId)[0]
        || chapters.filter((chapter) => isObject(chapter) && chapter.state === 'active')[0]
        || null;
      return { model: model, current: current };
    }

    function currentGoalText() {
      const view = currentChapterView();
      if (!view || !view.current) return '';
      const routes = Array.isArray(view.current.routes) ? view.current.routes : [];
      for (let i = 0; i < routes.length; i += 1) {
        const hint = cleanText(routes[i] && routes[i].hint);
        if (hint) return hint;
      }
      const mustKnow = Array.isArray(view.current.mustKnow) ? view.current.mustKnow : [];
      for (let i = 0; i < mustKnow.length; i += 1) {
        const text = cleanText(isObject(mustKnow[i]) ? (mustKnow[i].text || mustKnow[i].label) : mustKnow[i]);
        if (text) return text;
      }
      return '';
    }

    /**
     * 首航身份只显示一行。优先 C0 章节内容（到港后 currentChapter 已是 C1，
     * 角色句仍在 chapter-00 的 role 字段）；再按其它真实字段回退，缺字段则隐藏。
     */
    function roleTextOf() {
      const candidates = [];
      const zero = isObject(liveContext && liveContext.chapterZero) ? liveContext.chapterZero : null;
      if (zero) candidates.push(zero.role);
      const chapters = isObject(liveContext && liveContext.chapters) ? liveContext.chapters : null;
      if (chapters && isObject(chapters.C0)) candidates.push(chapters.C0.role);
      const view = currentChapterView();
      if (view && view.current) candidates.push(view.current.role);
      if (view && view.model) candidates.push(view.model.role);
      const chapter = isObject(liveContext && liveContext.chapter) ? liveContext.chapter : null;
      if (chapter) candidates.push(chapter.role);
      for (let i = 0; i < candidates.length; i += 1) {
        const text = cleanText(candidates[i]);
        if (text) return text;
      }
      return '';
    }

    function renderOrigin() {
      const arrival = arrivalLineOf(liveContext);
      introGreeting.textContent = arrival;
      introGreeting.hidden = !arrival;
      location.hidden = !!arrival;
      const role = roleTextOf();
      introRole.textContent = role;
      introRole.hidden = !role;
      introGoal.textContent = '眼下：' + (currentGoalText() || INTRO_GOAL);
    }

    /**
     * 推荐只消费 ctx.campaign.recommend 与真实 unlockedSet；
     * 推荐 id 必须在 availableIds 内，不推荐锁定单；接口缺失返回 null 由旧列表兜底。
     */
    function recommendedSuggestionOf() {
      const campaign = isObject(liveContext && liveContext.campaign) ? liveContext.campaign : null;
      if (!campaign || typeof campaign.recommend !== 'function' || !unlockedSet) return null;
      let suggestion = null;
      try {
        suggestion = campaign.recommend({
          quests: Array.isArray(liveContext.quests) ? liveContext.quests : [],
          claims: Array.isArray(liveContext.claims) ? liveContext.claims : [],
          profile: liveContext.profile || null,
          wallet: liveContext.wallet || null,
          availableIds: Object.keys(unlockedSet),
          storyEvidence: liveContext.storyEvidence || null,
        });
      } catch (err) {
        return null;
      }
      if (!isObject(suggestion) || suggestion.ok === false) return null;
      let id = idText(suggestion.commissionId);
      if (id && !unlockedSet[id]) id = '';
      if (!id) return null;
      const row = commissionRowsOf(liveContext).filter((entry) => entry.commissionId === id)[0] || null;
      if (!row) return null;
      /* 首屏目标是世界内目标（游戏名 + objective.atLeast 可读数量），
         不用 campaign.recommend.goal（常为委托标题，会与卡片标题重复）。 */
      const worldGoal = rowGoalText(row);
      const hasObjective = !!(row.objective && numberOrZero(row.objective.atLeast));
      return {
        row: row,
        goal: hasObjective ? worldGoal : (cleanText(suggestion.goal) || worldGoal),
        reason: cleanText(suggestion.reason),
        kindText: RECOMMEND_KIND_TEXT[cleanText(suggestion.kind)] || '路线进展',
      };
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

    function renderCampaign() {
      const view = currentChapterView();
      if (!view || !view.current) {
        campaignSection.hidden = true;
        return;
      }
      campaignSection.hidden = false;
      /* 只显示当前章的戏内标题，不显示 C 码、状态词或后续章节标题。 */
      campaignCurrent.textContent = cleanText(view.current.title) || '旧港来信';
      campaignCurrent.setAttribute('data-town-current', idText(view.current.chapterId));
      campaignEndings.textContent = '';
      const endings = Array.isArray(view.model.endings) ? view.model.endings : [];
      endings.forEach((ending) => {
        if (!isObject(ending) || ending.available !== true) return;
        const button = make('button', 'ac-career-btn ac-career-btn--primary',
          '去往结局 · ' + (cleanText(ending.title) || '未命名的路'));
        button.type = 'button';
        button.setAttribute('data-town-ending', cleanText(ending.approach));
        button.addEventListener('click', function () {
          if (typeof liveContext.startEnding !== 'function') return;
          try { liveContext.startEnding(ending.approach); } catch (err) { /* ignore */ }
        }, false);
        campaignEndings.appendChild(button);
      });
    }

    function renderList() {
      while (recommendList.firstChild) recommendList.removeChild(recommendList.firstChild);
      while (flightList.firstChild) flightList.removeChild(flightList.firstChild);
      while (freeList.firstChild) freeList.removeChild(freeList.firstChild);

      const allRows = commissionRowsOf(liveContext);
      const boardReady = !!unlockedSet;
      const suggestion = boardReady ? recommendedSuggestionOf() : null;

      /* 有 live run 的同委托优先作为推荐（仍要求已解锁）。 */
      let liveId = '';
      if (boardReady) {
        for (let i = 0; i < allRows.length; i += 1) {
          if (continuations[allRows[i].commissionId] && unlockedSet[allRows[i].commissionId]) {
            liveId = allRows[i].commissionId;
            break;
          }
        }
      }

      const mainRow = liveId
        ? allRows.filter((row) => row.commissionId === liveId)[0]
        : suggestion ? suggestion.row : null;
      if (mainRow) {
        const opts = {
          recommended: true,
          gameName: mainRow.gameName,
          titleOverride: liveId ? '继续这张单：' + mainRow.title : '眼下先做：' + mainRow.title,
          goalOverride: suggestion && suggestion.row.commissionId === mainRow.commissionId ? suggestion.goal : '',
          kindText: suggestion && suggestion.row.commissionId === mainRow.commissionId ? suggestion.kindText : '能积攒下一步所需',
          reason: suggestion && suggestion.row.commissionId === mainRow.commissionId ? suggestion.reason : '',
        };
        recommendList.appendChild(renderRow(mainRow, boardReady, opts));
        recommendList.hidden = false;
      } else {
        recommendList.hidden = true;
      }

      const patrol = boardReady && unlockedSet[FIRST_PATROL_ID]
        ? allRows.find((row) => row.commissionId === FIRST_PATROL_ID) : null;
      const showPatrol = patrol && (!mainRow || mainRow.commissionId !== FIRST_PATROL_ID);
      if (showPatrol) flightList.appendChild(renderRow(patrol, boardReady, {}));
      flightList.hidden = !showPatrol;
      hangarBtn.hidden = typeof openerOf(liveContext, 'openHangar') !== 'function';
      flightDetails.hidden = !patrol && hangarBtn.hidden;
      flightRental.textContent = rentalHintOf();

      const mainId = mainRow ? mainRow.commissionId : '';
      const rows = boardReady
        ? allRows.filter((row) => unlockedSet[row.commissionId] && row.commissionId !== mainId && row.commissionId !== FIRST_PATROL_ID)
        : [];
      rows.forEach((row) => freeList.appendChild(renderRow(row, boardReady, {})));
      const hasRows = rows.length > 0;
      freeList.hidden = !hasRows;
      freeDetails.hidden = !hasRows;
      empty.hidden = hasRows || !boardReady || !!mainRow;
    }

    function loadContinuations(seq) {
      continuations = Object.create(null);
      const commission = commissionOf(liveContext);
      const provider = (commission && typeof commission.continuations === 'function' && commission.continuations)
        || (typeof liveContext.careerContinuations === 'function' && liveContext.careerContinuations);
      if (!provider || !careerIdOf(liveContext)) return;
      let result = null;
      try {
        result = provider.call(commission || liveContext, { careerId: careerIdOf(liveContext) });
      } catch (err) {
        return;
      }
      const apply = (value, failed) => {
        if (!isCurrent() || seq !== requestSeq) return;
        continuations = normalizeContinuations(value);
        /* 仅重绘列表；不重建面板，不让用户焦点丢失。 */
        renderList();
        if (failed) {
          const text = '港里一时查不到进行中的单子，能接的单还挂在木牌上。';
          statusLine.textContent = text;
          statusLine.hidden = false;
        }
      };
      const reject = () => apply(null, true);
      if (result && typeof result.then === 'function') {
        result.then((value) => apply(value, !!(value && value.ok === false)), reject);
        return;
      }
      apply(result, !!(result && result.ok === false));
    }

    function loadUnlocks() {
      requestSeq += 1;
      const seq = requestSeq;
      const commission = commissionOf(liveContext);
      if (!commission) {
        unlockedSet = null;
        applyUnlocked(null);
        return;
      }
      ensureCommissionContent(commission, liveContext);
      if (typeof commission.listAvailable !== 'function') {
        unlockedSet = null;
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
        unlockedSet = normalizeUnlocked(value);
        applyUnlocked(unlockedSet);
        loadContinuations(seq);
        renderAlternatives();
      };
      if (result && typeof result.then === 'function') {
        result.then(settle, () => settle(null));
        return;
      }
      settle(result);
    }

    function applyUnlocked(next, initial) {
      /* initial：先画「暂未开放」占位，不立刻报「暂不可用」，等 listAvailable 结果再决定。 */
      setNotice(next || initial ? '' : BOARD_UNAVAILABLE);
      renderList();
      if (next) renderWallet();
    }

    function renderAlternatives() {
      const alt = liveContext && liveContext.alternatives ? liveContext.alternatives : null;
      while (altList.firstChild) altList.removeChild(altList.firstChild);
      if (!alt || typeof alt.listOffers !== 'function') {
        altHeading.hidden = true;
        altList.hidden = true;
        altEmpty.hidden = true;
        return;
      }
      altHeading.hidden = false;
      let result = null;
      try {
        result = alt.listOffers({ careerId: careerIdOf(liveContext) });
      } catch (err) {
        result = null;
      }
      const apply = (value) => {
        if (!isCurrent()) return;
        while (altList.firstChild) altList.removeChild(altList.firstChild);
        const offers = value && Array.isArray(value.offers) ? value.offers : [];
        offers.forEach((offer) => {
          if (!offer || typeof offer.offerId !== 'string') return;
          const item = make('li', 'ac-career-town__row');
          const info = make('div', 'ac-career-town__row-main');
          info.appendChild(make('strong', 'ac-career-town__row-title', String(offer.title || offer.offerId)));
          const cost = offer.cost && typeof offer.cost === 'object' ? offer.cost : {};
          const pieces = [];
          if (cost.credits) pieces.push(cost.credits + ' 信用点');
          if (cost.items && typeof cost.items === 'object') {
            Object.keys(cost.items).forEach((key) => pieces.push(cost.items[key] + ' ' + (materialNames[key] || key)));
          }
          info.appendChild(make('span', 'ac-career-town__row-meta', pieces.length ? '工本：' + pieces.join(' + ') : '不用工本'));
          if (offer.summary) info.appendChild(make('span', 'ac-career-town__row-summary', String(offer.summary)));
          const actions = make('div', 'ac-career-town__row-actions');
          const button = make('button', 'ac-career-btn', ALT_BUY_LABEL);
          button.type = 'button';
          button.setAttribute('data-alt-offer', offer.offerId);
          button.disabled = offer.alreadyDone === true || offer.affordable === false;
          button.addEventListener('click', () => buyAlternative(offer, button));
          actions.appendChild(button);
          item.appendChild(info);
          item.appendChild(actions);
          altList.appendChild(item);
        });
        altList.hidden = offers.length === 0;
        altEmpty.hidden = offers.length > 0;
      };
      if (result && typeof result.then === 'function') result.then(apply, () => apply(null));
      else apply(result);
    }

    function buyAlternative(offer, button) {
      const alt = liveContext && liveContext.alternatives ? liveContext.alternatives : null;
      if (!alt || typeof alt.buy !== 'function' || !offer) return;
      if (button) button.disabled = true;
      setStatus('正在跟港务处登记…');
      let result = null;
      try {
        result = alt.buy({ careerId: careerIdOf(liveContext), offerId: offer.offerId });
      } catch (err) {
        result = null;
      }
      const done = (value) => {
        if (!isCurrent()) return;
        if (value && value.ok === true) {
          setStatus(cleanText(value.message) || '这单记在港务处账上了。');
          announce(cleanText(value.message) || '这单记在港务处账上了。');
          renderWallet();
          renderAlternatives();
          return;
        }
        if (button) button.disabled = false;
        /* 优先结果里的明确说明（尤其「钱已扣、旗标未记」），未知原因才兜底。 */
        const text = failureTextOf(value, '这单没办成，港务处说再试一次。');
        setStatus(text);
        announce(text);
        if (value && value.retryable === true) button.disabled = false;
      };
      if (result && typeof result.then === 'function') result.then(done, () => done(null));
      else done(result);
    }

    function restoreButton(button) {
      if (!button) return;
      button.disabled = false;
      button.textContent = START_LABEL;
    }

    function settleStart(result, button, commissionId, wasContinuing) {
      delete startingIds[commissionId];
      const failed = !result || (isObject(result) && result.ok === false);
      if (failed) {
        restoreButton(button);
        const text = failureTextOf(result, START_FAILED);
        setStatus(text);
        announce(text);
        showStatusRetry(commissionId);
        renderList();
        return;
      }
      setStatus(wasContinuing && result && result.reused === true ? CONTINUE_OK : START_OK);
      announce(wasContinuing && result && result.reused === true ? CONTINUE_OK : START_OK);
      showStatusRetry(null);
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
      const wasContinuing = !!continuations[id];
      startingIds[id] = true;
      if (button) {
        button.disabled = true;
        button.textContent = STARTING_LABEL;
      }
      setStatus('');
      showStatusRetry(null);
      let result = null;
      try {
        result = commission.start({ commissionId: id, careerId: careerIdOf(liveContext) });
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => settleStart(value, button, id, wasContinuing),
          () => settleStart(null, button, id, wasContinuing)
        );
        return;
      }
      settleStart(result, button, id, wasContinuing);
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
      if (action === 'start' || action === 'retry') {
        startCommission(target.getAttribute('data-commission-id'), target);
        return;
      }
      if (action === 'back-to-board') return;
      if (action === 'hangar') {
        openOther('openHangar', HANGAR_FAILED);
        return;
      }
      if (action === 'market') {
        openOther('openMarket', '材料商店还没开门。');
        return;
      }
      if (action === 'workshop') {
        openOther('openWorkshop', '制造台还没通电。');
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
      showStatusRetry(null);
      renderOrigin();
      renderCampaign();
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
     * 同步返回的 listAvailable / getWallet 结果必须等到「当前面板」确定后才被接受。
     */
    function start() {
      applyUnlocked(null, true);
      renderOrigin();
      renderWallet();
      renderCampaign();
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
      /* 只处理最上层面板的键盘事件；下层面板不抢 Esc/Tab。 */
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
