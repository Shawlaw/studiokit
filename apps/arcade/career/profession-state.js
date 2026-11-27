/*!
 * StudioKit Arcade Life — 职业披露状态扩展（0.22，T01 冻结接口）
 *
 * 纯 UMD：浏览器挂 window.ArcadeCareer.professionState，Node 可直接 require()。
 * 无 DOM / IndexedDB / 网络 / 时钟 / 随机数；时间由调用方显式传入。
 *
 * 本模块只处理 `state['discovery']` 快照中的职业披露扩展，不创建身份、不写资产、
 * 不读完整 catalog。身份与起源事务由 career-db.applyProfessionEvent 在同一事务完成。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.professionState = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const PROFESSION_VERSION = 1;
  const STATES = Object.freeze([
    'undiscovered',
    'glimpsed',
    'read',
    'accepted',
    'developed',
    'completed',
  ]);
  const RANK = Object.freeze(STATES.reduce((map, state, index) => {
    map[state] = index;
    return map;
  }, Object.create(null)));
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  const GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  const EVENT_ID_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  const MAX_STORY_EVENTS = 256;
  const LEGACY_DISCOVERY_KEYS = new Set([
    'schemaVersion', 'stage', 'firstSourceGame', 'firstClueId', 'hintsEnabled',
    'portSeenAt', 'careerSignedAt', 'explorerAt', 'updatedAt', 'clues', 'runs',
  ]);

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return null;
    }
  }

  function validId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function validGameId(value) {
    return typeof value === 'string' && GAME_ID_RE.test(value);
  }

  function validToken(value) {
    return typeof value === 'string' && TOKEN_RE.test(value);
  }

  function validEventId(value) {
    return typeof value === 'string' && EVENT_ID_RE.test(value);
  }

  function laterTimestamp(current, candidate) {
    const now = iso(candidate);
    const previous = iso(current);
    if (!now) return previous;
    if (!previous) return now;
    return Date.parse(now) > Date.parse(previous) ? now : previous;
  }

  function iso(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return '';
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? text : '';
  }

  function rankOf(state) {
    return RANK[state] === undefined ? -1 : RANK[state];
  }

  function laterRank(a, b) {
    return rankOf(a) >= rankOf(b) ? a : b;
  }

  function emptyProgress(discoveredAt) {
    return {
      state: 'undiscovered',
      paused: false,
      discoveredAt: iso(discoveredAt) || null,
      readAt: null,
      acceptedAt: null,
      completedAt: null,
    };
  }

  function initialState(now) {
    const at = iso(now);
    return {
      professionVersion: PROFESSION_VERSION,
      firstDiscoveredGameId: null,
      acceptedOriginGameId: null,
      activeProfessionId: null,
      narrativeCursor: { chapterId: 'C0', nodeId: null },
      storyEvents: {},
      professionProgress: {},
      updatedAt: at,
    };
  }

  function normalizeProgress(raw, fallbackAt) {
    if (!isObject(raw)) return null;
    const declared = STATES.indexOf(raw.state) >= 0 ? raw.state : 'undiscovered';
    let state = declared;
    /* 证据只能把状态向前推，不能因为坏快照或旧字段回退。 */
    if (iso(raw.acceptedAt)) state = laterRank(state, 'accepted');
    if (iso(raw.completedAt)) state = laterRank(state, 'completed');
    if (iso(raw.readAt)) state = laterRank(state, 'read');
    if (iso(raw.discoveredAt)) state = laterRank(state, 'glimpsed');
    return {
      state,
      paused: raw.paused === true,
      discoveredAt: iso(raw.discoveredAt) || null,
      readAt: iso(raw.readAt) || null,
      acceptedAt: iso(raw.acceptedAt) || null,
      completedAt: iso(raw.completedAt) || null,
    };
  }

  /** 只规整扩展字段；不接触 discovery 既有 clues/runs/stage 等真相。 */
  function professionVersionOf(raw) {
    if (!isObject(raw)) return PROFESSION_VERSION;
    const value = raw.professionVersion;
    if (!Number.isInteger(value) || value < 1) return PROFESSION_VERSION;
    return value;
  }

  function futureExtensionOf(raw) {
    const out = Object.create(null);
    Object.keys(raw).forEach((key) => {
      if (LEGACY_DISCOVERY_KEYS.has(key)) return;
      out[key] = clone(raw[key]);
    });
    out.professionVersion = professionVersionOf(raw);
    out.updatedAt = iso(raw.updatedAt);
    return out;
  }

  function normalizeExtension(raw, now) {
    const base = initialState(now);
    if (!isObject(raw)) return base;
    if (professionVersionOf(raw) > PROFESSION_VERSION) return futureExtensionOf(raw);
    const first = validGameId(raw.firstDiscoveredGameId) ? raw.firstDiscoveredGameId
      : validGameId(raw.firstSourceGame) ? raw.firstSourceGame : null;
    base.firstDiscoveredGameId = first;
    base.acceptedOriginGameId = validGameId(raw.acceptedOriginGameId) ? raw.acceptedOriginGameId : null;
    base.activeProfessionId = validId(raw.activeProfessionId) ? raw.activeProfessionId : null;
    if (isObject(raw.narrativeCursor)) {
      base.narrativeCursor = {
        chapterId: typeof raw.narrativeCursor.chapterId === 'string' && raw.narrativeCursor.chapterId.length <= 32
          ? raw.narrativeCursor.chapterId : 'C0',
        nodeId: validEventId(raw.narrativeCursor.nodeId) ? raw.narrativeCursor.nodeId : null,
      };
    }
    if (isObject(raw.storyEvents)) {
      Object.keys(raw.storyEvents).forEach((eventId) => {
        const row = raw.storyEvents[eventId];
        if (!validEventId(eventId) || !isObject(row)) return;
        base.storyEvents[eventId] = { at: iso(row.at) || null, source: typeof row.source === 'string' ? row.source.slice(0, 120) : '' };
      });
      const keys = Object.keys(base.storyEvents).sort();
      while (keys.length > MAX_STORY_EVENTS) delete base.storyEvents[keys.shift()];
    }
    if (isObject(raw.professionProgress)) {
      Object.keys(raw.professionProgress).forEach((professionId) => {
        if (!validId(professionId)) return;
        const normalized = normalizeProgress(raw.professionProgress[professionId], iso(now));
        if (normalized) base.professionProgress[professionId] = normalized;
      });
    }
    base.updatedAt = laterTimestamp(iso(now), raw.updatedAt);
    return base;
  }

  function mergeIntoDiscovery(state, raw, now) {
    const base = isObject(state) ? clone(state) : null;
    const out = base || initialState(now);
    const extension = normalizeExtension(raw, now);
    /* 任一端为未来版本都只读保留，绝不把未知字段写入当前 schema。 */
    if (professionVersionOf(base) > PROFESSION_VERSION || professionVersionOf(extension) > PROFESSION_VERSION) return out;
    Object.assign(out, extension);
    return out;
  }

  function extensionOf(state) {
    if (!isObject(state)) return null;
    if (professionVersionOf(state) > PROFESSION_VERSION) return futureExtensionOf(state);
    const ext = normalizeExtension(state, iso(state.updatedAt));
    delete ext.updatedAt;
    return ext;
  }

  function fail(state, reason) {
    return { ok: false, reason, state: state };
  }

  function done(state, extra) {
    const out = { ok: true, state: state };
    if (extra && typeof extra === 'object') Object.keys(extra).forEach((key) => { out[key] = extra[key]; });
    return out;
  }

  function nextState(state) {
    if (!isObject(state)) return null;
    return clone(state);
  }

  function progressOf(state, professionId) {
    const progress = state && isObject(state.professionProgress) ? state.professionProgress : null;
    return progress && isObject(progress[professionId]) ? progress[professionId] : null;
  }

  function recordGlimpsed(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    if (input.gameId !== undefined && !validGameId(input.gameId)) return fail(state, 'bad-game-id');
    if (input.clueId !== undefined && !validToken(input.clueId)) return fail(state, 'bad-clue-id');
    const mismatch = mappingError(input.catalog, input.professionId, input.gameId, input.clueId);
    if (mismatch) return fail(state, mismatch);
    const at = iso(input.at);
    const id = input.professionId;
    next.professionProgress = isObject(next.professionProgress) ? next.professionProgress : {};
    const prior = progressOf(next, id);
    if (!prior) {
      next.professionProgress[id] = Object.assign(emptyProgress(at), { state: 'glimpsed' });
    } else if (rankOf(prior.state) < rankOf('glimpsed')) {
      prior.state = 'glimpsed';
      prior.discoveredAt = prior.discoveredAt || at || null;
    }
    if (!next.firstDiscoveredGameId && validGameId(input.gameId)) next.firstDiscoveredGameId = input.gameId;
    if (!next.firstSourceGame && validGameId(input.gameId)) next.firstSourceGame = input.gameId;
    next.updatedAt = laterTimestamp(next.updatedAt, at);
    return done(next);
  }

  function recordRead(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    if (input.clueId !== undefined && !validToken(input.clueId)) return fail(state, 'bad-clue-id');
    const mismatch = mappingError(input.catalog, input.professionId, input.gameId, input.clueId);
    if (mismatch) return fail(state, mismatch);
    const priorBeforeRead = progressOf(next, input.professionId);
    if ((!priorBeforeRead || rankOf(priorBeforeRead.state) < rankOf('glimpsed')) && input.clueOpened !== true) {
      return fail(state, 'not-discovered');
    }
    const at = iso(input.at);
    const id = input.professionId;
    next.professionProgress = isObject(next.professionProgress) ? next.professionProgress : {};
    let prior = progressOf(next, id);
    if (!prior) {
      prior = emptyProgress(at);
      if (input.clueOpened === true) prior.discoveredAt = at || null;
      next.professionProgress[id] = prior;
    }
    if (rankOf(prior.state) < rankOf('read')) prior.state = 'read';
    prior.readAt = prior.readAt || at || null;
    next.updatedAt = laterTimestamp(next.updatedAt, at);
    return done(next);
  }

  function acceptInvitation(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    if (input.gameId !== undefined && !validGameId(input.gameId)) return fail(state, 'bad-game-id');
    const prior = progressOf(next, input.professionId);
    if (!prior || rankOf(prior.state) < rankOf('read')) return fail(state, 'not-readable');
    const duplicate = rankOf(prior.state) >= rankOf('accepted');
    if (duplicate) {
      /* 重复邀请必须是纯 no-op；切换当前职业只能显式调用 setActive。 */
      return done(nextState(state), {
        duplicate: true,
        newlyAccepted: false,
        originGameId: isObject(state) ? state.acceptedOriginGameId || null : null,
      });
    }
    if (!validGameId(input.gameId)) return fail(state, 'missing-game-id');
    const mismatch = mappingError(input.catalog, input.professionId, input.gameId, input.clueId);
    if (mismatch) return fail(state, mismatch);
    const at = iso(input.at);
    prior.state = 'accepted';
    prior.acceptedAt = prior.acceptedAt || at || null;
    if (!next.acceptedOriginGameId) next.acceptedOriginGameId = input.gameId;
    next.activeProfessionId = input.professionId;
    if (!isObject(next.narrativeCursor)) next.narrativeCursor = { chapterId: 'C0', nodeId: null };
    if (!next.narrativeCursor.nodeId) next.narrativeCursor.nodeId = 'invitation:' + input.professionId;
    next.updatedAt = laterTimestamp(next.updatedAt, at);
    return done(next, { duplicate: false, newlyAccepted: true, originGameId: next.acceptedOriginGameId });
  }

  function setActive(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    const mismatch = mappingError(input.catalog, input.professionId);
    if (mismatch) return fail(state, mismatch);
    const prior = progressOf(next, input.professionId);
    if (!prior || rankOf(prior.state) < rankOf('accepted')) return fail(state, 'not-accepted');
    next.activeProfessionId = input.professionId;
    next.updatedAt = laterTimestamp(next.updatedAt, iso(input.at));
    return done(next);
  }

  function setPaused(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    const mismatch = mappingError(input.catalog, input.professionId);
    if (mismatch) return fail(state, mismatch);
    const prior = progressOf(next, input.professionId);
    if (!prior || rankOf(prior.state) < rankOf('accepted')) return fail(state, 'not-accepted');
    prior.paused = input.paused === true;
    next.updatedAt = laterTimestamp(next.updatedAt, iso(input.at));
    return done(next, { paused: prior.paused });
  }

  function advance(state, input, target) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    const mismatch = mappingError(input.catalog, input.professionId);
    if (mismatch) return fail(state, mismatch);
    const prior = progressOf(next, input.professionId);
    if (!prior || rankOf(prior.state) < rankOf('accepted')) return fail(state, 'not-accepted');
    const at = iso(input.at);
    if (rankOf(prior.state) < rankOf(target)) prior.state = target;
    if (target === 'completed') prior.completedAt = prior.completedAt || at || null;
    next.updatedAt = laterTimestamp(next.updatedAt, at);
    return done(next);
  }

  function markDeveloped(state, input) {
    return advance(state, input, 'developed');
  }

  function markCompleted(state, input) {
    return advance(state, input, 'completed');
  }

  function recordStoryEvent(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validEventId(input.eventId)) return fail(state, 'bad-event-id');
    next.storyEvents = isObject(next.storyEvents) ? next.storyEvents : {};
    if (next.storyEvents[input.eventId]) return done(next, { duplicate: true });
    next.storyEvents[input.eventId] = {
      at: iso(input.at) || null,
      source: typeof input.source === 'string' ? input.source.slice(0, 120) : '',
    };
    if (Object.keys(next.storyEvents).length > MAX_STORY_EVENTS) {
      const keys = Object.keys(next.storyEvents).sort();
      while (keys.length > MAX_STORY_EVENTS) delete next.storyEvents[keys.shift()];
    }
    if (!isObject(next.narrativeCursor)) next.narrativeCursor = { chapterId: 'C0', nodeId: null };
    next.narrativeCursor.nodeId = input.eventId;
    next.updatedAt = laterTimestamp(next.updatedAt, iso(input.at));
    return done(next, { duplicate: false });
  }

  function arrayOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function catalogParts(catalog) {
    if (!isObject(catalog)) return { games: [], professions: [], commissions: [], clues: [] };
    return {
      games: Array.isArray(catalog.games) ? catalog.games : [],
      professions: Array.isArray(catalog.professions) ? catalog.professions : [],
      commissions: Array.isArray(catalog.commissions) ? catalog.commissions : [],
      clues: Array.isArray(catalog.clues) ? catalog.clues : [],
    };
  }

  function mappingError(catalog, professionId, gameId, clueId) {
    const parts = catalogParts(catalog);
    if (!parts.professions.length) return 'missing-catalog';
    if (!parts.professions.some((row) => isObject(row) && row.professionId === professionId)) return 'unknown-profession';
    if (typeof gameId === 'string' && gameId) {
      const game = parts.games.find((row) => isObject(row) && row.gameId === gameId);
      if (!game || arrayOf(game.professions).indexOf(professionId) < 0) return 'profession-game-mismatch';
    }
    if (typeof clueId === 'string' && clueId) {
      const clue = parts.clues.find((row) => isObject(row) && row.clueId === clueId);
      if (!clue || !validGameId(clue.gameId)) return 'unknown-clue';
      if (typeof gameId === 'string' && gameId && clue.gameId !== gameId) return 'clue-game-mismatch';
      const clueGame = parts.games.find((row) => isObject(row) && row.gameId === clue.gameId);
      if (!clueGame || arrayOf(clueGame.professions).indexOf(professionId) < 0) return 'clue-profession-mismatch';
      if (clue.professionId && clue.professionId !== professionId) return 'clue-profession-mismatch';
    }
    return null;
  }

  function commissionProfessionMap(commissions) {
    const map = Object.create(null);
    commissions.forEach((row) => {
      if (isObject(row) && validId(row.commissionId) && validId(row.professionId)) map[row.commissionId] = row.professionId;
    });
    return map;
  }

  function gameByProfession(games, professionId) {
    const matches = games
      .filter((game) => isObject(game) && validGameId(game.gameId) && arrayOf(game.professions).indexOf(professionId) >= 0)
      .map((game) => game.gameId)
      .sort();
    return matches[0] || null;
  }

  function evidenceAt(row) {
    if (!isObject(row)) return '';
    return iso(row.at) || iso(row.acceptedAt) || iso(row.clearedAt) || iso(row.claimedAt)
      || iso(row.settledAt) || iso(row.createdAt) || iso(row.issuedAt) || iso(row.updatedAt);
  }

  /**
   * 旧档接受证据回填。只认显式接受集合、真实委托 run/claim/cleared quest；
   * 线索、投递、全局 stage、catalog unlock、游玩次数与推荐均不算接受。
   */
  /**
   * 首次到港被真实消费：玩家在到港面板点了第一份工作并成功开局。
   * 只把叙事游标从 `invitation:<id>` 推进到 `arrival:<id>`，不改职业状态、
   * 不发奖励、不写故事事件；重复调用是纯 no-op（关页重开不重播首到港）。
   */
  function consumeFirstArrival(state, input) {
    const next = nextState(state);
    if (!next || !isObject(input) || !validId(input.professionId)) return fail(state, 'bad-profession-id');
    const progress = progressOf(next, input.professionId);
    if (!progress || rankOf(progress.state) < rankOf('accepted')) return fail(state, 'not-accepted');
    if (!isObject(next.narrativeCursor)) next.narrativeCursor = { chapterId: 'C0', nodeId: null };
    if (next.narrativeCursor.nodeId !== 'invitation:' + input.professionId) {
      return done(next, { duplicate: true, consumed: false });
    }
    next.narrativeCursor.nodeId = 'arrival:' + input.professionId;
    next.updatedAt = laterTimestamp(next.updatedAt, iso(input.at));
    return done(next, { duplicate: false, consumed: true });
  }

  function deriveLegacyAcceptance(state, input) {
    const next = nextState(state);
    const opts = isObject(input) ? input : {};
    if (!next) return { ok: false, reason: 'bad-state', state: state, derived: [] };
    if (professionVersionOf(next) > PROFESSION_VERSION) {
      return { ok: false, reason: 'future-profession-version', state: state, derived: [] };
    }
    const parts = catalogParts(opts.catalog);
    const map = commissionProfessionMap(parts.commissions);
    const records = isObject(opts.records) ? opts.records : {};
    const profile = isObject(records.profile) ? records.profile : null;
    const evidence = Object.create(null);
    const add = (professionId, at, source) => {
      if (!validId(professionId)) return;
      const stamp = iso(at);
      const priorAt = evidence[professionId] ? iso(evidence[professionId].at) : '';
      if (!evidence[professionId] || (!priorAt && stamp) || (stamp && stamp < priorAt)) {
        evidence[professionId] = { at: stamp, source: source };
      }
    };
    arrayOf(profile && profile.acceptedProfessionIds).forEach((id) => {
      const stamp = profile && isObject(profile.acceptedAt) ? profile.acceptedAt[id] : null;
      add(id, stamp, 'profile');
    });
    arrayOf(records.quests).forEach((row) => {
      if (!isObject(row)) return;
      const status = typeof row.status === 'string' ? row.status : '';
      if (status && ['accepted', 'active', 'issued', 'cleared', 'completed'].indexOf(status) < 0) return;
      if (!status) return;
      const id = validId(row.commissionId) ? row.commissionId : validId(row.nodeId) ? row.nodeId : '';
      if (map[id]) add(map[id], evidenceAt(row), 'quest');
    });
    arrayOf(records.claims).forEach((row) => {
      if (!isObject(row)) return;
      const id = validId(row.commissionId) ? row.commissionId : '';
      if (map[id]) add(map[id], evidenceAt(row), 'claim');
    });
    arrayOf(records.runs).forEach((row) => {
      if (!isObject(row)) return;
      const id = validId(row.commissionId) ? row.commissionId : '';
      if (map[id]) add(map[id], evidenceAt(row), 'run');
    });
    const ids = Object.keys(evidence).sort();
    const derived = [];
    const at = iso(opts.now);
    next.professionProgress = isObject(next.professionProgress) ? next.professionProgress : {};
    ids.forEach((professionId) => {
      const row = next.professionProgress[professionId] || emptyProgress(null);
      if (rankOf(row.state) < rankOf('accepted')) {
        row.state = 'accepted';
        row.acceptedAt = row.acceptedAt || evidence[professionId].at || null;
      }
      derived.push({ professionId: professionId, source: evidence[professionId].source, at: evidence[professionId].at || null });
      next.professionProgress[professionId] = row;
    });
    if (!next.acceptedOriginGameId) {
      const fromProfile = profile && validGameId(profile.originGameId) ? profile.originGameId : null;
      if (fromProfile) next.acceptedOriginGameId = fromProfile;
      else {
        /* 只按合法且可证实的时间排序；时间未知时不捏造起源。 */
        const withTime = ids.filter((id) => !!evidence[id].at).sort((a, b) => {
          const timeA = String(evidence[a].at);
          const timeB = String(evidence[b].at);
          if (timeA !== timeB) return timeA < timeB ? -1 : 1;
          return a < b ? -1 : a > b ? 1 : 0;
        });
        if (withTime.length) next.acceptedOriginGameId = gameByProfession(parts.games, withTime[0]);
      }
    }
    if (!next.activeProfessionId) {
      /* 没有明确证据时不替玩家选当前职业。 */
      const explicit = profile && validId(profile.activeProfessionId) && evidence[profile.activeProfessionId]
        ? profile.activeProfessionId : null;
      if (explicit) next.activeProfessionId = explicit;
    }
    next.updatedAt = laterTimestamp(next.updatedAt, at);
    return { ok: true, state: next, derived: derived };
  }

  function validate(state, catalog) {
    if (!isObject(state)) return { ok: false, reason: 'bad-state' };
    if (professionVersionOf(state) > PROFESSION_VERSION) return { ok: false, reason: 'future-profession-version' };
    const ext = normalizeExtension(state, iso(state.updatedAt));
    const parts = catalogParts(catalog);
    const professionIds = parts.professions.map((row) => row && row.professionId).filter(validId);
    const gameIds = parts.games.map((row) => row && row.gameId).filter(validGameId);
    if (professionIds.length && parts.professions.length !== professionIds.length) return { ok: false, reason: 'bad-catalog-profession' };
    if (gameIds.length && parts.games.length !== gameIds.length) return { ok: false, reason: 'bad-catalog-game' };
    if (professionIds.length) {
      const allowed = Object.create(null);
      professionIds.forEach((id) => { allowed[id] = true; });
      const unknown = Object.keys(ext.professionProgress).filter((id) => !allowed[id]);
      if (unknown.length) return { ok: false, reason: 'unknown-profession', professionId: unknown[0] };
      if (ext.activeProfessionId && !allowed[ext.activeProfessionId]) return { ok: false, reason: 'unknown-active-profession' };
    }
    if (gameIds.length) {
      const allowedGames = Object.create(null);
      gameIds.forEach((id) => { allowedGames[id] = true; });
      if (ext.firstDiscoveredGameId && !allowedGames[ext.firstDiscoveredGameId]) return { ok: false, reason: 'unknown-first-game' };
      if (ext.acceptedOriginGameId && !allowedGames[ext.acceptedOriginGameId]) return { ok: false, reason: 'unknown-origin-game' };
    }
    if (ext.activeProfessionId) {
      const active = ext.professionProgress[ext.activeProfessionId];
      if (!active || rankOf(active.state) < rankOf('accepted')) return { ok: false, reason: 'active-not-accepted' };
    }
    if (ext.acceptedOriginGameId) {
      const acceptedAtOrigin = Object.keys(ext.professionProgress).some((id) => {
        const row = ext.professionProgress[id];
        return row && rankOf(row.state) >= rankOf('accepted') && gameByProfession(parts.games, id) === ext.acceptedOriginGameId;
      });
      if (!acceptedAtOrigin) return { ok: false, reason: 'origin-not-accepted' };
    }
    if (ext.firstDiscoveredGameId) {
      const discovered = Object.keys(ext.professionProgress).some((id) => {
        const row = ext.professionProgress[id];
        return row && rankOf(row.state) >= rankOf('glimpsed') && gameByProfession(parts.games, id) === ext.firstDiscoveredGameId;
      });
      if (!discovered) return { ok: false, reason: 'first-game-not-discovered' };
    }
    return { ok: true };
  }

  return {
    SCHEMA_VERSION,
    PROFESSION_VERSION,
    STATES,
    initialState,
    normalizeExtension,
    mergeIntoDiscovery,
    extensionOf,
    recordGlimpsed,
    recordRead,
    acceptInvitation,
    setActive,
    setPaused,
    markDeveloped,
    markCompleted,
    recordStoryEvent,
    consumeFirstArrival,
    deriveLegacyAcceptance,
    validate,
  };
});
