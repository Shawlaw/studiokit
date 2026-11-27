/*!
 * StudioKit Arcade Life — 统一职业披露投影（0.22，T04）
 *
 * 纯 UMD：浏览器挂 window.ArcadeCareer.professionView（并镜像
 * window.ArcadeCareerProfessionView）；Node module.exports 返回同一 API。
 * 输入必须显式提供 state / catalog / context；不读 DOM、DB、存储、时钟或随机数。
 * 本模块只返回允许进入玩家 DOM 的投影，不创建身份、不接单、不写资产。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  root.ArcadeCareerProfessionView = api;
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.professionView !== api) {
    try {
      career.professionView = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var MODULE_VERSION = '0.22.0';
  var PROFESSION_VERSION = 1;
  var ACCEPTED_STATES = ['accepted', 'developed', 'completed'];
  var SURFACES = [
    'clue', 'letter', 'port', 'work', 'journal', 'receipt', 'message',
    'route', 'toast', 'deep-link', 'shop', 'crafting', 'tools',
  ];
  /* 任务详情只允许进入工作、港口、经历、收据、消息、路线与显式深链。 */
  var COMMISSION_SURFACES = ['port', 'work', 'journal', 'receipt', 'message', 'route', 'toast', 'deep-link'];
  /* 未接受职业的真实历史只在经历/收据/消息/路线/港口/深链中只读解释。 */
  var HISTORY_SURFACES = ['port', 'journal', 'receipt', 'message', 'route', 'toast', 'deep-link'];
  var INVITATION_SURFACES = ['clue', 'letter'];
  var REASONS = Object.freeze({
    notDiscovered: 'not-discovered',
    notRead: 'not-read',
    notAccepted: 'not-accepted',
    paused: 'paused',
    wrongSurface: 'wrong-surface',
    worldLocked: 'world-locked',
    storyLocked: 'story-locked',
    notAvailable: 'not-available',
    historicalOnly: 'historical-only',
    archived: 'archived',
    unknownProfession: 'unknown-profession',
    unknownCommission: 'unknown-commission',
    futureVersion: 'future-version',
  });

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      var text = JSON.stringify(value);
      return typeof text === 'string' ? JSON.parse(text) : null;
    } catch (err) {
      return null;
    }
  }

  function arrayOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function stableId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value);
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function stateOf(input) {
    var state = isObject(input) ? input : {};
    /* 兼容只读包装 {value: discovery}，但绝不读取任何外部存储。 */
    return isObject(state.value) ? state.value : state;
  }

  function contextOf(input) {
    var context = isObject(input) ? input : {};
    return Object.assign({}, context, {
      surface: typeof context.surface === 'string' && context.surface ? context.surface : 'work',
    });
  }

  function catalogOf(input) {
    var catalog = isObject(input) ? input : {};
    var commissions = Array.isArray(catalog.commissions) ? catalog.commissions : [];
    return {
      games: arrayOf(catalog.games),
      professions: arrayOf(catalog.professions),
      commissions: commissions,
      clues: arrayOf(catalog.clues),
      tools: arrayOf(catalog.tools),
      worldWorkIds: worldWorkIdsOf(catalog, null),
    };
  }

  function worldWorkIdsOf(catalog, context) {
    var out = [];
    var add = function (value) {
      if (!stableId(value) || out.indexOf(value) >= 0) return;
      out.push(value);
    };
    arrayOf(catalog && catalog.worldWorkIds).forEach(add);
    if (catalog && isObject(catalog.worldWork)) arrayOf(catalog.worldWork.commissionIds).forEach(add);
    if (catalog && isObject(catalog.worldWork)) arrayOf(catalog.worldWork.ids).forEach(add);
    if (context) arrayOf(context.worldWorkIds).forEach(add);
    return out;
  }

  function professionOf(catalog, professionId) {
    if (!stableId(professionId)) return null;
    for (var i = 0; i < catalog.professions.length; i += 1) {
      var row = catalog.professions[i];
      if (isObject(row) && row.professionId === professionId) return row;
    }
    return null;
  }

  function commissionOf(catalog, commissionId) {
    if (!stableId(commissionId)) return null;
    for (var i = 0; i < catalog.commissions.length; i += 1) {
      var row = catalog.commissions[i];
      if (isObject(row) && row.commissionId === commissionId) return row;
    }
    return null;
  }

  function progressOf(state, professionId) {
    var progress = isObject(state.professionProgress) ? state.professionProgress : null;
    return progress && isObject(progress[professionId]) ? progress[professionId] : null;
  }

  function progressState(progress) {
    return progress && typeof progress.state === 'string' ? progress.state : 'undiscovered';
  }

  function isAccepted(progress) {
    return ACCEPTED_STATES.indexOf(progressState(progress)) >= 0;
  }

  function acceptedProfessionIds(state, catalog) {
    var out = [];
    catalog.professions.forEach(function (profession) {
      if (!isObject(profession) || !stableId(profession.professionId)) return;
      if (isAccepted(progressOf(state, profession.professionId))) out.push(profession.professionId);
    });
    return out.sort();
  }

  function futureVersion(state) {
    return Number.isInteger(state.professionVersion) && state.professionVersion > PROFESSION_VERSION;
  }

  function fail(reason, extra) {
    var out = { ok: false, reason: reason };
    if (isObject(extra)) Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    return out;
  }

  function pass(extra) {
    var out = { ok: true };
    if (isObject(extra)) Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    return out;
  }

  function commonFailure(state, context) {
    if (futureVersion(state)) return fail(REASONS.futureVersion);
    if (context.archived === true) return fail(REASONS.archived);
    if (SURFACES.indexOf(context.surface) < 0) return fail(REASONS.wrongSurface);
    return null;
  }

  function canRevealProfession(input) {
    var options = isObject(input) ? input : {};
    var state = stateOf(options.state);
    var context = contextOf(options.context);
    var catalog = catalogOf(options.catalog);
    var common = commonFailure(state, context);
    if (common) return common;
    var professionId = options.professionId;
    if (!professionOf(catalog, professionId)) return fail(REASONS.unknownProfession);
    var progress = progressOf(state, professionId);
    var status = progressState(progress);
    if (status === 'undiscovered' || status === 'glimpsed') return fail(REASONS.notDiscovered);
    if (status === 'read') {
      /* 已读未接受不是职业披露，只允许恢复原邀请，绝不恢复任务详情。 */
      return INVITATION_SURFACES.indexOf(context.surface) >= 0
        ? pass({ invitationOnly: true })
        : fail(REASONS.notAccepted);
    }
    if (!isAccepted(progress)) return fail(REASONS.notRead);
    return pass();
  }

  function historyRows(context, commissionId) {
    var rows = [];
    arrayOf(context.history).forEach(function (row) {
      if (isObject(row) && row.commissionId === commissionId) rows.push(row);
    });
    if (isObject(context.history) && isObject(context.history[commissionId])) rows.push(context.history[commissionId]);
    arrayOf(context.activeRuns).forEach(function (row) {
      if (isObject(row) && row.commissionId === commissionId) rows.push(row);
    });
    if (isObject(context.activeRuns) && isObject(context.activeRuns[commissionId])) rows.push(context.activeRuns[commissionId]);
    return rows;
  }

  function hasRealHistory(context, commissionId) {
    if (arrayOf(context.clearedCommissions).indexOf(commissionId) >= 0) return true;
    if (isObject(context.clearedCommissions) && context.clearedCommissions[commissionId] === true) return true;
    return historyRows(context, commissionId).length > 0;
  }

  function isWorldCommission(catalog, context, commission) {
    if (!isObject(commission)) return false;
    return catalog.worldWorkIds.indexOf(commission.commissionId) >= 0
      || commission.category === 'world'
      || commission.worldWork === true;
  }

  function tokens(context, key) {
    var value = context[key];
    var out = [];
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        if (typeof item === 'string' && out.indexOf(item) < 0) out.push(item);
      });
    } else if (isObject(value)) {
      Object.keys(value).forEach(function (item) {
        if (value[item] === true && out.indexOf(item) < 0) out.push(item);
      });
    }
    return out;
  }

  function itemCount(context, itemId) {
    var items = isObject(context.items) ? context.items : (isObject(context.wallet) && isObject(context.wallet.items) ? context.wallet.items : {});
    var count = Number(items[itemId]);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }

  function unlockAllows(node, context) {
    if (node === undefined || node === null) return true;
    if (!isObject(node)) return false;
    if (Array.isArray(node.all)) return node.all.every(function (child) { return unlockAllows(child, context); });
    if (Array.isArray(node.any)) return node.any.some(function (child) { return unlockAllows(child, context); });
    var kind = typeof node.kind === 'string' ? node.kind : '';
    var value = node.value;
    var need = Number(node.atLeast);
    need = Number.isFinite(need) && need > 0 ? Math.floor(need) : 1;
    if (kind === 'chapterFlag' || (!kind && stableId(node.chapterFlag))) {
      return tokens(context, 'worldFlags').indexOf(kind ? value : node.chapterFlag) >= 0;
    }
    if (kind === 'commissionCleared' || (!kind && stableId(node.commissionCleared))) {
      var clearedId = kind ? value : node.commissionCleared;
      return tokens(context, 'clearedCommissions').indexOf(clearedId) >= 0
        || (isObject(context.clearedCommissions) && context.clearedCommissions[clearedId] === true);
    }
    if (kind === 'evidence' || (!kind && stableId(node.evidence))) {
      return tokens(context, 'storyEvidence').indexOf(kind ? value : node.evidence) >= 0;
    }
    if (kind === 'capability' || (!kind && stableId(node.capability))) {
      return tokens(context, 'capabilities').indexOf(kind ? value : node.capability) >= 0;
    }
    if (kind === 'item' || (!kind && stableId(node.item))) {
      return itemCount(context, kind ? value : node.item) >= need;
    }
    if (kind === 'credits' || (!kind && isObject(node.credits))) {
      if (context.walletKnown !== true) return false;
      var credits = Number(kind ? need : node.credits.atLeast);
      var known = Number(isObject(context.wallet) ? context.wallet.credits : context.credits);
      return Number.isFinite(credits) && Number.isFinite(known) && known >= credits;
    }
    return false;
  }

  function unlockFailureReason(node, context) {
    if (!isObject(node)) return REASONS.storyLocked;
    var worldKeys = ['item', 'credits', 'capability'];
    var key = Object.keys(node).filter(function (name) { return worldKeys.indexOf(name) >= 0; })[0];
    if (key) return REASONS.worldLocked;
    if (node.kind && worldKeys.indexOf(node.kind) >= 0) return REASONS.worldLocked;
    var children = Array.isArray(node.all) ? node.all : (Array.isArray(node.any) ? node.any : []);
    for (var i = 0; i < children.length; i += 1) {
      if (!unlockAllows(children[i], context) && unlockFailureReason(children[i], context) === REASONS.worldLocked) {
        return REASONS.worldLocked;
      }
    }
    return REASONS.storyLocked;
  }

  function canShowCommission(input) {
    var options = isObject(input) ? input : {};
    var state = stateOf(options.state);
    var context = contextOf(options.context);
    var catalog = catalogOf(options.catalog);
    var common = commonFailure(state, context);
    if (common) return common;
    var commissionId = options.commissionId;
    var commission = commissionOf(catalog, commissionId);
    if (!commission) return fail(REASONS.unknownCommission);
    if (COMMISSION_SURFACES.indexOf(context.surface) < 0) return fail(REASONS.wrongSurface);

    var world = isWorldCommission(catalog, context, commission);
    var owner = world ? null : commission.professionId;
    if (!world && !professionOf(catalog, owner)) return fail(REASONS.unknownProfession);
    var accepted = acceptedProfessionIds(state, catalog);
    var professionAccepted = world ? accepted.length > 0 : isAccepted(progressOf(state, owner));
    var paused = !world && isObject(progressOf(state, owner)) && progressOf(state, owner).paused === true;
    var allowed = unlockAllows(commission.unlock, context);
    var historical = hasRealHistory(context, commissionId);

    if (professionAccepted && !paused && allowed) return pass();
    if (historical && HISTORY_SURFACES.indexOf(context.surface) >= 0) {
      return pass({ reason: REASONS.historicalOnly, historicalOnly: true });
    }
    if (!professionAccepted) {
      if (world) return fail(REASONS.notAccepted);
      var progress = progressOf(state, owner);
      var status = progressState(progress);
      if (status === 'undiscovered' || status === 'glimpsed') return fail(REASONS.notDiscovered);
      if (status === 'read') return fail(REASONS.notAccepted);
      return fail(REASONS.notAccepted);
    }
    if (paused) return fail(REASONS.paused);
    return fail(unlockFailureReason(commission.unlock, context));
  }

  function canAcceptCommission(input) {
    var options = isObject(input) ? input : {};
    var shown = canShowCommission(options);
    if (!shown.ok) return shown;
    if (shown.historicalOnly === true) return fail(REASONS.historicalOnly);
    var context = contextOf(options.context);
    var available = tokens(context, 'availableIds');
    if (available.indexOf(options.commissionId) < 0) return fail(REASONS.notAvailable);
    return pass();
  }

  function publicCommission(catalog, context, commission, shown) {
    var world = isWorldCommission(catalog, context, commission);
    var historicalOnly = shown.historicalOnly === true;
    var out = {
      commissionId: commission.commissionId,
      gameId: typeof commission.gameId === 'string' ? commission.gameId : null,
      category: world ? 'world' : 'profession',
      title: typeof commission.title === 'string' ? commission.title : commission.commissionId,
      summary: typeof commission.summary === 'string' ? commission.summary : '',
      issuer: world ? '旧港' : (typeof commission.issuer === 'string' ? commission.issuer : ''),
      reward: isObject(commission.reward) ? clone(commission.reward) : { credits: 0, items: {}, evidence: [], flags: [] },
      repeatSalaryCredits: Number.isFinite(Number(commission.repeatSalaryCredits)) ? Math.max(0, Math.floor(Number(commission.repeatSalaryCredits))) : 0,
      durationHint: typeof commission.durationHint === 'string' ? commission.durationHint : '',
      risk: typeof commission.risk === 'string' ? commission.risk : 'low',
      startParams: isObject(commission.startParams) ? clone(commission.startParams) : {},
      unlocked: true,
      historicalOnly: historicalOnly,
      readOnly: historicalOnly,
    };
    if (Number.isFinite(Number(commission.tier))) out.tier = Math.max(1, Math.floor(Number(commission.tier)));
    if (!world && !historicalOnly && stableId(commission.professionId)) out.professionId = commission.professionId;
    return out;
  }

  function getVisibleCommissions(input) {
    var options = isObject(input) ? input : {};
    var state = stateOf(options.state);
    var context = contextOf(options.context);
    var catalog = catalogOf(options.catalog);
    var common = commonFailure(state, context);
    if (common) return [];
    var out = [];
    catalog.commissions.forEach(function (commission) {
      if (!isObject(commission) || !stableId(commission.commissionId)) return;
      var shown = canShowCommission({
        state: state,
        catalog: catalog,
        context: context,
        commissionId: commission.commissionId,
      });
      if (shown.ok) out.push(publicCommission(catalog, context, commission, shown));
    });
    out.sort(function (a, b) {
      if (a.commissionId === b.commissionId) return 0;
      return a.commissionId < b.commissionId ? -1 : 1;
    });
    return out;
  }

  function getNextNarrativeAction(input) {
    var options = isObject(input) ? input : {};
    var state = stateOf(options.state);
    var context = contextOf(options.context);
    var catalog = catalogOf(options.catalog);
    var common = commonFailure(state, context);
    if (common) return null;
    /* 推荐只能从调用方明确传入的真实可接集合选择；缺省时宁可不推荐。 */
    var available = tokens(context, 'availableIds');
    if (!available.length) return null;
    var visible = getVisibleCommissions({ state: state, catalog: catalog, context: context });
    var byId = Object.create(null);
    visible.forEach(function (commission) { byId[commission.commissionId] = commission; });
    var active = typeof state.activeProfessionId === 'string' ? state.activeProfessionId : null;
    var candidates = [];
    available.forEach(function (commissionId) {
      var commission = byId[commissionId];
      if (!commission || commission.readOnly) return;
      var accepted = canAcceptCommission({ state: state, catalog: catalog, context: context, commissionId: commissionId });
      if (!accepted.ok) return;
      var rank = commission.category === 'world' ? 0 : (commission.professionId === active ? 1 : 2);
      candidates.push({ commission: commission, rank: rank });
    });
    candidates.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.commission.commissionId === b.commission.commissionId) return 0;
      return a.commission.commissionId < b.commission.commissionId ? -1 : 1;
    });
    if (!candidates.length) return null;
    var picked = candidates[0].commission;
    return {
      kind: 'commission',
      commissionId: picked.commissionId,
      label: picked.title,
    };
  }

  function safeStoryEvent(state, catalog, eventId, row) {
    if (typeof eventId !== 'string' || !isObject(row)) return null;
    if (eventId.indexOf('invitation:') === 0) {
      var professionId = eventId.slice('invitation:'.length);
      if (!isAccepted(progressOf(state, professionId)) || !professionOf(catalog, professionId)) return null;
    }
    var source = typeof row.source === 'string' ? row.source : '';
    if (source && ['clue', 'commission', 'world', 'story'].indexOf(source) < 0) return null;
    return {
      eventId: eventId,
      at: typeof row.at === 'string' ? row.at : null,
      source: source,
    };
  }

  function storyHistory(state, catalog) {
    var events = isObject(state.storyEvents) ? state.storyEvents : {};
    var out = [];
    Object.keys(events).sort().forEach(function (eventId) {
      var row = safeStoryEvent(state, catalog, eventId, events[eventId]);
      if (row) out.push(row);
    });
    out.sort(function (a, b) {
      var left = a.at || '';
      var right = b.at || '';
      if (left !== right) return left < right ? -1 : 1;
      return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
    });
    return out;
  }

  function toolIntroduced(state, catalog, context, tool) {
    if (!isObject(tool) || !stableId(tool.toolId)) return false;
    if (tokens(context, 'knownToolIds').indexOf(tool.toolId) >= 0) return true;
    var owner = tool.professionId || tool.introducedByProfessionId || null;
    if (owner && professionOf(catalog, owner)) return isAccepted(progressOf(state, owner));
    var flags = [tool.worldFlag, tool.requiredFlag, tool.unlockFlag].filter(function (value) { return stableId(value); });
    return flags.some(function (flag) { return tokens(context, 'worldFlags').indexOf(flag) >= 0; });
  }

  function projectCareerView(input) {
    var options = isObject(input) ? input : {};
    var state = stateOf(options.state);
    var context = contextOf(options.context);
    var catalog = catalogOf(options.catalog);
    var out = {
      schemaVersion: SCHEMA_VERSION,
      originGameId: null,
      activeProfessionId: null,
      professions: [],
      commissions: [],
      story: { nextAction: null, messages: [], history: [] },
      tools: [],
    };
    if (futureVersion(state) || context.archived === true || SURFACES.indexOf(context.surface) < 0) return out;
    var accepted = acceptedProfessionIds(state, catalog);
    if (!accepted.length) {
      /* 无已接受职业时仍允许真实历史只读投影，但绝不推测起源/当前职业。 */
      out.commissions = getVisibleCommissions({ state: state, catalog: catalog, context: context });
      out.story.history = storyHistory(state, catalog);
      return out;
    }
    if (stableId(state.acceptedOriginGameId) && catalog.games.some(function (game) {
      return isObject(game) && game.gameId === state.acceptedOriginGameId;
    })) out.originGameId = state.acceptedOriginGameId;
    if (accepted.indexOf(state.activeProfessionId) >= 0) out.activeProfessionId = state.activeProfessionId;
    out.professions = accepted.map(function (professionId) {
      var raw = professionOf(catalog, professionId);
      var progress = progressOf(state, professionId);
      return {
        professionId: professionId,
        displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : professionId,
        domain: typeof raw.domain === 'string' ? raw.domain : '',
        state: progressState(progress),
        paused: progress.paused === true,
        active: state.activeProfessionId === professionId,
      };
    });
    out.commissions = getVisibleCommissions({ state: state, catalog: catalog, context: context });
    out.story.nextAction = getNextNarrativeAction({ state: state, catalog: catalog, context: context });
    out.story.history = storyHistory(state, catalog);
    out.tools = catalog.tools.filter(function (tool) {
      return toolIntroduced(state, catalog, context, tool);
    }).map(function (tool) {
      return {
        toolId: tool.toolId,
        name: typeof tool.name === 'string' ? tool.name : (typeof tool.displayName === 'string' ? tool.displayName : tool.toolId),
      };
    }).sort(function (a, b) {
      return a.toolId < b.toolId ? -1 : a.toolId > b.toolId ? 1 : 0;
    });
    return out;
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    MODULE_VERSION: MODULE_VERSION,
    PROFESSION_VERSION: PROFESSION_VERSION,
    STATES: Object.freeze(['undiscovered', 'glimpsed', 'read', 'accepted', 'developed', 'completed']),
    SURFACES: Object.freeze(SURFACES.slice()),
    REASONS: REASONS,
    projectCareerView: projectCareerView,
    canRevealProfession: canRevealProfession,
    canShowCommission: canShowCommission,
    canAcceptCommission: canAcceptCommission,
    getVisibleCommissions: getVisibleCommissions,
    getNextNarrativeAction: getNextNarrativeAction,
  });
});
