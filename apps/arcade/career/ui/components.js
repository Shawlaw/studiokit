/*!
 * StudioKit Arcade Life — shared career UI components (0.23 T11).
 * Ordinary browser script (non-ESM). The module is inert until a component is called.
 * Contract: docs/arcade-life/ADR-0.23-ui.md §4–§5.
 *
 *   root .ac-career-ui__overlay[data-career-panel] and a dialog panel. showHeader
 *   defaults to true; false keeps the accessible title/aria-label but hides the
 *   visible header and close button (Esc/backdrop/keyboard traps still work).
 *
 * Public API:
 *   window.ArcadeCareerUI.components.CareerShell(props) -> detached root
 *   window.ArcadeCareerUI.components.CareerShell.create(panelKey) -> {open,render,close}
 *   window.ArcadeCareerUI.components.CareerShell.open({panelKey,...props})
 *   window.ArcadeCareerUI.components.CareerShell.render({panelKey,...props})
 *   window.ArcadeCareerUI.components.CareerShell.close()
 *   window.ArcadeCareerUI.components.ensureStyles(cssText) -> idempotent <style>
 *
 * All player text is assigned with textContent. No storage, requests or business state.
 */
(function (root) {
  'use strict';

  const PANELS = ['mailbox', 'town', 'world-state', 'receipt', 'hangar', 'market', 'workshop', 'settings', 'arrival', 'journal'];
  const SHELL_STATES = ['normal', 'scroll', 'loading', 'error'];
  const CLUE_STATES = ['hidden', 'glimpsed', 'read', 'recoverable'];
  const LETTER_STATES = ['unread', 'read', 'deferred'];
  const NPC_STATES = ['first', 'return', 'optional', 'error'];
  const STORY_STATES = ['current', 'no-action', 'completed'];
  const WORK_STATES = ['active', 'optional', 'paused', 'empty'];
  const RECEIPT_STATES = ['success', 'failure', 'no-duplicate-reward'];
  const TIMELINE_STATES = ['empty', 'filled'];
  const TOOL_STATES = ['hidden', 'available'];
  const TAB_IDS = ['home', 'work', 'journal'];
  const TOOL_ORDER = ['wallet', 'shop', 'workshop', 'hangar'];
  const STYLE_ID = 'ac-career-ui-components-style';
  const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, summary, [tabindex]';

  const ICON_PATHS = {
    gem: '<path d="M3 8l4-5h10l4 5-9 13zM3 8h18M7 3l5 18 5-18"/>',
    scroll: '<path d="M8 4h10a3 3 0 0 1 3 3v2h-5v10H6a3 3 0 0 1-3-3v-2h5zM8 14h8M11 8h3M11 11h3"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    pick: '<path d="m4 20 12-12M4 4c7-2 14 2 16 10M9 3 3 9M20 14l-3 3"/>',
    wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 7V4l13-2v3M21 11h-7v5h7M16 13.5h.1"/>',
    store: '<path d="M4 10v11h16V10M3 10l2-7h14l2 7M3 10c0 4 6 4 6 0 0 4 6 4 6 0 0 4 6 4 6 0M9 21v-6h6v6"/>',
    tool: '<path d="M14 7a5 5 0 0 0-6-5l3 3-4 4-3-3a5 5 0 0 0 6 6l8 9 3-3-9-8"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
  };

  let idSequence = 0;
  const docStates = new WeakMap();

  function documentOf() {
    return typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendContent(parent, content) {
    if (content === null || content === undefined || content === false) return;
    if (Array.isArray(content)) {
      content.forEach((entry) => appendContent(parent, entry));
      return;
    }
    if (typeof content === 'string' || typeof content === 'number') {
      parent.appendChild(parent.ownerDocument.createTextNode(String(content)));
      return;
    }
    if (content && typeof content.nodeType === 'number') parent.appendChild(content);
  }

  function icon(name) {
    const doc = documentOf();
    if (!doc || typeof doc.createElementNS !== 'function') return null;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ac-career-ui__icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.gem;
    return svg;
  }

  function isThenable(value) {
    return !!value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
  }

  function actionProps(action) {
    return isObject(action) ? action : {};
  }

  function actionButton(props, kind) {
    const doc = documentOf();
    const input = isObject(props) ? props : {};
    const baseLabel = cleanText(input.label);
    const button = element(doc, 'button');
    button.type = 'button';
    button.className = kind === 'primary'
      ? 'ac-career-ui__action ac-career-ui__action--primary'
      : 'ac-career-ui__action ac-career-ui__action--secondary ac-career-ui__action--' + oneOf(input.variant, ['border', 'text'], 'border');
    button.setAttribute('data-action-kind', kind);
    button.setAttribute('data-action-variant', kind === 'primary' ? 'solid' : oneOf(input.variant, ['border', 'text'], 'border'));
    if (input.id) button.id = cleanText(input.id);
    if (input.ariaLabel) button.setAttribute('aria-label', cleanText(input.ariaLabel));
    if (input.describedBy) button.setAttribute('aria-describedby', cleanText(input.describedBy));

    let internalBusy = false;
    let invoking = false;
    let hovered = false;
    let focused = false;
    let pressed = false;

    function sync() {
      const busy = !!input.busy || internalBusy;
      const disabled = !!input.disabled || busy;
      button.disabled = disabled;
      button.setAttribute('aria-busy', String(busy));
      button.setAttribute('data-action-state', busy ? 'loading' : (disabled ? 'disabled' : (pressed ? 'pressed' : (focused ? 'focus' : (hovered ? 'hover' : 'default')))));
      button.textContent = baseLabel + (busy ? '（处理中）' : (input.disabled ? '（暂不可用）' : ''));
    }

    button.addEventListener('pointerenter', () => {
      hovered = true;
      if (!button.disabled) sync();
    });
    button.addEventListener('pointerleave', () => {
      hovered = false;
      pressed = false;
      if (!button.disabled) sync();
    });
    button.addEventListener('focus', () => {
      focused = true;
      if (!button.disabled) sync();
    });
    button.addEventListener('blur', () => {
      focused = false;
      pressed = false;
      if (!button.disabled) sync();
    });
    button.addEventListener('pointerdown', () => {
      if (button.disabled) return;
      pressed = true;
      sync();
    });
    button.addEventListener('pointerup', () => {
      pressed = false;
      if (!button.disabled) sync();
    });
    button.addEventListener('click', () => {
      if (button.disabled || invoking || internalBusy || input.busy || input.disabled) return;
      if (typeof input.onClick !== 'function') return;
      invoking = true;
      let result;
      try {
        result = input.onClick();
      } finally {
        invoking = false;
      }
      if (isThenable(result)) {
        internalBusy = true;
        pressed = false;
        sync();
        Promise.resolve(result).then(() => {
          internalBusy = false;
          sync();
        }, () => {
          internalBusy = false;
          sync();
        });
      } else {
        pressed = true;
        sync();
        Promise.resolve().then(() => {
          pressed = false;
          if (!button.disabled) sync();
        });
      }
    });
    sync();
    return button;
  }

  function PrimaryAction(props) {
    return actionButton(props, 'primary');
  }

  function SecondaryAction(props) {
    return actionButton(props, 'secondary');
  }

  function renderAction(action) {
    const input = actionProps(action);
    if (input.kind === 'primary') return PrimaryAction(input);
    if (input.kind === 'secondary') return SecondaryAction(Object.assign({}, input, { variant: input.variant || 'border' }));
    return SecondaryAction(Object.assign({}, input, { variant: 'text' }));
  }

  function ClueRow(props) {
    const input = isObject(props) ? props : {};
    const state = oneOf(input.state, CLUE_STATES, 'hidden');
    if (state === 'hidden') return null;
    const doc = documentOf();
    if (!doc) return null;
    const button = element(doc, 'button');
    button.type = 'button';
    button.className = 'ac-career-ui__clue';
    button.setAttribute('data-clue-state', state);
    button.setAttribute('data-placement', oneOf(input.placement, ['result-host', 'page-corner', 'list'], 'list'));
    button.setAttribute('data-reduced-motion', String(!!input.reducedMotion));
    button.appendChild(icon(input.icon));
    const content = element(doc, 'span', 'ac-career-ui__grow ac-career-ui__clue-content');
    content.appendChild(element(doc, 'strong', 'ac-career-ui__clue-title', cleanText(input.title)));
    const teaser = cleanText(input.teaser);
    if (teaser) content.appendChild(element(doc, 'span', 'ac-career-ui__caption ac-career-ui__clue-teaser', teaser));
    content.appendChild(element(doc, 'span', 'ac-career-ui__gold ac-career-ui__clue-action', cleanText(input.actionLabel)));
    button.appendChild(content);
    button.addEventListener('click', () => {
      if (typeof input.onOpen === 'function') input.onOpen(cleanText(input.clueId));
    });
    return button;
  }

  function LetterCard(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const wrapper = element(doc, 'section', 'ac-career-ui__letter-wrap');
    wrapper.setAttribute('data-letter-state', oneOf(input.state, LETTER_STATES, 'unread'));
    const ambient = cleanText(input.ambientLabel);
    if (ambient) wrapper.appendChild(element(doc, 'p', 'ac-career-ui__caption', ambient));
    const letter = element(doc, 'article', 'ac-career-ui__letter ac-career-ui__stack ac-career-ui__stack--small');
    letter.appendChild(element(doc, 'h2', 'ac-career-ui__gold-light', cleanText(input.title)));
    const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
    paragraphs.forEach((paragraph) => letter.appendChild(element(doc, 'p', 'ac-career-ui__letter-paragraph', cleanText(paragraph))));
    const sender = cleanText(input.sender);
    if (sender) letter.appendChild(element(doc, 'p', 'ac-career-ui__signature', '—— ' + sender));
    wrapper.appendChild(letter);
    const actions = (Array.isArray(input.actions) ? input.actions : []).slice(0, 2);
    if (actions.length) {
      const row = element(doc, 'div', 'ac-career-ui__actions');
      actions.forEach((action) => row.appendChild(renderAction(action)));
      wrapper.appendChild(row);
    }
    return wrapper;
  }

  function NPCDialogue(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const rootNode = element(doc, 'section', 'ac-career-ui__npc');
    rootNode.setAttribute('data-npc-state', oneOf(input.state, NPC_STATES, 'first'));
    const row = element(doc, 'div', 'ac-career-ui__row ac-career-ui__row--start');
    const avatar = element(doc, 'div', 'ac-career-ui__avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const avatarProps = isObject(input.avatar) ? input.avatar : {};
    if (avatarProps.kind === 'initial') {
      avatar.textContent = cleanText(avatarProps.label || input.name).slice(0, 1);
    } else if (avatarProps.kind === 'user' && avatarProps.src) {
      const image = element(doc, 'img');
      image.src = cleanText(avatarProps.src);
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      avatar.appendChild(image);
    } else {
      avatar.appendChild(icon('user'));
    }
    row.appendChild(avatar);
    const content = element(doc, 'div', 'ac-career-ui__grow ac-career-ui__stack ac-career-ui__stack--small');
    content.appendChild(element(doc, 'strong', 'ac-career-ui__gold ac-career-ui__npc-name', cleanText(input.name)));
    const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
    paragraphs.forEach((paragraph) => content.appendChild(element(doc, 'p', 'ac-career-ui__npc-paragraph', cleanText(paragraph))));
    row.appendChild(content);
    rootNode.appendChild(row);
    const actions = Array.isArray(input.actions) ? input.actions : [];
    if (actions.length) {
      const actionRow = element(doc, 'div', 'ac-career-ui__actions');
      actions.forEach((action) => actionRow.appendChild(renderAction(action)));
      rootNode.appendChild(actionRow);
    }
    return rootNode;
  }

  function StoryCard(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const state = oneOf(input.state, STORY_STATES, 'current');
    const card = element(doc, 'article', 'ac-career-ui__surface ac-career-ui__stack ac-career-ui__stack--small');
    card.setAttribute('data-story-state', state);
    const eyebrow = cleanText(input.eyebrow);
    if (eyebrow) card.appendChild(element(doc, 'p', 'ac-career-ui__caption', eyebrow));
    const tags = Array.isArray(input.tags) ? input.tags.map(cleanText).filter(Boolean) : [];
    if (tags.length) {
      const tagRow = element(doc, 'div', 'ac-career-ui__tags');
      tags.forEach((tag) => tagRow.appendChild(element(doc, 'span', 'ac-career-ui__tag', tag)));
      card.appendChild(tagRow);
    }
    card.appendChild(element(doc, 'h2', 'ac-career-ui__story-title', cleanText(input.title)));
    card.appendChild(element(doc, 'p', 'ac-career-ui__story-summary', cleanText(input.summary)));
    if (state === 'current' && isObject(input.action)) card.appendChild(renderAction(input.action));
    return card;
  }

  function SegmentedTabs(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const source = (Array.isArray(input.tabs) ? input.tabs : []).filter((tab) => isObject(tab) && TAB_IDS.indexOf(tab.id) >= 0);
    const ordered = TAB_IDS.map((id) => source.find((tab) => tab.id === id)).filter(Boolean);
    const enabled = ordered.filter((tab) => !tab.disabled);
    const selected = ordered.find((tab) => tab.id === input.selectedId && !tab.disabled) || enabled[0] || null;
    const tablist = element(doc, 'div', 'ac-career-ui__tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', cleanText(input.label));
    tablist.setAttribute('data-selected-id', selected ? selected.id : '');
    const controlsId = cleanText(input.controlsId);
    const buttons = [];

    function setTabState(button, state) {
      if (state === 'selected' || state === 'focus') button.setAttribute('data-tab-state', state);
      else button.removeAttribute('data-tab-state');
    }

    function selectTab(tab, focus) {
      if (!tab || tab.disabled) return;
      tablist.setAttribute('data-selected-id', tab.id);
      buttons.forEach((button) => {
        const active = button.getAttribute('data-tab') === tab.id;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        setTabState(button, active ? 'selected' : null);
      });
      if (typeof input.onSelect === 'function') input.onSelect(tab.id);
      if (focus && typeof tab.button.focus === 'function') tab.button.focus();
    }

    ordered.forEach((tab) => {
      const button = element(doc, 'button', 'ac-career-ui__tab', cleanText(tab.label));
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('data-tab', tab.id);
      button.setAttribute('aria-selected', String(!!selected && selected.id === tab.id));
      button.tabIndex = selected && selected.id === tab.id ? 0 : -1;
      setTabState(button, selected && selected.id === tab.id ? 'selected' : null);
      button.disabled = !!tab.disabled;
      if (controlsId) button.setAttribute('aria-controls', controlsId);
      button.addEventListener('focus', () => {
        setTabState(button, button.getAttribute('aria-selected') === 'true' ? 'selected' : 'focus');
      });
      button.addEventListener('blur', () => {
        setTabState(button, button.getAttribute('aria-selected') === 'true' ? 'selected' : null);
      });
      button.addEventListener('click', () => selectTab(tab, false));
      button.addEventListener('keydown', (event) => {
        if (!event || tab.disabled) return;
        const key = event.key || '';
        if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (!enabled.length) return;
        const current = Math.max(0, enabled.indexOf(tab));
        const nextIndex = key === 'Home' ? 0 : (key === 'End' ? enabled.length - 1 : ((current + (key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length));
        selectTab(enabled[nextIndex], true);
      });
      tab.button = button;
      buttons.push(button);
      tablist.appendChild(button);
    });
    return tablist;
  }

  function workStatusText(state) {
    if (state === 'active') return '进行中';
    if (state === 'paused') return '已搁置';
    if (state === 'empty') return '暂无工作';
    return '可选';
  }

  function commissionNode(doc, commission, isWorld, onStart) {
    const entry = isObject(commission) ? commission : {};
    const node = element(doc, 'article', 'ac-career-ui__commission');
    node.appendChild(element(doc, 'h3', 'ac-career-ui__commission-title', cleanText(entry.title)));
    const summary = cleanText(entry.summary);
    if (summary) node.appendChild(element(doc, 'p', 'ac-career-ui__commission-summary', summary));
    const objective = cleanText(entry.objectiveText);
    if (objective) node.appendChild(element(doc, 'p', 'ac-career-ui__caption ac-career-ui__commission-objective', objective));
    if (!isWorld) {
      const gameName = cleanText(entry.gameName);
      if (gameName) node.appendChild(element(doc, 'p', 'ac-career-ui__caption', gameName));
      const reward = cleanText(entry.rewardText);
      if (reward) node.appendChild(element(doc, 'p', 'ac-career-ui__commission-reward', reward));
    }
    if (typeof onStart === 'function') {
      node.appendChild(SecondaryAction({
        label: '接下这单',
        variant: 'border',
        onClick: () => onStart(cleanText(entry.commissionId)),
      }));
    }
    return node;
  }

  function WorkCard(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const state = oneOf(input.state, WORK_STATES, 'empty');
    const isWorld = input.professionId === null;
    const commissions = (Array.isArray(input.commissions) ? input.commissions : []).filter(isObject);
    const card = element(doc, 'article', 'ac-career-ui__surface ac-career-ui__work');
    card.setAttribute('data-work-state', state);
    card.setAttribute('data-work-category', isWorld ? 'world' : 'profession');
    card.setAttribute('data-expanded', String(!!input.expanded));

    const header = element(doc, 'div', 'ac-career-ui__row ac-career-ui__work-header');
    header.appendChild(icon(input.icon));
    const displayName = cleanText(input.title) || cleanText(input.displayName);
    header.appendChild(element(doc, 'strong', 'ac-career-ui__grow ac-career-ui__work-name', displayName));
    header.appendChild(element(doc, 'p', 'ac-career-ui__caption ac-career-ui__work-status', cleanText(input.statusLabel) || workStatusText(state)));
    card.appendChild(header);

    if (state === 'empty') {
      card.appendChild(element(doc, 'p', 'ac-career-ui__muted', '这里暂时没有可接的工作。'));
      return card;
    }
    if (state === 'paused') {
      if (!isWorld && typeof input.onPause === 'function') {
        card.appendChild(SecondaryAction({
          label: '恢复这段经历',
          variant: 'text',
          onClick: () => input.onPause(cleanText(input.professionId), false),
        }));
      }
      return card;
    }

    const list = element(doc, 'div', 'ac-career-ui__work-list');
    if (commissions.length) {
      const first = commissions[0];
      if (isWorld) {
        list.appendChild(element(doc, 'h3', 'ac-career-ui__commission-title', cleanText(first.title)));
        const summary = cleanText(first.summary);
        if (summary) list.appendChild(element(doc, 'p', 'ac-career-ui__commission-summary', summary));
        const objective = cleanText(first.objectiveText);
        if (objective) list.appendChild(element(doc, 'p', 'ac-career-ui__caption ac-career-ui__commission-objective', objective));
        if (typeof input.onStart === 'function') {
          list.appendChild(SecondaryAction({
            label: '接下这单',
            variant: 'border',
            onClick: () => input.onStart(cleanText(first.commissionId)),
          }));
        }
      } else {
        list.appendChild(commissionNode(doc, first, false, input.onStart));
      }
    }
    if (commissions.length > 1) {
      const details = element(doc, 'details', 'ac-career-ui__work-details');
      details.open = !!input.expanded;
      details.addEventListener('toggle', () => card.setAttribute('data-expanded', String(details.open)));
      details.appendChild(element(doc, 'summary', 'ac-career-ui__work-more', '查看其余工作'));
      commissions.slice(1).forEach((commission) => details.appendChild(commissionNode(doc, commission, isWorld, input.onStart)));
      list.appendChild(details);
    }
    card.appendChild(list);
    if (!isWorld && typeof input.onPause === 'function') {
      card.appendChild(SecondaryAction({
        label: '暂时搁置',
        variant: 'text',
        onClick: () => input.onPause(cleanText(input.professionId), true),
      }));
    }
    return card;
  }

  function rewardRow(doc, label, value) {
    const row = element(doc, 'div', 'ac-career-ui__kv');
    row.appendChild(element(doc, 'span', 'ac-career-ui__muted', label));
    row.appendChild(element(doc, 'span', 'ac-career-ui__kv-value', value));
    return row;
  }

  function ReceiptCard(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const state = oneOf(input.state, RECEIPT_STATES, 'success');
    const card = element(doc, 'section', 'ac-career-ui__surface ac-career-ui__receipt');
    card.setAttribute('data-receipt-state', state);
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.setAttribute('aria-atomic', 'true');
    card.appendChild(element(doc, 'h2', 'ac-career-ui__receipt-title', cleanText(input.title)));
    const result = element(doc, 'div', 'ac-career-ui__row ac-career-ui__receipt-result ' + (input.outcome === 'failure' ? 'ac-career-ui__danger' : 'ac-career-ui__success'));
    result.appendChild(icon(input.outcome === 'failure' ? 'x' : 'check'));
    result.appendChild(element(doc, 'span', 'ac-career-ui__grow', cleanText(input.resultLine)));
    card.appendChild(result);

    const rewards = isObject(input.rewards) ? input.rewards : null;
    if (state !== 'no-duplicate-reward' && rewards) {
      const rows = element(doc, 'div', 'ac-career-ui__kv-list');
      if (typeof rewards.credits === 'number' && Number.isFinite(rewards.credits)) rows.appendChild(rewardRow(doc, '工作报酬', String(rewards.credits)));
      const materials = Array.isArray(rewards.materials) ? rewards.materials : [];
      materials.filter(isObject).forEach((material) => {
        const name = cleanText(material.name);
        const count = typeof material.count === 'number' && Number.isFinite(material.count) ? String(material.count) : cleanText(material.count);
        if (name && count) rows.appendChild(rewardRow(doc, name, count));
      });
      const identity = cleanText(rewards.identity);
      if (identity) rows.appendChild(rewardRow(doc, '生涯身份', identity));
      const experience = cleanText(rewards.experience);
      if (experience) rows.appendChild(rewardRow(doc, '经历', experience));
      if (rows.children.length) card.appendChild(rows);
    }

    if (isObject(input.npcReply)) {
      const reply = element(doc, 'div', 'ac-career-ui__stack ac-career-ui__stack--small ac-career-ui__receipt-reply');
      reply.setAttribute('data-npc-state', oneOf(input.npcReply.state, NPC_STATES, 'return'));
      reply.appendChild(element(doc, 'strong', 'ac-career-ui__gold ac-career-ui__npc-name', cleanText(input.npcReply.name)));
      const paragraphs = Array.isArray(input.npcReply.paragraphs) ? input.npcReply.paragraphs : [];
      paragraphs.forEach((paragraph) => reply.appendChild(element(doc, 'p', 'ac-career-ui__npc-paragraph', cleanText(paragraph))));
      card.appendChild(reply);
    }
    const actions = [input.nextAction, input.exitAction].filter(isObject).slice(0, 2);
    if (actions.length) {
      const row = element(doc, 'div', 'ac-career-ui__actions');
      actions.forEach((action) => row.appendChild(renderAction(action)));
      card.appendChild(row);
    }
    return card;
  }

  function validIsoDate(value) {
    const text = cleanText(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    if (text.length > 10 && !Number.isFinite(Date.parse(text))) return '';
    return match[1] + '-' + match[2] + '-' + match[3];
  }

  function JournalTimeline(props) {
    const input = isObject(props) ? props : {};
    const doc = documentOf();
    if (!doc) return null;
    const state = oneOf(input.state, TIMELINE_STATES, 'empty');
    const events = (Array.isArray(input.events) ? input.events : []).filter(isObject);
    const wrapper = element(doc, 'section', 'ac-career-ui__journal');
    wrapper.setAttribute('data-timeline-state', state);
    if (state === 'empty' || !events.length) {
      wrapper.appendChild(element(doc, 'p', 'ac-career-ui__muted', '还没有记下新的经历。'));
      return wrapper;
    }
    const list = element(doc, 'ol', 'ac-career-ui__timeline');
    events.forEach((event) => {
      const item = element(doc, 'li', 'ac-career-ui__timeline-item');
      item.appendChild(element(doc, 'span', 'ac-career-ui__timeline-label', cleanText(event.label)));
      const at = validIsoDate(event.at);
      if (at) item.appendChild(element(doc, 'time', 'ac-career-ui__caption ac-career-ui__timeline-time', at));
      list.appendChild(item);
    });
    wrapper.appendChild(list);
    return wrapper;
  }

  function ToolGrid(props) {
    const input = isObject(props) ? props : {};
    const state = oneOf(input.state, TOOL_STATES, 'hidden');
    if (state === 'hidden') return null;
    const doc = documentOf();
    if (!doc) return null;
    const source = Array.isArray(input.tools) ? input.tools : [];
    const grid = element(doc, 'div', 'ac-career-ui__tools');
    grid.setAttribute('data-tool-grid-state', 'available');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', cleanText(input.label));
    TOOL_ORDER.forEach((id) => {
      const tool = source.find((entry) => isObject(entry) && entry.id === id);
      if (!tool) return;
      const button = element(doc, 'button', 'ac-career-ui__tool');
      button.type = 'button';
      button.setAttribute('data-tool', id);
      button.appendChild(icon(oneOf(tool.icon, ['wallet', 'store', 'tool'], 'tool')));
      button.appendChild(element(doc, 'span', 'ac-career-ui__tool-label', cleanText(tool.label)));
      button.addEventListener('click', () => {
        if (typeof tool.onClick === 'function') tool.onClick();
      });
      grid.appendChild(button);
    });
    return grid;
  }

  /* ---------------------------- CareerShell ---------------------------- */

  function stateFor(doc) {
    let state = docStates.get(doc);
    if (!state) {
      state = { stack: [], lockCount: 0, lock: null };
      docStates.set(doc, state);
    }
    return state;
  }

  function styleProperty(style, name) {
    if (!style) return { value: '', priority: '' };
    if (typeof style.getPropertyValue === 'function') {
      return { value: style.getPropertyValue(name), priority: typeof style.getPropertyPriority === 'function' ? style.getPropertyPriority(name) : '' };
    }
    return { value: style[name] || '', priority: '' };
  }

  function restoreStyleProperty(style, name, saved) {
    if (!style) return;
    if (!saved.value) {
      if (typeof style.removeProperty === 'function') style.removeProperty(name);
      else delete style[name];
      return;
    }
    if (typeof style.setProperty === 'function') style.setProperty(name, saved.value, saved.priority || '');
    else style[name] = saved.value;
  }

  function lockScroll(doc) {
    const state = stateFor(doc);
    state.lockCount += 1;
    if (state.lockCount > 1) return;
    const html = doc.documentElement;
    const body = doc.body;
    state.lock = {
      html: ['overflow', 'overflow-x', 'overflow-y'].map((name) => styleProperty(html && html.style ? html.style : null, name)),
      body: ['overflow', 'overflow-x', 'overflow-y'].map((name) => styleProperty(body && body.style ? body.style : null, name)),
    };
    if (html && html.classList) html.classList.add('ac-career-ui-scroll-lock');
    [html, body].forEach((node) => {
      if (!node || !node.style) return;
      ['overflow', 'overflow-x', 'overflow-y'].forEach((name) => {
        if (typeof node.style.setProperty === 'function') node.style.setProperty(name, 'hidden', 'important');
        else node.style[name] = 'hidden';
      });
    });
  }

  function unlockScroll(doc) {
    const state = stateFor(doc);
    if (!state.lockCount) return;
    state.lockCount -= 1;
    if (state.lockCount) return;
    const html = doc.documentElement;
    const body = doc.body;
    if (html && html.classList) html.classList.remove('ac-career-ui-scroll-lock');
    if (state.lock) {
      ['overflow', 'overflow-x', 'overflow-y'].forEach((name, index) => {
        restoreStyleProperty(html && html.style ? html.style : null, name, state.lock.html[index]);
        restoreStyleProperty(body && body.style ? body.style : null, name, state.lock.body[index]);
      });
    }
    state.lock = null;
  }

  function isVisible(node) {
    if (!node || node.hidden) return false;
    let parent = node.parentNode;
    while (parent) {
      if (parent.hidden) return false;
      parent = parent.parentNode;
    }
    if (typeof node.getClientRects === 'function') return node.getClientRects().length > 0;
    return true;
  }

  function focusableIn(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((node) => {
      if (node.disabled || node.getAttribute('aria-hidden') === 'true') return false;
      const tabindex = node.getAttribute('tabindex');
      if (tabindex !== null && Number(tabindex) < 0) return false;
      return isVisible(node);
    });
  }

  function safelyFocus(node) {
    if (node && typeof node.focus === 'function') {
      try { node.focus(); } catch (_) { /* detached or non-focusable node */ }
    }
  }

  function resolveInitialFocus(value, panel) {
    if (value && typeof value.nodeType === 'number') return panel.contains(value) ? value : null;
    const selector = cleanText(value);
    if (!selector || typeof panel.querySelector !== 'function') return null;
    let found = null;
    try { found = panel.querySelector(selector); } catch (_) { found = null; }
    if (!found && selector.charAt(0) !== '#' && panel.ownerDocument && typeof panel.ownerDocument.getElementById === 'function') {
      found = panel.ownerDocument.getElementById(selector);
    }
    return found && panel.contains(found) ? found : null;
  }

  function focusDescriptor(node) {
    if (!node) return null;
    const attrs = ['data-focus-key', 'id', 'name', 'aria-label'];
    for (const attr of attrs) {
      const value = node.getAttribute && node.getAttribute(attr);
      if (value) return { attr, value: String(value) };
    }
    return { attr: 'text', value: cleanText(node.textContent), tag: node.tagName };
  }

  function restoreDescriptor(panel, descriptor) {
    if (!descriptor) return null;
    const candidates = focusableIn(panel);
    if (descriptor.attr === 'text') {
      return candidates.find((node) => node.tagName === descriptor.tag && cleanText(node.textContent) === descriptor.value) || null;
    }
    return candidates.find((node) => node.getAttribute && node.getAttribute(descriptor.attr) === descriptor.value) || null;
  }

  function panelKeyOf(input) {
    if (!isObject(input)) return '';
    return oneOf(input.panelKey || input.panel, PANELS, '');
  }

  function createShellDom(ctx, panelKey) {
    const doc = documentOf();
    const input = isObject(ctx) ? ctx : {};
    const state = oneOf(input.state, SHELL_STATES, 'normal');
    const size = oneOf(input.size, ['default', 'small'], 'default');
    const title = cleanText(input.title) || '生涯面板';
    const rootNode = element(doc, 'div', 'ac-career-ui');
    rootNode.setAttribute('data-reduced-motion', String(!!input.reducedMotion));
    const overlay = element(doc, 'div', 'ac-career-ui__overlay');
    overlay.setAttribute('data-career-panel', panelKey);
    const panel = element(doc, 'div', 'ac-career-ui__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('data-shell-state', state);
    panel.setAttribute('data-shell-size', size);
    panel.setAttribute('aria-busy', String(state === 'loading'));
    panel.tabIndex = -1;

    const titleId = 'ac-career-ui-' + panelKey + '-title-' + (++idSequence);
    panel.setAttribute('aria-labelledby', titleId);
    panel.setAttribute('aria-label', title);
    panel.setAttribute('data-show-header', String(input.showHeader !== false));
    const descriptionId = cleanText(input.descriptionId);
    if (descriptionId) panel.setAttribute('aria-describedby', descriptionId);

    const header = element(doc, 'header', 'ac-career-ui__header');
    header.hidden = input.showHeader === false;
    const heading = element(doc, size === 'small' ? 'h2' : 'h1', 'ac-career-ui__title', title);
    heading.id = titleId;
    heading.tabIndex = -1;
    header.appendChild(heading);
    const closeButton = element(doc, 'button', 'ac-career-ui__close');
    closeButton.type = 'button';
    closeButton.hidden = input.showHeader === false;
    closeButton.setAttribute('aria-label', '关闭' + title);
    closeButton.appendChild(icon('x'));
    header.appendChild(closeButton);
    panel.appendChild(header);

    const body = element(doc, 'div', 'ac-career-ui__body');
    body.setAttribute('data-shell-body', '');
    appendContent(body, input.body);
    panel.appendChild(body);

    const notice = element(doc, 'div', 'ac-career-ui__shell-notice');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    panel.appendChild(notice);

    const footer = element(doc, 'footer', 'ac-career-ui__footer');
    appendContent(footer, input.footer);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    rootNode.appendChild(overlay);

    return { doc, rootNode, overlay, panel, header, heading, titleId, closeButton, body, notice, footer };
  }

  function updateShellDom(dom, ctx) {
    const input = isObject(ctx) ? ctx : {};
    const state = oneOf(input.state, SHELL_STATES, 'normal');
    const size = oneOf(input.size, ['default', 'small'], 'default');
    const showHeader = input.showHeader !== false;
    const title = cleanText(input.title) || '生涯面板';
    dom.rootNode.setAttribute('data-reduced-motion', String(!!input.reducedMotion));
    dom.panel.setAttribute('data-shell-state', state);
    dom.panel.setAttribute('data-shell-size', size);
    dom.panel.setAttribute('data-show-header', String(showHeader));
    dom.panel.setAttribute('aria-label', title);
    dom.panel.setAttribute('aria-busy', String(state === 'loading'));
    dom.header.hidden = !showHeader;
    dom.closeButton.hidden = !showHeader;
    if (dom.heading.tagName !== (size === 'small' ? 'H2' : 'H1')) {
      const heading = element(dom.doc, size === 'small' ? 'h2' : 'h1', 'ac-career-ui__title', title);
      heading.id = dom.titleId;
      heading.tabIndex = -1;
      dom.heading.parentNode.replaceChild(heading, dom.heading);
      dom.heading = heading;
    } else {
      dom.heading.textContent = title;
    }
    dom.closeButton.setAttribute('aria-label', '关闭' + title);
    const descriptionId = cleanText(input.descriptionId);
    if (descriptionId) dom.panel.setAttribute('aria-describedby', descriptionId);
    else dom.panel.removeAttribute('aria-describedby');

    const active = dom.doc.activeElement;
    const descriptor = active && dom.body.contains(active) ? focusDescriptor(active) : null;
    const headerFocusLost = !showHeader && (active === dom.closeButton || active === dom.heading);
    dom.body.replaceChildren();
    appendContent(dom.body, input.body);
    dom.footer.replaceChildren();
    appendContent(dom.footer, input.footer);
    dom.footer.hidden = !input.footer;
    dom.notice.hidden = state !== 'loading' && state !== 'error';
    dom.notice.className = 'ac-career-ui__shell-notice' + (state === 'error' ? ' ac-career-ui__shell-notice--error' : '');
    dom.notice.textContent = state === 'loading' ? '正在整理这些内容…' : (state === 'error' ? '这里暂时读不到内容，请关闭后重试。' : '');
    if (descriptor) safelyFocus(restoreDescriptor(dom.panel, descriptor) || (showHeader ? dom.closeButton : dom.panel));
    else if (headerFocusLost) safelyFocus(showHeader ? dom.closeButton : dom.panel);
  }

  function topManager(doc) {
    const state = stateFor(doc);
    for (let index = state.stack.length - 1; index >= 0; index -= 1) {
      const manager = state.stack[index];
      if (manager.record && manager.record.rootNode.isConnected) return manager;
      state.stack.splice(index, 1);
    }
    return null;
  }

  function onShellKeyDown(manager, event) {
    const record = manager.record;
    if (!record || !event || topManager(record.doc) !== manager) return;
    const key = event.key || '';
    const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
    if (key === 'Escape' || key === 'Esc' || code === 27) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      closeShell(manager);
      return;
    }
    if (key !== 'Tab' && code !== 9) return;
    const items = focusableIn(record.panel);
    if (!items.length) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      safelyFocus(record.panel);
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = record.doc.activeElement;
    const outside = !record.panel.contains(active);
    if (event.shiftKey) {
      if (active === first || active === record.panel || outside) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(last);
      }
      return;
    }
    if (active === last || active === record.panel || outside) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      safelyFocus(first);
    }
  }

  function openShell(manager, ctx) {
    const input = isObject(ctx) ? ctx : {};
    const doc = documentOf();
    if (!doc || !doc.body) return { ok: false, reason: 'document-unavailable' };
    const panelKey = panelKeyOf(input) || manager.panelKey;
    if (PANELS.indexOf(panelKey) < 0) return { ok: false, reason: 'invalid-panel' };
    const state = stateFor(doc);
    const existing = state.stack.find((entry) => entry.panelKey === panelKey && entry.record && entry.record.rootNode.isConnected);
    if (existing) {
      const effective = Object.assign({}, existing.ctx || {}, input);
      existing.ctx = effective;
      updateShellDom(existing.record, effective);
      return { ok: true, panel: existing.record.panel };
    }
    if (manager.record && manager.record.rootNode.isConnected) {
      const effective = Object.assign({}, manager.ctx || {}, input);
      manager.ctx = effective;
      updateShellDom(manager.record, effective);
      return { ok: true, panel: manager.record.panel };
    }

    const dom = createShellDom(input, panelKey);
    const previousFocus = doc.activeElement;
    const record = {
      doc,
      rootNode: dom.rootNode,
      overlay: dom.overlay,
      panel: dom.panel,
      header: dom.header,
      closeButton: dom.closeButton,
      body: dom.body,
      heading: dom.heading,
      titleId: dom.titleId,
      notice: dom.notice,
      footer: dom.footer,
      previousFocus,
      ctx: input,
      onKeyDown: null,
    };
    manager.record = record;
    manager.panelKey = panelKey;
    manager.ctx = input;

    dom.closeButton.addEventListener('click', () => closeShell(manager));
    let pressedBackdrop = false;
    dom.overlay.addEventListener('pointerdown', (event) => {
      pressedBackdrop = !!(event && event.target === dom.overlay);
    });
    dom.overlay.addEventListener('pointercancel', () => { pressedBackdrop = false; });
    dom.overlay.addEventListener('click', (event) => {
      const onBackdrop = !!(event && event.target === dom.overlay);
      const view = doc.defaultView;
      const supportsPointer = !!view && typeof view.PointerEvent === 'function';
      if (onBackdrop && (pressedBackdrop || !supportsPointer)) closeShell(manager);
      pressedBackdrop = false;
    });

    record.onKeyDown = (event) => onShellKeyDown(manager, event);
    doc.addEventListener('keydown', record.onKeyDown, true);
    doc.body.appendChild(dom.rootNode);
    lockScroll(doc);
    state.stack.push(manager);
    const initialFocus = resolveInitialFocus(input.initialFocus, dom.panel);
    safelyFocus(initialFocus || (input.showHeader === false ? dom.panel : dom.closeButton));
    return { ok: true, panel: dom.panel };
  }

  function closeShell(manager) {
    const record = manager.record;
    if (!record) return false;
    const state = stateFor(record.doc);
    if (topManager(record.doc) !== manager) return false;
    state.stack = state.stack.filter((entry) => entry !== manager);
    record.doc.removeEventListener('keydown', record.onKeyDown, true);
    if (record.rootNode.parentNode) record.rootNode.parentNode.removeChild(record.rootNode);
    manager.record = null;
    unlockScroll(record.doc);
    const explicitReturn = manager.ctx && manager.ctx.returnFocus;
    const target = explicitReturn && typeof explicitReturn.nodeType === 'number' ? explicitReturn : record.previousFocus;
    if (target && target.isConnected) safelyFocus(target);
    if (manager.ctx && typeof manager.ctx.onClose === 'function') {
      try { manager.ctx.onClose(); } catch (_) { /* close remains complete */ }
    }
    manager.ctx = null;
    return true;
  }

  function createCareerShell(panelKey) {
    const manager = { panelKey: oneOf(panelKey, PANELS, ''), record: null, ctx: null };
    return {
      open(ctx) { return openShell(manager, ctx); },
      render(ctx) { return openShell(manager, ctx); },
      close() { return closeShell(manager); },
    };
  }

  function CareerShell(props) {
    const input = isObject(props) ? props : {};
    const panelKey = panelKeyOf(input) || 'town';
    const dom = createShellDom(input, panelKey);
    updateShellDom(dom, input);
    return dom.rootNode;
  }

  CareerShell.create = createCareerShell;
  CareerShell.open = function open(props) {
    const panelKey = panelKeyOf(props);
    if (!panelKey) return { ok: false, reason: 'invalid-panel' };
    return createCareerShell(panelKey).open(props);
  };
  CareerShell.render = function render(props) {
    const panelKey = panelKeyOf(props);
    if (!panelKey) return { ok: false, reason: 'invalid-panel' };
    return createCareerShell(panelKey).render(props);
  };
  CareerShell.close = function close() {
    const doc = documentOf();
    const manager = doc ? topManager(doc) : null;
    return manager ? closeShell(manager) : false;
  };
  CareerShell.PANELS = PANELS.slice();

  function ensureStyles(cssText) {
    const doc = documentOf();
    if (!doc) return null;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(STYLE_ID) : null;
    if (existing) return existing;
    if (typeof cssText !== 'string' || !cssText.trim()) return null;
    const style = element(doc, 'style', '', cssText);
    style.id = STYLE_ID;
    style.setAttribute('data-ac-career-ui-style', '');
    const parent = doc.head || doc.documentElement || doc.body;
    parent.appendChild(style);
    return style;
  }

  const components = {
    CareerShell,
    ClueRow,
    LetterCard,
    NPCDialogue,
    PrimaryAction,
    SecondaryAction,
    StoryCard,
    SegmentedTabs,
    WorkCard,
    ReceiptCard,
    JournalTimeline,
    ToolGrid,
    ensureStyles,
    icon,
    formatIsoDate: validIsoDate,
    STATES: {
      CareerShell: SHELL_STATES.slice(),
      ClueRow: CLUE_STATES.slice(),
      LetterCard: LETTER_STATES.slice(),
      NPCDialogue: NPC_STATES.slice(),
      StoryCard: STORY_STATES.slice(),
      WorkCard: WORK_STATES.slice(),
      ReceiptCard: RECEIPT_STATES.slice(),
      JournalTimeline: TIMELINE_STATES.slice(),
      ToolGrid: TOOL_STATES.slice(),
    },
  };

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.components = components;
  root.ArcadeCareerUI.CareerComponents = components;

  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = components;
  }
})(typeof window !== 'undefined' ? window : globalThis);
