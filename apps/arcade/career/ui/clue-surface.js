/*!
 * StudioKit Arcade Life — 结算处微线索（0.15 / D15-05）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.clueSurface，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.clueSurface.render({ clue, onOpen, host, placement, anchor,
 *     state, uiComponents, invitationForClue, reducedMotion });
 *   window.ArcadeCareerUI.clueSurface.clear();
 *
 * 0.23 bridge request: pass uiComponents, the frozen stateSnapshot and, when
 * available, invitationForClue(clueId) so the internal profession gate can use
 * the gated small face. Never pass a full catalog.
 *
 * 0.22 披露边界（ADR §23.3）：
 * - bridge 只传入一条已判定的 clue；本模块只消费 clue/onOpen/host；
 * - 不列举职业或委托，不读取 careerView/catalog，不渲染任务详情或主操作按钮；
 * - 即使 options 带额外投影/邀请字段，也只保留这一枚低强调线索。
 * - 只在结算安全点出现：不自动弹信件、不自动打开面板、不抢焦点、无声音、无震动；
 * - role="button" + tabindex="0"，点击 / Enter / Space 打开同一封线索；
 * - 热区 ≥44×44px（视觉药丸可小于热区），prefers-reduced-motion 下无动画；
 * - 文案优先 clue.ambientLabel，其次 clue.title，全部来自内容包，不做 16 款硬编码；
 * - 重复 render 先 clear()；clear() 后 DOM 中不残留节点。
 */
(function (root) {
  'use strict';

  const CHIP_CLASS = 'ac-career-clue';
  const FLOATING_CLASS = 'ac-career-clue--floating';
  const HOST_CLASS = 'ac-career-clue--host';
  const PILL_CLASS = 'ac-career-clue__pill';
  const GLYPH_CLASS = 'ac-career-clue__glyph';
  const LABEL_CLASS = 'ac-career-clue__label';
  const FALLBACK_LABEL = '来源不明的信';
  const ARIA_PREFIX = '发现一封来源不明的信：';
  const ACTIVATE_KEYS = ['Enter', ' ', 'Spacebar'];
  const KEY_ENTER = 13;
  const KEY_SPACE = 32;

  /* 当前挂载的 chip；同一时刻只允许一个，重复 render 会先 clear。 */
  let active = null;

  function documentOf() {
    return typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null;
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function chipLabel(clue) {
    if (!clue) return FALLBACK_LABEL;
    return cleanText(clue.ambientLabel) || cleanText(clue.title) || FALLBACK_LABEL;
  }

  function chipAriaLabel(clue) {
    const title = cleanText(clue && clue.title) || chipLabel(clue);
    return ARIA_PREFIX + title;
  }

  /**
   * 解析挂载点：显式 host（元素或选择器）优先；没有 host / host 失效时回退 body，
   * 并标记为浮动 chip（CSS 用 fixed 定位贴在角落，不压画布中央）。
   * @param {Element|string|undefined} host
   * @returns {{target: Element, floating: boolean}|null}
   */
  function resolveMount(host) {
    const doc = documentOf();
    if (!doc) return null;
    let target = null;
    if (typeof host === 'string') {
      try {
        target = doc.querySelector(host);
      } catch (err) {
        target = null;
      }
    } else if (host && typeof host === 'object' && (host.nodeType === 1 || typeof host.appendChild === 'function')) {
      target = host;
    }
    if (target && typeof target.appendChild === 'function') return { target: target, floating: false };
    const fallback = (doc.body && typeof doc.body.appendChild === 'function' && doc.body) || doc.documentElement || null;
    return fallback ? { target: fallback, floating: true } : null;
  }

  function removeNode(node) {
    try {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    } catch (err) {
      /* 宿主已卸载时忽略 */
    }
  }

  /** 移除当前 chip（可重复调用；未渲染时是空操作）。 */
  function clear() {
    const current = active;
    active = null;
    if (!current) return false;
    try {
      if (typeof current.cleanup === 'function') current.cleanup();
      else {
        current.node.removeEventListener('click', current.onClick, false);
        current.node.removeEventListener('keydown', current.onKeyDown, false);
      }
    } catch (err) {
      /* 老引擎的监听器移除失败不影响 DOM 清理 */
    }
    removeNode(current.node);
    return true;
  }

  /**
   * 渲染可点按的 micro-clue chip。
   * @param {{clue?: object, onOpen?: (clueId: string) => void, host?: Element|string}} [options]
   * @returns {Element|null} 新建的 chip；无 DOM / 无合法 clue / 宿主不可用时返回 null
   */
  function renderLegacy(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const clue = opts.clue && typeof opts.clue === 'object' ? opts.clue : null;
    /* 契约要求：重复 render 先 clear（无效参数也要清掉旧 chip，避免陈旧线索残留）。 */
    clear();
    if (!clue) return null;
    const clueId = cleanText(clue.clueId);
    if (!clueId) return null;

    const mount = resolveMount(opts.host);
    if (!mount) return null;
    const doc = (mount.target.ownerDocument || documentOf() || null);
    if (!doc || typeof doc.createElement !== 'function') return null;

    const pill = doc.createElement('span');
    pill.className = PILL_CLASS;

    const glyph = doc.createElement('span');
    glyph.className = GLYPH_CLASS;
    glyph.textContent = '✉';

    const label = doc.createElement('span');
    label.className = LABEL_CLASS;
    label.textContent = chipLabel(clue);

    pill.appendChild(glyph);
    pill.appendChild(label);

    const node = doc.createElement('div');
    node.className = CHIP_CLASS;
    /* 有 host 时用 host 内的角落绝对定位：bridge 传的 host 是结算弹层
       (.overlay: display:flex 居中)，普通行内插入会把结算面板挤偏。 */
    if (mount.floating) node.className = CHIP_CLASS + ' ' + FLOATING_CLASS;
    else node.className = CHIP_CLASS + ' ' + HOST_CLASS;
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('data-career-clue', clueId);
    node.setAttribute('data-clue-id', clueId);
    node.setAttribute('aria-label', chipAriaLabel(clue));
    node.appendChild(pill);

    /* 只调用一次 onOpen，且不吞掉回调异常以外的任何行为。 */
    function activate() {
      if (typeof opts.onOpen !== 'function') return;
      try {
        opts.onOpen(clueId);
      } catch (err) {
        /* 结算流程不因线索回调异常中断；bridge 负责自己的错误处理 */
      }
    }

    function onClick(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      activate();
    }

    function onKeyDown(event) {
      if (!event) return;
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
      if (ACTIVATE_KEYS.indexOf(key) < 0 && code !== KEY_ENTER && code !== KEY_SPACE) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      activate();
    }

    node.addEventListener('click', onClick, false);
    node.addEventListener('keydown', onKeyDown, false);

    try {
      mount.target.appendChild(node);
    } catch (err) {
      try {
        node.removeEventListener('click', onClick, false);
        node.removeEventListener('keydown', onKeyDown, false);
      } catch (removeErr) {
        /* ignore */
      }
      return null;
    }

    active = { node: node, onClick: onClick, onKeyDown: onKeyDown, clueId: clueId };
    return node;
  }

  /* 0.23 T12：真实 bridge payload → T11 ClueRow 的唯一派生面。 */
  const FAMILY_ICONS = { record: 'mail', signal: 'scroll', bio: 'gem', industrial: 'pick', route: 'chevron' };

  function invitationOf(opts, clueId) {
    let raw = opts.invitation;
    if (!raw && typeof opts.invitationForClue === 'function') {
      try { raw = opts.invitationForClue(clueId); } catch (err) { raw = null; }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const professionId = cleanText(raw.professionId);
    return professionId ? { professionId: professionId, state: cleanText(raw.state) } : null;
  }

  function deriveProps(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const clue = opts.clue && typeof opts.clue === 'object' ? opts.clue : null;
    if (!clue) return null;
    const clueId = cleanText(clue.clueId);
    const gameId = cleanText(clue.gameId);
    const state = opts.state && typeof opts.state === 'object' ? opts.state : null;
    const records = state && state.clues && typeof state.clues === 'object' ? state.clues : null;
    const record = records && records[clueId] && typeof records[clueId] === 'object' ? records[clueId] : null;
    if (!clueId || !gameId || !record) return null;

    const opened = !!cleanText(record.openedAt);
    const hasReadClue = Object.keys(records).some((id) => id !== clueId && !!(records[id] && cleanText(records[id].openedAt)));
    const stage = cleanText(state.stage).toUpperCase();
    const recoverable = !opened && !cleanText(state.portSeenAt)
      && (stage === 'GLIMPSED' || stage === 'CURIOUS') && hasReadClue;
    const clueState = recoverable ? 'recoverable' : (opened ? 'read' : 'glimpsed');
    const letter = clue.letter && typeof clue.letter === 'object' ? clue.letter : {};
    const family = cleanText(clue.family);
    const placement = opts.placement === 'page-corner' ? 'page-corner'
      : (opts.placement === 'list' ? 'list' : 'result-host');
    const invitation = invitationOf(opts, clueId);
    return {
      clueId: clueId,
      gameId: gameId,
      professionId: invitation ? invitation.professionId : (cleanText(opts.professionId) || null),
      icon: recoverable ? 'mail' : (FAMILY_ICONS[family] || 'gem'),
      title: cleanText(clue.ambientLabel) || cleanText(clue.title),
      teaser: cleanText(clue.ambientText),
      actionLabel: recoverable ? (cleanText(letter.actionLabel) || '按地址投递')
        : (clueState === 'read' ? '查看这封信' : '仔细看看'),
      state: clueState,
      placement: placement,
      reducedMotion: opts.reducedMotion === true,
    };
  }

  function render(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const props = deriveProps(opts);
    clear();
    const components = opts.uiComponents && typeof opts.uiComponents.ClueRow === 'function'
      ? opts.uiComponents
      : root.ArcadeCareerUI && root.ArcadeCareerUI.components;
    if (!components || typeof components.ClueRow !== 'function') {
      /* T11 尚未装载时保留旧宿主可用性；正式 0.23 loader 必须提供组件。 */
      return renderLegacy(opts);
    }
    if (!props) return null;
    const mount = resolveMount(opts.host);
    if (!mount) return null;
    const doc = mount.target.ownerDocument || documentOf();
    if (!doc || typeof doc.createElement !== 'function') return null;
    const clueId = props.clueId;
    const node = components.ClueRow(Object.assign({}, props, {
      onOpen(id) {
        if (typeof opts.onOpen !== 'function') return;
        try { opts.onOpen(id); } catch (err) { /* 结算主流程不受线索回调异常影响 */ }
      },
    }));
    if (!node) return null;
    node.setAttribute('data-clue-id', clueId);
    const wrapper = doc.createElement('div');
    wrapper.className = 'ac-career-ui';
    wrapper.setAttribute('data-career-clue', clueId);
    wrapper.appendChild(node);
    let next = null;
    if (opts.anchor && opts.anchor.parentNode && typeof opts.anchor.parentNode.insertBefore === 'function') {
      next = opts.anchor.nextSibling || null;
    }
    try {
      if (next && next.parentNode === mount.target && typeof mount.target.insertBefore === 'function') mount.target.insertBefore(wrapper, next);
      else mount.target.appendChild(wrapper);
    } catch (err) {
      return null;
    }
    active = { node: wrapper, cleanup: null };
    return wrapper;
  }

  const api = {
    render: render,
    clear: clear,
    deriveProps: deriveProps,
  };

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.clueSurface = api;
})(typeof window !== 'undefined' ? window : globalThis);
