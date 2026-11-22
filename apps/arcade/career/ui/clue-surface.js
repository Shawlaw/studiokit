/*!
 * StudioKit Arcade Life — 结算处微线索（0.15 / D15-05）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.clueSurface，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.clueSurface.render({ clue, onOpen, host });
 *   window.ArcadeCareerUI.clueSurface.clear();
 *
 * 约束（docs/arcade-life/ADR-interfaces.md §14 微线索 UI 规则、§17 UI 模块契约）：
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
    if (!current) return;
    try {
      current.node.removeEventListener('click', current.onClick, false);
      current.node.removeEventListener('keydown', current.onKeyDown, false);
    } catch (err) {
      /* 老引擎的监听器移除失败不影响 DOM 清理 */
    }
    removeNode(current.node);
  }

  /**
   * 渲染可点按的 micro-clue chip。
   * @param {{clue?: object, onOpen?: (clueId: string) => void, host?: Element|string}} [options]
   * @returns {Element|null} 新建的 chip；无 DOM / 无合法 clue / 宿主不可用时返回 null
   */
  function render(options) {
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

  const api = {
    render: render,
    clear: clear,
  };

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.clueSurface = api;
})(typeof window !== 'undefined' ? window : globalThis);
