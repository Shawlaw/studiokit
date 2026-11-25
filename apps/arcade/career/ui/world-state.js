/*!
 * StudioKit Arcade Life — 旧港来信 / 章节面板与港口世界状态（0.18 / D18-12）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.worldState，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.worldState.open(ctx);
 *   window.ArcadeCareerUI.worldState.render(ctx);
 *   window.ArcadeCareerUI.worldState.close();
 *
 * ctx（bridge 构造；字段缺失一律按空处理，绝不抛）：
 *   - campaign：campaign-core（ADR §20.2）实例；也接受 campaign.json 形状的内容对象；
 *   - campaignState / campaign.state：只读的章节/终局/后日谈快照（ADR §20.2 state() 输出）；
 *   - ending：ending-reducer（ADR §20.3）实例，终局按钮只调用 ending.startEnding({approach})；
 *   - startEnding：bridge 兜底（没有 ending 模块时由 bridge 自己处理终局与导航）；
 *   - commission：commission-core 实例（只读；本面板不接单、不发奖）；
 *   - npc / sideStories：npc.json / side-stories.json 内容；
 *   - state / clues / careerId / reducedMotion / announce：0.15–0.17 既有上下文。
 *
 * 约束（ADR §20.4 / 任务 D18-12）：
 * - 只从信箱「旧港来信」或告示板章节卡片打开，不新增顶层 CTA、不强制弹窗；
 * - 六章卡片（标题/状态/一条戏内提示）、可选支线、NPC 回信（可跳过）、C4 后三终局、后日谈；
 * - 状态只读：不写 IndexedDB/localStorage、不发奖、不自行导航（导航只把结果 url 交给 location）；
 * - 港口灯光/广播只存在于本浮层内，绝不改经典游戏画布、局内档、难度或页面结构；
 * - reduced-motion / ctx.reducedMotion 下不动画（静态灯与静态广播文本）；
 * - 320–430 无横向溢出、按钮 ≥44px、role=dialog/aria-modal/aria-labelledby、Esc 只关最上层、
 *   关闭后焦点返回、Tab 不逃逸、零 console error。
 *
 * 样式偏差：本任务写入区只有 world-state.js，无法改 ui/clue-surface.css，
 * 因此面板样式首次打开时注入一次性 <style id="ac-career-world-style">（不引用外部资源）。
 */
(function (root) {
  'use strict';

  const VERSION = '0.18.0';
  const PANEL_KEY = 'world-state';
  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet ac-career-world';
  const TITLE_ID = 'ac-career-world-title';
  const DESC_ID = 'ac-career-world-desc';
  const STYLE_ID = 'ac-career-world-style';

  const PANEL_LABEL = '旧港来信';
  const WHERE_TEXT = '旧码头门房边的信箱，信纸边角还带着海风的潮气。';
  const DEGRADED_TEXT = '港务处还在整理旧信。';
  const GATE_TEXT = '信还没送到旧港。先在信箱里把线索信按地址投递。';
  const READONLY_TEXT = '没有登记过的生涯，这里只能看，不能签。';
  const CHAPTERS_HEADING = '港里的六封信';
  const CHAPTERS_HEADING_OTHER = '港里的信';
  const SIDE_HEADING = '可选支线';
  const REPLIES_HEADING = '港里的回信';
  const RECENT_HEADING = '刚刚记下的';
  const EARLIER_HEADING = '更早的信';
  const EXPAND_LABEL = '展开回顾';
  const COLLAPSE_LABEL = '收起回顾';
  const CONTACTS_HEADING = '可以问的人';
  const NEXT_HEADING = '下一步';
  const NEXT_FALLBACK = {
    C0: '去街角的告示板，挑一张今天能做成的水上零工。',
    C1: '再带回一份与航报不同来源的现场记录，让研究院把那截信号比对完。',
    C2: '去月影一侧的旧观测站查值班表，看看当年那位调度员遭遇了什么。',
    C3: '城市要撑不住了，先去旧机库问问还能顶用的料，让街灯亮起来。',
    C4: '星塔的选择摆在你面前：让它停、改写它认得的信号，或赶在窗口关上前把人接回来。',
    C5: '事情了结，告示板又挂满了工单。想接什么活，随你。',
  };
  const ENDINGS_HEADING = '星塔的回响';
  const EPILOGUE_HEADING = '后日谈';
  const ENDINGS_NOTE = '三条路都能让星塔停下；港口会记住你选择的方式。';
  const CHOSEN_NOTE_PREFIX = '星塔的回响已经落定：';
  const CHOSEN_NOTE_SUFFIX = '。港里按这个结局继续过日子。';
  const SKIP_LABEL = '跳过回信';
  const UNSKIP_LABEL = '看看回信';
  const BACK_LABEL = '回到游戏';
  const CLOSE_LABEL = '收起旧港来信';
  const STATUS_FAILED = '星塔那边没应声，过一会儿再试。';
  const STATUS_READONLY = '这里只能看，不能签字。';
  const STATUS_NO_URL = '已经登记，但从这里找不到去星塔的路。';
  const STATUS_NAVIGATING = '已经登记，正在去星塔。';
  const ANNOUNCE_REPLIES_HIDDEN = '回信已经收起。';
  const ANNOUNCE_REPLIES_SHOWN = '回信重新摊开。';
  const ANNOUNCE_CHAPTERS_EXPANDED = '更早的信已经展开。';
  const ANNOUNCE_CHAPTERS_COLLAPSED = '更早的信已经收起。';

  const STAGE_RANK = { DORMANT: 0, GLIMPSED: 1, CURIOUS: 2, LOCAL: 3, RESIDENT: 4, EXPLORER: 5 };
  const CHAPTER_ORDER = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
  const CHAPTER_FLAG = {
    C0: 'C0.port_seen',
    C1: 'C1.signal_fragment',
    C2: 'C2.research_complete',
    C3: 'C3.truth_found',
    C4: 'C4.city_power_restored',
    C5: 'C5.star_tower_resolved',
  };
  const CHAPTER_STATES = ['locked', 'available', 'active', 'complete'];
  const STATE_LABEL = {
    locked: '尚未开放',
    available: '可以开始',
    active: '进行中',
    complete: '已完成',
  };
  const APPROACH_ORDER = ['combat', 'research', 'rescue'];

  /* 内容兜底：只在 ctx 里读不到 campaign.json 时使用（真实内容优先，逐项合并）。 */
  const CHAPTER_FALLBACK = {
    C0: { title: '不起眼的印记', hint: '线索信的背面有一行旧港地址。', fallback: '信箱可随时找回这封信。' },
    C1: { title: '第一封工单', hint: '告示板上的工钱够不够，是接下来最实际的问题。', fallback: '不买飞船也能租；不战斗也能委托代办。' },
    C2: { title: '谁留下了七号货柜', hint: '晨光研究院愿意看晶格模型。', fallback: '研究、开采、贸易三条线都能解译，不锁死游戏。' },
    C3: { title: '月影里的时间差', hint: '旧观测站的坐标在月影一侧。', fallback: '探索、生态、档案三条替代线任选。' },
    C4: { title: '停摆的城市', hint: '港口需要一座稳定的临时能源塔。', fallback: '建造、物流、维护/协调任一路可完成。' },
    C5: { title: '星塔的回响', hint: '三条路都能让星塔停下；港口会记住你选择的方式。', fallback: '三条终局路线任选，完成后仍可自由游玩。' },
  };
  const APPROACH_FALLBACK = {
    combat: { title: '武力解除', summary: '在母舰防线直面旧防御核心，让星塔停下。' },
    research: { title: '理性重启', summary: '用晶格模型重写许可信号，让旧系统重新认识现代货运。' },
    rescue: { title: '运输救援', summary: '在星塔关闭窗口前把补给与人工送进旧港，让城市自己走出来。' },
  };
  const BROADCAST = {
    pre: '旧港广播：今晚只有门房的灯还亮着，地址栏里没有新信。',
    C0: '旧港广播：码头亮起两盏灯，收货窗口照常开着。',
    C1: '旧港广播：信号塔的杂音里，夹着 P-07 的旧编号。',
    C2: '旧港广播：研究院的灯亮到很晚，七号货柜那边多了一队人。',
    C3: '旧港广播：月影方向的探照灯扫过旧观测站，又慢慢移开。',
    C4: '旧港广播：城市的灯重新亮起，星塔的影子第一次被人看清。',
    C5: '旧港广播：星塔的探照灯停住了，像在等一个回答。',
    'ending.combat': '旧港广播：星塔安静下来，巡防队把禁区标在了海图上。',
    'ending.research': '旧港广播：许可信号重写成功，货船重新被认成了朋友。',
    'ending.rescue': '旧港广播：补给车队回来了，调度员重新出现在值班表上。',
    ending: '旧港广播：星塔的回响留在了港口的日常里。',
  };
  const LIGHT_COUNT = { pre: 1, C0: 2, C1: 3, C2: 3, C3: 4, C4: 5, C5: 5, ending: 5 };

  const STYLE_TEXT = [
    '.ac-career-world {',
    '  gap: 10px;',
    '}',
    '.ac-career-world__where {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__view {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 10px;',
    '  min-width: 0;',
    '  padding-top: 10px;',
    '}',
    '.ac-career-world__port {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: center;',
    '  gap: 6px 10px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding: 8px 10px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.5);',
    '}',
    '.ac-career-world__lights {',
    '  display: inline-flex;',
    '  flex: 0 0 auto;',
    '  gap: 4px;',
    '  align-items: center;',
    '}',
    '.ac-career-world__light {',
    '  display: inline-block;',
    '  width: 8px;',
    '  height: 8px;',
    '  border: 1px solid rgba(147, 160, 200, 0.42);',
    '  border-radius: 50%;',
    '  background: rgba(147, 160, 200, 0.22);',
    '}',
    '.ac-career-world__light.is-lit {',
    '  border-color: #ffd23f;',
    '  background: #ffd23f;',
    '  box-shadow: 0 0 6px rgba(255, 210, 63, 0.62);',
    '}',
    '.ac-career-world__port[data-motion="subtle"] .ac-career-world__light.is-lit {',
    '  animation: ac-career-world-lamp 3.4s ease-in-out infinite;',
    '}',
    '.ac-career-world__broadcast {',
    '  flex: 1 1 170px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '@keyframes ac-career-world-lamp {',
    '  0%, 100% { opacity: 1; }',
    '  50% { opacity: 0.55; }',
    '}',
    '.ac-career-world__heading {',
    '  margin: 2px 0 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12.5px;',
    '  font-weight: 600;',
    '  letter-spacing: 0.04em;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__subheading {',
    '  margin: 4px 0 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__stage-text {',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__contacts,',
    '.ac-career-world__clues {',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding-left: 18px;',
    '}',
    '.ac-career-world__contact,',
    '.ac-career-world__clue {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__chapters,',
    '.ac-career-world__recent-list,',
    '.ac-career-world__earlier-list,',
    '.ac-career-world__side-list,',
    '.ac-career-world__replies {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding: 0;',
    '  list-style: none;',
    '}',
    '.ac-career-world__chapter {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 4px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.55);',
    '}',
    '.ac-career-world__chapter[data-state="locked"] {',
    '  border-style: dashed;',
    '}',
    '.ac-career-world__chapter-head {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: baseline;',
    '  gap: 2px 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-world__chapter-title {',
    '  margin: 0;',
    '  font-size: 13.5px;',
    '  font-weight: 600;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__badge {',
    '  flex: 0 0 auto;',
    '  padding: 1px 7px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 999px;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11px;',
    '  line-height: 1.6;',
    '  white-space: nowrap;',
    '}',
    '.ac-career-world__chapter[data-state="complete"] .ac-career-world__badge {',
    '  border-color: rgba(255, 210, 63, 0.55);',
    '  color: #ffd23f;',
    '}',
    '.ac-career-world__chapter[data-state="available"] .ac-career-world__badge,',
    '.ac-career-world__chapter[data-state="active"] .ac-career-world__badge {',
    '  border-color: rgba(126, 226, 168, 0.5);',
    '  color: #8ee6b0;',
    '}',
    '.ac-career-world__earlier-head {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-world__earlier-toggle {',
    '  flex: 0 0 auto;',
    '  min-height: 44px;',
    '  padding: 8px 12px;',
    '}',
    '.ac-career-world__hint {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__facts {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 2px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding-left: 18px;',
    '}',
    '.ac-career-world__fact {',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__chapter-body {',
    '  margin: 0;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__next {',
    '  margin: 0;',
    '  color: #8ee6b0;',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__section {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-world__section-head {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 4px 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-world__side-item,',
    '.ac-career-world__reply {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 2px;',
    '  min-width: 0;',
    '  padding: 8px 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(11, 16, 32, 0.55);',
    '}',
    '.ac-career-world__side-title,',
    '.ac-career-world__reply-name {',
    '  margin: 0;',
    '  font-size: 12.5px;',
    '  font-weight: 600;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__side-text,',
    '.ac-career-world__reply-text,',
    '.ac-career-world__reply-meta {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 12px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__reply-name {',
    '  color: var(--ac-career-ink, #eef1ff);',
    '}',
    '.ac-career-world__notice {',
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
    '.ac-career-world__gate {',
    '  margin: 0;',
    '  padding: 10px 12px;',
    '  border: 1px dashed var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  color: var(--ac-career-ink, #eef1ff);',
    '  font-size: 12.5px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__readonly {',
    '  margin: 0;',
    '  color: var(--ac-career-muted, #93a0c8);',
    '  font-size: 11.5px;',
    '  line-height: 1.6;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__endings-actions {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 8px;',
    '  min-width: 0;',
    '}',
    '.ac-career-world__endings-actions .ac-career-btn,',
    '.ac-career-world__footer .ac-career-btn,',
    '.ac-career-world__skip {',
    '  flex: 1 1 120px;',
    '  min-height: 44px;',
    '}',
    '.ac-career-world__skip {',
    '  flex: 0 0 auto;',
    '  min-width: 44px;',
    '}',
    '.ac-career-world__epilogue {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 6px;',
    '  min-width: 0;',
    '  padding: 10px;',
    '  border: 1px solid var(--ac-career-line, #2a3560);',
    '  border-radius: 10px;',
    '  background: rgba(21, 29, 58, 0.72);',
    '  font-size: 12.5px;',
    '  line-height: 1.7;',
    '  overflow-wrap: anywhere;',
    '}',
    '.ac-career-world__epilogue p {',
    '  margin: 0;',
    '}',
    '.ac-career-world__footer {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  padding-top: 2px;',
    '}',
    '@media (max-width: 375px) {',
    '  .ac-career-world__chapter {',
    '    padding: 9px;',
    '  }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .ac-career-world__light.is-lit {',
    '    animation: none !important;',
    '  }',
    '}',
  ].join('\n');

  let panel = null;
  let styleInjected = false;

  /* ---------------------------------------------------------------- 基础工具 */

  function documentOf() {
    return typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isArray(value) {
    return Array.isArray(value);
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

  function arrayOfText(value) {
    if (!isArray(value)) return [];
    const out = [];
    value.forEach((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        const text = cleanText(item);
        if (text) out.push(text);
        return;
      }
      if (isObject(item)) {
        const text = cleanText(item.text) || cleanText(item.label) || cleanText(item.title);
        if (text) out.push(text);
      }
    });
    return out;
  }

  function beatsOf(value) {
    const raw = isObject(value) ? value : {};
    return {
      start: cleanText(raw.start),
      progress: cleanText(raw.progress),
      complete: cleanText(raw.complete),
    };
  }

  function textList(value) {
    const out = [];
    (Array.isArray(value) ? value : []).forEach((item) => {
      const text = cleanText(typeof item === 'string' || typeof item === 'number' ? item : item && (item.text || item.label || item.title || item.name));
      if (text && out.indexOf(text) < 0) out.push(text);
    });
    return out;
  }

  function rootWindow() {
    return typeof window !== 'undefined' && window ? window : null;
  }

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

  /** 只接受同源 http(s) 相对地址；拒绝 javascript:/data:/协议相对地址。 */
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

  function reducedMotionOf(context) {
    const win = rootWindow();
    try {
      if (win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch (err) {
      /* 忽略 matchMedia 失败 */
    }
    return !!(isObject(context) && context.reducedMotion === true);
  }

  function stageRankOf(context) {
    const state = isObject(context) && isObject(context.state) ? context.state : null;
    const stage = cleanText(state && state.stage).toUpperCase();
    return STAGE_RANK[stage] === undefined ? 0 : STAGE_RANK[stage];
  }

  function careerIdOf(context) {
    if (!isObject(context)) return null;
    const candidates = [
      context.careerId,
      isObject(context.profile) ? context.profile.careerId : null,
      isObject(context.state) ? context.state.careerId : null,
      isObject(context.commissionRun) ? context.commissionRun.careerId : null,
      isObject(context.wallet) ? context.wallet.careerId : null,
      isObject(context.api) && isObject(context.api.commissionRun) ? context.api.commissionRun.careerId : null,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const id = idText(candidates[i]);
      if (id) return id;
    }
    return null;
  }

  /* ---------------------------------------------------------------- 只读状态推导 */

  function addFlags(value, out) {
    if (!value) return out;
    if (typeof value === 'string') {
      const flag = idText(value);
      if (flag) out.add(flag);
      return out;
    }
    if (isArray(value)) {
      value.forEach((item) => addFlags(item, out));
      return out;
    }
    if (isObject(value)) {
      Object.keys(value).forEach((key) => {
        if (!value[key]) return;
        const flag = idText(key);
        if (flag) out.add(flag);
      });
    }
    return out;
  }

  function normalizeChapterState(value) {
    const text = cleanText(value).toLowerCase().replace(/[\s-]+/g, '_');
    if (text === 'complete' || text === 'done' || text === 'finished' || text === 'cleared') return 'complete';
    if (text === 'active' || text === 'in_progress' || text === 'started' || text === 'current') return 'active';
    if (text === 'available' || text === 'open' || text === 'unlocked' || text === 'ready') return 'available';
    return 'locked';
  }

  function normalizeApproach(value) {
    let raw = value;
    if (isObject(raw)) raw = raw.approach || raw.ending || raw.id || raw.kind;
    const text = cleanText(raw).toLowerCase();
    return APPROACH_ORDER.indexOf(text) >= 0 ? text : '';
  }

  function normalizeRoutes(raw) {
    if (!isArray(raw)) return [];
    const out = [];
    raw.forEach((entry) => {
      if (!isObject(entry)) return;
      const routeId = idText(entry.routeId || entry.id);
      const hint = cleanText(entry.hint);
      if (!routeId && !hint) return;
      out.push({
        routeId: routeId,
        label: cleanText(entry.label) || cleanText(entry.title),
        hint: hint,
        available: entry.available !== false,
        complete: entry.complete === true,
      });
    });
    return out;
  }

  function normalizeSnapshot(raw) {
    if (!isObject(raw)) return null;
    const chapters = [];
    if (isArray(raw.chapters)) {
      raw.chapters.forEach((entry) => {
        if (!isObject(entry)) return;
        const chapterId = idText(entry.chapterId || entry.id);
        if (!chapterId) return;
        chapters.push({
          chapterId: chapterId,
          state: normalizeChapterState(entry.state || entry.status),
          title: cleanText(entry.title),
          routes: normalizeRoutes(entry.routes),
          mustKnow: arrayOfText(entry.mustKnow),
          body: cleanText(entry.body),
          handoff: cleanText(entry.handoff),
        });
      });
    }
    const endings = [];
    if (isArray(raw.endings)) {
      raw.endings.forEach((entry) => {
        if (!isObject(entry)) return;
        const approach = normalizeApproach(entry.approach || entry.ending || entry.id);
        if (!approach) return;
        endings.push({
          approach: approach,
          available: entry.available !== false,
          title: cleanText(entry.title),
          summary: cleanText(entry.summary),
        });
      });
    }
    const epilogue = isObject(raw.epilogue)
      ? raw.epilogue
      : cleanText(raw.epilogue)
        ? { base: cleanText(raw.epilogue) }
        : null;
    return {
      chapters: chapters,
      endings: endings,
      endingChosen: normalizeApproach(raw.endingChosen || raw.chosen || raw.endingApproach),
      epilogue: epilogue,
      currentChapter: idText(raw.currentChapter || raw.current),
      hasChapters: isArray(raw.chapters),
    };
  }

  function snapshotUseful(snapshot) {
    return !!(
      snapshot &&
      (snapshot.hasChapters || snapshot.endings.length || snapshot.endingChosen || snapshot.epilogue)
    );
  }

  function flagsOf(context) {
    const out = new Set();
    const c = isObject(context) ? context : {};
    addFlags(c.flags, out);
    addFlags(c.storyFlags, out);
    if (isObject(c.profile)) {
      addFlags(c.profile.flags, out);
      addFlags(c.profile.storyFlags, out);
    }
    if (isObject(c.state)) {
      addFlags(c.state.flags, out);
      addFlags(c.state.storyFlags, out);
    }
    if (isObject(c.wallet)) addFlags(c.wallet.flags, out);
    const snapshots = [
      c.campaignState,
      c.storyState,
      isObject(c.campaign) && !(typeof c.campaign.state === 'function') ? c.campaign.state : null,
      isObject(c.campaign) ? c.campaign.snapshot : null,
      isObject(c.state) ? c.state.campaign : null,
    ];
    snapshots.forEach((snapshot) => {
      if (!isObject(snapshot)) return;
      addFlags(snapshot.flags, out);
      const chapters = isArray(snapshot.chapters) ? snapshot.chapters : [];
      chapters.forEach((chapter) => {
        if (!isObject(chapter)) return;
        const chapterId = idText(chapter.chapterId || chapter.id);
        if (normalizeChapterState(chapter.state || chapter.status) !== 'complete') return;
        if (CHAPTER_FLAG[chapterId]) out.add(CHAPTER_FLAG[chapterId]);
      });
      const chosen = normalizeApproach(snapshot.endingChosen || snapshot.chosen);
      if (chosen) out.add('ending.' + chosen);
    });
    return out;
  }

  function endingApproachFromFlags(flags) {
    for (let i = 0; i < APPROACH_ORDER.length; i += 1) {
      if (flags.has('ending.' + APPROACH_ORDER[i])) return APPROACH_ORDER[i];
    }
    return '';
  }

  function invokeStateFunction(module, context) {
    if (!module || typeof module.state !== 'function') return null;
    const payload = {
      quests: isObject(context) ? context.quests || null : null,
      claims: isObject(context) ? context.claims || null : null,
      profile: isObject(context) && isObject(context.profile) ? context.profile : null,
      wallet: isObject(context) && isObject(context.wallet) ? context.wallet : null,
      flags: Array.from(flagsOf(context)),
      careerId: careerIdOf(context),
    };
    try {
      return module.state(payload);
    } catch (err) {
      return null;
    }
  }

  function campaignSnapshotOf(context) {
    const c = isObject(context) ? context : {};
    const direct = [c.campaignState, c.storyState];
    for (let i = 0; i < direct.length; i += 1) {
      const snapshot = normalizeSnapshot(direct[i]);
      if (snapshotUseful(snapshot)) return snapshot;
    }
    if (isObject(c.campaign)) {
      if (isObject(c.campaign.state)) {
        const snapshot = normalizeSnapshot(c.campaign.state);
        if (snapshotUseful(snapshot)) return snapshot;
      } else if (typeof c.campaign.state === 'function') {
        const snapshot = normalizeSnapshot(invokeStateFunction(c.campaign, c));
        if (snapshotUseful(snapshot)) return snapshot;
      }
      if (isObject(c.campaign.snapshot)) {
        const snapshot = normalizeSnapshot(c.campaign.snapshot);
        if (snapshotUseful(snapshot)) return snapshot;
      }
    }
    if (isObject(c.state) && isObject(c.state.campaign)) {
      const snapshot = normalizeSnapshot(c.state.campaign);
      if (snapshotUseful(snapshot)) return snapshot;
    }
    return null;
  }

  function campaignContentOf(context) {
    const c = isObject(context) ? context : {};
    const candidates = [
      c.campaignContent,
      c.campaignData,
      isObject(c.content) ? c.content.campaign : null,
      isObject(c.api) ? c.api.campaignContent : null,
    ];
    if (isObject(c.campaign) && isArray(c.campaign.chapters)) candidates.push(c.campaign);
    if (isObject(c.api) && isObject(c.api.campaign) && isArray(c.api.campaign.chapters)) candidates.push(c.api.campaign);
    for (let i = 0; i < candidates.length; i += 1) {
      if (isObject(candidates[i]) && isArray(candidates[i].chapters)) return candidates[i];
    }
    return null;
  }

  function completedCommissionIdsOf(context) {
    const out = new Set();
    const c = isObject(context) ? context : {};
    function collect(value) {
      if (!value) return;
      if (isArray(value)) {
        value.forEach((entry) => {
          if (typeof entry === 'string') {
            const id = idText(entry);
            if (id) out.add(id);
            return;
          }
          if (!isObject(entry)) return;
          const status = cleanText(entry.status || entry.state).toLowerCase();
          if (status && status !== 'cleared' && status !== 'complete' && status !== 'completed') return;
          const id = idText(entry.commissionId || entry.questId || entry.id);
          if (id) out.add(id);
        });
        return;
      }
      if (isObject(value)) {
        Object.keys(value).forEach((key) => {
          if (value[key]) out.add(idText(key));
        });
      }
    }
    collect(c.clearedCommissions);
    collect(c.completedCommissions);
    collect(c.claims);
    collect(c.quests);
    if (isObject(c.profile)) collect(c.profile.clearedCommissions);
    return out;
  }

  function requiresMet(requires, flags, completed, evidence) {
    if (!isObject(requires)) return true;
    const all = [];
    if (isArray(requires.allFlags)) all.push.apply(all, requires.allFlags);
    if (isArray(requires.flags)) all.push.apply(all, requires.flags);
    for (let i = 0; i < all.length; i += 1) {
      if (!flags.has(idText(all[i]))) return false;
    }
    const anyGroups = [requires.anyFlags, requires.anyChaosFlags];
    for (let g = 0; g < anyGroups.length; g += 1) {
      const group = anyGroups[g];
      if (!isArray(group) || !group.length) continue;
      let hit = false;
      group.forEach((flag) => {
        if (flags.has(idText(flag))) hit = true;
      });
      if (!hit) return false;
    }
    if (isArray(requires.anyCommissions) && requires.anyCommissions.length) {
      let hit = false;
      requires.anyCommissions.forEach((commissionId) => {
        const id = idText(commissionId);
        if (id && completed && completed.has(id)) hit = true;
      });
      if (!hit) return false;
    }
    const evidenceSet = evidence && typeof evidence.has === 'function' ? evidence : new Set();
    if (isArray(requires.evidenceAll)) {
      for (let e = 0; e < requires.evidenceAll.length; e += 1) {
        if (!evidenceSet.has(idText(requires.evidenceAll[e]))) return false;
      }
    }
    if (isArray(requires.evidenceAny) && requires.evidenceAny.length) {
      let hit = false;
      requires.evidenceAny.forEach((token) => {
        if (evidenceSet.has(idText(token))) hit = true;
      });
      if (!hit) return false;
    }
    return true;
  }

  function rewardFlagsMet(list, flags) {
    if (!isArray(list) || !list.length) return false;
    for (let i = 0; i < list.length; i += 1) {
      if (!flags.has(idText(list[i]))) return false;
    }
    return true;
  }

  function contentRoutesOf(contentChapter, flags, completed, evidence) {
    const routes = isObject(contentChapter) && isArray(contentChapter.routes) ? contentChapter.routes : [];
    const out = [];
    routes.forEach((route) => {
      if (!isObject(route)) return;
      out.push({
        routeId: idText(route.routeId),
        label: cleanText(route.label),
        hint: cleanText(route.hint),
        available: requiresMet(route.requires, flags, completed, evidence),
        complete: rewardFlagsMet(route.rewardFlags, flags),
      });
    });
    return out;
  }

  function pickHint(state, routes, contentRoutes, contentChapter, builtin) {
    const fallback = cleanText(contentChapter && contentChapter.fallback) || cleanText(builtin && builtin.fallback);
    if (state === 'locked') return fallback || cleanText(builtin && builtin.hint);
    const pool = [];
    const lists = [routes, contentRoutes];
    lists.forEach((list) => {
      list.forEach((route) => {
        if (route && route.hint && route.available !== false) pool.push(route.hint);
      });
    });
    if (!pool.length) {
      lists.forEach((list) => {
        list.forEach((route) => {
          if (route && route.hint) pool.push(route.hint);
        });
      });
    }
    if (!pool.length) pool.push(cleanText(builtin && builtin.hint));
    return pool[0] || fallback;
  }

  function chapterOf(model, chapterId) {
    if (!model || !isArray(model.chapters)) return null;
    for (let i = 0; i < model.chapters.length; i += 1) {
      if (model.chapters[i].chapterId === chapterId) return model.chapters[i];
    }
    return null;
  }

  function isChapterComplete(chapters, chapterId) {
    for (let i = 0; i < chapters.length; i += 1) {
      if (chapters[i].chapterId === chapterId && chapters[i].state === 'complete') return true;
    }
    return false;
  }

  function firstOpenChapter(chapters) {
    for (let i = 0; i < chapters.length; i += 1) {
      if (chapters[i].state === 'available' || chapters[i].state === 'active') return chapters[i].chapterId;
    }
    return '';
  }

  function lastCompleteChapter(chapters) {
    let found = '';
    chapters.forEach((chapter) => {
      if (chapter.state === 'complete') found = chapter.chapterId;
    });
    return found;
  }

  function normalizeEpilogue(raw) {
    if (!isObject(raw)) return null;
    const out = { base: cleanText(raw.base) || cleanText(raw.text) || '' };
    APPROACH_ORDER.forEach((approach) => {
      out[approach] = cleanText(raw[approach]);
    });
    if (!out.base && !out.combat && !out.research && !out.rescue) return null;
    return out;
  }

  function evidenceOf(context) {
    const out = new Set();
    const c = isObject(context) ? context : {};
    const add = (list) => {
      if (!isArray(list)) return;
      list.forEach((token) => {
        const id = idText(token);
        if (id) out.add(id);
      });
    };
    const rowsOf = (value) => {
      if (isArray(value)) return value;
      if (isObject(value)) return Object.keys(value).map((key) => value[key]);
      return [];
    };
    rowsOf(c.quests).forEach((row) => {
      if (isObject(row)) {
        add(row.evidence);
        add(row.receipt && row.receipt.evidence);
      }
    });
    rowsOf(c.claims).forEach((row) => {
      if (isObject(row)) add(row.evidence);
    });
    const snapshot = campaignSnapshotOf(c);
    if (isObject(c.campaignState) && isArray(c.campaignState.claims)) {
      c.campaignState.claims.forEach((row) => { if (isObject(row)) add(row.evidence); });
    }
    return out;
  }

  function buildChapter(chapterId, snapshotChapter, contentChapter, flags, completed, evidence) {
    const builtin = CHAPTER_FALLBACK[chapterId] || {};
    const contentRoutes = contentChapter ? contentRoutesOf(contentChapter, flags, completed, evidence) : [];
    const snapshotRoutes = snapshotChapter ? snapshotChapter.routes : [];
    const routes = snapshotRoutes.length ? snapshotRoutes : contentRoutes;
    let state = snapshotChapter ? snapshotChapter.state : '';
    if (!state) {
      const flagDone = flags.has(CHAPTER_FLAG[chapterId]) || (chapterId === 'C5' && !!endingApproachFromFlags(flags));
      if (flagDone) state = 'complete';
      else if (contentChapter) state = requiresMet(contentChapter.entry, flags, completed) ? 'available' : 'locked';
      else if (CHAPTER_FLAG[chapterId]) state = 'complete';
      else state = 'available';
    }
    if (state !== 'complete' && flags.has(CHAPTER_FLAG[chapterId])) state = 'complete';
    if (state !== 'complete' && chapterId === 'C5' && endingApproachFromFlags(flags)) state = 'complete';
    if (CHAPTER_STATES.indexOf(state) < 0) state = 'locked';
    const title =
      cleanText(snapshotChapter && snapshotChapter.title) ||
      cleanText(contentChapter && contentChapter.title) ||
      cleanText(builtin.title) ||
      '第 ' + chapterId + ' 章';
    const mustKnow =
      arrayOfText(contentChapter && contentChapter.mustKnow).length
        ? arrayOfText(contentChapter && contentChapter.mustKnow)
        : (snapshotChapter && snapshotChapter.mustKnow) || [];
    return {
      chapterId: chapterId,
      state: state,
      title: title,
      hint: pickHint(state, routes, contentRoutes, contentChapter, builtin),
      beats: beatsOf(contentChapter && contentChapter.beats),
      contacts: textList(contentChapter && contentChapter.contacts),
      clues: textList(contentChapter && contentChapter.clues),
      next: cleanText(contentChapter && contentChapter.next) || cleanText(NEXT_FALLBACK[chapterId]),
      routes: routes,
      mustKnow: mustKnow,
      body: cleanText(snapshotChapter && snapshotChapter.body) || cleanText(contentChapter && contentChapter.body),
      handoff: cleanText(snapshotChapter && snapshotChapter.handoff) || cleanText(contentChapter && contentChapter.handoff),
    };
  }

  function buildEndings(model, context, snapshot, content, flags, endingChosen) {
    const c4Complete = chapterOf(model, 'C4') && chapterOf(model, 'C4').state === 'complete';
    const entries = [];
    if (snapshot && snapshot.endings.length) {
      snapshot.endings.forEach((entry) => {
        entries.push({
          approach: entry.approach,
          title: entry.title || cleanText(APPROACH_FALLBACK[entry.approach] && APPROACH_FALLBACK[entry.approach].title),
          summary: entry.summary || cleanText(APPROACH_FALLBACK[entry.approach] && APPROACH_FALLBACK[entry.approach].summary),
          available: entry.available !== false && !endingChosen && !!c4Complete,
        });
      });
    } else if (content && isArray(content.endings)) {
      content.endings.forEach((entry) => {
        if (!isObject(entry)) return;
        const approach = normalizeApproach(entry.approach);
        if (!approach) return;
        const fallback = APPROACH_FALLBACK[approach] || { title: '', summary: '' };
        entries.push({
          approach: approach,
          title: cleanText(entry.title) || fallback.title,
          summary: cleanText(entry.summary) || fallback.summary,
          available: !endingChosen && !!c4Complete && requiresMet(entry.entry, flags, completedCommissionIdsOf(context)),
        });
      });
    }
    APPROACH_ORDER.forEach((approach) => {
      let found = false;
      entries.forEach((entry) => {
        if (entry.approach === approach) found = true;
      });
      if (found) return;
      const fallback = APPROACH_FALLBACK[approach] || { title: '终局', summary: '' };
      entries.push({
        approach: approach,
        title: fallback.title,
        summary: fallback.summary,
        available: !endingChosen && !!c4Complete,
      });
    });
    entries.sort((a, b) => APPROACH_ORDER.indexOf(a.approach) - APPROACH_ORDER.indexOf(b.approach));
    return entries;
  }

  function resolveEpilogue(context, snapshot, content, endingChosen) {
    if (snapshot && snapshot.epilogue) return normalizeEpilogue(snapshot.epilogue);
    if (content && isObject(content.epilogue)) {
      const normalized = normalizeEpilogue(content.epilogue);
      if (normalized) return normalized;
    }
    if (endingChosen && isObject(context) && isObject(context.campaign) && typeof context.campaign.epilogueFor === 'function') {
      try {
        const value = context.campaign.epilogueFor(endingChosen);
        if (typeof value === 'string' && cleanText(value)) return { base: cleanText(value), combat: '', research: '', rescue: '' };
        const normalized = normalizeEpilogue(value);
        if (normalized) return normalized;
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  function buildModel(context) {
    const content = campaignContentOf(context);
    const snapshot = campaignSnapshotOf(context);
    const flags = flagsOf(context);
    const completed = completedCommissionIdsOf(context);
    const evidence = evidenceOf(context);
    let endingChosen = (snapshot && snapshot.endingChosen) || endingApproachFromFlags(flags);
    if (endingChosen && !endingApproachFromFlags(flags)) flags.add('ending.' + endingChosen);
    if (endingChosen) flags.add('C5.star_tower_resolved');
    if (!content && !(snapshot && snapshot.hasChapters)) return null;

    const contentChapters = content && isArray(content.chapters) ? content.chapters : [];
    const contentMap = Object.create(null);
    contentChapters.forEach((entry) => {
      if (!isObject(entry)) return;
      const chapterId = idText(entry.chapterId);
      if (chapterId) contentMap[chapterId] = entry;
    });
    const chapterFiles = isObject(context.chapters) ? context.chapters : null;
    const snapshotChapters = snapshot && snapshot.hasChapters ? snapshot.chapters : [];
    const snapshotMap = Object.create(null);
    snapshotChapters.forEach((entry) => {
      if (entry.chapterId) snapshotMap[entry.chapterId] = entry;
    });

    let ids = [];
    if (contentChapters.length) {
      contentChapters.forEach((entry) => {
        if (!isObject(entry)) return;
        const chapterId = idText(entry.chapterId);
        if (chapterId && ids.indexOf(chapterId) < 0) ids.push(chapterId);
      });
    } else {
      snapshotChapters.forEach((entry) => {
        if (entry.chapterId && ids.indexOf(entry.chapterId) < 0) ids.push(entry.chapterId);
      });
    }
    CHAPTER_ORDER.forEach((chapterId) => {
      if (ids.indexOf(chapterId) >= 0) return;
      if (contentMap[chapterId] || snapshotMap[chapterId]) ids.push(chapterId);
    });
    if (!ids.length) return null;

    const chapters = ids.map((chapterId) => {
      const fileChapter = chapterFiles && isObject(chapterFiles[chapterId]) ? chapterFiles[chapterId] : null;
      const mergedChapter = contentMap[chapterId]
        ? Object.assign({}, fileChapter || {}, contentMap[chapterId], {
            /* beats/contacts/clues 只存在于章节文件，campaign-core 的章视图可能没有；取文件优先。 */
            beats: beatsOf((fileChapter && fileChapter.beats) || (contentMap[chapterId] && contentMap[chapterId].beats)),
            contacts: textList((fileChapter && fileChapter.contacts) || (contentMap[chapterId] && contentMap[chapterId].contacts)),
            clues: textList((fileChapter && fileChapter.clues) || (contentMap[chapterId] && contentMap[chapterId].clues)),
            next: cleanText(fileChapter && fileChapter.next) || cleanText(contentMap[chapterId] && contentMap[chapterId].next),
            body: cleanText(contentMap[chapterId].body) || cleanText(fileChapter && fileChapter.body),
            mustKnow: arrayOfText(contentMap[chapterId].mustKnow).length ? contentMap[chapterId].mustKnow : (fileChapter && fileChapter.mustKnow),
          })
        : fileChapter;
      return buildChapter(chapterId, snapshotMap[chapterId], mergedChapter, flags, completed, evidence);
    });
    const model = { chapters: chapters, endings: [], endingChosen: endingChosen, endingVisible: false, epilogue: null, currentChapter: '' };
    model.endings = buildEndings(model, context, snapshot, content, flags, endingChosen);
    model.endingVisible = isChapterComplete(chapters, 'C4') || flags.has('C4.city_power_restored');
    model.epilogue = resolveEpilogue(context, snapshot, content, endingChosen);
    model.currentChapter = (snapshot && snapshot.currentChapter) || firstOpenChapter(chapters) || lastCompleteChapter(chapters) || (chapters[0] && chapters[0].chapterId) || '';
    return model;
  }

  function revealedOf(model, context, flags) {
    if (!model) return false;
    const c0 = chapterOf(model, 'C0');
    if (c0 && c0.state === 'complete') return true;
    if (flags.has('C0.port_seen')) return true;
    return stageRankOf(context) >= STAGE_RANK.LOCAL;
  }

  function portPhaseOf(model, revealed) {
    if (!model || !revealed) {
      return { id: 'pre', broadcast: BROADCAST.pre, lit: LIGHT_COUNT.pre };
    }
    if (model.endingChosen) {
      const chosen = 'ending.' + model.endingChosen;
      return {
        id: 'ending',
        approach: model.endingChosen,
        broadcast: BROADCAST[chosen] || BROADCAST.ending,
        lit: LIGHT_COUNT.ending,
      };
    }
    let phase = '';
    CHAPTER_ORDER.forEach((chapterId) => {
      if (isChapterComplete(model.chapters, chapterId)) phase = chapterId;
    });
    if (!phase) {
      const current = model.currentChapter;
      phase = current && BROADCAST[current] ? current : 'C0';
    }
    return { id: phase, broadcast: BROADCAST[phase] || BROADCAST.C0, lit: LIGHT_COUNT[phase] || LIGHT_COUNT.C0 };
  }

  function endingModuleOf(context) {
    if (!isObject(context)) return null;
    if (isObject(context.ending)) return context.ending;
    if (isObject(context.api) && isObject(context.api.ending)) return context.api.ending;
    return null;
  }

  function endingStarterOf(context) {
    const module = endingModuleOf(context);
    if (module && typeof module.startEnding === 'function') {
      return {
        kind: 'module',
        start: function (approach) {
          return module.startEnding({ approach: approach });
        },
      };
    }
    if (isObject(context) && typeof context.startEnding === 'function') {
      return {
        kind: 'bridge',
        start: function (approach) {
          return context.startEnding(approach);
        },
      };
    }
    return null;
  }

  /* ---------------------------------------------------------------- 内容读取（npc / 支线 / 线索） */

  function npcContentOf(context) {
    const c = isObject(context) ? context : {};
    const candidates = [
      c.npc,
      c.npcContent,
      isObject(c.content) ? c.content.npc : null,
      isObject(c.api) ? c.api.npc : null,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      if (isObject(candidates[i]) && isArray(candidates[i].characters)) return candidates[i];
    }
    return null;
  }

  function sideStoriesContentOf(context) {
    const c = isObject(context) ? context : {};
    const candidates = [
      c.sideStories,
      c.sideStoriesContent,
      isObject(c.content) ? c.content.sideStories : null,
      isObject(c.api) ? c.api.sideStories : null,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      if (isObject(candidates[i]) && isArray(candidates[i].families)) return candidates[i];
    }
    return null;
  }

  function discoveredIdsOf(context) {
    const out = new Set();
    const c = isObject(context) ? context : {};
    function collect(value) {
      if (!value) return;
      if (isArray(value)) {
        value.forEach((entry) => {
          if (typeof entry === 'string') {
            const id = idText(entry);
            if (id) out.add(id);
            return;
          }
          if (!isObject(entry)) return;
          const id = idText(entry.clueId || entry.id);
          if (id) out.add(id);
        });
        return;
      }
      if (isObject(value)) {
        Object.keys(value).forEach((key) => {
          const id = idText(key);
          if (id) out.add(id);
        });
      }
    }
    if (isObject(c.state)) collect(c.state.clues);
    /* c.clues 是线索目录（含未发现），不能当作已发现集合。 */
    collect(c.discoveredClues);
    collect(c.clueIds);
    return out;
  }

  function repliesOf(model, context) {
    const npc = npcContentOf(context);
    if (!npc || !model || !isArray(model.chapters)) return [];
    const out = [];
    npc.characters.forEach((character) => {
      if (!isObject(character)) return;
      const characterId = idText(character.characterId || character.id);
      const replies = isArray(character.replies) ? character.replies : [];
      let chosen = null;
      replies.forEach((reply) => {
        if (!isObject(reply)) return;
        const chapterId = idText(reply.chapterId);
        const text = cleanText(reply.text);
        if (!chapterId || !text) return;
        /* 只显示已达到且对应章已完成的回信；进行中章的答案不提前泄漏。 */
        if (!isChapterComplete(model.chapters, chapterId)) return;
        if (!chosen || CHAPTER_ORDER.indexOf(chapterId) > CHAPTER_ORDER.indexOf(chosen.chapterId)) chosen = { chapterId: chapterId, text: text };
      });
      if (!chosen) return;
      out.push({
        characterId: characterId,
        name: cleanText(character.name) || characterId,
        role: cleanText(character.role),
        chapterId: chosen.chapterId,
        text: chosen.text,
      });
    });
    return out;
  }

  function sideStoriesOf(context) {
    const bundle = sideStoriesContentOf(context);
    if (!bundle) return [];
    const hasDiscoveryData = isObject(context) && (isObject(context.state) || isArray(context.discoveredClues) || isArray(context.clueIds));
    const discovered = discoveredIdsOf(context);
    const explicit = new Set();
    if (isArray(bundle.available)) {
      bundle.available.forEach((familyId) => {
        const id = idText(familyId);
        if (id) explicit.add(id);
      });
    }
    const out = [];
    bundle.families.forEach((family) => {
      if (!isObject(family)) return;
      const familyId = idText(family.familyId || family.id);
      const title = cleanText(family.title);
      const text = cleanText(family.text);
      if (!familyId || (!title && !text)) return;
      const marked = family.available === true || family.unlocked === true || explicit.has(familyId);
      const links = isArray(family.links) ? family.links.map(idText).filter(Boolean) : [];
      const hit = links.some((link) => discovered.has(link));
      /* 没有任何发现数据时按可选阅读展示；有发现数据则只展示已触发的家族。 */
      if (!marked && !hit && discovered.size > 0) return;
      out.push({ familyId: familyId, title: title || '未命名的支线', text: text });
    });
    return out;
  }

  /* ---------------------------------------------------------------- 面板构建 */

  function buildPanel(ctx, mounted) {
    const doc = documentOf();
    if (!doc) return null;
    const context = isObject(ctx) ? ctx : {};
    let liveContext = context;
    let liveReduced = reducedMotionOf(context);
    let repliesHidden = false;
    let endingPending = false;
    let earlierHidden = true;
    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    function make(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    const overlay = make('div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', PANEL_KEY);
    if (liveReduced) overlay.classList.add('is-reduced-motion');

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
    const where = make('p', 'ac-career-world__where', WHERE_TEXT);
    where.id = DESC_ID;
    const view = make('div', 'ac-career-world__view');
    view.setAttribute('data-view', 'world');
    const statusLine = make('p', 'ac-career-status');
    statusLine.hidden = true;

    body.appendChild(where);
    body.appendChild(view);
    body.appendChild(statusLine);
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);

    const liveRegion = make('div', 'ac-career-sr-only');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    overlay.appendChild(liveRegion);

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

    function portBlockOf(model, revealed) {
      const phase = portPhaseOf(model, revealed);
      const block = make('div', 'ac-career-world__port');
      block.setAttribute('data-port-state', phase.id);
      block.setAttribute('data-lit', String(phase.lit));
      block.setAttribute('data-motion', liveReduced ? 'static' : 'subtle');
      if (phase.approach) block.setAttribute('data-ending', phase.approach);
      const lights = make('span', 'ac-career-world__lights');
      lights.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 5; i += 1) {
        lights.appendChild(make('i', i < phase.lit ? 'ac-career-world__light is-lit' : 'ac-career-world__light'));
      }
      block.appendChild(lights);
      block.appendChild(make('p', 'ac-career-world__broadcast', phase.broadcast));
      return block;
    }

    function chapterRowOf(chapter) {
      const item = make('li', 'ac-career-world__chapter');
      item.setAttribute('data-chapter-id', chapter.chapterId);
      item.setAttribute('data-state', chapter.state);
      const rowHead = make('div', 'ac-career-world__chapter-head');
      const title = make('h4', 'ac-career-world__chapter-title', chapter.title);
      rowHead.appendChild(title);
      const badge = make('span', 'ac-career-world__badge', STATE_LABEL[chapter.state] || STATE_LABEL.locked);
      badge.setAttribute('data-state-label', chapter.state === 'active' ? 'current' : chapter.state === 'complete' ? 'recent' : chapter.state);
      rowHead.appendChild(badge);
      item.appendChild(rowHead);
      /* 锁定章只显示标题与状态；进行中只给待查疑问，不给答案。 */
      if (chapter.state === 'locked') return item;
      const isCurrent = chapter.state === 'active' || chapter.state === 'available';
      const playerText = chapter.beats[
        chapter.state === 'complete' ? 'complete' : chapter.state === 'active' ? 'progress' : 'start'
      ];
      if (playerText) item.appendChild(make('p', 'ac-career-world__stage-text', playerText));
      if (isCurrent) {
        const contacts = textList(chapter.contacts);
        if (contacts.length) {
          const list = make('ul', 'ac-career-world__contacts');
          list.setAttribute('data-contact-count', String(contacts.length));
          list.appendChild(make('li', 'ac-career-world__contact', CONTACTS_HEADING + '：' + contacts.join('、')));
          item.appendChild(list);
        }
        const clues = textList(chapter.clues);
        if (clues.length) {
          const list = make('ul', 'ac-career-world__clues');
          list.setAttribute('data-clue-count', String(clues.length));
          clues.forEach((clue) => list.appendChild(make('li', 'ac-career-world__clue', clue)));
          item.appendChild(list);
        }
        if (chapter.next) item.appendChild(make('p', 'ac-career-world__next', NEXT_HEADING + '：' + chapter.next));
      }
      if (chapter.state === 'complete' && chapter.body) item.appendChild(make('p', 'ac-career-world__chapter-body', chapter.body));
      if (chapter.state === 'complete' && chapter.mustKnow && chapter.mustKnow.length) {
        const facts = make('ul', 'ac-career-world__facts');
        facts.setAttribute('data-fact-count', String(chapter.mustKnow.length));
        chapter.mustKnow.forEach((fact) => {
          facts.appendChild(make('li', 'ac-career-world__fact', fact));
        });
        item.appendChild(facts);
      }
      if (chapter.hint && chapter.state !== 'locked') item.appendChild(make('p', 'ac-career-world__hint', chapter.hint));
      return item;
    }

    function chaptersSectionOf(model) {
      const section = make('section', 'ac-career-world__section ac-career-world__chapters-section');
      section.appendChild(make('h3', 'ac-career-world__heading', model.chapters.length === 6 ? CHAPTERS_HEADING : CHAPTERS_HEADING_OTHER));
      /* 当前章可为 active 或 available；当前章 + 最近完成章在前，更早的折叠回看。 */
      const current =
        model.chapters.filter((chapter) => chapter.state === 'active').slice(-1)[0] ||
        model.chapters.filter((chapter) => chapter.state === 'available').slice(-1)[0] ||
        null;
      const recentComplete = model.chapters.filter((chapter) => chapter.state === 'complete').slice(-1)[0] || null;
      const recentIds = [];
      model.chapters.forEach((chapter) => {
        if (chapter === recentComplete || chapter === current) recentIds.push(chapter.chapterId);
      });
      if (!recentIds.length && model.chapters[0]) recentIds.push(model.chapters[0].chapterId);
      const recentList = make('ul', 'ac-career-world__chapters ac-career-world__recent-list');
      recentList.setAttribute('data-chapter-count', String(recentIds.length));
      recentIds.forEach((chapterId) => {
        const chapter = chapterOf(model, chapterId);
        if (chapter) recentList.appendChild(chapterRowOf(chapter));
      });
      section.appendChild(make('h4', 'ac-career-world__subheading', RECENT_HEADING));
      section.appendChild(recentList);

      const earlier = model.chapters.filter((chapter) => recentIds.indexOf(chapter.chapterId) < 0);
      if (!earlier.length) return section;
      const head = make('div', 'ac-career-world__earlier-head');
      head.appendChild(make('h4', 'ac-career-world__subheading', EARLIER_HEADING));
      const toggle = make('button', 'ac-career-btn ac-career-btn--ghost ac-career-world__earlier-toggle', earlierHidden ? EXPAND_LABEL : COLLAPSE_LABEL);
      toggle.type = 'button';
      toggle.setAttribute('data-action', 'toggle-earlier-chapters');
      toggle.setAttribute('aria-expanded', earlierHidden ? 'false' : 'true');
      toggle.addEventListener('click', function () {
        earlierHidden = !earlierHidden;
        toggle.textContent = earlierHidden ? EXPAND_LABEL : COLLAPSE_LABEL;
        toggle.setAttribute('aria-expanded', earlierHidden ? 'false' : 'true');
        earlierList.hidden = earlierHidden;
        announce(earlierHidden ? ANNOUNCE_CHAPTERS_COLLAPSED : ANNOUNCE_CHAPTERS_EXPANDED);
      }, false);
      head.appendChild(toggle);
      section.appendChild(head);
      const earlierList = make('ul', 'ac-career-world__chapters ac-career-world__earlier-list');
      earlierList.setAttribute('data-chapter-count', String(earlier.length));
      earlierList.hidden = earlierHidden;
      earlier.forEach((chapter) => earlierList.appendChild(chapterRowOf(chapter)));
      section.appendChild(earlierList);
      return section;
    }

    function sideSectionOf(context2) {
      const families = sideStoriesOf(context2);
      if (!families.length) return null;
      const section = make('section', 'ac-career-world__section ac-career-world__side');
      section.setAttribute('data-side-count', String(families.length));
      section.appendChild(make('h3', 'ac-career-world__heading', SIDE_HEADING));
      const list = make('ul', 'ac-career-world__side-list');
      families.forEach((family) => {
        const item = make('li', 'ac-career-world__side-item');
        item.setAttribute('data-family-id', family.familyId);
        item.appendChild(make('h4', 'ac-career-world__side-title', family.title));
        if (family.text) item.appendChild(make('p', 'ac-career-world__side-text', family.text));
        list.appendChild(item);
      });
      section.appendChild(list);
      return section;
    }

    function repliesSectionOf(context2, model) {
      const replies = repliesOf(model, context2);
      if (!replies.length) return null;
      const section = make('section', 'ac-career-world__section ac-career-world__replies-section');
      section.setAttribute('data-reply-count', String(replies.length));
      const row = make('div', 'ac-career-world__section-head');
      row.appendChild(make('h3', 'ac-career-world__heading', REPLIES_HEADING));
      const skipBtn = make('button', 'ac-career-btn ac-career-btn--ghost ac-career-world__skip', repliesHidden ? UNSKIP_LABEL : SKIP_LABEL);
      skipBtn.type = 'button';
      skipBtn.setAttribute('data-action', 'skip-replies');
      skipBtn.setAttribute('aria-pressed', repliesHidden ? 'true' : 'false');
      skipBtn.setAttribute('aria-controls', 'ac-career-world-replies');
      row.appendChild(skipBtn);
      section.appendChild(row);
      const list = make('ul', 'ac-career-world__replies');
      list.id = 'ac-career-world-replies';
      list.hidden = repliesHidden;
      replies.forEach((reply) => {
        const item = make('li', 'ac-career-world__reply');
        item.setAttribute('data-character-id', reply.characterId);
        if (reply.chapterId) item.setAttribute('data-chapter-id', reply.chapterId);
        const name = make('h4', 'ac-career-world__reply-name', reply.name);
        item.appendChild(name);
        if (reply.role) item.appendChild(make('p', 'ac-career-world__reply-meta', reply.role));
        item.appendChild(make('p', 'ac-career-world__reply-text', reply.text));
        list.appendChild(item);
      });
      skipBtn.addEventListener(
        'click',
        function () {
          repliesHidden = !repliesHidden;
          skipBtn.textContent = repliesHidden ? UNSKIP_LABEL : SKIP_LABEL;
          skipBtn.setAttribute('aria-pressed', repliesHidden ? 'true' : 'false');
          list.hidden = repliesHidden;
          announce(repliesHidden ? ANNOUNCE_REPLIES_HIDDEN : ANNOUNCE_REPLIES_SHOWN);
        },
        false
      );
      section.appendChild(list);
      return section;
    }

    function startEnding(approach, button) {
      const starter = endingStarterOf(liveContext);
      const readonly = !careerIdOf(liveContext);
      if (readonly) {
        setStatus(STATUS_READONLY);
        announce(STATUS_READONLY);
        return;
      }
      if (!starter) {
        setStatus(DEGRADED_TEXT);
        announce(DEGRADED_TEXT);
        return;
      }
      if (endingPending) return;
      endingPending = true;
      if (button) button.disabled = true;
      const finishing = function (result) {
        endingPending = false;
        if (button && button.isConnected) button.disabled = false;
        settleEnding(approach, result, starter.kind === 'module');
      };
      let returned = null;
      try {
        returned = starter.start(approach);
      } catch (err) {
        finishing({ ok: false, reason: 'exception' });
        return;
      }
      if (returned && typeof returned.then === 'function') {
        returned.then(finishing, function () {
          finishing({ ok: false, reason: 'exception' });
        });
        return;
      }
      finishing(returned);
    }

    function settleEnding(approach, result, navigateHere) {
      const failed = isObject(result) && result.ok === false;
      if (failed) {
        setStatus(STATUS_FAILED);
        announce(STATUS_FAILED);
        return;
      }
      const url = isObject(result) ? safeNavUrl(result.url) : '';
      if (navigateHere && url) {
        setStatus(STATUS_NAVIGATING);
        announce(STATUS_NAVIGATING);
        const win = rootWindow();
        try {
          if (win && win.location && typeof win.location.assign === 'function') win.location.assign(url);
        } catch (err) {
          setStatus(STATUS_NO_URL);
          announce(STATUS_NO_URL);
        }
        return;
      }
      if (isObject(result) && result.ok === true && !url) {
        setStatus(STATUS_NO_URL);
        announce(STATUS_NO_URL);
        return;
      }
      /* bridge 兜底：bridge.startEnding 已经处理导航；这里不复述 url。 */
      if (isObject(result) && result.ok === true) {
        setStatus(STATUS_NAVIGATING);
        announce(STATUS_NAVIGATING);
        return;
      }
      setStatus(STATUS_FAILED);
      announce(STATUS_FAILED);
    }

    function endingsSectionOf(model) {
      const section = make('section', 'ac-career-world__section ac-career-world__endings');
      section.setAttribute('data-ending-visible', 'true');
      section.appendChild(make('h3', 'ac-career-world__heading', ENDINGS_HEADING));
      if (model.endingChosen) {
        section.setAttribute('data-ending-chosen', model.endingChosen);
        const chosenEntry = model.endings.filter((entry) => entry.approach === model.endingChosen)[0];
        const title = chosenEntry && chosenEntry.title ? chosenEntry.title : APPROACH_FALLBACK[model.endingChosen].title;
        section.appendChild(make('p', 'ac-career-world__notice', CHOSEN_NOTE_PREFIX + '「' + title + '」' + CHOSEN_NOTE_SUFFIX));
        return section;
      }
      section.appendChild(make('p', 'ac-career-world__hint', ENDINGS_NOTE));
      const readonly = !careerIdOf(liveContext);
      const starter = endingStarterOf(liveContext);
      const actions = make('div', 'ac-career-world__endings-actions');
      model.endings.forEach((entry) => {
        const button = make('button', 'ac-career-btn ac-career-btn--primary', entry.title);
        button.type = 'button';
        button.setAttribute('data-approach', entry.approach);
        button.setAttribute('aria-label', '选择「' + entry.title + '」终局');
        if (!entry.available || readonly || !starter) {
          button.disabled = true;
          button.setAttribute('aria-disabled', 'true');
        }
        button.addEventListener(
          'click',
          function () {
            startEnding(entry.approach, button);
          },
          false
        );
        actions.appendChild(button);
      });
      section.appendChild(actions);
      return section;
    }

    function epilogueSectionOf(model) {
      const epilogue = model.epilogue;
      if (!epilogue) return null;
      const section = make('section', 'ac-career-world__section ac-career-world__epilogue');
      section.setAttribute('data-epilogue', 'true');
      section.setAttribute('data-approach', model.endingChosen || '');
      section.appendChild(make('h3', 'ac-career-world__heading', EPILOGUE_HEADING));
      if (epilogue.base) section.appendChild(make('p', 'ac-career-world__epilogue-base', epilogue.base));
      const specific = model.endingChosen ? epilogue[model.endingChosen] : '';
      if (specific) section.appendChild(make('p', 'ac-career-world__epilogue-approach', specific));
      return section;
    }

    function paint() {
      liveReduced = reducedMotionOf(liveContext);
      if (liveReduced) overlay.classList.add('is-reduced-motion');
      else overlay.classList.remove('is-reduced-motion');
      const model = buildModel(liveContext);
      const flags = flagsOf(liveContext);
      const revealed = revealedOf(model, liveContext, flags);
      const readonly = !careerIdOf(liveContext);
      sheet.setAttribute('data-readonly', readonly ? 'true' : 'false');
      endingPending = false;
      view.textContent = '';
      view.appendChild(portBlockOf(model, revealed));
      if (!model) {
        const notice = make('p', 'ac-career-world__notice', DEGRADED_TEXT);
        notice.setAttribute('data-degraded', 'campaign');
        view.appendChild(notice);
        view.appendChild(footerOf());
        return;
      }
      if (!revealed) {
        const gate = make('p', 'ac-career-world__gate', GATE_TEXT);
        gate.setAttribute('data-gate', 'c0');
        view.appendChild(gate);
        view.appendChild(footerOf());
        return;
      }
      view.appendChild(chaptersSectionOf(model));

      const side = sideSectionOf(liveContext);
      if (side) view.appendChild(side);
      const replies = repliesSectionOf(liveContext, model);
      if (replies) view.appendChild(replies);

      const starter = endingStarterOf(liveContext);
      if (!starter) {
        const notice = make('p', 'ac-career-world__notice', DEGRADED_TEXT);
        notice.setAttribute('data-degraded', 'ending');
        view.appendChild(notice);
      }
      if (model.endingVisible) view.appendChild(endingsSectionOf(model));
      if (model.endingChosen) {
        const epilogue = epilogueSectionOf(model);
        if (epilogue) view.appendChild(epilogue);
      }
      if (readonly) {
        const note = make('p', 'ac-career-world__readonly', READONLY_TEXT);
        note.setAttribute('data-readonly', 'true');
        view.appendChild(note);
      }
      view.appendChild(footerOf());
    }

    function footerOf() {
      const footer = make('div', 'ac-career-world__footer');
      const back = make('button', 'ac-career-btn ac-career-btn--ghost', BACK_LABEL);
      back.type = 'button';
      back.setAttribute('data-action', 'close-world');
      back.addEventListener('click', function () { close(); }, false);
      footer.appendChild(back);
      const openMailbox = typeof liveContext?.openMailbox === 'function' ? liveContext.openMailbox : null;
      if (openMailbox) {
        const mail = make('button', 'ac-career-btn ac-career-btn--ghost', '回信箱');
        mail.type = 'button';
        mail.setAttribute('data-action', 'open-mailbox-from-world');
        mail.addEventListener('click', function () { close(); try { openMailbox(); } catch (err) { /* ignore */ } }, false);
        footer.appendChild(mail);
      }
      const openTown = typeof liveContext?.openTown === 'function' ? liveContext.openTown : null;
      if (openTown) {
        const town = make('button', 'ac-career-btn ac-career-btn--ghost', '去告示板');
        town.type = 'button';
        town.setAttribute('data-action', 'open-town-from-world');
        town.addEventListener('click', function () { close(); try { openTown(); } catch (err) { /* ignore */ } }, false);
        footer.appendChild(town);
      }
      return footer;
    }

    function start() {
      paint();
    }

    function refresh(next) {
      liveContext = isObject(next) ? next : liveContext;
      setStatus('');
      paint();
      if (mounted) {
        const active = doc.activeElement;
        if (!sheet.contains(active)) safelyFocus(closeBtn);
      }
      return sheet;
    }

    function destroy() {
      view.textContent = '';
    }

    return {
      doc: doc,
      overlay: overlay,
      sheet: sheet,
      previousFocus: previousFocus,
      closeBtn: closeBtn,
      context: context,
      start: start,
      refresh: refresh,
      destroy: destroy,
      announce: announce,
      setStatus: setStatus,
      repliesSectionOf: repliesSectionOf,
      buildModel: function () { return buildModel(liveContext); },
    };
  }

  /** 关闭旧港来信面板并把焦点还给打开前的元素（可重复调用）。 */
  function close() {
    const current = panel;
    panel = null;
    if (!current) return false;
    try {
      current.doc.removeEventListener('keydown', current.onKeyDown, true);
    } catch (err) {
      /* ignore */
    }
    if (typeof current.destroy === 'function') {
      try {
        current.destroy();
      } catch (err) {
        /* ignore */
      }
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
   * 打开「旧港来信」章节面板。
   * @param {object} [ctx] bridge 上下文（缺失字段按空处理，不抛异常）
   * @returns {Element|null} panel sheet；无 DOM 或挂载失败时返回 null
   */
  function open(ctx) {
    const doc = documentOf();
    if (!doc) return null;
    ensureStyle(doc);
    /* 幂等：重复 open 先关掉上一份，避免叠层。 */
    close();

    const built = buildPanel(ctx, true);
    if (!built) return null;
    if (!doc.body) return null;
    try {
      doc.body.appendChild(built.overlay);
    } catch (err) {
      return null;
    }

    function onKeyDown(event) {
      if (!event) return;
      if (event.defaultPrevented) return;
      /* 只处理最上层 career 面板；下层面板（如告示板/机库）不抢 Esc/Tab。 */
      const stacks = doc.querySelectorAll ? doc.querySelectorAll('[data-career-panel]') : [];
      if (stacks && stacks.length && stacks[stacks.length - 1] !== built.overlay) return;
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
      if (key === 'Escape' || key === 'Esc' || code === 27) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
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
    built.overlay.addEventListener(
      'pointerdown',
      function (event) {
        pressedBackdrop = !!(event && event.target === built.overlay);
      },
      false
    );
    built.overlay.addEventListener(
      'pointercancel',
      function () {
        pressedBackdrop = false;
      },
      false
    );
    built.overlay.addEventListener(
      'click',
      function (event) {
        const onBackdrop = !!(event && event.target === built.overlay) && pressedBackdrop;
        pressedBackdrop = false;
        if (onBackdrop) close();
      },
      false
    );
    built.closeBtn.addEventListener('click', function () { close(); }, false);
    doc.addEventListener('keydown', onKeyDown, true);

    panel = {
      doc: doc,
      overlay: built.overlay,
      sheet: built.sheet,
      previousFocus: built.previousFocus,
      onKeyDown: onKeyDown,
      refresh: built.refresh,
      destroy: built.destroy,
    };
    built.start();
    safelyFocus(built.closeBtn);
    return built.sheet;
  }

  /**
   * 渲染章节面板。
   * - 面板已打开：原地刷新（不叠层、不抢焦点），返回 sheet；
   * - 面板未打开：构建后返回未挂载的 sheet（供测试检查 DOM，不产生全局副作用）。
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
  root.ArcadeCareerUI.worldState = api;
})(typeof window !== 'undefined' ? window : globalThis);
