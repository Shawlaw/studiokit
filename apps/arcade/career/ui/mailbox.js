/*!
 * StudioKit Arcade Life — 旧港信箱 / 信件（0.15 / D15-06）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.mailbox，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.mailbox.open(ctx);
 *   window.ArcadeCareerUI.mailbox.close();
 *
 * ctx（bridge 构造，见 docs/arcade-life/ADR-interfaces.md §17）：
 *   { state, clues, openClue(clueId), followLetter(), announce(text), ... }
 *
 * 约束：
 * - 覆盖当前页面的轻量浮层（position:fixed，可滚动），按钮 + Esc + 点遮罩关闭；
 * - 关闭后焦点返回打开前的元素；键盘 Tab 可在面板内遍历（不逃逸到游戏页）；
 * - 只列 state.clues 中已发现的 clueId（按发现顺序），未发现的线索永不出现；
 * - 所有内容文本用 textContent 赋值，不拼 HTML 字符串；无网络请求、无声音；
 * - 投递只调用 ctx.followLetter()，成功后在同一个面板展示「折光港告示」。
 */
(function (root) {
  'use strict';

  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet';
  const TITLE_ID = 'ac-career-mailbox-title';
  const PANEL_LABEL = '旧港信箱';
  const EMPTY_TEXT = '信箱还空着，旧港的收件格里没有东西。';
  const NOTICE_TITLE = '折光港告示';
  const NOTICE_LINES = [
    '夜间收货窗口已经在册上记下这一件。',
    '失物招领架摆在旧码头门房边上，一时没人来领的东西会先搁在那里。',
  ];
  const FOLLOW_FALLBACK = '按地址投递';
  const FOLLOW_AGAIN = '再看告示';
  const BACK_LABEL = '回到游戏';
  const SEND_FAILED_TEXT = '这次没能送出去，过一会儿再试。';
  const FOLLOWED_FLAG = '已投递';
  const DELIVERED_NOTE = '这封信已经按地址投递过，告示还留在信箱里。';
  const FALLBACK_TITLE = '来源不明的信';

  /* 本页会话内的投递记录：关闭面板后再打开仍能看到「已投递」。 */
  const followedClues = Object.create(null);
  let panel = null;

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

  function clueListOf(context) {
    const list = context && Array.isArray(context.clues) ? context.clues : [];
    const index = Object.create(null);
    list.forEach((entry) => {
      if (!isObject(entry)) return;
      const clueId = cleanText(entry.clueId);
      if (!clueId) return;
      index[clueId] = entry;
    });
    return index;
  }

  /** 已发现 clueId 列表：只取 state.clues；按 seenAt 升序，缺失时保持写入顺序。 */
  function discoveredIds(context) {
    const state = context && isObject(context.state) ? context.state : null;
    const records = state && isObject(state.clues) ? state.clues : null;
    if (!records) return [];
    const rows = Object.keys(records).map((clueId, index) => {
      const record = isObject(records[clueId]) ? records[clueId] : {};
      return { clueId: clueId, seenAt: cleanText(record.seenAt), index: index };
    });
    rows.sort((a, b) => {
      if (a.seenAt && b.seenAt && a.seenAt !== b.seenAt) return a.seenAt < b.seenAt ? -1 : 1;
      return a.index - b.index;
    });
    return rows.map((row) => row.clueId);
  }

  function letterOf(clue) {
    return clue && isObject(clue.letter) ? clue.letter : {};
  }

  function titleOf(clue) {
    return cleanText(clue && clue.title) || FALLBACK_TITLE;
  }

  function originTextOf(context) {
    if (!context || typeof context.originIntro !== 'function') return '';
    let value = null;
    try {
      value = context.originIntro();
    } catch (err) {
      return '';
    }
    let text = '';
    if (typeof value === 'string') text = value;
    else if (isObject(value)) text = cleanText(value.greeting) || cleanText(value.text);
    text = cleanText(text);
    /* 首源短文案是戏内一句话；过长/空内容就不展示，避免撑破面板。 */
    return text && text.length <= 60 ? text : '';
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

  /** 关闭当前信箱浮层并把焦点还给打开前的元素（可重复调用）。 */
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

  /**
   * 打开旧港信箱。
   * @param {object} [ctx] bridge 上下文（缺失字段按空处理，不抛异常）
   * @returns {Element|null} 面板元素；无 DOM 或挂载失败时返回 null
   */
  function open(ctx) {
    const doc = documentOf();
    if (!doc) return null;
    const context = isObject(ctx) ? ctx : {};
    /* 幂等：重复 open 先关掉上一份，避免叠层。 */
    close();

    const contentIndex = clueListOf(context);
    const ids = discoveredIds(context);
    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;
    const followedFromContext = Array.isArray(context.followedClueIds) ? context.followedClueIds : [];
    followedFromContext.forEach((clueId) => {
      const id = cleanText(clueId);
      if (id) followedClues[id] = true;
    });

    function make(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    const overlay = make('div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', 'mailbox');
    /* ctx.reducedMotion 与系统偏好双保险：由 bridge 传入的偏好直接关掉动画。 */
    if (context.reducedMotion) overlay.classList.add('is-reduced-motion');

    const sheet = make('div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('tabindex', '-1');

    const head = make('div', 'ac-career-sheet__head');
    const heading = make('h2', 'ac-career-sheet__title', PANEL_LABEL);
    heading.id = TITLE_ID;
    const closeBtn = make('button', 'ac-career-icon-btn ac-career-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '收起信箱');
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make('div', 'ac-career-sheet__body');

    /* 首源短文案（可选）：只来自 entry-router 派生数据，缺省时整行不出现。 */
    const originText = originTextOf(context);
    const originLine = make('p', 'ac-career-mailbox__origin', originText);
    originLine.hidden = !originText;

    const mailboxView = make('div', 'ac-career-mailbox');
    mailboxView.setAttribute('data-view', 'mailbox');

    const list = make('ul', 'ac-career-mailbox__list');
    const emptyLine = make('p', 'ac-career-mailbox__empty', EMPTY_TEXT);

    const letter = make('article', 'ac-career-letter');
    const letterTitle = make('h3', 'ac-career-letter__title');
    const letterAmbient = make('p', 'ac-career-letter__ambient');
    const letterSender = make('p', 'ac-career-letter__sender');
    const letterBody = make('p', 'ac-career-letter__body');
    const letterAddress = make('p', 'ac-career-letter__address');
    const letterDelivered = make('p', 'ac-career-letter__delivered', DELIVERED_NOTE);
    const letterActions = make('div', 'ac-career-letter__actions');
    const followBtn = make('button', 'ac-career-btn', FOLLOW_FALLBACK);
    followBtn.type = 'button';
    letterActions.appendChild(followBtn);
    letterDelivered.hidden = true;
    letter.appendChild(letterTitle);
    letter.appendChild(letterAmbient);
    letter.appendChild(letterSender);
    letter.appendChild(letterBody);
    letter.appendChild(letterAddress);
    letter.appendChild(letterDelivered);
    letter.appendChild(letterActions);

    /* 可见的失败提示；读屏播报统一走 announce()（bridge 的 polite 区域或面板内置区域）。 */
    const statusLine = make('p', 'ac-career-status');
    statusLine.hidden = true;

    mailboxView.appendChild(list);
    mailboxView.appendChild(emptyLine);
    mailboxView.appendChild(letter);
    mailboxView.appendChild(statusLine);

    const noticeView = make('div', 'ac-career-mailbox ac-career-mailbox--notice');
    noticeView.setAttribute('data-view', 'notice');
    noticeView.hidden = true;

    const noticeTitle = make('h3', 'ac-career-letter__title', NOTICE_TITLE);
    const noticeAddress = make('p', 'ac-career-letter__address');
    const noticeBody = make('div', 'ac-career-letter__body');
    NOTICE_LINES.forEach((line) => {
      noticeBody.appendChild(make('p', null, line));
    });
    const noticeActions = make('div', 'ac-career-letter__actions');
    const backBtn = make('button', 'ac-career-btn ac-career-btn--primary', BACK_LABEL);
    backBtn.type = 'button';
    noticeActions.appendChild(backBtn);
    noticeView.appendChild(noticeTitle);
    noticeView.appendChild(noticeAddress);
    noticeView.appendChild(noticeBody);
    noticeView.appendChild(noticeActions);

    body.appendChild(originLine);
    body.appendChild(mailboxView);
    body.appendChild(noticeView);

    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);
    if (!doc.body) return null;
    try {
      doc.body.appendChild(overlay);
    } catch (err) {
      return null;
    }

    const liveRegion = make('div', 'ac-career-sr-only');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    overlay.appendChild(liveRegion);

    function announce(text) {
      const value = cleanText(text);
      if (!value) return;
      if (typeof context.announce === 'function') {
        try {
          context.announce(value);
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

    const itemNodes = Object.create(null);
    let selectedId = '';

    function setField(node, text) {
      const value = cleanText(text);
      node.textContent = value;
      node.hidden = !value;
    }

    function refreshSelection() {
      Object.keys(itemNodes).forEach((clueId) => {
        itemNodes[clueId].setAttribute('aria-current', clueId === selectedId ? 'true' : 'false');
      });
      const clue = contentIndex[selectedId] || null;
      const letterContent = letterOf(clue);
      setField(letterTitle, clue ? titleOf(clue) : '');
      setField(letterAmbient, clue ? clue.ambientText : '');
      setField(letterSender, letterContent.sender);
      setField(letterBody, letterContent.body);
      setField(letterAddress, letterContent.address);
      const delivered = !!followedClues[selectedId];
      letterDelivered.hidden = !delivered;
      followBtn.textContent = delivered ? FOLLOW_AGAIN : cleanText(letterContent.actionLabel) || FOLLOW_FALLBACK;
      followBtn.setAttribute('aria-label', delivered ? '再看折光港告示' : followBtn.textContent);
    }

    function selectClue(clueId, userInitiated) {
      const id = cleanText(clueId);
      if (!id || !itemNodes[id]) return;
      selectedId = id;
      refreshSelection();
      if (typeof context.openClue === 'function') {
        try {
          context.openClue(id);
        } catch (err) {
          /* 记录失败不影响阅读 */
        }
      }
      if (userInitiated) announce('翻到「' + titleOf(contentIndex[id]) + '」。');
    }

    ids.forEach((clueId) => {
      const clue = contentIndex[clueId] || null;
      const item = make('button', 'ac-career-mailbox__item');
      item.type = 'button';
      item.setAttribute('data-clue-id', clueId);
      item.appendChild(make('span', 'ac-career-mailbox__item-title', clue ? titleOf(clue) : FALLBACK_TITLE));
      const ambient = clue ? cleanText(clue.ambientLabel) || cleanText(clue.ambientText) : '';
      if (ambient) item.appendChild(make('span', 'ac-career-mailbox__item-label', ambient));
      if (followedClues[clueId]) item.appendChild(make('span', 'ac-career-mailbox__flag', FOLLOWED_FLAG));
      item.addEventListener('click', () => selectClue(clueId, true), false);
      const row = make('li', 'ac-career-mailbox__row');
      row.appendChild(item);
      list.appendChild(row);
      itemNodes[clueId] = item;
    });

    const hasLetters = ids.length > 0;
    list.hidden = !hasLetters;
    emptyLine.hidden = hasLetters;
    letter.hidden = !hasLetters;

    if (hasLetters) {
      /* bridge 的 openClue(clueId) 会以 ctx.clueId 打开指定信件，且此前已记录 CLUE_OPENED；
         这种情况下不重复调用 openClue，避免同一动作写两次状态。 */
      const bridgeSelected = cleanText(context.clueId) || cleanText(context.clue && context.clue.clueId);
      const preferred = bridgeSelected || cleanText(context.state && context.state.lastClueId);
      const initial = itemNodes[preferred] ? preferred : ids[ids.length - 1];
      selectedId = initial;
      refreshSelection();
      if (typeof context.openClue === 'function' && initial !== bridgeSelected) {
        try {
          context.openClue(initial);
        } catch (err) {
          /* 记录失败不影响阅读 */
        }
      }
    }

    function showNotice() {
      const clue = contentIndex[selectedId] || null;
      const letterContent = letterOf(clue);
      setField(noticeAddress, letterContent.address);
      mailboxView.hidden = true;
      noticeView.hidden = false;
      safelyFocus(backBtn);
      announce('信已经按地址送出，折光港的告示留在信箱里。');
    }

    function settleFollow(result, clueId) {
      const failed = !!result && isObject(result) && result.ok === false;
      if (failed) {
        setStatus(SEND_FAILED_TEXT);
        announce(SEND_FAILED_TEXT);
        return;
      }
      followedClues[clueId] = true;
      if (itemNodes[clueId] && !itemNodes[clueId].querySelector('.ac-career-mailbox__flag')) {
        itemNodes[clueId].appendChild(make('span', 'ac-career-mailbox__flag', FOLLOWED_FLAG));
      }
      setStatus('');
      noticeTitle.setAttribute('data-clue-id', clueId);
      showNotice();
    }

    function follow() {
      const clueId = selectedId;
      if (!clueId) return;
      if (followedClues[clueId]) {
        noticeTitle.setAttribute('data-clue-id', clueId);
        showNotice();
        return;
      }
      if (typeof context.followLetter !== 'function') {
        setStatus(SEND_FAILED_TEXT);
        announce(SEND_FAILED_TEXT);
        return;
      }
      let result = null;
      try {
        result = context.followLetter();
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => settleFollow(value, clueId),
          () => settleFollow({ ok: false }, clueId)
        );
        return;
      }
      settleFollow(result, clueId);
    }

    followBtn.addEventListener('click', follow, false);
    closeBtn.addEventListener('click', () => close(), false);
    backBtn.addEventListener('click', () => close(), false);

    /* 点遮罩关闭：必须在遮罩上按下并抬起，面板内拖动/选字不会误关。 */
    let pressedBackdrop = false;
    overlay.addEventListener('pointerdown', (event) => {
      pressedBackdrop = !!(event && event.target === overlay);
    }, false);
    overlay.addEventListener('pointercancel', () => {
      pressedBackdrop = false;
    }, false);
    overlay.addEventListener('click', (event) => {
      const onBackdrop = !!(event && event.target === overlay) && pressedBackdrop;
      pressedBackdrop = false;
      if (onBackdrop) close();
    }, false);

    function onKeyDown(event) {
      if (!event) return;
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

    doc.addEventListener('keydown', onKeyDown, true);

    /* 对话框打开后把焦点放进面板（不抢游戏页焦点之外的东西）。 */
    safelyFocus(closeBtn);

    panel = {
      doc: doc,
      overlay: overlay,
      sheet: sheet,
      previousFocus: previousFocus,
      onKeyDown: onKeyDown,
    };
    return sheet;
  }

  const api = {
    open: open,
    close: close,
  };

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.mailbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
