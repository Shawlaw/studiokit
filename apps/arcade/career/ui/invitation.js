/*!
 * StudioKit Arcade Life — first arrival / later invitation adapter (0.23 T12).
 *
 * Browser script (non-ESM). The adapter only consumes a gated single invitation,
 * careerView and the narrative card injected by bridge. It never reads a catalog,
 * storage or network, and accepting an invitation never starts a commission.
 *
 * bridge integration:
 *   invitation.open(uiContext({ clueId, narrative, returnFocus }))
 *   invitation.render(sameContext)
 *   invitation.close()
 *
 * narrative may be the invited profession's card directly, a professionId-keyed
 * map, or a function(invitation, context). freshIntro is used only before the
 * first identity exists; existingIntro is used for an established identity and
 * for accept results with created:false. Missing fields degrade to a quiet,
 * action-only invitation instead of inventing story or tasks.
 */
(function (root) {
  'use strict';

  const manager = { shell: null, context: null, token: 0, unsubscribe: null };
  const DESTRUCTIVE_REASONS = ['career-imported', 'career-archived', 'career-unarchived', 'career-reset'];

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00a0/g, ' ').replace(/[ \t\r\n]+/g, ' ').trim();
  }

  function componentsOf(context) {
    if (isObject(context) && isObject(context.uiComponents) && typeof context.uiComponents.CareerShell === 'function') return context.uiComponents;
    return root.ArcadeCareerUI && root.ArcadeCareerUI.components;
  }

  function harborOf(context) {
    if (context && typeof context.uiHarbor === 'function' && typeof context.uiHarbor.render === 'function') return context.uiHarbor.render;
    if (context && isObject(context.uiHarbor) && typeof context.uiHarbor.render === 'function') return context.uiHarbor.render;
    if (context && typeof context.uiHarbor === 'function') return context.uiHarbor;
    const harbor = root.ArcadeCareerUI && root.ArcadeCareerUI.harbor;
    if (harbor && typeof harbor.render === 'function') return harbor.render;
    return typeof harbor === 'function' ? harbor : null;
  }

  function normalizeInvitation(raw, clueId) {
    if (!isObject(raw)) return null;
    const professionId = cleanText(raw.professionId);
    const gameId = cleanText(raw.gameId);
    const state = cleanText(raw.state).toLowerCase();
    if (!professionId || !gameId || ['glimpsed', 'read', 'accepted'].indexOf(state) < 0) return null;
    return {
      professionId: professionId,
      gameId: gameId,
      displayName: cleanText(raw.displayName),
      sender: cleanText(raw.sender),
      state: state,
      canAccept: state === 'read' && raw.canAccept === true,
    };
  }

  async function readInvitation(context) {
    const clueId = cleanText(context && context.clueId);
    if (!clueId) return null;
    let raw = context && context.invitation;
    const reader = typeof context.invitationForClue === 'function'
      ? context.invitationForClue
      : isObject(context.api) && typeof context.api.invitationForClue === 'function' ? context.api.invitationForClue : null;
    if (reader) {
      try { raw = await reader.call(context, clueId); } catch (err) { raw = null; }
    }
    return normalizeInvitation(raw, clueId);
  }

  async function readView(context) {
    const reader = typeof context.careerView === 'function'
      ? context.careerView
      : isObject(context.api) && typeof context.api.careerView === 'function' ? context.api.careerView : null;
    if (!reader) return null;
    try { return await reader.call(context, { surface: 'letter' }); } catch (err) { return null; }
  }

  function identityEstablished(context, view) {
    if (cleanText(context && context.careerId)) return true;
    if (isObject(context && context.state) && cleanText(context.state.acceptedOriginGameId)) return true;
    if (!isObject(view)) return false;
    return !!cleanText(view.originGameId) || (Array.isArray(view.professions) && view.professions.length > 0);
  }

  function paragraphsOf(value) {
    if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).slice(0, 3);
    const text = cleanText(value);
    return text ? [text] : [];
  }

  function narrativeOf(context, invitation) {
    let raw = context && context.narrative;
    if (typeof raw === 'function') {
      try { raw = raw(invitation, context); } catch (err) { raw = null; }
    }
    if (!isObject(raw)) return {};
    const keyed = isObject(raw.byProfessionId) && isObject(raw.byProfessionId[invitation.professionId])
      ? raw.byProfessionId[invitation.professionId]
      : isObject(raw[invitation.professionId]) ? raw[invitation.professionId] : null;
    if (keyed) return keyed;
    if (raw.professionId && raw.professionId !== invitation.professionId) return {};
    return raw;
  }

  function acceptFnOf(context) {
    if (typeof context.acceptProfessionInvitation === 'function') return context.acceptProfessionInvitation;
    if (isObject(context.api) && typeof context.api.acceptProfessionInvitation === 'function') return context.api.acceptProfessionInvitation;
    return null;
  }

  function isFirstCommissionFor(row, invitation) {
    return isObject(row)
      && cleanText(row.professionId) === cleanText(invitation.professionId)
      && cleanText(row.category) === 'profession'
      && row.readOnly !== true
      && row.historicalOnly !== true;
  }

  function projectedCommission(view, invitation, narrative) {
    if (!isObject(view) || !Array.isArray(view.commissions)) return null;
    const wanted = cleanText(narrative.firstCommissionId);
    const rows = view.commissions.filter((row) => isFirstCommissionFor(row, invitation));
    if (wanted) {
      /* An explicit firstCommissionId is a gate, not a preference: a mismatch
         from another profession, world work or a read-only row must not start. */
      const exact = rows.find((row) => cleanText(row.commissionId) === wanted);
      return exact || null;
    }
    return rows[0] || null;
  }

  /** Pure, async projection used by the adapter and its Node/VM gate. */
  async function derive(context, options) {
    const ctx = isObject(context) ? context : {};
    const opts = isObject(options) ? options : {};
    const invitation = normalizeInvitation(opts.invitation, cleanText(ctx.clueId)) || await readInvitation(ctx);
    if (!invitation) return { ok: false, reason: 'invitation-unavailable' };
    const view = await readView(ctx);
    const established = identityEstablished(ctx, view);
    const acceptedResult = isObject(opts.acceptedResult) ? opts.acceptedResult : null;
    const accepted = invitation.state === 'accepted' || !!(acceptedResult && acceptedResult.ok === true);
    const identityBefore = opts.identityBefore === undefined ? established : opts.identityBefore === true;
    const created = !!(acceptedResult && acceptedResult.ok === true && acceptedResult.created === true && !identityBefore);
    const mode = created || (!established && !(acceptedResult && acceptedResult.created === false)) ? 'freshIntro' : 'existingIntro';
    const narrative = narrativeOf(ctx, invitation);
    const intro = paragraphsOf(narrative[mode]);
    const firstCommission = created ? projectedCommission(view, invitation, narrative) : null;
    return {
      ok: true,
      invitation: accepted ? Object.assign({}, invitation, { state: 'accepted', canAccept: false }) : invitation,
      view: view,
      narrative: narrative,
      mode: mode,
      identityBefore: identityBefore,
      created: created,
      accepted: accepted,
      paragraphs: intro.length ? intro : ['你可以收下这份邀请，也可以稍后再决定。'],
      firstCommission: firstCommission,
    };
  }

  function announce(context, text) {
    if (typeof context.announce !== 'function') return;
    try { context.announce(text); } catch (err) { /* visible state remains authoritative */ }
  }

  function annotateActions(node, actions) {
    const buttons = node.querySelectorAll('button');
    actions.forEach((input, index) => {
      if (buttons[index] && input.id) buttons[index].setAttribute('data-action', input.id);
    });
  }

  function close() {
    manager.token += 1;
    if (manager.unsubscribe) {
      try { manager.unsubscribe(); } catch (err) { /* ignore */ }
      manager.unsubscribe = null;
    }
    const shell = manager.shell;
    manager.shell = null;
    manager.context = null;
    return !!(shell && shell.close());
  }

  function subscribe(context) {
    const fn = typeof context.onCareerDataChanged === 'function'
      ? context.onCareerDataChanged
      : isObject(context.api) && typeof context.api.onCareerDataChanged === 'function' ? context.api.onCareerDataChanged : null;
    if (!fn) return null;
    try {
      const unsubscribe = fn.call(context, (change) => {
        if (DESTRUCTIVE_REASONS.indexOf(cleanText(change && change.reason)) >= 0) close();
      });
      return typeof unsubscribe === 'function' ? unsubscribe : null;
    } catch (err) { return null; }
  }

  function startCallOf(context) {
    if (typeof context.startCommission === 'function') return { fn: context.startCommission, scope: context };
    if (isObject(context.commission) && typeof context.commission.start === 'function') return { fn: context.commission.start, scope: context.commission };
    return null;
  }

  function renderModel(state, model, status) {
    const components = componentsOf(state.context);
    const harbor = harborOf(state.context);
    if (!components || !harbor) {
      state.shell.render({ title: '旧港邀请', state: 'error', reducedMotion: !!state.context.reducedMotion, body: null, onClose: close });
      return;
    }
    const doc = state.shellDoc;
    const body = doc.createElement('div');
    body.className = 'ac-career-ui__stack';
    const scene = harbor(true);
    if (scene) body.appendChild(scene);
    const location = doc.createElement('p');
    location.className = 'ac-career-ui__caption';
    location.textContent = cleanText(model.narrative.location) || '折光港 · 旧码头';
    body.appendChild(location);

    const npcActions = [];
    if (!model.accepted) {
      const accept = acceptFnOf(state.context);
      if (model.invitation.canAccept && accept) {
        npcActions.push({
          id: 'accept-invitation', label: cleanText(model.narrative.acceptLabel) || '接受这份邀请', kind: 'primary',
          disabled: state.busy,
          onClick: () => acceptInvitation(state),
        });
      }
      npcActions.push({ id: 'defer-invitation', label: cleanText(model.narrative.deferLabel) || '以后再说', kind: 'text', onClick: close });
    } else if (model.firstCommission) {
      npcActions.push({ id: 'leave-arrival', label: cleanText(model.narrative.leaveLabel) || '暂时离开港口', kind: 'text', onClick: close });
    } else {
      npcActions.push({ id: 'leave-arrival', label: cleanText(model.narrative.leaveLabel) || '离开港口', kind: 'primary', onClick: close });
    }

    const npc = components.NPCDialogue({
      name: cleanText(model.narrative.npcName) || cleanText(model.invitation.sender) || '旧港来信',
      paragraphs: model.paragraphs,
      avatar: { kind: 'user' },
      state: model.mode === 'freshIntro' ? 'first' : 'optional',
      actions: npcActions,
    });
    annotateActions(npc, npcActions);
    body.appendChild(npc);
    if (status) {
      const note = doc.createElement('p');
      note.className = 'ac-career-ui__caption';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.textContent = status;
      body.appendChild(note);
    }
    if (model.accepted && !status) {
      const note = doc.createElement('p');
      note.className = 'ac-career-ui__caption';
      note.textContent = '邀请已收下。';
      body.appendChild(note);
    }

    if (model.firstCommission) {
      const commission = model.firstCommission;
      const storyAction = {
        id: 'start-first-commission',
        label: cleanText(model.narrative.firstActionLabel) || '接受这份工作',
        kind: 'primary',
        disabled: state.busy,
        onClick: () => startFirstCommission(state, commission.commissionId),
      };
      const story = components.StoryCard({
        eyebrow: cleanText(model.narrative.firstCommissionEyebrow) || '你的第一份工作',
        title: cleanText(commission.title),
        summary: cleanText(commission.summary) || cleanText(commission.objectiveText),
        state: 'current',
        action: storyAction,
      });
      annotateActions(story, [storyAction]);
      body.appendChild(story);
    }

    const title = cleanText(model.narrative.title) || (model.mode === 'freshIntro' ? '初次到港' : '一封新的邀请');
    const result = state.shell.render({
      title: title,
      state: 'normal',
      body: body,
      reducedMotion: !!state.context.reducedMotion,
      returnFocus: state.context.returnFocus || null,
      onClose: close,
    });
    if (result && result.panel) {
      result.panel.setAttribute('data-invitation-mode', model.mode);
      result.panel.setAttribute('data-invitation-created', String(model.created));
    }
  }

  async function refresh(state, initial) {
    const token = ++manager.token;
    const model = await derive(state.context, {
      invitation: state.invitation,
      acceptedResult: state.acceptedResult,
      identityBefore: state.identityBefore,
    });
    if (token !== manager.token || manager.shell !== state.shell) return;
    state.model = model;
    if (!model.ok) {
      const doc = state.shellDoc;
      const body = doc.createElement('p');
      body.className = 'ac-career-ui__muted';
      body.textContent = '这封邀请暂时读不到，稍后可以从原信再来。';
      state.shell.render({ title: '旧港邀请', state: 'error', body: body, reducedMotion: !!state.context.reducedMotion, onClose: close });
      return;
    }
    if (state.identityBefore === null) state.identityBefore = model.identityBefore;
    renderModel(state, model, initial ? '' : state.status);
  }

  async function acceptInvitation(state) {
    if (state.busy || !state.model || state.model.accepted || !state.model.invitation.canAccept) return { ok: false };
    const accept = acceptFnOf(state.context);
    if (!accept) return { ok: false };
    state.busy = true;
    state.status = '';
    renderModel(state, state.model, '正在收下这份邀请…');
    let result = null;
    try {
      result = await accept.call(state.context, {
        professionId: state.model.invitation.professionId,
        gameId: state.model.invitation.gameId,
      });
    } catch (err) { result = { ok: false }; }
    if (!isObject(result) || result.ok !== true) {
      state.busy = false;
      state.status = '这封邀请这会儿没能收下，你想再试一次吗？';
      renderModel(state, state.model, state.status);
      announce(state.context, state.status);
      return { ok: false };
    }
    state.acceptedResult = result;
    state.busy = false;
    state.status = '';
    state.invitation = Object.assign({}, state.model.invitation, { state: 'accepted', canAccept: false });
    try { await refresh(state, false); } catch (err) {
      state.status = '邀请已收下，港口这会儿没能展开，你可以稍后再来。';
      renderModel(state, state.model, state.status);
    }
    announce(state.context, '邀请已收下。');
    return { ok: true };
  }

  async function startFirstCommission(state, commissionId) {
    if (state.busy || !commissionId || !state.model || !isFirstCommissionFor(state.model.firstCommission, state.model.invitation)) return { ok: false };
    const start = startCallOf(state.context);
    if (!start) {
      state.status = '这份工作暂时接不了，你可以稍后再来。';
      renderModel(state, state.model, state.status);
      return { ok: false };
    }
    state.busy = true;
    state.status = '';
    renderModel(state, state.model, '正在接下这份工作…');
    let result = null;
    try { result = await start.fn.call(start.scope, { commissionId: commissionId, ensure: false }); }
    catch (err) { result = { ok: false }; }
    state.busy = false;
    if (!isObject(result) || result.ok !== true) {
      state.status = '这份工作暂时接不了，你想再试一次吗？';
      renderModel(state, state.model, state.status);
      return { ok: false };
    }
    state.status = '';
    renderModel(state, state.model, '');
    const url = cleanText(result.url);
    if (url && root.location && typeof root.location.assign === 'function') root.location.assign(url);
    return { ok: true };
  }

  function open(context) {
    const components = componentsOf(context);
    const doc = typeof document !== 'undefined' && document && document.body ? document : null;
    if (!components || !doc) return { ok: false, reason: 'ui-unavailable' };
    close();
    const ctx = isObject(context) ? context : {};
    const shell = components.CareerShell.create('arrival');
    const state = {
      shell: shell,
      shellDoc: doc,
      context: ctx,
      model: null,
      invitation: normalizeInvitation(ctx.invitation, cleanText(ctx.clueId)),
      acceptedResult: null,
      identityBefore: null,
      busy: false,
      status: '',
    };
    manager.shell = shell;
    manager.context = ctx;
    const opened = shell.open({
      title: '旧港邀请',
      state: 'loading',
      body: null,
      reducedMotion: !!ctx.reducedMotion,
      returnFocus: ctx.returnFocus || null,
      onClose: close,
    });
    if (!opened || !opened.ok) {
      manager.shell = null;
      manager.context = null;
      return opened || { ok: false, reason: 'open-failed' };
    }
    manager.unsubscribe = subscribe(ctx);
    refresh(state, true).catch(() => {
      if (manager.shell === shell) shell.render({ title: '旧港邀请', state: 'error', body: null, reducedMotion: !!ctx.reducedMotion, onClose: close });
    });
    return opened;
  }

  function render(context) {
    /* Bridge refresh facade: open() owns the interactive session and rebuilds it. */
    if (!manager.shell) return open(context);
    const ctx = isObject(context) ? context : {};
    return open(Object.assign({}, manager.context, ctx));
  }

  const api = { open: open, render: render, show: render, close: close, derive: derive };
  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.invitation = api;
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
