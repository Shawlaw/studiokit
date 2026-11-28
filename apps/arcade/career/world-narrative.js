/*!
 * StudioKit Arcade Life — 0.24 世界叙事纯 resolver（T22）
 *
 * 纯 UMD：浏览器挂 window.ArcadeCareer.worldNarrative（并镜像
 * window.ArcadeCareerWorldNarrative）；Node module.exports 返回同一 API。
 *
 * 只读：不读 DOM / DB / localStorage / IndexedDB / 网络 / 时钟 / 随机数；
 * 不修改入参；不抛异常（异常一律转成结构化失败或空结果）。
 *
 * 内容唯一来源：`career/content/world-narrative.json`（T20 schema 冻结）。
 * 本模块只做纯投影与判定，不写任何持久化面；事件写入由 bridge 走既有
 * `career-db.applyProfessionEvent({action:'RECORD_STORY_EVENT'})`，不在本模块。
 *
 * 主 API（T22 任务契约）：
 *   var engine = createWorldNarrative({ content, catalog })
 *   engine.resolveCrossover(input)   -> { ok, node|null, reason }
 *   engine.resolveAlternative(input) -> { ok, node|null, reason }
 *   engine.listCrossovers(input)     -> { ok, nodes, reason }
 *
 * ADR §3.3 兼容 API：resolveWorldAlternatives({ chapterId, state, catalog, context })
 * 以及只读辅助 eventIdForProfessionPair / resolveSignature。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  root.ArcadeCareerWorldNarrative = api;
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.worldNarrative !== api) {
    try {
      career.worldNarrative = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 冻结常量（与 tools/career_world_narrative_schema.json 对齐）
   * ------------------------------------------------------------------ */

  var SCHEMA_VERSION = 1;
  var MODULE_VERSION = '0.24.0';
  var CONTENT_VERSION = '0.18.0';
  var PROFESSION_VERSION = 1;

  var ACCEPTED_STATES = Object.freeze(['accepted', 'developed', 'completed']);
  var CHAPTER_IDS = Object.freeze(['C1', 'C2', 'C3', 'C4', 'C5']);
  var MECHANISMS = Object.freeze([
    'world-work', 'profession-commission', 'errand', 'rental', 'market-material', 'evidence-pair',
  ]);
  var SURFACES = Object.freeze([
    'clue', 'letter', 'port', 'work', 'journal', 'receipt', 'message',
    'route', 'toast', 'deep-link', 'shop', 'crafting', 'tools',
  ]);
  var CROSSOVER_SURFACES = Object.freeze(['port', 'journal', 'message', 'receipt', 'toast', 'deep-link']);
  /* 替代叙事挂在真实机制上，允许出现在工作/路线等可读面；邀请与商店面不渲染。 */
  var ALTERNATIVE_SURFACES = Object.freeze([
    'port', 'work', 'journal', 'receipt', 'message', 'route', 'toast', 'deep-link',
  ]);
  var JOURNAL_SURFACES = Object.freeze(['port', 'journal', 'receipt', 'message', 'toast', 'deep-link']);
  var JOURNAL_SOURCES = Object.freeze(['clue', 'commission', 'world', 'story']);

  var MECHANISM_ANCHOR_KIND = Object.freeze({
    'world-work': 'commission',
    'profession-commission': 'commission',
    errand: 'offer',
    rental: 'ship',
    'market-material': 'item',
    'evidence-pair': 'evidencePair',
  });
  var MECHANISM_RECEIPT_SOURCE = Object.freeze({
    'world-work': 'commission-receipt',
    'profession-commission': 'commission-receipt',
    errand: 'alternative-purchase',
    rental: 'commission-receipt',
    'market-material': 'purchase-ledger',
    'evidence-pair': 'evidence-grant',
  });

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

  /* 与真实内容镜像的真值；提供 catalog 对应分区时以 catalog 为准（见下方索引）。 */
  var FROZEN_CHAPTER_FLAGS = Object.freeze({
    C1: Object.freeze(['C0.port_seen']),
    C2: Object.freeze(['C1.signal_fragment']),
    C3: Object.freeze(['C2.research_complete']),
    C4: Object.freeze(['C3.truth_found']),
    C5: Object.freeze(['C4.city_power_restored']),
  });
  var FROZEN_WORLD_WORK_IDS = Object.freeze([
    'star-raid.T1', 'star-raid.T2', 'star-raid.T3', 'pendulum-tower.T1', 'pendulum-tower.T2',
  ]);
  var FROZEN_RENTAL_SHIP_IDS = Object.freeze(['old-wing']);
  var FROZEN_MATERIAL_IDS = Object.freeze(['building', 'alloy', 'electronics', 'starcrystal', 'biomass']);
  var FROZEN_OFFERS = Object.freeze([
    Object.freeze({ offerId: 'alt.courier', issuer: '旧港港务处' }),
    Object.freeze({ offerId: 'alt.records', issuer: '旧港档案室' }),
  ]);

  var STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  var EVENT_ID_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var CROSSOVER_ID_RE = /^crossover:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  var NODE_ID_RE = /^altn[.]C[1-5][.][a-z0-9-]+([.][a-z0-9-]+)+$/;
  var FLAG_RE = /^C[1-5][.][a-z0-9][a-z0-9._-]{0,60}$/;
  var EVIDENCE_RE = /^(E|MAP|BP|DEC)-[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
  var CHARACTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;

  var TEXT_LIMITS = Object.freeze({
    invite: Object.freeze([10, 120]),
    body: Object.freeze([10, 240]),
    receipt: Object.freeze([10, 120]),
    decline: Object.freeze([8, 120]),
    offer: Object.freeze([10, 120]),
    progress: Object.freeze([10, 120]),
    next: Object.freeze([6, 80]),
  });
  var JOURNAL_LABEL_MIN = 6;
  var JOURNAL_LABEL_MAX = 60;

  /* ------------------------------------------------------------------ *
   * 基础工具（纯函数，无副作用）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function arrayOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function stableId(value) {
    return typeof value === 'string' && STABLE_ID_RE.test(value);
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

  function uniqueStrings(list) {
    var out = [];
    arrayOf(list).forEach(function (value) {
      if (typeof value === 'string' && out.indexOf(value) < 0) out.push(value);
    });
    return out;
  }

  function sameCanonical(left, right) {
    return canonical(left) === canonical(right);
  }

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (isObject(value)) {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + canonical(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function tokensOf(value) {
    var out = [];
    var add = function (token) {
      if (typeof token === 'string' && token && out.indexOf(token) < 0) out.push(token);
    };
    if (Array.isArray(value)) {
      value.forEach(add);
    } else if (isObject(value)) {
      Object.keys(value).forEach(function (key) {
        if (value[key] === true) add(key);
      });
    }
    return out;
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined) return arguments[i];
    }
    return undefined;
  }

  function fail(reason) {
    return { ok: false, node: null, reason: reason || REASONS.notAvailable };
  }

  function okNode(node) {
    return node ? { ok: true, node: node, reason: null } : { ok: true, node: null, reason: null };
  }

  /* ------------------------------------------------------------------ *
   * 内容规整（结构性部分；只读，不改入参）
   * ------------------------------------------------------------------ */

  function normalizeNpcRef(raw) {
    if (!isObject(raw)) return null;
    if (raw.kind === 'origin-letter') {
      if (!exactlyKeys(raw, NPC_REF_ORIGIN_KEYS)) return null;
      if (!stableId(raw.gameId) || !GAME_ID_RE.test(raw.gameId)) return null;
      return { kind: 'origin-letter', gameId: raw.gameId };
    }
    if (raw.kind === 'character') {
      if (!exactlyKeys(raw, NPC_REF_CHARACTER_KEYS)) return null;
      if (typeof raw.characterId !== 'string' || !CHARACTER_ID_RE.test(raw.characterId)) return null;
      return { kind: 'character', characterId: raw.characterId };
    }
    return null;
  }

  function npcRefsUnique(refs) {
    var seen = [];
    for (var i = 0; i < refs.length; i += 1) {
      var key = canonical(refs[i]);
      if (seen.indexOf(key) >= 0) return false;
      seen.push(key);
    }
    return true;
  }

  function normalizeFlagList(raw, max) {
    if (!Array.isArray(raw)) return null;
    if (raw.length > max) return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var value = raw[i];
      if (typeof value !== 'string' || !FLAG_RE.test(value)) return null;
      if (out.indexOf(value) >= 0) return null;
      out.push(value);
    }
    return out;
  }

  function normalizeCommandList(raw, max) {
    if (!Array.isArray(raw)) return null;
    if (raw.length > max) return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var value = raw[i];
      if (!stableId(value)) return null;
      if (out.indexOf(value) >= 0) return null;
      out.push(value);
    }
    return out;
  }

  function normalizeEvidenceList(raw, max) {
    if (!Array.isArray(raw)) return null;
    if (raw.length > max) return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var value = raw[i];
      if (typeof value !== 'string' || !EVIDENCE_RE.test(value)) return null;
      if (out.indexOf(value) >= 0) return null;
      out.push(value);
    }
    return out;
  }

  function normalizeAcceptedStates(raw) {
    if (!Array.isArray(raw) || raw.length !== 3) return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var value = raw[i];
      if (typeof value !== 'string' || ACCEPTED_STATES.indexOf(value) < 0) return null;
      if (out.indexOf(value) >= 0) return null;
      out.push(value);
    }
    return out;
  }

  /* additionalProperties:false 的运行时镜像：未知/禁止键一律 fail-closed。 */
  function onlyKeys(value, allowed) {
    if (!isObject(value)) return false;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      if (allowed.indexOf(keys[i]) < 0) return false;
    }
    return true;
  }

  function exactlyKeys(value, keys) {
    return onlyKeys(value, keys) && Object.keys(value).length === keys.length;
  }

  var NPC_REF_ORIGIN_KEYS = Object.freeze(['kind', 'gameId']);
  var NPC_REF_CHARACTER_KEYS = Object.freeze(['kind', 'characterId']);
  var GATE_KEYS = Object.freeze([
    'requiresAcceptedProfession', 'requiresSpecificProfession',
    'requiresFlagsAny', 'requiresFlagsAll', 'requiresCommissionsAll', 'requiresEvidenceAny',
  ]);
  var CROSSOVER_GATE_KEYS = Object.freeze([
    'professionGate', 'acceptedStates', 'pausedBlocks',
    'requiresFlagsAny', 'requiresFlagsAll', 'requiresCommissionsAll', 'requiresEvidenceAny',
  ]);
  var ALTERNATIVE_KEYS = Object.freeze([
    'sampleKind', 'placeholder', 'narrativeNodeId', 'chapterId', 'mechanism', 'anchor',
    'npcRef', 'signatureFrom', 'gate', 'texts', 'receiptSource',
  ]);
  var ALTERNATIVE_ANCHOR_KEYS = Object.freeze(['kind', 'refs']);
  var CROSSOVER_KEYS = Object.freeze([
    'sampleKind', 'placeholder', 'contentOwnerProfessionId', 'eventId', 'pairId', 'professionIds',
    'anchor', 'gate', 'texts', 'visibleSurfaces', 'effects', 'grants', 'touchesMainline',
    'affectsIdentity', 'maxShowsPerCareer', 'activeTextOwner',
  ]);
  var CROSSOVER_ANCHOR_KEYS = Object.freeze(['professionGames', 'chapterIds', 'npcRefs']);
  var CROSSOVER_GAME_KEYS = Object.freeze(['professionId', 'gameId']);
  var GRANTS_KEYS = Object.freeze(['credits', 'items', 'evidence', 'flags']);
  var JOURNAL_KEYS = Object.freeze([
    'sampleKind', 'placeholder', 'eventId', 'source', 'whitelistLayer', 'labelMode', 'label',
    /* 0.24 T24 加性：经历回读的可选静态文本与真实人物/签发人；不落盘。 */
    'text', 'person', 'surfaces',
  ]);
  var JOURNAL_TEXT_MIN = 8;
  var JOURNAL_TEXT_MAX = 120;
  var JOURNAL_PERSON_MAX = 24;

  function normalizeGate(raw, forCrossover) {
    if (!isObject(raw)) return null;
    if (!onlyKeys(raw, forCrossover ? CROSSOVER_GATE_KEYS : GATE_KEYS)) return null;
    if (forCrossover) {
      if (raw.professionGate !== 'both-accepted') return null;
      if (raw.pausedBlocks !== false) return null;
      if (!normalizeAcceptedStates(raw.acceptedStates)) return null;
    } else {
      if (raw.requiresAcceptedProfession !== true) return null;
      if (raw.requiresSpecificProfession !== false) return null;
    }
    var flagsAny = normalizeFlagList(raw.requiresFlagsAny, 8);
    var flagsAll = normalizeFlagList(raw.requiresFlagsAll, 8);
    var commissions = normalizeCommandList(raw.requiresCommissionsAll, 8);
    var evidence = normalizeEvidenceList(raw.requiresEvidenceAny, 8);
    if (!flagsAny || !flagsAll || !commissions || !evidence) return null;
    var gate = {
      requiresFlagsAny: flagsAny,
      requiresFlagsAll: flagsAll,
      requiresCommissionsAll: commissions,
      requiresEvidenceAny: evidence,
    };
    if (forCrossover) {
      gate.professionGate = 'both-accepted';
      gate.acceptedStates = ACCEPTED_STATES.slice();
      gate.pausedBlocks = false;
    } else {
      gate.requiresAcceptedProfession = true;
      gate.requiresSpecificProfession = false;
    }
    return gate;
  }

  function normalizeTexts(raw, keys) {
    if (!exactlyKeys(raw, keys)) return null;
    var out = {};
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var text = raw[key];
      var limits = TEXT_LIMITS[key];
      if (typeof text !== 'string') return null;
      if (text.length < limits[0] || text.length > limits[1]) return null;
      out[key] = text;
    }
    return out;
  }

  function normalizeSurfaces(raw, allowed) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 6) return null;
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var surface = raw[i];
      if (typeof surface !== 'string' || allowed.indexOf(surface) < 0) return null;
      if (out.indexOf(surface) >= 0) return null;
      out.push(surface);
    }
    return out;
  }

  function normalizeAlternativeNode(raw) {
    if (!isObject(raw)) return null;
    if (!exactlyKeys(raw, ALTERNATIVE_KEYS)) return null;
    if (raw.sampleKind !== 'alternativeNarrativeNode') return null;
    if (raw.placeholder !== false) return null;
    if (typeof raw.narrativeNodeId !== 'string' || !NODE_ID_RE.test(raw.narrativeNodeId)) return null;
    if (CHAPTER_IDS.indexOf(raw.chapterId) < 0) return null;
    if (raw.narrativeNodeId.indexOf('altn.' + raw.chapterId + '.') !== 0) return null;
    if (MECHANISMS.indexOf(raw.mechanism) < 0) return null;
    var anchor = isObject(raw.anchor) ? raw.anchor : null;
    if (!anchor || !exactlyKeys(anchor, ALTERNATIVE_ANCHOR_KEYS)) return null;
    if (anchor.kind !== MECHANISM_ANCHOR_KIND[raw.mechanism]) return null;
    if (!Array.isArray(anchor.refs) || !anchor.refs.length || anchor.refs.length > 3) return null;
    if (!uniqueStrings(anchor.refs).length || uniqueStrings(anchor.refs).length !== anchor.refs.length) return null;
    for (var i = 0; i < anchor.refs.length; i += 1) {
      if (!stableId(anchor.refs[i])) return null;
    }
    if (raw.mechanism === 'evidence-pair' && anchor.refs.length < 2) return null;
    var npcRef = normalizeNpcRef(raw.npcRef);
    if (!npcRef) return null;
    if (['origin-letter', 'commission-issuer', 'offer-issuer', 'npc-character'].indexOf(raw.signatureFrom) < 0) return null;
    if (raw.signatureFrom === 'origin-letter' && npcRef.kind !== 'origin-letter') return null;
    if (raw.signatureFrom === 'npc-character' && npcRef.kind !== 'character') return null;
    if (raw.signatureFrom === 'commission-issuer' && anchor.kind !== 'commission') return null;
    if (raw.signatureFrom === 'offer-issuer' && anchor.kind !== 'offer') return null;
    var gate = normalizeGate(raw.gate, false);
    if (!gate) return null;
    var texts = normalizeTexts(raw.texts, ['offer', 'progress', 'receipt', 'next']);
    if (!texts) return null;
    if (raw.receiptSource !== MECHANISM_RECEIPT_SOURCE[raw.mechanism]) return null;
    return {
      narrativeNodeId: raw.narrativeNodeId,
      chapterId: raw.chapterId,
      mechanism: raw.mechanism,
      anchor: { kind: anchor.kind, refs: anchor.refs.slice() },
      npcRef: npcRef,
      signatureFrom: raw.signatureFrom,
      gate: gate,
      texts: texts,
      receiptSource: raw.receiptSource,
    };
  }

  function normalizeCrossoverPair(raw) {
    if (!isObject(raw)) return null;
    if (!exactlyKeys(raw, CROSSOVER_KEYS)) return null;
    if (raw.sampleKind !== 'crossoverPair') return null;
    if (raw.placeholder !== false) return null;
    if (!Array.isArray(raw.professionIds) || raw.professionIds.length !== 2) return null;
    var a = raw.professionIds[0];
    var b = raw.professionIds[1];
    if (!stableId(a) || !stableId(b) || a === b) return null;
    if (a >= b) return null; /* 冻结为字典序升序 */
    var eventId = 'crossover:' + a + ':' + b;
    if (raw.eventId !== eventId || raw.pairId !== eventId) return null;
    if (!CROSSOVER_ID_RE.test(eventId) || !EVENT_ID_RE.test(eventId) || eventId.length > 120) return null;
    if (raw.contentOwnerProfessionId !== a && raw.contentOwnerProfessionId !== b) return null;
    var anchor = isObject(raw.anchor) ? raw.anchor : null;
    if (!anchor || !exactlyKeys(anchor, CROSSOVER_ANCHOR_KEYS)) return null;
    if (!Array.isArray(anchor.professionGames) || anchor.professionGames.length !== 2) return null;
    var gameById = {};
    for (var i = 0; i < anchor.professionGames.length; i += 1) {
      var row = anchor.professionGames[i];
      if (!isObject(row) || !exactlyKeys(row, CROSSOVER_GAME_KEYS)) return null;
      if (!stableId(row.professionId) || typeof row.gameId !== 'string' || !GAME_ID_RE.test(row.gameId)) return null;
      if (row.professionId !== a && row.professionId !== b) return null;
      if (gameById[row.professionId]) return null;
      gameById[row.professionId] = row.gameId;
    }
    if (!gameById[a] || !gameById[b]) return null;
    if (!Array.isArray(anchor.chapterIds) || !anchor.chapterIds.length || anchor.chapterIds.length > 2) return null;
    var chapterIds = [];
    for (var c = 0; c < anchor.chapterIds.length; c += 1) {
      var chapterId = anchor.chapterIds[c];
      if (CHAPTER_IDS.indexOf(chapterId) < 0 || chapterIds.indexOf(chapterId) >= 0) return null;
      chapterIds.push(chapterId);
    }
    chapterIds.sort(function (left, right) {
      return CHAPTER_IDS.indexOf(left) - CHAPTER_IDS.indexOf(right);
    });
    if (!Array.isArray(anchor.npcRefs) || !anchor.npcRefs.length || anchor.npcRefs.length > 2) return null;
    var npcRefs = [];
    for (var n = 0; n < anchor.npcRefs.length; n += 1) {
      var npcRef = normalizeNpcRef(anchor.npcRefs[n]);
      if (!npcRef) return null;
      npcRefs.push(npcRef);
    }
    if (!npcRefsUnique(npcRefs)) return null;
    var gate = normalizeGate(raw.gate, true);
    if (!gate) return null;
    var texts = normalizeTexts(raw.texts, ['invite', 'body', 'receipt', 'decline']);
    if (!texts) return null;
    var visibleSurfaces = normalizeSurfaces(raw.visibleSurfaces, CROSSOVER_SURFACES);
    if (!visibleSurfaces) return null;
    if (!Array.isArray(raw.effects) || raw.effects.length !== 0) return null;
    var grants = isObject(raw.grants) ? raw.grants : null;
    if (!grants || !exactlyKeys(grants, GRANTS_KEYS)) return null;
    if (grants.credits !== 0) return null;
    if (!isObject(grants.items) || Object.keys(grants.items).length !== 0) return null;
    if (!Array.isArray(grants.evidence) || grants.evidence.length !== 0) return null;
    if (!Array.isArray(grants.flags) || grants.flags.length !== 0) return null;
    if (raw.touchesMainline !== false || raw.affectsIdentity !== false) return null;
    if (raw.maxShowsPerCareer !== 1) return null;
    if (typeof raw.activeTextOwner !== 'boolean') return null;
    return {
      eventId: eventId,
      pairId: eventId,
      professionIds: [a, b],
      contentOwnerProfessionId: raw.contentOwnerProfessionId,
      activeTextOwner: raw.activeTextOwner,
      anchor: {
        professionGames: [
          { professionId: a, gameId: gameById[a] },
          { professionId: b, gameId: gameById[b] },
        ],
        chapterIds: chapterIds,
        npcRefs: npcRefs,
      },
      gate: gate,
      texts: texts,
      visibleSurfaces: visibleSurfaces,
    };
  }

  function normalizeJournalEntry(raw) {
    if (!isObject(raw)) return null;
    if (!onlyKeys(raw, JOURNAL_KEYS)) return null;
    if (raw.sampleKind !== 'journalEvent') return null;
    if (raw.placeholder !== false) return null;
    if (typeof raw.eventId !== 'string' || !EVENT_ID_RE.test(raw.eventId)) return null;
    if (JOURNAL_SOURCES.indexOf(raw.source) < 0) return null;
    if (['code-frozen', 'content', 'engine-prefix'].indexOf(raw.whitelistLayer) < 0) return null;
    if (['content', 'code-frozen', 'commission-title', 'profession-name'].indexOf(raw.labelMode) < 0) return null;
    var surfaces = normalizeSurfaces(raw.surfaces, JOURNAL_SURFACES);
    if (!surfaces) return null;
    var label = typeof raw.label === 'string' ? raw.label : '';
    if (raw.labelMode === 'content') {
      if (label.length < JOURNAL_LABEL_MIN || label.length > JOURNAL_LABEL_MAX) return null;
    } else if (hasOwn(raw, 'label') || label) {
      /* 条件规则：非 content 标签模式禁止携带 label。 */
      return null;
    }
    var namespace = raw.eventId.split(':')[0];
    if (['story', 'world', 'crossover', 'invitation', 'commission'].indexOf(namespace) < 0) return null;
    /* 0.24 T24 加性透传：text/person 只在类型与长度合法时带上；旧内容缺省时行为不变。 */
    var text = typeof raw.text === 'string' ? raw.text : '';
    if (hasOwn(raw, 'text') && (text.length < JOURNAL_TEXT_MIN || text.length > JOURNAL_TEXT_MAX)) return null;
    var person = typeof raw.person === 'string' ? raw.person : '';
    if (hasOwn(raw, 'person') && (!person || person.length > JOURNAL_PERSON_MAX)) return null;
    var entry = {
      eventId: raw.eventId,
      source: raw.source,
      whitelistLayer: raw.whitelistLayer,
      labelMode: raw.labelMode,
      label: label,
      surfaces: surfaces,
    };
    if (text) entry.text = text;
    if (person) entry.person = person;
    return entry;
  }

  var CONTENT_KEYS = Object.freeze([
    'schemaVersion', 'contentVersion', 'releaseVersion',
    'alternativeNarratives', 'crossoverPairs', 'journalWhitelist',
  ]);

  function normalizeContent(content) {
    var warnings = [];
    var out = { usable: false, alternatives: [], pairs: [], journal: [], warnings: warnings };
    if (!isObject(content)) return out;
    if (content.schemaVersion !== 1 || content.contentVersion !== CONTENT_VERSION) {
      warnings.push('content-version-mismatch');
      return out;
    }
    if (!onlyKeys(content, CONTENT_KEYS)) {
      /* 未知顶层键 fail-closed：避免未来经济字段被静默带入。 */
      warnings.push('content-unknown-key');
      return out;
    }
    out.usable = true;
    var alternativeNodeIds = Object.create(null);
    var alternativeCombos = Object.create(null);
    arrayOf(content.alternativeNarratives).forEach(function (raw, index) {
      var node = normalizeAlternativeNode(raw);
      if (!node) {
        warnings.push('alternative-invalid:' + index);
        return;
      }
      var combo = node.chapterId + '|' + node.mechanism + '|' + node.anchor.refs.slice().sort().join(',');
      if (alternativeNodeIds[node.narrativeNodeId] || alternativeCombos[combo]) {
        /* ADR §3.2.5：同一 nodeId / 同一 (章节,机制,refs) 组合只保留第一份声明。 */
        warnings.push('alternative-duplicate:' + node.narrativeNodeId);
        return;
      }
      alternativeNodeIds[node.narrativeNodeId] = true;
      alternativeCombos[combo] = true;
      out.alternatives.push(node);
    });
    var declarations = [];
    arrayOf(content.crossoverPairs).forEach(function (raw, index) {
      var pair = normalizeCrossoverPair(raw);
      if (!pair) {
        warnings.push('crossover-pair-invalid:' + index);
        return;
      }
      declarations.push(pair);
    });
    out.pairs = resolvePairDeclarations(declarations, warnings);
    var journalEventIds = Object.create(null);
    arrayOf(content.journalWhitelist).forEach(function (raw, index) {
      var entry = normalizeJournalEntry(raw);
      if (!entry) {
        warnings.push('journal-entry-invalid:' + index);
        return;
      }
      if (journalEventIds[entry.eventId]) {
        warnings.push('journal-entry-duplicate:' + entry.eventId);
        return;
      }
      journalEventIds[entry.eventId] = true;
      out.journal.push(entry);
    });
    out.alternatives.sort(compareAlternativeNodes);
    out.journal.sort(function (left, right) {
      return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
    });
    return out;
  }

  function contentOwnerRank(pair) {
    return pair.contentOwnerProfessionId === pair.professionIds[0] ? 0 : 1;
  }

  function declarationBetter(candidate, current) {
    var candidateRank = contentOwnerRank(candidate);
    var currentRank = contentOwnerRank(current);
    if (candidateRank !== currentRank) return candidateRank < currentRank;
    if (candidate.contentOwnerProfessionId !== current.contentOwnerProfessionId) {
      return candidate.contentOwnerProfessionId < current.contentOwnerProfessionId;
    }
    return false; /* 仍并列：保留先声明者 */
  }

  function pairPayload(pair) {
    return { anchor: pair.anchor, gate: pair.gate, texts: pair.texts };
  }

  /* ADR §4.5 A：同一 eventId 只留一个 owner；同对声明必须完全一致，否则 fail-closed。 */
  function resolvePairDeclarations(declarations, warnings) {
    var grouped = Object.create(null);
    var order = [];
    declarations.forEach(function (pair) {
      if (!grouped[pair.eventId]) {
        grouped[pair.eventId] = [];
        order.push(pair.eventId);
      }
      grouped[pair.eventId].push(pair);
    });
    var out = [];
    order.forEach(function (eventId) {
      var rows = grouped[eventId];
      var winner = rows[0];
      var consistent = true;
      for (var i = 1; i < rows.length; i += 1) {
        if (!sameCanonical(pairPayload(rows[i]), pairPayload(winner))) consistent = false;
        if (declarationBetter(rows[i], winner)) winner = rows[i];
      }
      if (!consistent) {
        warnings.push('crossover-pair-inconsistent:' + eventId);
        return;
      }
      out.push(winner);
    });
    out.sort(function (left, right) {
      return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
    });
    return out;
  }

  function compareAlternativeNodes(left, right) {
    var chapterDelta = CHAPTER_IDS.indexOf(left.chapterId) - CHAPTER_IDS.indexOf(right.chapterId);
    if (chapterDelta !== 0) return chapterDelta;
    var mechanismDelta = MECHANISMS.indexOf(left.mechanism) - MECHANISMS.indexOf(right.mechanism);
    if (mechanismDelta !== 0) return mechanismDelta;
    var leftRefs = left.anchor.refs.join(',');
    var rightRefs = right.anchor.refs.join(',');
    if (leftRefs !== rightRefs) return leftRefs < rightRefs ? -1 : 1;
    if (left.narrativeNodeId === right.narrativeNodeId) return 0;
    return left.narrativeNodeId < right.narrativeNodeId ? -1 : 1;
  }

  /* ------------------------------------------------------------------ *
   * catalog 只读索引（只读取，不写入）
   * ------------------------------------------------------------------ */

  function catalogArray(catalog, key) {
    return Array.isArray(catalog[key]) ? catalog[key] : null;
  }

  function offersFromCatalog(catalog) {
    var rows = null;
    if (Array.isArray(catalog.offers)) rows = catalog.offers;
    else if (Array.isArray(catalog.alternativesOffers)) rows = catalog.alternativesOffers;
    else if (isObject(catalog.alternatives) && Array.isArray(catalog.alternatives.offers)) rows = catalog.alternatives.offers;
    if (!rows) return null;
    var map = new Map();
    rows.forEach(function (row) {
      if (!isObject(row) || !stableId(row.offerId)) return;
      map.set(row.offerId, typeof row.issuer === 'string' ? row.issuer : '');
    });
    return map;
  }

  function buildCatalogIndex(catalog) {
    var source = isObject(catalog) ? catalog : {};
    var index = {
      hasProfessions: false,
      professionIds: new Set(),
      hasGames: false,
      gameByProfession: new Map(),
      commissionById: null,
      evidenceTokens: null,
      worldWorkIds: new Set(FROZEN_WORLD_WORK_IDS),
      rentalShipIds: new Set(FROZEN_RENTAL_SHIP_IDS),
      materialIds: new Set(FROZEN_MATERIAL_IDS),
      offerIssuers: new Map(),
      chapterFlags: null,
      originSigners: null,
      npcNames: null,
    };
    FROZEN_OFFERS.forEach(function (offer) {
      index.offerIssuers.set(offer.offerId, offer.issuer);
    });
    var catalogOffers = offersFromCatalog(source);
    if (catalogOffers) index.offerIssuers = catalogOffers;

    var professions = catalogArray(source, 'professions');
    if (professions) {
      index.hasProfessions = true;
      professions.forEach(function (row) {
        if (isObject(row) && stableId(row.professionId)) index.professionIds.add(row.professionId);
      });
    }
    var games = catalogArray(source, 'games');
    if (games) {
      index.hasGames = true;
      games.forEach(function (game) {
        if (!isObject(game) || typeof game.gameId !== 'string') return;
        arrayOf(game.professions).forEach(function (professionId) {
          if (stableId(professionId) && !index.gameByProfession.has(professionId)) {
            index.gameByProfession.set(professionId, game.gameId);
          }
        });
      });
    }
    var commissions = catalogArray(source, 'commissions');
    if (commissions) {
      index.commissionById = new Map();
      index.evidenceTokens = new Set();
      commissions.forEach(function (row) {
        if (!isObject(row) || !stableId(row.commissionId)) return;
        index.commissionById.set(row.commissionId, row);
        var reward = isObject(row.reward) ? row.reward : null;
        arrayOf(reward && reward.evidence).forEach(function (token) {
          if (typeof token === 'string' && token) index.evidenceTokens.add(token);
        });
      });
    }
    var worldWorkIds = [];
    if (isObject(source.worldWork) && Array.isArray(source.worldWork.commissionIds)) {
      worldWorkIds = source.worldWork.commissionIds;
    } else if (Array.isArray(source.worldWorkIds)) {
      worldWorkIds = source.worldWorkIds;
    }
    if (worldWorkIds.length) {
      index.worldWorkIds = new Set(worldWorkIds.filter(stableId));
    }
    var items = isObject(source.items) ? source.items : null;
    if (items && Array.isArray(items.ships)) {
      index.rentalShipIds = new Set();
      items.ships.forEach(function (ship) {
        if (isObject(ship) && ship.rental === true && stableId(ship.shipId)) index.rentalShipIds.add(ship.shipId);
      });
    }
    if (items && Array.isArray(items.materials)) {
      index.materialIds = new Set();
      items.materials.forEach(function (material) {
        if (isObject(material) && stableId(material.itemId)) index.materialIds.add(material.itemId);
      });
    }
    var chapters = isObject(source.campaign) ? arrayOf(source.campaign.chapters) : [];
    if (chapters.length) {
      index.chapterFlags = new Map();
      chapters.forEach(function (chapter) {
        if (!isObject(chapter) || CHAPTER_IDS.indexOf(chapter.chapterId) < 0) return;
        var entry = isObject(chapter.entry) ? chapter.entry : null;
        var flags = arrayOf(entry && entry.allFlags).filter(function (flag) {
          return typeof flag === 'string' && flag;
        });
        index.chapterFlags.set(chapter.chapterId, flags);
      });
      if (!index.chapterFlags.size) index.chapterFlags = null;
    }
    var origins = null;
    if (isObject(source.chapterOne) && Array.isArray(source.chapterOne.origins)) origins = source.chapterOne.origins;
    else if (isObject(source.chapter01) && Array.isArray(source.chapter01.origins)) origins = source.chapter01.origins;
    else if (Array.isArray(source.origins)) origins = source.origins;
    if (origins) {
      index.originSigners = new Map();
      origins.forEach(function (origin) {
        if (!isObject(origin) || typeof origin.gameId !== 'string') return;
        var letter = isObject(origin.c0Letter) ? origin.c0Letter : null;
        var from = letter && typeof letter.from === 'string' ? letter.from : '';
        if (from) index.originSigners.set(origin.gameId, from);
      });
    }
    var characters = null;
    if (isObject(source.npc) && Array.isArray(source.npc.characters)) characters = source.npc.characters;
    else if (Array.isArray(source.npcs)) characters = source.npcs;
    if (characters) {
      index.npcNames = new Map();
      characters.forEach(function (character) {
        if (!isObject(character) || typeof character.characterId !== 'string') return;
        var name = typeof character.name === 'string' ? character.name : '';
        if (name) index.npcNames.set(character.characterId, name);
      });
    }
    return index;
  }

  /* 内容里声明的锚点必须与 catalog 提供的真实内容一致；有 catalog 分区才校验（fail-closed）。 */
  function anchorMatchesCatalog(pair, index) {
    if (index.hasProfessions) {
      for (var i = 0; i < pair.professionIds.length; i += 1) {
        if (!index.professionIds.has(pair.professionIds[i])) return false;
      }
    }
    if (index.hasGames) {
      for (var g = 0; g < pair.anchor.professionGames.length; g += 1) {
        var row = pair.anchor.professionGames[g];
        var mapped = index.gameByProfession.get(row.professionId);
        if (mapped && mapped !== row.gameId) return false;
        if (!mapped && index.hasGames) return false;
      }
    }
    if (index.originSigners) {
      for (var n = 0; n < pair.anchor.npcRefs.length; n += 1) {
        var npcRef = pair.anchor.npcRefs[n];
        if (npcRef.kind === 'origin-letter' && !index.originSigners.has(npcRef.gameId)) return false;
      }
    }
    return true;
  }

  function alternativeAnchorMatchesCatalog(node, index) {
    var kind = node.anchor.kind;
    if (kind === 'commission') {
      if (index.commissionById && !index.commissionById.has(node.anchor.refs[0])) return false;
      if (node.mechanism === 'world-work' && !index.worldWorkIds.has(node.anchor.refs[0])) return false;
      if (node.mechanism === 'profession-commission' && index.worldWorkIds.has(node.anchor.refs[0])) return false;
    }
    if (kind === 'offer' && !index.offerIssuers.has(node.anchor.refs[0])) return false;
    if (kind === 'ship' && !index.rentalShipIds.has(node.anchor.refs[0])) return false;
    if (kind === 'item' && !index.materialIds.has(node.anchor.refs[0])) return false;
    if (kind === 'evidencePair' && index.evidenceTokens) {
      for (var i = 0; i < node.anchor.refs.length; i += 1) {
        if (!index.evidenceTokens.has(node.anchor.refs[i])) return false;
      }
    }
    if (index.originSigners) {
      var npcRef = node.npcRef;
      if (npcRef.kind === 'origin-letter' && !index.originSigners.has(npcRef.gameId)) return false;
    }
    return true;
  }

  function buildEngine(content, catalog) {
    var normalized = normalizeContent(content);
    var index = buildCatalogIndex(catalog);
    var pairs = normalized.pairs.filter(function (pair) {
      return anchorMatchesCatalog(pair, index);
    });
    var alternatives = normalized.alternatives.filter(function (node) {
      return alternativeAnchorMatchesCatalog(node, index);
    });
    return {
      pairs: pairs,
      alternatives: alternatives,
      journal: normalized.journal,
      warnings: normalized.warnings,
      index: index,
    };
  }

  /* ------------------------------------------------------------------ *
   * 输入规整：只接受冻结 context（professions/state/flags/cleared/
   * capabilities/wallet + surface/archived/chapterId/professionVersion）
   * ------------------------------------------------------------------ */

  function normalizeContext(input) {
    var options = isObject(input) ? input : {};
    var context = isObject(options.context) ? options.context : {};
    var state = isObject(options.state) ? options.state : (isObject(context.state) ? context.state : {});
    var progress = Object.create(null);
    if (isObject(state.professionProgress)) {
      Object.keys(state.professionProgress).forEach(function (professionId) {
        if (!stableId(professionId)) return;
        var row = state.professionProgress[professionId];
        if (!isObject(row)) return;
        progress[professionId] = {
          state: typeof row.state === 'string' ? row.state : 'undiscovered',
          paused: row.paused === true,
        };
      });
    }
    var acceptedHint = null;
    var addHint = function (professionId) {
      if (!stableId(professionId)) return;
      if (!acceptedHint) acceptedHint = [];
      if (acceptedHint.indexOf(professionId) < 0) acceptedHint.push(professionId);
    };
    var professionsInput = firstDefined(options.professions, context.professions);
    if (Array.isArray(professionsInput)) {
      professionsInput.forEach(function (row) {
        if (typeof row === 'string') {
          addHint(row);
          return;
        }
        if (!isObject(row) || !stableId(row.professionId)) return;
        if (!progress[row.professionId] || progress[row.professionId].state === 'undiscovered') {
          progress[row.professionId] = {
            state: typeof row.state === 'string' ? row.state : 'accepted',
            paused: row.paused === true,
          };
        }
      });
    }
    var hintList = firstDefined(options.acceptedProfessionIds, context.acceptedProfessionIds);
    if (Array.isArray(hintList)) {
      hintList.forEach(function (professionId) {
        addHint(professionId);
      });
    }
    var professionVersion = null;
    if (Number.isInteger(state.professionVersion)) professionVersion = state.professionVersion;
    else if (Number.isInteger(options.professionVersion)) professionVersion = options.professionVersion;
    return {
      surface: typeof options.surface === 'string' && options.surface
        ? options.surface
        : (typeof context.surface === 'string' && context.surface ? context.surface : 'port'),
      archived: options.archived === true || context.archived === true,
      professionVersion: professionVersion,
      chapterId: CHAPTER_IDS.indexOf(options.chapterId) >= 0
        ? options.chapterId
        : (CHAPTER_IDS.indexOf(context.chapterId) >= 0 ? context.chapterId : null),
      progress: progress,
      acceptedHint: acceptedHint,
      flags: new Set(tokensOf(firstDefined(options.flags, options.worldFlags, context.worldFlags, context.flags))),
      cleared: new Set(tokensOf(firstDefined(options.cleared, options.clearedCommissions, context.clearedCommissions, context.cleared))),
      evidence: new Set(tokensOf(firstDefined(options.evidence, options.storyEvidence, context.storyEvidence, context.evidence))),
      capabilities: new Set(tokensOf(firstDefined(options.capabilities, context.capabilities))),
      wallet: firstDefined(options.wallet, context.wallet) || null,
      storyEvents: isObject(state.storyEvents) ? state.storyEvents : {},
    };
  }

  function isProfessionAccepted(ctx, professionId) {
    if (!stableId(professionId)) return false;
    if (hasOwn(ctx.progress, professionId)) {
      var row = ctx.progress[professionId];
      if (ACCEPTED_STATES.indexOf(row.state) < 0) return false;
      if (ctx.acceptedHint && ctx.acceptedHint.indexOf(professionId) < 0) return false;
      return true;
    }
    if (Object.keys(ctx.progress).length > 0) return false;
    return !!(ctx.acceptedHint && ctx.acceptedHint.indexOf(professionId) >= 0);
  }

  function hasAnyAccepted(ctx, index) {
    var ids = [];
    if (Object.keys(ctx.progress).length > 0) {
      Object.keys(ctx.progress).forEach(function (professionId) {
        if (isProfessionAccepted(ctx, professionId)) ids.push(professionId);
      });
    } else if (ctx.acceptedHint) {
      ctx.acceptedHint.forEach(function (professionId) {
        ids.push(professionId);
      });
    }
    if (index.hasProfessions) {
      ids = ids.filter(function (professionId) {
        return index.professionIds.has(professionId);
      });
    }
    return ids.length > 0;
  }

  function hardFailure(ctx) {
    if (typeof ctx.professionVersion === 'number' && ctx.professionVersion > PROFESSION_VERSION) {
      return REASONS.futureVersion;
    }
    if (ctx.archived === true) return REASONS.archived;
    return null;
  }

  function chapterFlagsOf(index, chapterId) {
    if (index.chapterFlags && index.chapterFlags.has(chapterId)) return index.chapterFlags.get(chapterId);
    return FROZEN_CHAPTER_FLAGS[chapterId] || [];
  }

  function chapterReached(ctx, index, chapterId) {
    if (ctx.chapterId === chapterId) return true;
    var required = chapterFlagsOf(index, chapterId);
    if (!required.length) return false;
    return required.every(function (flag) {
      return ctx.flags.has(flag);
    });
  }

  function everyKnown(list, set) {
    return list.every(function (token) {
      return set.has(token);
    });
  }

  function anyKnown(list, set) {
    return list.some(function (token) {
      return set.has(token);
    });
  }

  function gateSatisfied(gate, ctx) {
    if (!everyKnown(gate.requiresFlagsAll, ctx.flags)) return false;
    if (gate.requiresFlagsAny.length && !anyKnown(gate.requiresFlagsAny, ctx.flags)) return false;
    if (!everyKnown(gate.requiresCommissionsAll, ctx.cleared)) return false;
    if (gate.requiresEvidenceAny.length && !anyKnown(gate.requiresEvidenceAny, ctx.evidence)) return false;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 交叉节点判定与输出
   * ------------------------------------------------------------------ */

  function findPair(engine, eventId) {
    for (var i = 0; i < engine.pairs.length; i += 1) {
      if (engine.pairs[i].eventId === eventId) return engine.pairs[i];
    }
    return null;
  }

  function findAlternative(engine, narrativeNodeId) {
    for (var i = 0; i < engine.alternatives.length; i += 1) {
      if (engine.alternatives[i].narrativeNodeId === narrativeNodeId) return engine.alternatives[i];
    }
    return null;
  }

  function eventIdForProfessionPair(left, right) {
    if (!stableId(left) || !stableId(right) || left === right) return null;
    var ids = [left, right].sort();
    var eventId = 'crossover:' + ids[0] + ':' + ids[1];
    return CROSSOVER_ID_RE.test(eventId) && EVENT_ID_RE.test(eventId) && eventId.length <= 120 ? eventId : null;
  }

  function evaluateCrossover(pair, ctx, index) {
    if (hasOwn(ctx.storyEvents, pair.eventId)) return { available: false, reason: REASONS.historicalOnly };
    if (index.hasProfessions) {
      if (!index.professionIds.has(pair.professionIds[0]) || !index.professionIds.has(pair.professionIds[1])) {
        return { available: false, reason: REASONS.unknownProfession };
      }
    }
    if (!isProfessionAccepted(ctx, pair.professionIds[0]) || !isProfessionAccepted(ctx, pair.professionIds[1])) {
      return { available: false, reason: REASONS.notAccepted };
    }
    var chapterOk = pair.anchor.chapterIds.some(function (chapterId) {
      return chapterReached(ctx, index, chapterId);
    });
    if (!chapterOk) return { available: false, reason: REASONS.storyLocked };
    if (!gateSatisfied(pair.gate, ctx)) return { available: false, reason: REASONS.worldLocked };
    if (pair.visibleSurfaces.indexOf(ctx.surface) < 0) return { available: false, reason: REASONS.wrongSurface };
    return { available: true, reason: null };
  }

  function crossoverNode(pair) {
    return {
      eventId: pair.eventId,
      pairId: pair.pairId,
      npcRefs: clone(pair.anchor.npcRefs),
      texts: clone(pair.texts),
      receiptSource: 'narrative-event',
      maxShowsPerCareer: 1,
    };
  }

  function selectPair(input, engine, index) {
    var selector = isObject(input) ? input : {};
    var eventId = null;
    var requestedIds = Array.isArray(selector.professionIds) ? selector.professionIds : null;
    if (typeof selector.eventId === 'string' && selector.eventId) eventId = selector.eventId;
    else if (typeof selector.pairId === 'string' && selector.pairId) eventId = selector.pairId;
    else if (requestedIds && requestedIds.length === 2) {
      eventId = eventIdForProfessionPair(requestedIds[0], requestedIds[1]);
    }
    if (!eventId) return { pair: null, explicit: false };
    var pair = findPair(engine, eventId);
    if (pair) return { pair: pair, explicit: true };
    if (index.hasProfessions && requestedIds && requestedIds.some(function (professionId) {
      return !index.professionIds.has(professionId);
    })) {
      return { pair: null, explicit: true, unknownProfession: true };
    }
    return { pair: null, explicit: true };
  }

  /* ------------------------------------------------------------------ *
   * 替代叙事判定与输出
   * ------------------------------------------------------------------ */

  function mechanismReady(node, index) {
    var refs = node.anchor.refs;
    if (node.mechanism === 'world-work') {
      if (!index.worldWorkIds.has(refs[0])) return { ok: false, reason: REASONS.unknownCommission };
      if (index.commissionById && !index.commissionById.has(refs[0])) {
        return { ok: false, reason: REASONS.unknownCommission };
      }
      return { ok: true, reason: null };
    }
    if (node.mechanism === 'profession-commission') {
      var commission = index.commissionById && index.commissionById.get(refs[0]);
      if (!commission || !stableId(commission.professionId) || index.worldWorkIds.has(refs[0])) {
        return { ok: false, reason: REASONS.unknownCommission };
      }
      return { ok: true, reason: null };
    }
    if (node.mechanism === 'errand') {
      if (!index.offerIssuers.has(refs[0])) return { ok: false, reason: REASONS.notAvailable };
      return { ok: true, reason: null };
    }
    if (node.mechanism === 'rental') {
      if (!index.rentalShipIds.has(refs[0])) return { ok: false, reason: REASONS.notAvailable };
      return { ok: true, reason: null };
    }
    if (node.mechanism === 'market-material') {
      if (!index.materialIds.has(refs[0])) return { ok: false, reason: REASONS.notAvailable };
      return { ok: true, reason: null };
    }
    if (node.mechanism === 'evidence-pair') {
      if (refs.length < 2) return { ok: false, reason: REASONS.notAvailable };
      if (index.evidenceTokens) {
        for (var i = 0; i < refs.length; i += 1) {
          if (!index.evidenceTokens.has(refs[i])) return { ok: false, reason: REASONS.notAvailable };
        }
      }
      return { ok: true, reason: null };
    }
    return { ok: false, reason: REASONS.notAvailable };
  }

  function evaluateAlternative(node, ctx, index) {
    if (!hasAnyAccepted(ctx, index)) return { available: false, reason: REASONS.notAccepted };
    if (!chapterReached(ctx, index, node.chapterId)) return { available: false, reason: REASONS.storyLocked };
    if (!gateSatisfied(node.gate, ctx)) return { available: false, reason: REASONS.worldLocked };
    var ready = mechanismReady(node, index);
    if (!ready.ok) return { available: false, reason: ready.reason };
    if (node.mechanism === 'profession-commission') {
      var owner = index.commissionById.get(node.anchor.refs[0]).professionId;
      if (!isProfessionAccepted(ctx, owner)) return { available: false, reason: REASONS.notAccepted };
    }
    return { available: true, reason: null };
  }

  function alternativeNode(node) {
    return {
      narrativeNodeId: node.narrativeNodeId,
      mechanism: node.mechanism,
      anchor: clone(node.anchor),
      npcRef: clone(node.npcRef),
      signatureFrom: node.signatureFrom,
      available: true,
      reason: null,
      texts: clone(node.texts),
      receiptSource: node.receiptSource,
    };
  }

  /* ------------------------------------------------------------------ *
   * 公开 API
   * ------------------------------------------------------------------ */

  function createWorldNarrative(options) {
    var settings = isObject(options) ? options : {};
    var catalog = isObject(settings.catalog) ? settings.catalog : {};
    var content = settings.content !== undefined ? settings.content : catalog.worldNarrative;
    var engine = buildEngine(content, catalog);

    function resolveCrossover(input) {
      try {
        var ctx = normalizeContext(input);
        var hard = hardFailure(ctx);
        if (hard) return fail(hard);
        if (CROSSOVER_SURFACES.indexOf(ctx.surface) < 0) {
          return { ok: true, node: null, reason: REASONS.wrongSurface };
        }
        var selection = selectPair(input, engine, engine.index);
        if (selection.unknownProfession) return fail(REASONS.unknownProfession);
        /* 显式选择器指向未声明/未接受的 pair 时绝不回退成全量扫描（防止深链绕过 gate）。 */
        if (selection.explicit && !selection.pair) return { ok: true, node: null, reason: null };
        var targets = selection.pair ? [selection.pair] : engine.pairs;
        var diagnostic = null;
        for (var i = 0; i < targets.length; i += 1) {
          var evaluated = evaluateCrossover(targets[i], ctx, engine.index);
          if (evaluated.available) return { ok: true, node: crossoverNode(targets[i]), reason: null };
          if (selection.pair && !diagnostic) diagnostic = evaluated.reason;
        }
        return { ok: true, node: null, reason: selection.pair ? diagnostic : null };
      } catch (err) {
        return fail(REASONS.notAvailable);
      }
    }

    function resolveAlternative(input) {
      try {
        var ctx = normalizeContext(input);
        var hard = hardFailure(ctx);
        if (hard) return fail(hard);
        if (ALTERNATIVE_SURFACES.indexOf(ctx.surface) < 0) {
          return { ok: true, node: null, reason: REASONS.wrongSurface };
        }
        var selector = isObject(input) ? input : {};
        if (typeof selector.narrativeNodeId === 'string' && selector.narrativeNodeId) {
          var picked = findAlternative(engine, selector.narrativeNodeId);
          if (!picked) return { ok: true, node: null, reason: null };
          var pickedResult = evaluateAlternative(picked, ctx, engine.index);
          if (!pickedResult.available) return { ok: true, node: null, reason: pickedResult.reason };
          return { ok: true, node: alternativeNode(picked), reason: null };
        }
        var chapterFilter = CHAPTER_IDS.indexOf(ctx.chapterId) >= 0 ? ctx.chapterId : null;
        for (var i = 0; i < engine.alternatives.length; i += 1) {
          var node = engine.alternatives[i];
          if (chapterFilter && node.chapterId !== chapterFilter) continue;
          if (evaluateAlternative(node, ctx, engine.index).available) {
            return { ok: true, node: alternativeNode(node), reason: null };
          }
        }
        return { ok: true, node: null, reason: null };
      } catch (err) {
        return fail(REASONS.notAvailable);
      }
    }

    function listCrossovers(input) {
      try {
        var ctx = normalizeContext(input);
        var hard = hardFailure(ctx);
        if (hard) return { ok: false, nodes: [], reason: hard };
        if (CROSSOVER_SURFACES.indexOf(ctx.surface) < 0) {
          return { ok: true, nodes: [], reason: REASONS.wrongSurface };
        }
        var nodes = [];
        engine.pairs.forEach(function (pair) {
          if (evaluateCrossover(pair, ctx, engine.index).available) nodes.push(crossoverNode(pair));
        });
        return { ok: true, nodes: nodes, reason: null };
      } catch (err) {
        return { ok: false, nodes: [], reason: REASONS.notAvailable };
      }
    }

    return Object.freeze({
      resolveCrossover: resolveCrossover,
      resolveAlternative: resolveAlternative,
      listCrossovers: listCrossovers,
    });
  }

  /* ADR §3.3 聚合适配器：给定章节，返回该章替代节点与当前可用交汇。 */
  function resolveWorldAlternatives(input) {
    try {
      var options = isObject(input) ? input : {};
      var catalog = isObject(options.catalog) ? options.catalog : {};
      var content = options.content !== undefined ? options.content : catalog.worldNarrative;
      var engine = buildEngine(content, catalog);
      var ctx = normalizeContext(options);
      var chapterId = CHAPTER_IDS.indexOf(options.chapterId) >= 0
        ? options.chapterId
        : (CHAPTER_IDS.indexOf(ctx.chapterId) >= 0 ? ctx.chapterId : null);
      var hard = hardFailure(ctx);
      var nodes = [];
      var crossovers = [];
      if (!hard && chapterId && ALTERNATIVE_SURFACES.indexOf(ctx.surface) >= 0) {
        engine.alternatives.forEach(function (node) {
          if (node.chapterId !== chapterId) return;
          if (evaluateAlternative(node, ctx, engine.index).available) nodes.push(alternativeNode(node));
        });
      }
      if (!hard && CROSSOVER_SURFACES.indexOf(ctx.surface) >= 0) {
        engine.pairs.forEach(function (pair) {
          if (evaluateCrossover(pair, ctx, engine.index).available) crossovers.push(crossoverNode(pair));
        });
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        chapterId: chapterId,
        nodes: nodes,
        crossovers: crossovers,
      };
    } catch (err) {
      return { schemaVersion: SCHEMA_VERSION, chapterId: null, nodes: [], crossovers: [] };
    }
  }

  /**
   * 从当前生涯的真实已清记录推导「已经发生」的替代经历（ADR §9 增补，只读、不落盘）。
   * 每条都必须同时满足：节点在当前事实下可达，且有带合法时间的真实记录
   * （委托/代办/证据走 quests 行，商店材料走采购流水）。免费租机不留持久记录，不在此推导。
   * 返回 [{eventId, at, source}]；是否进入经历仍由内容白名单与投影 gate 决定。
   */
  function isoTime(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  }

  function deriveJournalEvents(input) {
    try {
      var options = isObject(input) ? input : {};
      var catalog = isObject(options.catalog) ? options.catalog : {};
      var content = options.content !== undefined ? options.content : catalog.worldNarrative;
      var engine = buildEngine(content, catalog);
      var ctx = normalizeContext(input);
      /* 内容不可用时 normalizeContent 已把 alternatives 清空，这里自然不产出任何经历。 */
      if (hardFailure(ctx) || ALTERNATIVE_SURFACES.indexOf(ctx.surface) < 0) return [];
      var records = isObject(options.records) ? options.records : {};
      var quests = arrayOf(records.quests);
      var purchases = arrayOf(records.purchases);
      var clearedAt = function (kind, nodeId) {
        for (var i = 0; i < quests.length; i += 1) {
          var row = quests[i];
          if (isObject(row) && row.kind === kind && row.nodeId === nodeId && row.status === 'cleared' && isoTime(row.clearedAt)) {
            return row.clearedAt;
          }
        }
        return null;
      };
      var out = [];
      engine.alternatives.forEach(function (node) {
        if (!evaluateAlternative(node, ctx, engine.index).available) return;
        var refs = arrayOf(node.anchor && node.anchor.refs);
        var at = null;
        var source = 'world';
        if (node.anchor.kind === 'commission') {
          at = clearedAt('commission', refs[0]);
        } else if (node.mechanism === 'errand') {
          at = clearedAt('alternative', refs[0]);
          source = 'commission';
        } else if (node.mechanism === 'evidence-pair') {
          var times = refs.map(function (token) { return clearedAt('evidence', 'evidence:' + token); });
          at = times.every(isoTime) ? times.slice().sort().pop() : null;
        } else if (node.mechanism === 'market-material') {
          at = (purchases.filter(function (row) {
            return isObject(row) && row.itemId === refs[0] && isoTime(row.at);
          })[0] || {}).at || null;
        }
        if (!isoTime(at)) return;
        out.push({ eventId: 'world:' + node.narrativeNodeId.slice('altn.'.length), at: at, source: source });
      });
      return out;
    } catch (err) {
      return [];
    }
  }

  /* 落款只读解引用：从真实内容读人名，绝不由叙事文本手写。 */
  function resolveSignature(input) {
    try {
      var options = isObject(input) ? input : {};
      var node = isObject(options.node) ? options.node : {};
      var index = buildCatalogIndex(isObject(options.catalog) ? options.catalog : {});
      var anchor = isObject(node.anchor) ? node.anchor : {};
      var refs = arrayOf(anchor.refs);
      var npcRef = isObject(node.npcRef) ? node.npcRef : {};
      if (node.signatureFrom === 'origin-letter') {
        if (!index.originSigners || !stableId(npcRef.gameId)) return { ok: false, signer: null, reason: REASONS.notAvailable };
        var signer = index.originSigners.get(npcRef.gameId);
        return signer ? { ok: true, signer: signer, reason: null } : { ok: false, signer: null, reason: REASONS.notAvailable };
      }
      if (node.signatureFrom === 'commission-issuer') {
        if (!index.commissionById) return { ok: false, signer: null, reason: REASONS.unknownCommission };
        var commission = index.commissionById.get(refs[0]);
        if (!commission || typeof commission.issuer !== 'string' || !commission.issuer) {
          return { ok: false, signer: null, reason: REASONS.unknownCommission };
        }
        return { ok: true, signer: commission.issuer, reason: null };
      }
      if (node.signatureFrom === 'offer-issuer') {
        var issuer = index.offerIssuers.get(refs[0]);
        return typeof issuer === 'string' && issuer
          ? { ok: true, signer: issuer, reason: null }
          : { ok: false, signer: null, reason: REASONS.notAvailable };
      }
      if (node.signatureFrom === 'npc-character') {
        if (!index.npcNames) return { ok: false, signer: null, reason: REASONS.notAvailable };
        var name = index.npcNames.get(npcRef.characterId);
        return name ? { ok: true, signer: name, reason: null } : { ok: false, signer: null, reason: REASONS.notAvailable };
      }
      return { ok: false, signer: null, reason: REASONS.notAvailable };
    } catch (err) {
      return { ok: false, signer: null, reason: REASONS.notAvailable };
    }
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    MODULE_VERSION: MODULE_VERSION,
    CONTENT_VERSION: CONTENT_VERSION,
    PROFESSION_VERSION: PROFESSION_VERSION,
    ACCEPTED_STATES: ACCEPTED_STATES,
    CHAPTER_IDS: CHAPTER_IDS,
    SURFACES: SURFACES,
    CROSSOVER_SURFACES: CROSSOVER_SURFACES,
    ALTERNATIVE_SURFACES: ALTERNATIVE_SURFACES,
    JOURNAL_SURFACES: JOURNAL_SURFACES,
    JOURNAL_SOURCES: JOURNAL_SOURCES,
    MECHANISMS: MECHANISMS,
    MECHANISM_ANCHOR_KIND: MECHANISM_ANCHOR_KIND,
    MECHANISM_RECEIPT_SOURCE: MECHANISM_RECEIPT_SOURCE,
    FROZEN_CHAPTER_FLAGS: FROZEN_CHAPTER_FLAGS,
    FROZEN_WORLD_WORK_IDS: FROZEN_WORLD_WORK_IDS,
    FROZEN_RENTAL_SHIP_IDS: FROZEN_RENTAL_SHIP_IDS,
    FROZEN_MATERIAL_IDS: FROZEN_MATERIAL_IDS,
    FROZEN_OFFERS: FROZEN_OFFERS,
    REASONS: REASONS,
    eventIdForProfessionPair: eventIdForProfessionPair,
    createWorldNarrative: createWorldNarrative,
    resolveWorldAlternatives: resolveWorldAlternatives,
    deriveJournalEvents: deriveJournalEvents,
    resolveSignature: resolveSignature,
  });
});
