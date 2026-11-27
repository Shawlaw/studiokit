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
 * 0.22 的统一披露入口（ADR §23.3）：
 *   ctx.careerView({surface:'work'})  → 唯一工作列表来源（已投影的公开字段）
 *   ctx.commission.listAvailable({careerId, ensure:false, surface:'work'})
 *                                    → 核心授权集合；只取交集，不反向扩张
 *   view.story.nextAction             → 眼下主卡
 * 任一接口缺失、抛错或返回异常时只显示自然空状态，不回退完整目录、不建身份。
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
  const PAUSED_LIST_TITLE = '先收着的职业';
  const RECOMMEND_TITLE = '你想先走这条路吗？';
  const RECOMMEND_KIND_TEXT = { milestone: '能推进这一段', step: '能积攒下一步所需' };
  const RECOMMEND_GOAL_TITLE = '你愿意完成';
  const DATA_CLOSE_REASONS = ['career-archived', 'career-reset', 'career-imported'];
  const REASON_CODES = [
    'not-discovered', 'not-read', 'not-accepted', 'paused', 'wrong-surface',
    'world-locked', 'story-locked', 'not-available', 'historical-only',
    'archived', 'unknown-profession', 'unknown-commission', 'future-version',
  ];
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

  /** 冻结 reason code 只供诊断；任何代码样式字符串都不进入玩家文案。 */
  function safePlayerReason(value) {
    const text = cleanText(value);
    if (!text) return '';
    const lower = text.toLowerCase();
    if (REASON_CODES.some((code) => lower === code || lower.indexOf(code + ':') === 0 || lower.indexOf(code + ' ') === 0)) return '';
    if (/^[a-z][a-z0-9._-]{4,}$/i.test(text)) return '';
    if (/\b(?:active|locked|archived)\b/i.test(text)) return '';
    if (/C[0-5]\.|\b(?:E|BP|MAP|DEC)-|commissionId|professionId|eventId/.test(text)) return '';
    return text;
  }

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
    '[data-town-flight]:not([open]) > .ac-career-town__free-body {',
    '  display: none;',
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
    '.ac-career-town__paused-name {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
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

  /* ------------------------------------------------------------------ *
   * 0.23 T13 — component-backed port surface.
   * The legacy 0.18–0.22 panel stays intact for hosts without the frozen
   * component injection. When bridge supplies ctx.uiComponents (or true with
   * the global T11 namespace), this surface renders P07–P10 through T11.
   * ------------------------------------------------------------------ */

  const PORT_TITLE = '折光港';
  const PORT_TABS = [
    { id: 'home', label: '眼下' },
    { id: 'work', label: '工作' },
    { id: 'journal', label: '经历' },
  ];
  const PORT_SURFACES = ['port', 'work', 'journal'];
  const PORT_CAPTION = '港口还开着，你可以慢慢看看。';
  const PORT_EMPTY_TITLE = '港口暂时没有新的安排';
  const PORT_EMPTY_SUMMARY = '你保存的经历还在，随时可以从这里继续。';
  const PORT_LOADING_TITLE = '正在整理港口内容';
  const PORT_LOADING_SUMMARY = '请稍候，已经保存的内容不会丢失。';
  const PORT_ERROR_TITLE = '港口记录暂时读不出来';
  const PORT_ERROR_SUMMARY = '你的游玩不受影响，可以再试一次。';
  const PORT_EXIT_LABEL = '离开港口';
  const PORT_RETRY_LABEL = '重试';
  const PORT_TOOL_FALLBACK = { wallet: '钱包', shop: '商店', workshop: '工作台', hangar: '机库' };
  const PORT_TOOL_ICON = { wallet: 'wallet', shop: 'store', workshop: 'tool', hangar: 'tool' };
  const PORT_CLUE_FAMILY_ICON = { record: 'mail', signal: 'scroll', bio: 'gem', industrial: 'pick', route: 'chevron' };

  function portComponentsOf(context) {
    const direct = context && context.uiComponents;
    if (direct === true && root.ArcadeCareerUI && isObject(root.ArcadeCareerUI.components)) return root.ArcadeCareerUI.components;
    if (!isObject(direct)) return null;
    const required = ['CareerShell', 'StoryCard', 'SegmentedTabs', 'WorkCard', 'JournalTimeline', 'ToolGrid', 'SecondaryAction'];
    return required.every((name) => typeof direct[name] === 'function') ? direct : null;
  }

  function portRootWindow() {
    return typeof window !== 'undefined' && window ? window : null;
  }

  function portApiOf(context) {
    return context && isObject(context.api) ? context.api : {};
  }

  function portOpenMethod(context, name) {
    if (context && typeof context[name] === 'function') return context[name];
    const api = portApiOf(context);
    return typeof api[name] === 'function' ? api[name] : null;
  }

  function portHarborNode(context, doc) {
    const source = context && context.uiHarbor;
    let rendered = null;
    if (typeof source === 'function') {
      try { rendered = source(false); } catch (err) { rendered = null; }
    } else if (source && typeof source === 'object' && typeof source.render === 'function') {
      try { rendered = source.render(false); } catch (err) { rendered = null; }
    }
    if (typeof rendered === 'string' && rendered.trim()) {
      try {
        const template = doc.createElement('template');
        template.innerHTML = rendered;
        rendered = template.content && template.content.firstChild ? template.content.firstChild : null;
      } catch (err) {
        rendered = null;
      }
    }
    return rendered && typeof rendered.nodeType === 'number' ? rendered : null;
  }

  function portTextNode(doc, className, text) {
    const node = doc.createElement('p');
    if (className) node.className = className;
    node.textContent = text || '';
    return node;
  }

  function requestPortCareerView(context, surface) {
    const provider = typeof context === 'object' && context && typeof context.careerView === 'function'
      ? context.careerView
      : portOpenMethod(context, 'careerView');
    if (typeof provider !== 'function') return Promise.resolve(null);
    let result = null;
    try {
      result = provider({ surface: surface });
    } catch (err) {
      return Promise.resolve(null);
    }
    return Promise.resolve(result).then(
      (value) => isObject(value) ? value : null,
      () => null
    );
  }

  function createPortState() {
    return {
      views: Object.create(null),
      tab: 'home',
      expanded: Object.create(null),
      phase: 'normal',
      seq: 0,
      alive: true,
      unsubscribe: null,
      shell: null,
      context: null,
    };
  }

  function destroyPortState(state) {
    if (!state || !state.alive) return;
    state.alive = false;
    state.seq += 1;
    if (typeof state.unsubscribe === 'function') {
      try { state.unsubscribe(); } catch (err) { /* ignore */ }
    }
    state.unsubscribe = null;
  }

  function portViewOf(state) {
    if (!state) return null;
    if (state.tab === 'work') return state.views.work || null;
    if (state.tab === 'journal') return state.views.journal || null;
    return state.views.port || null;
  }

  function portNarrativeOf(context) {
    return context && isObject(context.narrative) ? context.narrative : {};
  }

  function portFindCommission(view, commissionId) {
    const id = idText(commissionId);
    if (!id || !view || !Array.isArray(view.commissions)) return null;
    return view.commissions.filter((row) => isObject(row) && idText(row.commissionId) === id)[0] || null;
  }

  function portStoryProps(context, view) {
    const narrative = portNarrativeOf(context);
    const story = view && isObject(view.story) ? view.story : {};
    const next = isObject(story.nextAction) ? story.nextAction : null;
    const nextId = idText(next && next.commissionId);
    const row = portFindCommission(view, nextId);
    const commission = commissionOf(context);
    const title = cleanText(narrative.storyTitle) || cleanText(next && next.label) || cleanText(row && row.title);
    const summary = cleanText(narrative.storySummary) || cleanText(row && row.summary) || cleanText(row && row.objectiveText);
    const action = nextId && (!commission || typeof commission.start !== 'function')
      ? null
      : (nextId ? {
          id: 'port-story-' + nextId,
          label: cleanText(next && next.label) || '继续这段故事',
          kind: 'primary',
          onClick: () => startPortCommission(context, nextId),
        } : null);
    return {
      eyebrow: cleanText(narrative.storyEyebrow) || '正在发生的故事',
      title: safePlayerReason(title) || PORT_EMPTY_TITLE,
      summary: safePlayerReason(summary) || PORT_EMPTY_SUMMARY,
      state: nextId ? 'current' : 'no-action',
      tags: [],
      action: action,
    };
  }

  function portMessageNode(doc, view, components) {
    const messages = view && view.story && Array.isArray(view.story.messages) ? view.story.messages : [];
    const row = messages.filter(isObject).slice(0, 1)[0];
    if (!row) return null;
    const label = cleanText(row.label) || cleanText(row.text);
    if (!label) return null;
    const wrapper = doc.createElement('div');
    wrapper.className = 'ac-career-ui__row ac-career-ui__port-message';
    wrapper.setAttribute('data-port-message', 'true');
    wrapper.appendChild(components.icon && components.icon('mail'));
    const content = doc.createElement('div');
    content.className = 'ac-career-ui__grow ac-career-ui__stack ac-career-ui__stack--small';
    const from = cleanText(row.from);
    if (from) content.appendChild(portTextNode(doc, 'ac-career-ui__caption ac-career-ui__gold', from));
    content.appendChild(portTextNode(doc, 'ac-career-ui__caption', safePlayerReason(label)));
    const text = cleanText(row.text);
    if (text && text !== label) content.appendChild(portTextNode(doc, 'ac-career-ui__caption', safePlayerReason(text)));
    const at = cleanText(row.at);
    const date = at && typeof components.formatIsoDate === 'function' ? components.formatIsoDate(at) : '';
    if (date) {
      const time = doc.createElement('time');
      time.className = 'ac-career-ui__caption';
      time.textContent = date;
      content.appendChild(time);
    }
    wrapper.appendChild(content);
    return wrapper;
  }

  function portClueProps(context) {
    const narrative = portNarrativeOf(context);
    const input = context && (context.portClue || context.recoverableClue) ? (context.portClue || context.recoverableClue) : narrative.clue;
    if (!isObject(input)) return null;
    const clue = isObject(input.clue) ? input.clue : input;
    const clueId = idText(clue.clueId || input.clueId);
    if (!clueId) return null;
    const snapshot = isObject(input.state) ? input.state : (isObject(context.state) ? context.state : {});
    const record = isObject(snapshot.clues) ? snapshot.clues[clueId] : null;
    let state = cleanText(input.state);
    if (['hidden', 'glimpsed', 'read', 'recoverable'].indexOf(state) < 0) {
      if (!record) state = 'hidden';
      else if (record.openedAt) state = 'read';
      else {
        const stage = cleanText(snapshot.stage).toUpperCase();
        const hasRead = Object.keys(snapshot.clues).some((key) => !!(snapshot.clues[key] && snapshot.clues[key].openedAt));
        state = !record.portSeenAt && (stage === 'GLIMPSED' || stage === 'CURIOUS') && hasRead ? 'recoverable' : 'glimpsed';
      }
    }
    if (state === 'hidden') return null;
    const title = cleanText(clue.ambientLabel) || cleanText(clue.title);
    if (!title) return null;
    const actionLabel = state === 'glimpsed'
      ? '仔细看看'
      : (state === 'read' ? '查看这封信' : (cleanText(clue.letter && clue.letter.actionLabel) || '按地址投递'));
    let onOpen = typeof input.onOpen === 'function' ? input.onOpen : portOpenMethod(context, 'openClue');
    if (typeof onOpen !== 'function') onOpen = portOpenMethod(context, 'onOpenClue');
    const invitation = typeof context.invitationForClue === 'function' ? context.invitationForClue(clueId) : null;
    return {
      clueId: clueId,
      gameId: idText(clue.gameId),
      professionId: invitation && idText(invitation.professionId),
      icon: state === 'recoverable' ? 'mail' : (PORT_CLUE_FAMILY_ICON[cleanText(clue.family)] || 'gem'),
      title: title,
      teaser: cleanText(clue.ambientText),
      actionLabel: actionLabel,
      state: state,
      placement: 'list',
      reducedMotion: !!context.reducedMotion,
      onOpen: typeof onOpen === 'function' ? onOpen : undefined,
    };
  }

  function portToolItems(context, view) {
    const tools = view && Array.isArray(view.tools) ? view.tools : [];
    const out = [];
    Object.keys(PORT_TOOL_FALLBACK).forEach((id) => {
      const tool = tools.filter((entry) => isObject(entry) && idText(entry.toolId) === id)[0];
      if (!tool) return;
      const openerName = id === 'wallet' ? 'openReceipt' : (id === 'shop' ? 'openMarket' : (id === 'workshop' ? 'openWorkshop' : 'openHangar'));
      out.push({
        id: id,
        label: cleanText(tool.name) || PORT_TOOL_FALLBACK[id],
        icon: PORT_TOOL_ICON[id],
        onClick: () => {
          const opener = portOpenMethod(context, openerName);
          if (typeof opener === 'function') {
            try { opener(); } catch (err) { /* ignore */ }
          } else if (typeof context.announce === 'function') {
            context.announce(PORT_TOOL_FALLBACK[id] + '暂时打不开。');
          }
        },
      });
    });
    return out;
  }

  function startPortCommission(context, commissionId) {
    const id = idText(commissionId);
    if (!id) return Promise.resolve({ ok: false });
    const commission = commissionOf(context);
    if (!commission || typeof commission.start !== 'function') return Promise.resolve({ ok: false });
    let result = null;
    try {
      result = commission.start({ commissionId: id, careerId: careerIdOf(context), ensure: false, surface: 'work' });
    } catch (err) {
      result = { ok: false };
    }
    return Promise.resolve(result).then((value) => {
      const url = safeNavUrl(value && isObject(value) ? value.url : '');
      if (url && portRootWindow() && portRootWindow().location && typeof portRootWindow().location.assign === 'function') {
        try { portRootWindow().location.assign(url); } catch (err) { /* navigation unavailable in test host */ }
      }
      return value;
    }, () => ({ ok: false }));
  }

  function pausePortProfession(context, professionId, paused) {
    const id = idText(professionId);
    if (!id) return Promise.resolve({ ok: false });
    const fn = portOpenMethod(context, 'setProfessionPaused');
    if (typeof fn !== 'function') return Promise.resolve({ ok: false });
    let result = null;
    try {
      result = fn({ professionId: id, paused: !!paused });
    } catch (err) {
      result = { ok: false };
    }
    return Promise.resolve(result);
  }

  function portWorkCards(context, view, state, components) {
    const professions = view && Array.isArray(view.professions) ? view.professions.filter(isObject) : [];
    const accepted = professions.filter((entry) => ['accepted', 'developed', 'completed'].indexOf(cleanText(entry.state).toLowerCase()) >= 0);
    const commissions = view && Array.isArray(view.commissions) ? view.commissions.filter(isObject) : [];
    const worldRows = commissions.filter((entry) => cleanText(entry.category).toLowerCase() === 'world');
    if (!accepted.length && !worldRows.length) {
      return [components.WorkCard({ professionId: null, displayName: '', icon: 'check', state: 'empty', commissions: [] })];
    }
    const cards = accepted.map((entry) => {
      const professionId = idText(entry.professionId);
      const rows = commissions.filter((commission) => {
        if (cleanText(commission.category).toLowerCase() === 'world') return false;
        const parent = idText(commission.professionId || commission.parentProfessionId || commission.internalParentProfessionId);
        return !!parent && parent === professionId;
      });
      const paused = entry.paused === true;
      const card = components.WorkCard({
        professionId: professionId,
        displayName: cleanText(entry.displayName),
        icon: cleanText(entry.domain) === 'nature' ? 'pick' : (cleanText(entry.domain) === 'adventure' ? 'scroll' : 'gem'),
        state: paused ? 'paused' : (rows.length ? 'active' : 'optional'),
        commissions: paused ? [] : rows,
        expanded: !!state.expanded[professionId],
        onStart: (commissionId) => startPortCommission(context, commissionId),
        onPause: (targetId, nextPaused) => pausePortProfession(context, targetId, nextPaused).then(() => {
          if (state.alive && state.shell) {
            loadPortData(context, state);
            const focusId = 'work-pause-' + idText(targetId);
            Promise.resolve().then(() => {
              const panel = state.shell && state.shell.panel;
              const button = panel && panel.querySelector ? panel.querySelector('#' + focusId) : null;
              if (button && typeof button.focus === 'function') button.focus();
            });
          }
          return { ok: true };
        }),
      });
      card.setAttribute('data-port-profession', professionId);
      const buttons = card.querySelectorAll ? Array.prototype.slice.call(card.querySelectorAll('button')) : [];
      const pauseButton = buttons.filter((button) => {
        const label = cleanText(button.textContent);
        return label === '暂时搁置' || label === '恢复这段经历';
      })[0];
      if (pauseButton) {
        pauseButton.id = 'work-pause-' + professionId;
        pauseButton.setAttribute('data-work-pause', professionId);
      }
      const details = card.querySelector('details');
      if (details && typeof details.addEventListener === 'function') {
        details.addEventListener('toggle', () => { state.expanded[professionId] = !!details.open; });
      }
      return card;
    });
    if (worldRows.length) {
      const worldCard = components.WorkCard({
        professionId: null,
        displayName: '',
        icon: 'check',
        state: 'optional',
        commissions: worldRows,
        onStart: (commissionId) => startPortCommission(context, commissionId),
      });
      worldCard.setAttribute('data-port-profession', 'world');
      cards.push(worldCard);
    }
    return cards;
  }

  function portJournalNode(view, components) {
    const history = view && view.story && Array.isArray(view.story.history) ? view.story.history : [];
    const events = history.filter(isObject).map((row) => ({
      label: cleanText(row.label) || cleanText(row.text),
      at: cleanText(row.at),
    })).filter((row) => row.label);
    return components.JournalTimeline({ state: events.length ? 'filled' : 'empty', events: events });
  }

  function portContentNode(context, state, view, components) {
    const phase = state.phase;
    const stack = docOfPort();
    const content = stack.createElement('div');
    content.className = 'ac-career-ui__stack';
    content.id = 'ac-career-ui-port-tabpanel';
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-label', '港口内容');
    content.setAttribute('data-port-tabpanel', state.tab);

    if (phase === 'loading') {
      content.appendChild(components.StoryCard({
        eyebrow: '港口记录',
        title: PORT_LOADING_TITLE,
        summary: PORT_LOADING_SUMMARY,
        state: 'no-action',
      }));
      return content;
    }
    if (phase === 'error') {
      content.appendChild(components.StoryCard({
        eyebrow: '港口记录',
        title: PORT_ERROR_TITLE,
        summary: PORT_ERROR_SUMMARY,
        state: 'no-action',
      }));
      content.appendChild(components.SecondaryAction({
        id: 'port-retry',
        label: PORT_RETRY_LABEL,
        kind: 'secondary',
        variant: 'border',
        onClick: () => { loadPortData(state.context, state); return { ok: true }; },
      }));
      return content;
    }

    if (state.tab === 'work') {
      portWorkCards(context, view, state, components).forEach((card) => content.appendChild(card));
      return content;
    }
    if (state.tab === 'journal') {
      content.appendChild(portJournalNode(view, components));
      return content;
    }

    content.appendChild(components.StoryCard(portStoryProps(context, view)));
    const message = portMessageNode(stack, view, components);
    if (message) content.appendChild(message);
    const clue = components.ClueRow && portClueProps(context);
    if (clue) content.appendChild(components.ClueRow(clue));
    return content;
  }

  function docOfPort() {
    return documentOf() || { createElement(tag) { return { tagName: String(tag).toUpperCase(), className: '', textContent: '', childNodes: [], children: [], appendChild(node) { this.childNodes.push(node); this.children.push(node); return node; }, setAttribute() {} }; } };
  }

  function portBody(context, state, view, components) {
    const doc = docOfPort();
    const body = doc.createElement('div');
    body.className = 'ac-career-ui__stack';
    const harbor = portHarborNode(context, doc);
    if (harbor) body.appendChild(harbor);
    body.appendChild(portTextNode(doc, 'ac-career-ui__caption', cleanText(portNarrativeOf(context).caption) || PORT_CAPTION));
    body.appendChild(components.SegmentedTabs({
      tabs: PORT_TABS,
      selectedId: state.tab,
      label: '港口页面',
      controlsId: 'ac-career-ui-port-tabpanel',
      onSelect: (id) => {
        if (PORT_TABS.every((tab) => tab.id !== id)) return;
        state.tab = id;
        renderPortSurface(state.context, state);
      },
    }));
    body.appendChild(portContentNode(context, state, view, components));
    const tools = portToolItems(context, (state.views && state.views.port) || view);
    if (tools.length) {
      body.appendChild(components.ToolGrid({ tools: tools, state: 'available', label: '已知工具' }));
    }
    const footer = doc.createElement('footer');
    footer.className = 'ac-career-ui__footer';
    footer.appendChild(components.SecondaryAction({
      id: 'port-exit',
      label: PORT_EXIT_LABEL,
      kind: 'text',
      variant: 'text',
      onClick: () => {
        if (state.shell) state.shell.close();
        else if (typeof context.closePort === 'function') context.closePort();
      },
    }));
    body.appendChild(footer);
    return body;
  }

  function portShellState(context, state) {
    const explicit = cleanText(portNarrativeOf(context).state);
    if (explicit === 'loading' || explicit === 'error') return explicit;
    if (state.phase === 'loading') return 'loading';
    if (state.phase === 'error') return 'error';
    return 'normal';
  }

  function portShellProps(context, state, view, components) {
    return {
      panelKey: 'town',
      title: PORT_TITLE,
      state: portShellState(context, state),
      size: 'default',
      body: portBody(context, state, view, components),
      reducedMotion: !!context.reducedMotion,
    };
  }

  function renderPortSurface(context, state) {
    if (!state || !state.alive) return null;
    const components = portComponentsOf(context || state.context);
    if (!components) return null;
    state.context = context || state.context;
    const view = portViewOf(state);
    const props = portShellProps(state.context, state, view, components);
    if (state.shell && typeof state.shell.render === 'function') return state.shell.render(props);
    if (state.detached) return components.CareerShell(props);
    return null;
  }

  function subscribePortChanges(context, state) {
    if (typeof state.unsubscribe === 'function') {
      try { state.unsubscribe(); } catch (err) { /* ignore */ }
    }
    state.unsubscribe = null;
    const provider = typeof context.onCareerDataChanged === 'function'
      ? context.onCareerDataChanged
      : portOpenMethod(context, 'onCareerDataChanged');
    if (typeof provider !== 'function') return;
    try {
      const unsubscribe = provider((event) => {
        if (!state.alive) return;
        const reason = cleanText(event && event.reason).toLowerCase();
        if (['career-archived', 'career-reset', 'career-imported'].indexOf(reason) >= 0) {
          if (state.shell) state.shell.close();
          else destroyPortState(state);
          return;
        }
        loadPortData(state.context, state);
      });
      if (typeof unsubscribe === 'function') state.unsubscribe = unsubscribe;
    } catch (err) {
      state.unsubscribe = null;
    }
  }

  function loadPortData(context, state) {
    if (!state || !state.alive) return;
    state.context = context || state.context;
    state.seq += 1;
    const seq = state.seq;
    const narrative = portNarrativeOf(state.context);
    state.phase = cleanText(narrative.state) === 'error' ? 'error' : (cleanText(narrative.state) === 'loading' ? 'loading' : 'loading');
    renderPortSurface(state.context, state);
    if (state.phase === 'error') return;
    Promise.all(PORT_SURFACES.map((surface) => requestPortCareerView(state.context, surface))).then((views) => {
      if (!state.alive || seq !== state.seq) return;
      PORT_SURFACES.forEach((surface, index) => { state.views[surface] = views[index]; });
      state.phase = 'normal';
      renderPortSurface(state.context, state);
    }, () => {
      if (!state.alive || seq !== state.seq) return;
      state.phase = 'error';
      renderPortSurface(state.context, state);
    });
  }

  function openPortSurface(ctx) {
    const doc = documentOf();
    const components = portComponentsOf(ctx);
    if (!doc || !components) return { ok: false, reason: 'ui-unavailable' };
    const state = createPortState();
    state.context = ctx;
    let current = null;
    const manager = components.CareerShell.create('town');
    const result = manager.open({
      panelKey: 'town',
      title: PORT_TITLE,
      state: 'loading',
      size: 'default',
      body: portBody(ctx, state, null, components),
      reducedMotion: !!ctx.reducedMotion,
      onClose: () => {
        if (current && current.portState === state) {
          destroyPortState(state);
          panel = null;
        }
      },
    });
    if (!result.ok) return { ok: false, reason: 'ui-unavailable' };
    state.shell = manager;
    const closeBtn = result.panel.querySelector ? result.panel.querySelector('.ac-career-ui__close') : null;
    current = {
      doc: doc,
      overlay: result.panel.parentNode,
      sheet: result.panel,
      closeBtn: closeBtn,
      portState: state,
      portShell: manager,
      refresh: (next) => { subscribePortChanges(next || ctx, state); loadPortData(next || ctx, state); },
      destroy: () => destroyPortState(state),
    };
    panel = current;
    subscribePortChanges(ctx, state);
    loadPortData(ctx, state);
    return { ok: true, panel: result.panel };
  }

  function renderPortDetached(ctx) {
    const doc = documentOf();
    const components = portComponentsOf(ctx);
    if (!doc || !components) return null;
    const state = createPortState();
    state.context = ctx;
    state.detached = true;
    state.phase = cleanText(portNarrativeOf(ctx).state) === 'error' ? 'error' : 'normal';
    return components.CareerShell(portShellProps(ctx, state, null, components));
  }

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.portSurface = {
    componentsOf: portComponentsOf,
    createState: createPortState,
    body: portBody,
    requestView: requestPortCareerView,
    shellProps: portShellProps,
    render: renderPortSurface,
    load: loadPortData,
    startCommission: startPortCommission,
  };

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

  /** 只把投影给出的公开委托字段规整成行；不带 gameId 反查，也不读完整目录。 */
  function commissionRowsOf(view, materialNames) {
    const raw = view && Array.isArray(view.commissions) ? view.commissions : [];
    const names = isObject(materialNames) ? materialNames : Object.create(null);
    const rows = [];
    raw.forEach((entry) => {
      if (!isObject(entry)) return;
      const commissionId = idText(entry.commissionId);
      if (!commissionId) return;
      const world = cleanText(entry.category).toLowerCase() === 'world';
      rows.push({
        commissionId: commissionId,
        gameId: world ? '' : idText(entry.gameId),
        /* 世界工作只消费通用 title/summary；游戏名、拥有职业与职业报酬都不进入卡片。 */
        gameName: world ? '' : cleanText(entry.gameName),
        title: cleanText(entry.title) || '旧港的一张单子',
        summary: cleanText(entry.summary),
        issuer: world ? '' : cleanText(entry.issuer),
        objective: world ? null : (isObject(entry.objective) ? entry.objective : null),
        rewardText: world ? '' : rewardTextOf(entry.reward, names),
        category: world ? 'world' : 'profession',
        professionId: world ? '' : idText(entry.professionId),
      });
    });
    return rows;
  }

  function emptyCareerView() {
    return {
      schemaVersion: 1,
      originGameId: null,
      activeProfessionId: null,
      professions: [],
      commissions: [],
      story: { nextAction: null, messages: [], history: [] },
      tools: [],
    };
  }

  function careViewProvider(context) {
    if (context && typeof context.careerView === 'function') return context.careerView;
    if (context && isObject(context.api) && typeof context.api.careerView === 'function') return context.api.careerView;
    return null;
  }

  /** 只向 bridge 要投影；缺失时返回 null，UI 不自行拼 catalog。 */
  function requestCareerView(context, surface) {
    const provider = careViewProvider(context);
    if (!provider) return null;
    let result = null;
    try {
      result = provider({
        surface: surface,
        gameId: idText(context && (context.gameId || (isObject(context.api) ? context.api.gameId : null))) || null,
      });
    } catch (err) {
      return Promise.resolve(null);
    }
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).then(
        (value) => isObject(value) ? value : null,
        () => null
      );
    }
    return isObject(result) ? result : null;
  }

  function requestAuthorizedIds(commission, careerId) {
    if (!commission || typeof commission.listAvailable !== 'function') return null;
    let result = null;
    try {
      result = commission.listAvailable({ careerId: careerId, ensure: false, surface: 'work' });
    } catch (err) {
      return null;
    }
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).then(
        (value) => normalizeUnlocked(value),
        () => null
      );
    }
    return normalizeUnlocked(result);
  }

  function firstOriginViewOf(view, context) {
    if (!isObject(view) || !Array.isArray(view.professions) || view.professions.length !== 1) return false;
    const origin = idText(view.originGameId);
    if (!origin) return false;
    const state = cleanText(view.professions[0].state).toLowerCase();
    if (state !== 'accepted' && state !== 'developed' && state !== 'completed') return false;
    const gameId = idText(context && (context.gameId || (isObject(context.api) ? context.api.gameId : null)));
    return !gameId || origin === gameId;
  }

  function viewHasTool(view, toolId) {
    if (!isObject(view) || !Array.isArray(view.tools)) return false;
    const id = idText(toolId);
    return view.tools.some((tool) => isObject(tool) && idText(tool.toolId) === id);
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
    const pausedDetails = make('details', 'ac-career-town__free ac-career-town__paused');
    pausedDetails.setAttribute('data-town-paused', 'true');
    pausedDetails.open = false;
    pausedDetails.hidden = true;
    pausedDetails.appendChild(make('summary', null, PAUSED_LIST_TITLE));
    const pausedBody = make('div', 'ac-career-town__free-body');
    const pausedList = make('ul', 'ac-career-town__list');
    pausedList.setAttribute('data-town-paused-list', 'true');
    pausedBody.appendChild(pausedList);
    pausedDetails.appendChild(pausedBody);
    scope.appendChild(pausedDetails);

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
    townView.appendChild(recommendList);
    townView.appendChild(scope);
    townView.appendChild(empty);
    townView.appendChild(campaignSection);
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
    let projectedView = emptyCareerView();
    let viewReady = false;
    let unsubscribeCareer = null;
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
      const firstOrigin = firstOriginViewOf(projectedView, liveContext);
      const arrival = firstOrigin ? arrivalLineOf(liveContext) : '';
      introGreeting.textContent = arrival;
      introGreeting.hidden = !arrival;
      location.hidden = !!arrival;
      const role = firstOrigin ? roleTextOf() : '';
      introRole.textContent = role;
      introRole.hidden = !role;
      introGoal.textContent = '眼下：' + (currentGoalText() || INTRO_GOAL);
    }

    /** campaign 建议只能给主卡补充玩家语言；不能挑选投影外或核心未授权的委托。 */
    function recommendedSuggestionOf(allowedIds) {
      const campaign = isObject(liveContext && liveContext.campaign) ? liveContext.campaign : null;
      if (!campaign || typeof campaign.recommend !== 'function' || !unlockedSet || !allowedIds.length) return null;
      let suggestion = null;
      try {
        suggestion = campaign.recommend({
          quests: Array.isArray(liveContext.quests) ? liveContext.quests : [],
          claims: Array.isArray(liveContext.claims) ? liveContext.claims : [],
          profile: liveContext.profile || null,
          wallet: liveContext.wallet || null,
          availableIds: allowedIds.slice(),
          storyEvidence: liveContext.storyEvidence || null,
        });
      } catch (err) {
        return null;
      }
      if (!isObject(suggestion) || suggestion.ok === false) return null;
      const id = idText(suggestion.commissionId);
      if (!id || allowedIds.indexOf(id) < 0) return null;
      const row = commissionRowsOf(projectedView, materialNames)
        .filter((entry) => entry.commissionId === id)[0] || null;
      if (!row) return null;
      const worldGoal = rowGoalText(row);
      const hasObjective = !!(row.objective && numberOrZero(row.objective.atLeast));
      return {
        row: row,
        goal: hasObjective ? worldGoal : (cleanText(suggestion.goal) || worldGoal),
        reason: safePlayerReason(suggestion.reason),
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
      while (pausedList.firstChild) pausedList.removeChild(pausedList.firstChild);

      const boardReady = viewReady && !!unlockedSet;
      const allRows = boardReady ? commissionRowsOf(projectedView, materialNames) : [];
      const rows = allRows.filter((row) => unlockedSet[row.commissionId]);
      const allowedIds = rows.map((row) => row.commissionId);
      const story = isObject(projectedView.story) ? projectedView.story : {};
      const next = isObject(story.nextAction) ? story.nextAction : null;
      const nextId = idText(next && next.commissionId);
      const suggestion = boardReady ? recommendedSuggestionOf(allowedIds) : null;

      /* story.nextAction 是眼下主卡；没有它时才续接进行中的单或采用同集合建议。 */
      let liveId = '';
      for (let i = 0; i < rows.length; i += 1) {
        if (continuations[rows[i].commissionId]) {
          liveId = rows[i].commissionId;
          break;
        }
      }
      let mainId = nextId && allowedIds.indexOf(nextId) >= 0 ? nextId : '';
      if (!mainId && liveId) mainId = liveId;
      if (!mainId && suggestion) mainId = suggestion.row.commissionId;
      const mainRow = rows.filter((row) => row.commissionId === mainId)[0] || null;

      introGoal.hidden = !!mainRow && !introGreeting.hidden;
      if (mainRow) {
        const suggestionMatch = !!suggestion && suggestion.row.commissionId === mainRow.commissionId;
        const opts = {
          recommended: true,
          gameName: mainRow.gameName,
          titleOverride: liveId && mainId === liveId ? '继续这张单：' + mainRow.title : '眼下先做：' + mainRow.title,
          goalOverride: suggestionMatch ? suggestion.goal : '',
          kindText: suggestionMatch ? suggestion.kindText : '能积攒下一步所需',
          reason: suggestionMatch ? suggestion.reason : '',
        };
        const item = renderRow(mainRow, boardReady, opts);
        if (nextId === mainId) item.setAttribute('data-town-story-action', 'true');
        recommendList.appendChild(item);
        recommendList.hidden = false;
      } else {
        recommendList.hidden = true;
      }

      /* 0.22 不再给固定首单或机库特例；出航区只保留真实机库入口。 */
      flightList.hidden = true;
      hangarBtn.hidden = !viewHasTool(projectedView, 'hangar') ||
        typeof openerOf(liveContext, 'openHangar') !== 'function';
      flightDetails.hidden = hangarBtn.hidden;
      flightRental.textContent = rentalHintOf();

      receiptBtn.hidden = !viewHasTool(projectedView, 'wallet') ||
        typeof openerOf(liveContext, 'openReceipt') !== 'function';
      marketBtn.hidden = !viewHasTool(projectedView, 'shop') ||
        typeof openerOf(liveContext, 'openMarket') !== 'function';
      workshopBtn.hidden = !viewHasTool(projectedView, 'workshop') ||
        typeof openerOf(liveContext, 'openWorkshop') !== 'function';
      more.hidden = marketBtn.hidden && workshopBtn.hidden;

      rows.filter((row) => !mainId || row.commissionId !== mainId)
        .forEach((row) => freeList.appendChild(renderRow(row, boardReady, {})));
      const hasRows = rows.some((row) => !mainId || row.commissionId !== mainId);
      freeList.hidden = !hasRows;
      freeDetails.hidden = !hasRows;

      /* 已搁置职业只收纳名字，不展示任务或压力提示。 */
      const paused = viewReady && Array.isArray(projectedView.professions)
        ? projectedView.professions.filter((entry) => isObject(entry) && entry.paused === true && cleanText(entry.displayName))
        : [];
      paused.forEach((entry) => {
        pausedList.appendChild(make('li', 'ac-career-town__paused-name', cleanText(entry.displayName)));
      });
      pausedList.hidden = !paused.length;
      pausedDetails.hidden = !paused.length;

      empty.hidden = hasRows || !boardReady || !!mainRow;
      if (boardReady && !rows.length) empty.textContent = '告示板上还没有你能接下的单子，先回港口看看吧。';
      else empty.textContent = LIST_EMPTY;
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

    function loadBoard() {
      requestSeq += 1;
      const seq = requestSeq;
      const commission = commissionOf(liveContext);
      projectedView = emptyCareerView();
      viewReady = false;
      unlockedSet = null;

      const coreRequest = requestAuthorizedIds(commission, careerIdOf(liveContext));
      const viewRequest = requestCareerView(liveContext, 'work');
      const settle = (values) => {
        if (!isCurrent() || seq !== requestSeq) return;
        const authorized = values[0];
        const view = values[1];
        viewReady = !!view;
        projectedView = view || emptyCareerView();
        unlockedSet = viewReady && authorized ? authorized : null;
        setNotice(viewReady && authorized ? '' : BOARD_UNAVAILABLE);
        renderOrigin();
        renderList();
        if (viewReady && authorized) renderWallet();
        loadContinuations(seq);
        renderAlternatives();
      };
      if ((coreRequest && typeof coreRequest.then === 'function') ||
          (viewRequest && typeof viewRequest.then === 'function')) {
        Promise.all([coreRequest, viewRequest]).then(settle, () => settle([null, null]));
      } else {
        settle([coreRequest, viewRequest]);
      }
    }

    function applyUnlocked(next, initial) {
      /* initial：先画「暂未开放」占位，不立刻报「暂不可用」，等双源结果再决定。 */
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
        result = commission.start({
          commissionId: id,
          careerId: careerIdOf(liveContext),
          ensure: false,
          surface: 'work',
        });
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

    function closeThisPanel() {
      if (mounted) close();
      else destroy();
    }

    function onCareerDataChangedEvent(event) {
      if (!alive || !isCurrent()) return;
      const reason = cleanText(event && event.reason).toLowerCase();
      if (DATA_CLOSE_REASONS.indexOf(reason) >= 0) {
        closeThisPanel();
        return;
      }
      refresh(liveContext);
    }

    function subscribeCareerData(context2) {
      if (typeof unsubscribeCareer === 'function') {
        try { unsubscribeCareer(); } catch (err) { /* ignore */ }
      }
      unsubscribeCareer = null;
      const provider = context2 && typeof context2.onCareerDataChanged === 'function'
        ? context2.onCareerDataChanged
        : (context2 && isObject(context2.api) && typeof context2.api.onCareerDataChanged === 'function'
          ? context2.api.onCareerDataChanged : null);
      if (!provider) return;
      try {
        const unsubscribe = provider(onCareerDataChangedEvent);
        if (typeof unsubscribe === 'function') unsubscribeCareer = unsubscribe;
      } catch (err) {
        unsubscribeCareer = null;
      }
    }

    function refresh(next) {
      if (!isCurrent()) return sheet;
      const context2 = isObject(next) ? next : {};
      if (context2.reducedMotion) overlay.classList.add('is-reduced-motion');
      else overlay.classList.remove('is-reduced-motion');
      liveContext = context2;
      materialNames = materialNamesOf(context2);
      projectedView = emptyCareerView();
      viewReady = false;
      unlockedSet = null;
      setStatus('');
      showStatusRetry(null);
      renderList();
      renderOrigin();
      renderCampaign();
      renderWallet();
      subscribeCareerData(context2);
      loadBoard();
      return sheet;
    }

    function destroy() {
      alive = false;
      requestSeq += 1;
      if (typeof unsubscribeCareer === 'function') {
        try { unsubscribeCareer(); } catch (err) { /* ignore */ }
        unsubscribeCareer = null;
      }
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
      subscribeCareerData(liveContext);
      loadBoard();
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
    if (!current) return false;
    if (current.portShell) {
      current.portShell.close();
      return true;
    }
    panel = null;
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
    if (portComponentsOf(ctx)) return openPortSurface(ctx);
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
    if (portComponentsOf(ctx)) return renderPortDetached(ctx);
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
