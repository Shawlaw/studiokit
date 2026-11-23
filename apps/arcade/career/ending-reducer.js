/*!
 * StudioKit Arcade Life — 三终局汇合与后日常（0.18，D18-09）
 *
 * 职责：把三份 ending 内容（content/ending-{combat,research,rescue}.json）转成
 * commission-core 可以消费的委托行，建立**独立**的 commission-core 实例（不混入 96 告示板）；
 * 控制「C4 完成后三选一」的启动、结算后一次性写 C5 旗标与结局记录、只读推导当前结局与后日常。
 * ADR 依据：docs/arcade-life/ADR-interfaces.md §20.1–§20.5。
 *
 * 边界（不得越界）：
 * - 纯 UMD：浏览器挂 window.ArcadeCareerEnding，并镜像 window.ArcadeCareer.ending；
 *   Node 中 module.exports 返回同一 API（另加 createEndingReducer 工厂）。
 * - 无 DOM、无网络、无 localStorage/sessionStorage/indexedDB：DB 与 commission-core 都是
 *   注入依赖（configure({db, commission})，或 createEndingReducer({db, commission})）。
 *   本模块不自己写库、不发请求、不读页面存储。
 * - 不发明经济数字：ending 行 reward.credits=0、repeatSalaryCredits=0；结算收据若出现
 *   非 0 信用点（或该 run 的流水里有信用点步骤）则拒绝写 C5，返回 economy-violation。
 * - 旗标只写一次：C5.star_tower_resolved 与 ending.<approach> 两行 quest 在**同一**
 *   db.putQuests 事务里写入；活动结局记录已存在时返回 duplicate、零新增写入、零新增奖励。
 * - 失败/放弃不写 C5；重复结算返回原收据（duplicate）；不得把失败标记为通关。
 * - 不做 profile 写入：0.17 的 story-evidence 同样把剧情旗标放在 quests 行
 *   （nodeId 'story:<flag>'、flags:[flag]）而不是 profile.flags；本次注入的 DB 面
 *   （readQuestState/putQuests/getClaim/readLedger/getRun/getProfile）不含 putProfile，
 *   避免跨事务的部分写入。
 * - 所有公开方法捕获异常后返回结构化失败，绝不向调用方抛。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerEnding = api;
  /* 与 commission-core / story-evidence 一致：镜像挂到 ArcadeCareer 命名空间，
     供 bridge / UI 的 readGlobal('ending') 风格取用。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.ending !== api) {
    try {
      career.ending = api;
    } catch (err) {
      /* 只读宿主：忽略镜像失败，窗口级名字仍可用。 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function endingReducerFactory(root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量与形状
   * ------------------------------------------------------------------ */

  var VERSION = '0.18.0';
  var MODULE_VERSION = '0.18.0';
  /* 本模块自身的内容口径（ending/campaign 文件是 0.18.0）。注意：这个值**不**转发给
     commission-core —— 0.17 的 commission-core 用 contentVersion 做主键兼容检查，
     转发 0.18.0 会被判 unsupported-content。ending 行以裸数组注入，行上不带版本。 */
  var CONTENT_VERSION = '0.18.0';
  var SCHEMA_VERSION = 1;

  var APPROACHES = Object.freeze(['combat', 'research', 'rescue']);
  var C4_FLAG = 'C4.city_power_restored';
  var ENDING_FLAG = 'C5.star_tower_resolved';
  var ENDING_PREFIX = 'ending.';
  var CHAPTER = 'C5';
  var PROFESSION_ID = 'ending';
  var DEFAULT_ISSUER = '旧港调度';
  var DEFAULT_DURATION = '终局';

  /* ending 行的委托目标（objective.kind）与游戏目标由内容提供；这里只校验形状。 */
  var ENDING_COMMISSION_RE = /^ending\.(combat|research|rescue)$/;
  var ENDING_APPROACH_RE = /^(combat|research|rescue)$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var KIND_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
  var STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/;
  var CAREER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

  var LIVE_STATUS = ['issued', 'active'];
  var SETTLED_STATUS = ['claimed', 'settled', 'claiming'];

  /* 只读推导的结果来源：结局记录行 > 终局委托行 > 收据 > 孤立 C5 旗标行。 */
  var SOURCE_ENDING = 'ending';
  var SOURCE_COMMISSION = 'commission';
  var SOURCE_CLAIM = 'claim';
  var SOURCE_FLAG = 'flag';

  var REASONS = Object.freeze({
    notConfigured: 'not-configured',
    contentInvalid: 'content-invalid',
    dbUnavailable: 'db-unavailable',
    commissionUnavailable: 'commission-unavailable',
    badApproach: 'unknown-approach',
    badCareerId: 'bad-career-id',
    noCareer: 'no-career',
    dbReadFailed: 'db-read-failed',
    locked: 'locked',
    alreadyResolved: 'already-resolved',
    occupied: 'occupied',
    startFailed: 'start-failed',
    badTicket: 'bad-ticket',
    noRun: 'no-run',
    notAnEnding: 'not-an-ending',
    settleFailed: 'settle-failed',
    notCleared: 'not-cleared',
    runFailed: 'run-failed',
    alreadySettled: 'already-settled',
    receiptUnavailable: 'receipt-unavailable',
    receiptMismatch: 'receipt-mismatch',
    receiptMissingFlag: 'receipt-missing-flag',
    economyViolation: 'economy-violation',
    questWriteFailed: 'quest-write-failed',
    exception: 'exception',
  });

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS，无宿主依赖）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
  }

  function isArray(value) {
    return Array.isArray(value);
  }

  function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target || {}, key);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      var text = JSON.stringify(value);
      if (typeof text !== 'string') return null;
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function errorText(err) {
    if (!err) return 'unknown-error';
    if (typeof err === 'string') return err;
    try {
      if (err.name && err.message) return String(err.name) + ': ' + String(err.message);
      return String(err.message || err.name || 'unknown-error');
    } catch (e) {
      return 'unknown-error';
    }
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (max && text.length > max) text = text.slice(0, max);
    return text;
  }

  function nonNegInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : 0;
    var floored = Math.floor(num);
    return floored < 0 ? 0 : floored;
  }

  function isApproach(value) {
    return typeof value === 'string' && ENDING_APPROACH_RE.test(value);
  }

  function isStableId(value) {
    return typeof value === 'string' && STABLE_ID_RE.test(value);
  }

  function isGameId(value) {
    return typeof value === 'string' && GAME_ID_RE.test(value);
  }

  function isCareerId(value) {
    return typeof value === 'string' && CAREER_ID_RE.test(value);
  }

  function isRunId(value) {
    return typeof value === 'string' && CAREER_ID_RE.test(value);
  }

  function isLiveStatus(status) {
    return !status || LIVE_STATUS.indexOf(status) >= 0;
  }

  function isSettledStatus(status) {
    return SETTLED_STATUS.indexOf(status) >= 0;
  }

  function approachOrder(approach) {
    var index = APPROACHES.indexOf(approach);
    return index < 0 ? APPROACHES.length : index;
  }

  function stampOf(value) {
    return typeof value === 'string' && value ? value : '';
  }

  function unionList(left, right) {
    var out = [];
    [left, right].forEach(function (list) {
      if (!isArray(list)) return;
      for (var i = 0; i < list.length; i += 1) {
        var value = list[i];
        if (typeof value !== 'string' || !value) continue;
        if (out.indexOf(value) >= 0) continue;
        out.push(value);
      }
    });
    return out;
  }

  function valuesOf(value) {
    var out = [];
    if (!isObject(value)) return out;
    Object.keys(value).forEach(function (key) {
      if (isObject(value[key])) out.push(value[key]);
    });
    return out;
  }

  function failure(reason, detail) {
    var out = { ok: false, reason: reason || 'failed' };
    if (isObject(detail)) {
      Object.keys(detail).forEach(function (key) {
        if (key === 'ok' || key === 'reason') return;
        out[key] = detail[key];
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 内容规范化：campaign 后日谈 / ending 行
   * ------------------------------------------------------------------ */

  /** 目标形状规范化（对齐 career-core.sanitizeObjective 与 commission-core.normalizeObjective）。 */
  function normalizeObjective(raw) {
    if (!isObject(raw)) return null;
    if (typeof raw.kind !== 'string' || !KIND_RE.test(raw.kind)) return null;
    var objective = {
      kind: raw.kind,
      atLeast: Number.isFinite(Number(raw.atLeast)) && Math.floor(Number(raw.atLeast)) > 0 ? Math.floor(Number(raw.atLeast)) : 1,
      context: {},
    };
    if (raw.context !== undefined && raw.context !== null) {
      if (!isObject(raw.context)) return null;
      var fields = Object.keys(raw.context);
      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        if (!isStableId(field)) return null;
        var value = raw.context[field];
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
        objective.context[field] = value;
      }
    }
    if (raw.minValue !== undefined && raw.minValue !== null) {
      if (!isObject(raw.minValue) || !isStableId(raw.minValue.field)) return null;
      var value2 = Number(raw.minValue.value);
      if (!Number.isFinite(value2)) return null;
      objective.minValue = { field: raw.minValue.field, value: value2 };
    }
    return objective;
  }

  function normalizeStartParams(raw, warnings, approach) {
    var out = {};
    if (raw === undefined || raw === null) return out;
    if (!isObject(raw)) {
      warnings.push('ending-start-params-invalid:' + approach);
      return out;
    }
    Object.keys(raw).forEach(function (key) {
      var value = raw[key];
      if (!isStableId(key)) {
        warnings.push('ending-start-param-key-dropped:' + approach + ':' + key);
        return;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
      else warnings.push('ending-start-param-value-dropped:' + approach + ':' + key);
    });
    return out;
  }

  function normalizeFlagList(raw, warnings, approach) {
    var out = [];
    if (raw === undefined || raw === null) return out;
    if (!isArray(raw)) {
      warnings.push('ending-flags-invalid:' + approach);
      return out;
    }
    raw.forEach(function (value) {
      if (!isStableId(value)) {
        warnings.push('ending-flag-dropped:' + approach + ':' + String(value));
        return;
      }
      if (out.indexOf(value) >= 0) return;
      out.push(value);
    });
    return out;
  }

  function normalizeCampaign(raw, errors, warnings) {
    if (raw === undefined || raw === null) {
      errors.push('campaign-missing');
      return null;
    }
    if (!isObject(raw)) {
      errors.push('campaign-invalid');
      return null;
    }
    var epilogue = isObject(raw.epilogue) ? raw.epilogue : null;
    if (!epilogue) warnings.push('campaign-epilogue-missing');
    var base = epilogue && typeof epilogue.base === 'string' ? epilogue.base.trim() : '';
    var texts = {};
    var titles = {};
    var summaries = {};
    APPROACHES.forEach(function (approach) {
      texts[approach] = epilogue && typeof epilogue[approach] === 'string' ? epilogue[approach].trim() : '';
      if (!texts[approach]) warnings.push('campaign-epilogue-text-missing:' + approach);
    });
    var list = isArray(raw.endings) ? raw.endings : [];
    list.forEach(function (entry) {
      if (!isObject(entry)) return;
      if (!isApproach(entry.approach)) return;
      if (typeof entry.title === 'string' && entry.title.trim()) titles[entry.approach] = entry.title.trim();
      if (typeof entry.summary === 'string' && entry.summary.trim()) summaries[entry.approach] = entry.summary.trim();
    });
    return { base: base, texts: texts, titles: titles, summaries: summaries };
  }

  /** 收集 configure({endings}) 支持的三种形状：数组 / {endings:[...]} / 以 approach 为键的对象。 */
  function collectEndingSources(raw) {
    var out = { list: [], unknownKeys: [], keyed: false };
    if (isArray(raw)) {
      out.list = raw.slice();
      return out;
    }
    if (!isObject(raw)) return out;
    if (isArray(raw.endings)) {
      out.list = raw.endings.slice();
      Object.keys(raw).forEach(function (key) {
        if (key === 'endings' || key === 'contentVersion' || key === 'world' || key === 'chapters') return;
        if (APPROACHES.indexOf(key) >= 0) return;
        out.unknownKeys.push(key);
      });
      return out;
    }
    out.keyed = true;
    Object.keys(raw).forEach(function (key) {
      if (key === 'contentVersion' || key === 'world' || key === 'chapters' || key === 'epilogue') return;
      if (APPROACHES.indexOf(key) < 0) {
        out.unknownKeys.push(key);
        return;
      }
      var entry = raw[key];
      if (isObject(entry) && !hasOwn(entry, 'approach')) {
        var copy = {};
        Object.keys(entry).forEach(function (field) {
          copy[field] = entry[field];
        });
        copy.approach = key;
        out.list.push(copy);
        return;
      }
      out.list.push(entry);
    });
    return out;
  }

  function normalizeEnding(raw, campaignView, errors, warnings) {
    if (!isObject(raw)) {
      errors.push('ending-invalid:' + (isObject(raw) ? '?' : String(raw)));
      return null;
    }
    var approach = isApproach(raw.approach) ? raw.approach : '';
    if (!approach) {
      errors.push('ending-approach-unknown:' + String(raw.approach === undefined ? '?' : raw.approach));
      return null;
    }
    var commissionId = typeof raw.commissionId === 'string' && raw.commissionId ? raw.commissionId : ENDING_PREFIX + approach;
    if (!ENDING_COMMISSION_RE.test(commissionId) || commissionId !== ENDING_PREFIX + approach) {
      errors.push('ending-id-invalid:' + approach);
      return null;
    }
    if (!isGameId(raw.gameId)) {
      errors.push('ending-game-invalid:' + approach);
      return null;
    }
    var objective = normalizeObjective(raw.objective);
    if (!objective) {
      errors.push('ending-objective-invalid:' + approach);
      return null;
    }
    var title = trimText(raw.title, 80) || (campaignView ? campaignView.titles[approach] || '' : '');
    if (!title) {
      errors.push('ending-title-missing:' + approach);
      return null;
    }
    var summary = trimText(raw.summary, 200) || (campaignView ? campaignView.summaries[approach] || '' : '');
    if (!summary) {
      errors.push('ending-summary-missing:' + approach);
      return null;
    }
    var startParams = normalizeStartParams(raw.startParams, warnings, approach);
    var flags = normalizeFlagList(raw.flags, warnings, approach);
    if (flags.indexOf(ENDING_FLAG) < 0) {
      flags.unshift(ENDING_FLAG);
      warnings.push('ending-flag-derived:' + approach + ':' + ENDING_FLAG);
    }
    var ownFlag = ENDING_PREFIX + approach;
    if (flags.indexOf(ownFlag) < 0) {
      flags.push(ownFlag);
      warnings.push('ending-flag-derived:' + approach + ':' + ownFlag);
    }
    var epilogueText = typeof raw.epilogueText === 'string' && raw.epilogueText.trim() ? raw.epilogueText.trim() : '';
    if (!epilogueText && campaignView) epilogueText = campaignView.texts[approach] || '';
    /* commission-core 行：拒绝任何工钱；unlock 固定为 C4 完成。 */
    var row = {
      commissionId: commissionId,
      gameId: raw.gameId,
      professionId: PROFESSION_ID,
      tier: 5,
      title: title,
      summary: summary,
      issuer: trimText(raw.issuer, 80) || DEFAULT_ISSUER,
      objective: objective,
      objectiveBonus: 0,
      startParams: startParams,
      reward: { credits: 0, items: {}, evidence: [], flags: flags.slice() },
      repeatSalaryCredits: 0,
      unlock: { all: [{ chapterFlag: C4_FLAG }] },
      risk: 'high',
      durationHint: trimText(raw.durationHint, 80) || DEFAULT_DURATION,
    };
    return {
      approach: approach,
      commissionId: commissionId,
      gameId: raw.gameId,
      title: title,
      summary: summary,
      epilogueText: epilogueText,
      flags: flags.slice(),
      objective: clone(objective),
      startParams: clone(startParams),
      row: row,
    };
  }

  /* ------------------------------------------------------------------ *
   * 只读推导：旗标集合 / 当前结局
   * ------------------------------------------------------------------ */

  /** 单行 quest 暴露的旗标：flags 数组 + row.flag + nodeId 'story:<flag>' 约定 + nodeId 本身是旗标。 */
  function rowFlags(row) {
    var out = [];
    if (!isObject(row)) return out;
    if (isArray(row.flags)) {
      row.flags.forEach(function (flag) {
        if (typeof flag === 'string' && flag && out.indexOf(flag) < 0) out.push(flag);
      });
    }
    if (typeof row.flag === 'string' && row.flag && out.indexOf(row.flag) < 0) out.push(row.flag);
    var nodeId = typeof row.nodeId === 'string' ? row.nodeId : '';
    if (nodeId.indexOf('story:') === 0) {
      var derived = nodeId.slice('story:'.length);
      if (derived && out.indexOf(derived) < 0) out.push(derived);
    } else if (/^C[0-9]\.[a-z0-9][a-z0-9._-]{0,60}$/.test(nodeId) && out.indexOf(nodeId) < 0) {
      /* 兼容另一种写法：直接用旗标名做 nodeId（如 nodeId:'C5.star_tower_resolved'）。 */
      out.push(nodeId);
    }
    return out;
  }

  function questRowsOf(value) {
    if (isArray(value)) {
      return value.filter(isObject);
    }
    if (!isObject(value)) return [];
    if (isArray(value.quests)) return value.quests.filter(isObject);
    if (isObject(value.byNode)) return valuesOf(value.byNode);
    return [];
  }

  function claimRowsOf(value) {
    if (isArray(value)) return value.filter(isObject);
    if (!isObject(value)) return [];
    if (isArray(value.claims)) return value.claims.filter(isObject);
    if (isObject(value.claims)) return valuesOf(value.claims);
    if (isArray(value.receipts)) return value.receipts.filter(isObject);
    if (isObject(value.receipts)) return valuesOf(value.receipts);
    return [];
  }

  function receiptOfClaim(row) {
    if (!isObject(row)) return null;
    return isObject(row.receipt) ? row.receipt : row;
  }

  function approachFromCommissionId(commissionId) {
    if (typeof commissionId !== 'string') return null;
    var match = ENDING_COMMISSION_RE.exec(commissionId);
    return match ? match[1] : null;
  }

  function earliest(candidates) {
    var best = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      if (!best) {
        best = candidate;
        continue;
      }
      var left = stampOf(candidate.at);
      var right = stampOf(best.at);
      if (left && right && left < right) best = candidate;
      else if (left && !right) best = candidate;
      else if (left === right && approachOrder(candidate.approach) < approachOrder(best.approach)) best = candidate;
      else if (!left && !right && approachOrder(candidate.approach) < approachOrder(best.approach)) best = candidate;
    }
    return best;
  }

  /**
   * 从 quests / claims 只读推导 C5 结局。
   * 结果来源优先级：结局记录行(kind:'ending' + resolved) → 终局委托行 → 收据 → 孤立 C5 旗标行。
   * @returns {{resolved:boolean, approach:(string|null), source:(string|null), at:(string|null), c4:boolean, flags:string[]}}
   */
  function resolveFrom(quests, claims) {
    var rows = questRowsOf(quests);
    var claimRows = claimRowsOf(claims);
    var flags = [];
    var markers = [];
    var commissionRows = [];
    var c5Rows = [];

    function addFlag(flag) {
      if (typeof flag !== 'string' || !flag) return;
      if (flags.indexOf(flag) < 0) flags.push(flag);
    }

    rows.forEach(function (row) {
      var rowFlagList = rowFlags(row);
      rowFlagList.forEach(addFlag);
      if (row.status !== 'cleared') return;
      var hasC5 = rowFlagList.indexOf(ENDING_FLAG) >= 0;
      var nodeApproach = approachFromCommissionId(row.nodeId);
      var rowApproach = isApproach(row.approach) ? row.approach : nodeApproach;
      var at = stampOf(row.clearedAt) || stampOf(row.updatedAt) || null;
      if (hasC5) c5Rows.push({ approach: rowApproach || null, at: at, nodeId: row.nodeId || null });
      if (hasC5 && rowApproach && row.kind === 'ending' && row.resolved === true) {
        markers.push({ approach: rowApproach, at: at, nodeId: row.nodeId || null });
      }
      if (hasC5 && nodeApproach && rowApproach) {
        commissionRows.push({ approach: rowApproach, at: at, nodeId: row.nodeId || null });
      }
    });

    var claimCandidates = [];
    claimRows.forEach(function (claimRow) {
      var receipt = receiptOfClaim(claimRow);
      if (!isObject(receipt)) return;
      var receiptFlags = isArray(receipt.flags) ? receipt.flags : [];
      receiptFlags.forEach(addFlag);
      var claimApproach = approachFromCommissionId(receipt.commissionId);
      if (receiptFlags.indexOf(ENDING_FLAG) >= 0 && claimApproach) {
        claimCandidates.push({
          approach: claimApproach,
          at: stampOf(receipt.claimedAt) || stampOf(claimRow.claimedAt) || null,
          receiptId: receipt.receiptId || null,
        });
      }
    });

    var resolved = false;
    var approach = null;
    var source = null;
    var at = null;
    var marker = earliest(markers);
    if (marker) {
      resolved = true;
      approach = marker.approach;
      source = SOURCE_ENDING;
      at = marker.at;
    } else {
      var commissionRow = earliest(commissionRows);
      if (commissionRow) {
        resolved = true;
        approach = commissionRow.approach;
        source = SOURCE_COMMISSION;
        at = commissionRow.at;
      } else {
        var claimCandidate = earliest(claimCandidates);
        if (claimCandidate) {
          resolved = true;
          approach = claimCandidate.approach;
          source = SOURCE_CLAIM;
          at = claimCandidate.at;
        } else if (c5Rows.length) {
          resolved = true;
          approach = c5Rows[0].approach;
          source = SOURCE_FLAG;
          at = c5Rows[0].at;
        }
      }
    }

    return {
      resolved: resolved,
      approach: approach,
      source: source,
      at: at,
      c4: flags.indexOf(C4_FLAG) >= 0,
      flags: flags.slice().sort(),
    };
  }

  /** 把 canStart 的 ctx 归一成 {quests, claims, extraFlags, c4Hint}。 */
  function contextParts(ctx) {
    var parts = { quests: [], claims: [], extraFlags: [], c4Hint: null };
    if (isArray(ctx)) {
      parts.quests = ctx.filter(isObject);
      return parts;
    }
    if (!isObject(ctx)) return parts;
    var looksLikeState =
      hasOwn(ctx, 'quests') || hasOwn(ctx, 'byNode') || hasOwn(ctx, 'claims') || hasOwn(ctx, 'receipts') || hasOwn(ctx, 'profile') || hasOwn(ctx, 'flags');
    if (!looksLikeState) {
      /* 直接传 byNode 映射（nodeId → row）。 */
      parts.quests = valuesOf(ctx);
      return parts;
    }
    parts.quests = questRowsOf(ctx);
    parts.claims = claimRowsOf(ctx.claims !== undefined ? ctx.claims : ctx.receipts);
    if (isObject(ctx.profile) && isArray(ctx.profile.flags)) {
      ctx.profile.flags.forEach(function (flag) {
        if (typeof flag === 'string' && flag) parts.extraFlags.push(flag);
      });
    }
    if (isArray(ctx.flags)) {
      ctx.flags.forEach(function (flag) {
        if (typeof flag === 'string' && flag) parts.extraFlags.push(flag);
      });
    }
    if (typeof ctx.c4 === 'boolean') parts.c4Hint = ctx.c4;
    return parts;
  }

  function viewFromContext(ctx) {
    var parts = contextParts(ctx);
    var view = resolveFrom(parts.quests, parts.claims);
    if (parts.extraFlags.length) {
      var flags = unionList(view.flags, parts.extraFlags);
      view.flags = flags.slice().sort();
      if (flags.indexOf(C4_FLAG) >= 0) view.c4 = true;
    }
    if (parts.c4Hint === true) view.c4 = true;
    return view;
  }

  /* ------------------------------------------------------------------ *
   * 工厂
   * ------------------------------------------------------------------ */

  function createEndingReducer(options) {
    var opts = isObject(options) ? options : {};

    var injectedDb = opts.db !== undefined ? opts.db : null;
    var injectedCommission = opts.commission !== undefined ? opts.commission : null;
    var injectedFactory = isFunction(opts.commissionFactory) ? opts.commissionFactory : null;
    var injectedStorage = opts.storage;
    var injectedNow = isFunction(opts.now) ? opts.now : null;

    var state = {
      configured: false,
      /* 内容层（三份 ending + campaign）已校验通过；即使 commission-core 还没装载，
         只读推导（endingOf/epilogue/canStart）与运行期补建实例都以此为准。 */
      contentReady: false,
      instance: null,
      campaign: null,
      views: [],
      byApproach: Object.create(null),
      rows: [],
      errors: [],
      warnings: [],
      tickets: Object.create(null),
      ticketApproach: Object.create(null),
      lastStart: null,
      lastSettle: null,
    };

    /* ---------------- 依赖解析 ---------------- */

    function nowIso() {
      if (injectedNow) {
        try {
          var value = injectedNow();
          if (typeof value === 'string' && value) return value;
        } catch (err) {
          /* 落到系统时间 */
        }
      }
      return new Date().toISOString();
    }

    function resolveDb() {
      if (injectedDb) return injectedDb;
      if (root && root.ArcadeCareer && root.ArcadeCareer.db) return root.ArcadeCareer.db;
      return null;
    }

    function commissionModule() {
      if (injectedCommission) return injectedCommission;
      if (isNode && typeof require === 'function') {
        try {
          return require('./commission-core.js');
        } catch (err) {
          return null;
        }
      }
      if (root && root.ArcadeCareerCommission) return root.ArcadeCareerCommission;
      if (root && root.ArcadeCareer && root.ArcadeCareer.commission) return root.ArcadeCareer.commission;
      return null;
    }

    /**
     * 独立 commission-core 实例（绝不使用 96 告示板的全局单例内容）。
     * 注入顺序：commissionFactory > commission（工厂/实例/模块）> 模块 createCommissionCore。
     */
    function createInstance() {
      var db = resolveDb();
      var base = { db: db, storage: injectedStorage, now: injectedNow || undefined };
      if (injectedFactory) {
        try {
          var made = injectedFactory(base);
          if (made && isFunction(made.configure)) return made;
        } catch (err) {
          return null;
        }
      }
      var injected = injectedCommission;
      if (injected) {
        if (isFunction(injected)) {
          try {
            var direct = injected(base);
            if (direct && isFunction(direct.configure)) return direct;
          } catch (err) {
            return null;
          }
        }
        if (isFunction(injected.createCommissionCore)) {
          try {
            var built = injected.createCommissionCore(base);
            if (built && isFunction(built.configure)) return built;
          } catch (err) {
            return null;
          }
        }
        if (isFunction(injected.configure) && isFunction(injected.start)) return injected;
      }
      var mod = commissionModule();
      if (!mod) return null;
      if (isFunction(mod.createCommissionCore)) {
        try {
          var instance = mod.createCommissionCore(base);
          if (instance && isFunction(instance.configure)) return instance;
        } catch (err) {
          /* 建不出独立实例：返回 null。绝不退回全局单例——那会把 ending 行
             写进 96 告示板共用的 commission-core 内容，破坏隔离。 */
        }
        return null;
      }
      if (isFunction(mod.configure) && isFunction(mod.start)) return mod;
      return null;
    }

    /** 内容已就绪但 configure 时 commission-core 还没装载（脚本顺序/懒装载）→ 运行期补建一次。 */
    function ensureInstance() {
      if (state.instance && state.configured) return state.instance;
      if (!state.contentReady || !isArray(state.rows) || state.rows.length !== APPROACHES.length) return null;
      var instance = createInstance();
      if (!instance) return null;
      if (isFunction(instance.reset)) {
        try {
          instance.reset();
        } catch (err) {
          /* 忽略 */
        }
      }
      var result = instance.configure(clone(state.rows));
      if (!result || result.ok !== true) return null;
      var normalized = isFunction(instance.getCommissions) ? instance.getCommissions() : [];
      if (!isArray(normalized) || normalized.length !== state.rows.length) return null;
      state.instance = instance;
      state.configured = true;
      state.errors = state.errors.filter(function (code) {
        return code.indexOf('commission-') !== 0 && code !== REASONS.commissionUnavailable;
      });
      return instance;
    }

    /* ---------------- 公开方法：configure ---------------- */

    function configure(input) {
      var errors = [];
      var warnings = [];
      try {
        /* 任何一次 reconfigure 都先让运行期状态失效：内容校验没通过前不允许沿用旧内容。 */
        state.configured = false;
        state.contentReady = false;
        var source = isArray(input) ? { endings: input } : isObject(input) ? input : null;
        if (!source) {
          state.errors = ['endings-missing'];
          return { ok: false, endings: [], rows: [], contentReady: false, errors: ['endings-missing'], warnings: [], count: 0 };
        }
        if (hasOwn(source, 'db')) injectedDb = source.db;
        if (hasOwn(source, 'commission')) injectedCommission = source.commission;
        if (hasOwn(source, 'commissionFactory') && isFunction(source.commissionFactory)) injectedFactory = source.commissionFactory;
        if (hasOwn(source, 'storage')) injectedStorage = source.storage;
        if (hasOwn(source, 'now') && isFunction(source.now)) injectedNow = source.now;

        var campaignView = normalizeCampaign(source.campaign, errors, warnings);
        var collected = collectEndingSources(source.endings);
        collected.unknownKeys.forEach(function (key) {
          errors.push('ending-source-unknown:' + key);
        });
        if (!collected.list.length && !errors.length) errors.push('endings-missing');

        var views = [];
        var seenApproach = Object.create(null);
        var seenId = Object.create(null);
        collected.list.forEach(function (raw) {
          var view = normalizeEnding(raw, campaignView, errors, warnings);
          if (!view) return;
          if (seenApproach[view.approach]) {
            errors.push('ending-approach-duplicate:' + view.approach);
            return;
          }
          if (seenId[view.commissionId]) {
            errors.push('ending-id-duplicate:' + view.commissionId);
            return;
          }
          seenApproach[view.approach] = true;
          seenId[view.commissionId] = true;
          views.push(view);
        });
        APPROACHES.forEach(function (approach) {
          if (!seenApproach[approach]) errors.push('ending-incomplete:' + approach);
        });
        views.sort(function (a, b) {
          return approachOrder(a.approach) - approachOrder(b.approach);
        });

        state.campaign = campaignView;
        state.views = views;
        state.byApproach = Object.create(null);
        views.forEach(function (view) {
          state.byApproach[view.approach] = view;
        });
        state.rows = views.map(function (view) {
          return clone(view.row);
        });
        state.errors = errors.slice();
        state.warnings = warnings.slice();
        state.configured = false;
        state.contentReady = false;
        state.tickets = Object.create(null);
        state.ticketApproach = Object.create(null);
        state.lastStart = null;
        state.lastSettle = null;

        if (errors.length) {
          if (state.instance && isFunction(state.instance.reset)) {
            try {
              state.instance.reset();
            } catch (err) {
              /* 忽略 */
            }
          }
          return {
            ok: false,
            endings: views.map(publicEndingView),
            rows: clone(state.rows) || [],
            contentReady: false,
            errors: errors.slice(),
            warnings: warnings.slice(),
            count: views.length,
          };
        }

        /* 内容层已通过：从这里开始即使 commission-core 缺席，只读推导仍然可用，
           运行期还会由 ensureInstance() 再尝试补建独立实例。 */
        state.contentReady = true;
        var instance = createInstance();
        if (!instance) {
          errors.push(REASONS.commissionUnavailable);
          state.instance = null;
          return {
            ok: false,
            endings: views.map(publicEndingView),
            rows: clone(state.rows) || [],
            contentReady: true,
            errors: errors.slice(),
            warnings: warnings.slice(),
            count: views.length,
          };
        }
        if (isFunction(instance.reset)) {
          try {
            instance.reset();
          } catch (err) {
            /* 忽略 */
          }
        }
        var result = instance.configure(state.rows);
        if (!result || result.ok !== true) {
          var detail = result && isArray(result.errors) && result.errors.length ? result.errors.join(',') : 'unknown';
          errors.push('commission-configure-failed:' + detail);
        } else {
          var normalized = isFunction(instance.getCommissions) ? instance.getCommissions() : [];
          if (!isArray(normalized) || normalized.length !== state.rows.length) {
            errors.push('commission-row-mismatch:' + String(isArray(normalized) ? normalized.length : -1));
          } else {
            var ids = Object.create(null);
            normalized.forEach(function (row) {
              if (isObject(row) && typeof row.commissionId === 'string') ids[row.commissionId] = true;
            });
            state.rows.forEach(function (row) {
              if (!ids[row.commissionId]) errors.push('commission-row-missing:' + row.commissionId);
            });
          }
        }
        state.instance = instance;
        state.configured = errors.length === 0;
        return {
          ok: state.configured,
          endings: views.map(publicEndingView),
          rows: clone(state.rows) || [],
          contentReady: true,
          errors: errors.slice(),
          warnings: warnings.slice(),
          count: views.length,
        };
      } catch (err) {
        state.configured = false;
        state.contentReady = false;
        return {
          ok: false,
          endings: [],
          rows: [],
          contentReady: false,
          errors: errors.concat([REASONS.exception + ':' + errorText(err)]),
          warnings: warnings.slice(),
          count: 0,
        };
      }
    }

    function publicEndingView(view) {
      return {
        approach: view.approach,
        commissionId: view.commissionId,
        gameId: view.gameId,
        title: view.title,
        summary: view.summary,
        epilogueText: view.epilogueText,
        flags: view.flags.slice(),
        objective: clone(view.objective),
        startParams: clone(view.startParams),
        row: clone(view.row),
      };
    }

    /* ---------------- DB 读取（全部结构化失败，绝不抛） ---------------- */

    async function readQuests(db, careerId) {
      if (!db || !isFunction(db.readQuestState)) return { ok: false, reason: REASONS.dbUnavailable, rows: [] };
      try {
        var result = await db.readQuestState(careerId);
        if (!result || result.ok === false) {
          return { ok: false, reason: (result && result.reason) || 'db-read-failed', rows: [], error: (result && result.error) || null };
        }
        var rows = questRowsOf(result);
        return { ok: true, rows: rows, byNode: isObject(result.byNode) ? result.byNode : null };
      } catch (err) {
        return { ok: false, reason: 'db-read-failed', rows: [], error: errorText(err) };
      }
    }

    async function readProfile(db, careerId) {
      if (!db || !isFunction(db.getProfile)) return { ok: true, profile: null };
      try {
        var profile = await db.getProfile(careerId);
        return { ok: true, profile: isObject(profile) ? profile : null };
      } catch (err) {
        return { ok: false, reason: 'db-read-failed', error: errorText(err) };
      }
    }

    async function readRun(db, instance, ticketId) {
      if (db && isFunction(db.getRun)) {
        try {
          var run = await db.getRun(ticketId);
          return { ok: true, run: isObject(run) ? run : null };
        } catch (err) {
          return { ok: false, reason: 'db-read-failed', error: errorText(err) };
        }
      }
      if (instance && isFunction(instance.getState)) {
        try {
          var snapshot = instance.getState(ticketId);
          return { ok: true, run: snapshot && isObject(snapshot.run) ? snapshot.run : null };
        } catch (err) {
          return { ok: true, run: null };
        }
      }
      return { ok: true, run: null };
    }

    async function readClaim(db, ticketId) {
      if (!db || !isFunction(db.getClaim)) return null;
      try {
        var row = await db.getClaim(ticketId);
        return isObject(row) ? row : null;
      } catch (err) {
        return null;
      }
    }

    async function readLedger(db, careerId) {
      if (!db || !isFunction(db.readLedger)) return null;
      try {
        var result = await db.readLedger(careerId, 200);
        if (isArray(result)) return result.filter(isObject);
        if (isObject(result) && isArray(result.entries)) return result.entries.filter(isObject);
        if (isObject(result) && isArray(result.ledger)) return result.ledger.filter(isObject);
        return null;
      } catch (err) {
        return null;
      }
    }

    async function resolveCareerId(db, requested) {
      if (requested !== undefined && requested !== null) {
        if (!isCareerId(requested)) return { ok: false, reason: REASONS.badCareerId, careerId: null };
        return { ok: true, careerId: requested };
      }
      if (!db || !isFunction(db.getState)) return { ok: false, reason: REASONS.noCareer, careerId: null };
      try {
        var pointer = await db.getState('career');
        var pointerId = pointer && isObject(pointer.value) ? pointer.value.careerId : pointer && pointer.careerId;
        if (isCareerId(pointerId)) return { ok: true, careerId: pointerId };
        return { ok: false, reason: REASONS.noCareer, careerId: null };
      } catch (err) {
        return { ok: false, reason: REASONS.dbReadFailed, careerId: null, error: errorText(err) };
      }
    }

    function approachOfRun(run, ticketId) {
      if (!isObject(run)) return null;
      if (typeof run.mode === 'string' && run.mode && run.mode !== 'commission') return null;
      var approach = approachFromCommissionId(run.commissionId);
      if (approach) return approach;
      var fallback = state.ticketApproach[ticketId];
      return isApproach(fallback) ? fallback : null;
    }

    /* ---------------- 公开方法：listEndings / canStart ---------------- */

    function listEndings(ctx) {
      try {
        if (!state.contentReady) {
          return failure(REASONS.notConfigured, {
            endings: [],
            errors: state.errors.slice(),
            configured: false,
            contentReady: false,
          });
        }
        var view = ctx === undefined || ctx === null ? null : viewFromContext(ctx);
        var endings = state.views.map(function (entry) {
          var start = view ? evaluateStart(entry.approach, view) : null;
          return {
            approach: entry.approach,
            commissionId: entry.commissionId,
            gameId: entry.gameId,
            title: entry.title,
            summary: entry.summary,
            epilogueText: entry.epilogueText,
            available: start ? start.available : null,
            reason: start ? start.reason : null,
            chosen: view ? view.resolved && view.approach === entry.approach : null,
          };
        });
        return {
          ok: true,
          configured: state.configured,
          contentReady: true,
          careerId: null,
          endings: endings,
          resolved: view ? view.resolved : null,
          resolvedApproach: view ? view.approach : null,
          c4: view ? view.c4 : null,
        };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err), endings: [] });
      }
    }

    function evaluateStart(approach, view) {
      if (!isApproach(approach)) {
        return {
          ok: false,
          available: false,
          approach: approach === undefined ? null : approach,
          reason: REASONS.badApproach,
          allowedApproaches: APPROACHES.slice(),
        };
      }
      if (!state.contentReady) {
        return { ok: false, available: false, approach: approach, reason: REASONS.notConfigured };
      }
      var current = view || viewFromContext(null);
      if (current.resolved) {
        return {
          ok: false,
          available: false,
          approach: approach,
          reason: REASONS.alreadyResolved,
          resolvedApproach: current.approach,
          source: current.source,
          c4: current.c4,
          missingFlag: null,
        };
      }
      if (!current.c4) {
        return {
          ok: false,
          available: false,
          approach: approach,
          reason: REASONS.locked,
          missingFlag: C4_FLAG,
          resolvedApproach: null,
          c4: false,
        };
      }
      return {
        ok: true,
        available: true,
        approach: approach,
        reason: null,
        resolvedApproach: null,
        c4: true,
      };
    }

    /**
     * 纯只读：该生涯当前是否可选这个终局。
     * ctx 支持 {quests, claims, profile, flags}、原始 quest 数组或 byNode 映射。
     */
    function canStart(approach, ctx) {
      try {
        return evaluateStart(approach, viewFromContext(ctx));
      } catch (err) {
        return failure(REASONS.exception, { available: false, approach: approach || null, error: errorText(err) });
      }
    }

    /* ---------------- 公开方法：startEnding ---------------- */

    async function activeEndingFor(db, instance, careerId) {
      var entry = state.tickets[careerId];
      if (!entry) return null;
      var read = await readRun(db, instance, entry.ticketId);
      var run = read.ok ? read.run : null;
      if (!run || !isLiveStatus(run.status)) {
        delete state.tickets[careerId];
        delete state.ticketApproach[entry.ticketId];
        return null;
      }
      var approach = approachOfRun(run, entry.ticketId) || entry.approach;
      return { approach: approach, ticketId: entry.ticketId, run: run };
    }

    async function startEndingSafe(input) {
      var request = isObject(input) ? input : {};
      var approach = request.approach;
      if (!state.contentReady) {
        return failure(state.errors.length ? REASONS.contentInvalid : REASONS.notConfigured, {
          approach: approach === undefined ? null : approach,
          errors: state.errors.slice(),
        });
      }
      if (!isApproach(approach)) {
        return {
          ok: false,
          available: false,
          approach: approach === undefined ? null : approach,
          reason: REASONS.badApproach,
          allowedApproaches: APPROACHES.slice(),
        };
      }

      var db = resolveDb();
      if (!db) return failure(REASONS.dbUnavailable, { approach: approach });
      var instance = ensureInstance();
      if (!instance) {
        return failure(REASONS.commissionUnavailable, { approach: approach, errors: state.errors.slice() });
      }

      var career = await resolveCareerId(db, request.careerId);
      if (!career.ok) return failure(career.reason, { approach: approach, careerId: career.careerId || null });
      var careerId = career.careerId;

      var questState = await readQuests(db, careerId);
      if (!questState.ok) {
        return failure(REASONS.dbReadFailed, { approach: approach, careerId: careerId, detail: questState.reason, error: questState.error || null });
      }
      var profileRead = await readProfile(db, careerId);
      if (!profileRead.ok) {
        return failure(REASONS.dbReadFailed, { approach: approach, careerId: careerId, detail: profileRead.reason, error: profileRead.error || null });
      }
      var view = resolveFrom(questState.rows, null);
      if (profileRead.profile && isArray(profileRead.profile.flags)) {
        var merged = unionList(view.flags, profileRead.profile.flags);
        view.flags = merged.slice().sort();
        if (merged.indexOf(C4_FLAG) >= 0) view.c4 = true;
      }
      var submit = evaluateStart(approach, view);
      if (!submit.ok) {
        if (submit.reason === REASONS.alreadyResolved) submit.careerId = careerId;
        return submit;
      }

      var active = await activeEndingFor(db, instance, careerId);
      if (active && active.approach !== approach) {
        return failure(REASONS.occupied, {
          approach: approach,
          careerId: careerId,
          activeApproach: active.approach,
          ticketId: active.ticketId,
          message: '这一条主线已经在进行中，先把它走完。',
        });
      }

      var started = null;
      try {
        started = await Promise.resolve(instance.start({ careerId: careerId, commissionId: ENDING_PREFIX + approach }));
      } catch (err) {
        started = null;
      }
      if (!started || started.ok !== true || typeof started.ticketId !== 'string') {
        var reason = started && typeof started.reason === 'string' ? started.reason : 'unknown';
        if (reason === 'locked') {
          return failure(REASONS.locked, { approach: approach, careerId: careerId, missingFlag: C4_FLAG, detail: reason });
        }
        if (reason === 'db-unavailable') return failure(REASONS.dbUnavailable, { approach: approach, careerId: careerId, detail: reason });
        if (reason === 'content-unavailable' || reason === 'unsupported-content' || reason === 'missing-commission') {
          return failure(REASONS.contentInvalid, { approach: approach, careerId: careerId, detail: reason });
        }
        if (reason === 'career-unavailable' || reason === 'no-career') return failure(REASONS.noCareer, { approach: approach, careerId: careerId, detail: reason });
        return failure(REASONS.startFailed, {
          approach: approach,
          careerId: careerId,
          detail: reason,
          message: (started && started.message) || null,
        });
      }

      var viewMeta = state.byApproach[approach];
      var ticketId = started.ticketId;
      state.tickets[careerId] = { approach: approach, ticketId: ticketId, at: nowIso() };
      state.ticketApproach[ticketId] = approach;
      var url = typeof started.url === 'string' && started.url
        ? started.url
        : '../games/' + viewMeta.gameId + '.html?career=' + encodeURIComponent(ticketId);
      var outcome = {
        ok: true,
        approach: approach,
        commissionId: viewMeta.commissionId,
        gameId: viewMeta.gameId,
        careerId: careerId,
        ticketId: ticketId,
        url: url,
        title: viewMeta.title,
        startParams: clone(viewMeta.startParams),
        reused: started.reused === true,
      };
      state.lastStart = clone(outcome);
      return outcome;
    }

    function startEnding(input) {
      return guardAsync('start-ending', startEndingSafe(input));
    }

    /* ---------------- 公开方法：settleEnding ---------------- */

    function mapSettleFailure(result, context) {
      var reason = result && typeof result.reason === 'string' ? result.reason : 'unknown';
      var base = {
        approach: context.approach || null,
        careerId: context.careerId || null,
        settleReason: reason,
        duplicate: false,
        wrote: false,
        message: (result && result.message) || null,
      };
      if (reason === 'run-failed' || reason === 'abandoned' || reason === 'settled') {
        return failure(REASONS.runFailed, Object.assign({ runFailed: true, retryable: true, flagWritten: false }, base));
      }
      if (reason === 'no-run') {
        return failure(REASONS.noRun, Object.assign({ retryable: true, flagWritten: false }, base));
      }
      if (reason === 'db-unavailable') {
        return failure(REASONS.dbUnavailable, Object.assign({ retryable: true, flagWritten: false }, base));
      }
      if (reason === 'content-unavailable' || reason === 'unsupported-content' || reason === 'missing-commission') {
        return failure(REASONS.contentInvalid, Object.assign({ retryable: false, flagWritten: false }, base));
      }
      if (reason === 'objective-not-met' || reason === 'context-mismatch' || reason === 'value-not-met') {
        return failure(REASONS.notCleared, Object.assign({
          runFailed: true,
          retryable: true,
          flagWritten: false,
          observed: result && Number.isFinite(Number(result.observed)) ? Math.floor(Number(result.observed)) : null,
          objective: result && isObject(result.objective) ? clone(result.objective) : null,
        }, base));
      }
      if (reason === 'game-mismatch' || reason === 'mode-not-allowed' || reason === 'plan-failed' || reason === 'claim-failed') {
        return failure(REASONS.notCleared, Object.assign({ runFailed: false, retryable: true, flagWritten: false }, base));
      }
      return failure(REASONS.settleFailed, Object.assign({ retryable: true, flagWritten: false }, base));
    }

    function questRow(rows, nodeId) {
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (isObject(row) && row.nodeId === nodeId) return row;
      }
      return null;
    }

    /**
     * 结算一条终局 ticket，并在成功时**一次性**写 C5 旗标 + ending.<approach> 结局记录。
     *
     * 两条真实路径：
     * 1) 游戏页已经用自己的 commission-core 结算过（bridge 的常规路径）→ 这里再次
     *    settle 会得到 duplicate + 原收据，然后补写（幂等）旗标行；
     * 2) 调用方在本实例里记录过事件后直接结算 → settle 正常发（0 信用点）并写旗标行。
     * 若 run 还活着且没有任何事件，commission-core 会按“目标未达成”把它标成 failed：
     * 这不写 C5，玩家可以重新 startEnding 再打一次（可重试）。
     */
    async function settleEndingSafe(input) {
      var request = isObject(input) ? input : {};
      var ticketId = typeof request.ticketId === 'string' ? request.ticketId : '';
      if (!state.contentReady) {
        return failure(state.errors.length ? REASONS.contentInvalid : REASONS.notConfigured, { ticketId: ticketId || null });
      }
      if (!isRunId(ticketId)) return failure(REASONS.badTicket, { ticketId: ticketId || null });
      var db = resolveDb();
      if (!db) return failure(REASONS.dbUnavailable, { ticketId: ticketId });
      var instance = ensureInstance();
      if (!instance) return failure(REASONS.commissionUnavailable, { ticketId: ticketId, errors: state.errors.slice() });

      var runRead = await readRun(db, instance, ticketId);
      if (!runRead.ok) return failure(REASONS.dbReadFailed, { ticketId: ticketId, detail: runRead.reason });
      var run = runRead.run;
      if (!run) return failure(REASONS.noRun, { ticketId: ticketId });
      var careerId = isCareerId(run.careerId) ? run.careerId : null;
      if (!careerId) return failure(REASONS.noRun, { ticketId: ticketId, runId: run.runId || null });
      var approach = approachOfRun(run, ticketId);
      if (!approach) {
        return failure(REASONS.notAnEnding, {
          ticketId: ticketId,
          careerId: careerId,
          commissionId: typeof run.commissionId === 'string' ? run.commissionId : null,
        });
      }

      var questState = await readQuests(db, careerId);
      if (!questState.ok) {
        return failure(REASONS.dbReadFailed, { ticketId: ticketId, careerId: careerId, detail: questState.reason, error: questState.error || null });
      }
      var before = resolveFrom(questState.rows, null);
      if (before.resolved && before.approach && before.approach !== approach) {
        return failure(REASONS.alreadyResolved, {
          ticketId: ticketId,
          careerId: careerId,
          approach: approach,
          resolvedApproach: before.approach,
          source: before.source,
          settled: false,
          wrote: false,
          duplicate: false,
          receipt: null,
          message: '这条主线已经用另一种方式走完了；港口只会留下一个结局。',
        });
      }
      if (before.resolved && before.approach === approach && before.source === SOURCE_ENDING) {
        var existingClaim = await readClaim(db, ticketId);
        delete state.tickets[careerId];
        delete state.ticketApproach[ticketId];
        return {
          ok: true,
          duplicate: true,
          wrote: false,
          settled: true,
          approach: approach,
          careerId: careerId,
          ticketId: ticketId,
          receipt: existingClaim,
          credits: 0,
          flagsWritten: [],
          resolvedApproach: approach,
        };
      }

      var settled = null;
      try {
        var settleInput = { ticketId: ticketId };
        if (typeof request.outcome === 'string' && request.outcome) settleInput.outcome = request.outcome;
        if (isObject(request.stats)) settleInput.stats = request.stats;
        settled = await Promise.resolve(instance.settle(settleInput));
      } catch (err) {
        settled = null;
      }
      if (!settled || settled.ok !== true) {
        return mapSettleFailure(settled, { approach: approach, careerId: careerId });
      }
      var receipt = isObject(settled.receipt) ? clone(settled.receipt) : null;
      if (!receipt) {
        return failure(REASONS.receiptUnavailable, { ticketId: ticketId, careerId: careerId, approach: approach, settled: true, retryable: true, flagWritten: false });
      }
      if (typeof receipt.commissionId === 'string' && typeof run.commissionId === 'string' && receipt.commissionId !== run.commissionId) {
        return failure(REASONS.receiptMismatch, { ticketId: ticketId, careerId: careerId, approach: approach, settled: true, retryable: false, flagWritten: false });
      }
      if (nonNegInt(receipt.credits, 0) > 0) {
        return failure(REASONS.economyViolation, {
          ticketId: ticketId,
          careerId: careerId,
          approach: approach,
          settled: true,
          retryable: false,
          flagWritten: false,
          credits: nonNegInt(receipt.credits, 0),
          receipt: receipt,
        });
      }
      if (!isArray(receipt.flags) || receipt.flags.indexOf(ENDING_FLAG) < 0) {
        return failure(REASONS.receiptMissingFlag, {
          ticketId: ticketId,
          careerId: careerId,
          approach: approach,
          settled: true,
          retryable: true,
          flagWritten: false,
          receipt: receipt,
        });
      }
      var ledger = await readLedger(db, careerId);
      if (isArray(ledger) && ledger.length) {
        var creditSteps = ledger.filter(function (row) {
          if (!isObject(row)) return false;
          if (row.runId !== ticketId) return false;
          return nonNegInt(row.credits, 0) > 0;
        });
        if (creditSteps.length) {
          return failure(REASONS.economyViolation, {
            ticketId: ticketId,
            careerId: careerId,
            approach: approach,
            settled: true,
            retryable: false,
            flagWritten: false,
            credits: creditSteps.reduce(function (sum, row) {
              return sum + nonNegInt(row.credits, 0);
            }, 0),
            ledgerRows: creditSteps.length,
            receipt: receipt,
          });
        }
      }

      /* 并发安全：结算可能在本页之外完成，重新读一次 quests 再决定写不写。 */
      var afterState = await readQuests(db, careerId);
      var afterRows = afterState.ok ? afterState.rows : questState.rows;
      var after = resolveFrom(afterRows, null);
      if (after.resolved && after.approach && after.approach !== approach) {
        return failure(REASONS.alreadyResolved, {
          ticketId: ticketId,
          careerId: careerId,
          approach: approach,
          resolvedApproach: after.approach,
          source: after.source,
          settled: true,
          wrote: false,
          receipt: receipt,
          flagWritten: false,
        });
      }
      if (after.resolved && after.approach === approach && after.source === SOURCE_ENDING) {
        delete state.tickets[careerId];
        delete state.ticketApproach[ticketId];
        return {
          ok: true,
          duplicate: true,
          wrote: false,
          settled: true,
          approach: approach,
          careerId: careerId,
          ticketId: ticketId,
          receipt: receipt,
          credits: 0,
          flagsWritten: [],
          resolvedApproach: approach,
        };
      }

      var at = typeof receipt.claimedAt === 'string' && receipt.claimedAt ? receipt.claimedAt : nowIso();
      var receiptId = typeof receipt.receiptId === 'string' && receipt.receiptId ? receipt.receiptId : ticketId;
      var markerId = ENDING_PREFIX + approach;
      var previousMarker = questRow(afterRows, markerId);
      var flags = unionList([ENDING_FLAG, markerId], previousMarker && previousMarker.flags);
      var evidence = unionList(isArray(receipt.evidence) ? receipt.evidence : [], previousMarker && previousMarker.evidence);
      var flagRow = {
        careerId: careerId,
        nodeId: 'story:' + ENDING_FLAG,
        kind: 'story-flag',
        status: 'cleared',
        flag: ENDING_FLAG,
        flags: [ENDING_FLAG],
        chapter: CHAPTER,
        approach: approach,
        sourceReceipt: receiptId,
        receiptId: receiptId,
        clearedAt: at,
        updatedAt: at,
        schemaVersion: SCHEMA_VERSION,
      };
      var markerRow = {
        careerId: careerId,
        nodeId: markerId,
        kind: 'ending',
        status: 'cleared',
        approach: approach,
        commissionId: markerId,
        chapter: CHAPTER,
        flags: flags,
        evidence: evidence,
        receiptId: receiptId,
        sourceReceipt: receiptId,
        resolved: true,
        clearedAt: at,
        updatedAt: at,
        schemaVersion: SCHEMA_VERSION,
      };

      if (!isFunction(db.putQuests)) {
        return failure(REASONS.dbUnavailable, { ticketId: ticketId, careerId: careerId, approach: approach, settled: true, retryable: true, flagWritten: false, receipt: receipt });
      }
      var written = null;
      try {
        written = await db.putQuests(careerId, [flagRow, markerRow]);
      } catch (err) {
        written = { ok: false, error: errorText(err) };
      }
      if (!written || written.ok === false) {
        return failure(REASONS.questWriteFailed, {
          ticketId: ticketId,
          careerId: careerId,
          approach: approach,
          settled: true,
          retryable: true,
          flagWritten: false,
          receipt: receipt,
          detail: (written && (written.reason || written.error)) || null,
        });
      }

      delete state.tickets[careerId];
      delete state.ticketApproach[ticketId];
      var outcome = {
        ok: true,
        duplicate: settled.duplicate === true,
        wrote: true,
        settled: true,
        approach: approach,
        careerId: careerId,
        ticketId: ticketId,
        receipt: receipt,
        credits: 0,
        flagsWritten: [ENDING_FLAG, markerId],
        resolvedApproach: approach,
        questRows: 2,
        writtenAt: at,
      };
      state.lastSettle = clone({
        ticketId: ticketId,
        careerId: careerId,
        approach: approach,
        duplicate: outcome.duplicate,
        at: at,
      });
      return outcome;
    }

    function settleEnding(input) {
      return guardAsync('settle-ending', settleEndingSafe(input));
    }

    /* ---------------- 公开方法：abandonEnding ---------------- */

    async function abandonEndingSafe(input) {
      var request = isObject(input) ? input : {};
      var ticketId = typeof request.ticketId === 'string' ? request.ticketId : '';
      if (!state.contentReady) {
        return failure(state.errors.length ? REASONS.contentInvalid : REASONS.notConfigured, { ticketId: ticketId || null });
      }
      if (!isRunId(ticketId)) return failure(REASONS.badTicket, { ticketId: ticketId || null });
      var db = resolveDb();
      if (!db) return failure(REASONS.dbUnavailable, { ticketId: ticketId });
      var instance = ensureInstance();
      if (!instance) return failure(REASONS.commissionUnavailable, { ticketId: ticketId, errors: state.errors.slice() });
      var runRead = await readRun(db, instance, ticketId);
      if (!runRead.ok) return failure(REASONS.dbReadFailed, { ticketId: ticketId, detail: runRead.reason });
      var run = runRead.run;
      if (!run) return failure(REASONS.noRun, { ticketId: ticketId });
      var careerId = isCareerId(run.careerId) ? run.careerId : null;
      var approach = approachOfRun(run, ticketId);
      if (!approach) return failure(REASONS.notAnEnding, { ticketId: ticketId, careerId: careerId });
      if (isSettledStatus(run.status)) {
        return failure(REASONS.alreadySettled, { ticketId: ticketId, careerId: careerId, approach: approach, flagWritten: false });
      }
      var abandoned = null;
      try {
        abandoned = await Promise.resolve(instance.abandon(ticketId));
      } catch (err) {
        abandoned = null;
      }
      if (!abandoned || abandoned.ok !== true) {
        return failure(REASONS.settleFailed, {
          ticketId: ticketId,
          careerId: careerId,
          approach: approach,
          retryable: true,
          flagWritten: false,
          detail: (abandoned && abandoned.reason) || null,
        });
      }
      if (careerId) delete state.tickets[careerId];
      delete state.ticketApproach[ticketId];
      return {
        ok: true,
        abandoned: true,
        duplicate: abandoned.duplicate === true,
        ticketId: ticketId,
        careerId: careerId,
        approach: approach,
        flagWritten: false,
        credits: 0,
      };
    }

    function abandonEnding(input) {
      return guardAsync('abandon-ending', abandonEndingSafe(input));
    }

    /* ---------------- 公开方法：endingOf / epilogueFor ---------------- */

    function endingOf(input, second) {
      try {
        var quests = input;
        var claims = second;
        if (arguments.length < 2 && isObject(input) && (hasOwn(input, 'quests') || hasOwn(input, 'byNode') || hasOwn(input, 'claims') || hasOwn(input, 'receipts'))) {
          quests = hasOwn(input, 'quests') ? input.quests : input.byNode || [];
          claims = hasOwn(input, 'claims') ? input.claims : input.receipts;
        }
        var view = resolveFrom(quests, claims);
        var chosen = view.approach && state.byApproach[view.approach] ? state.byApproach[view.approach] : null;
        var epilogueText = '';
        /* 后日常以 campaign 为权威文本；ending 文件里的 epilogueText 只是兜底。 */
        if (view.approach && state.campaign && state.campaign.texts[view.approach]) epilogueText = state.campaign.texts[view.approach];
        else if (chosen && chosen.epilogueText) epilogueText = chosen.epilogueText;
        var base = state.campaign ? state.campaign.base : '';
        var endings = APPROACHES.map(function (approach) {
          var entry = state.byApproach[approach];
          return {
            approach: approach,
            title: entry ? entry.title : null,
            chosen: view.resolved && view.approach === approach,
            epilogueText: state.campaign && state.campaign.texts[approach] ? state.campaign.texts[approach] : entry ? entry.epilogueText : '',
          };
        });
        return {
          ok: true,
          resolved: view.resolved,
          approach: view.approach,
          resolvedApproach: view.approach,
          flag: view.resolved ? ENDING_FLAG : null,
          source: view.source,
          at: view.at,
          c4: view.c4,
          flags: view.flags.slice(),
          title: chosen ? chosen.title : null,
          summary: chosen ? chosen.summary : null,
          epilogue: { base: base, text: epilogueText, approach: view.approach },
          endings: endings,
        };
      } catch (err) {
        return failure(REASONS.exception, {
          error: errorText(err),
          resolved: false,
          approach: null,
          resolvedApproach: null,
          flag: null,
          source: null,
          at: null,
          c4: false,
          flags: [],
          title: null,
          summary: null,
          epilogue: { base: '', text: '', approach: null },
          endings: [],
        });
      }
    }

    function epilogueFor(approach) {
      try {
        if (!isApproach(approach)) {
          return failure(REASONS.badApproach, { approach: approach === undefined ? null : approach, allowedApproaches: APPROACHES.slice() });
        }
        if (!state.campaign) {
          return failure(REASONS.notConfigured, { approach: approach, epilogue: { base: '', text: '', approach: approach } });
        }
        var entry = state.byApproach[approach];
        var campaignText = state.campaign.texts[approach] || '';
        var text = campaignText || (entry ? entry.epilogueText : '');
        return {
          ok: true,
          approach: approach,
          title: entry ? entry.title : state.campaign.titles[approach] || null,
          summary: entry ? entry.summary : state.campaign.summaries[approach] || null,
          base: state.campaign.base,
          text: text,
          source: campaignText ? 'campaign' : 'ending',
          epilogue: { base: state.campaign.base, text: text, approach: approach },
        };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err), approach: approach === undefined ? null : approach });
      }
    }

    /* ---------------- 诊断 / 重置 ---------------- */

    function getState() {
      try {
        return {
          version: VERSION,
          contentVersion: CONTENT_VERSION,
          configured: state.configured,
          contentReady: state.contentReady,
          endings: state.views.map(function (view) {
            return {
              approach: view.approach,
              commissionId: view.commissionId,
              gameId: view.gameId,
              title: view.title,
              flags: view.flags.slice(),
            };
          }),
          errors: state.errors.slice(),
          warnings: state.warnings.slice(),
          tickets: clone(state.tickets) || {},
          lastStart: state.lastStart ? clone(state.lastStart) : null,
          lastSettle: state.lastSettle ? clone(state.lastSettle) : null,
        };
      } catch (err) {
        return { version: VERSION, contentVersion: CONTENT_VERSION, configured: false, contentReady: false, endings: [], errors: [errorText(err)], warnings: [], tickets: {}, lastStart: null, lastSettle: null };
      }
    }

    function getCommission() {
      return state.instance;
    }

    function reset() {
      try {
        if (state.instance && isFunction(state.instance.reset)) state.instance.reset();
        state.configured = false;
        state.contentReady = false;
        state.instance = null;
        state.campaign = null;
        state.views = [];
        state.byApproach = Object.create(null);
        state.rows = [];
        state.errors = [];
        state.warnings = [];
        state.tickets = Object.create(null);
        state.ticketApproach = Object.create(null);
        state.lastStart = null;
        state.lastSettle = null;
        return { ok: true };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err) });
      }
    }

    function guardAsync(label, value) {
      try {
        return Promise.resolve(value).catch(function (err) {
          return { ok: false, reason: REASONS.exception, error: errorText(err), label: label };
        });
      } catch (err) {
        return Promise.resolve({ ok: false, reason: REASONS.exception, error: errorText(err), label: label });
      }
    }

    /** 把游戏页真实事件写进终局实例的缓冲（bridge 在 ending.* run 时转发）。 */
    function recordEvent(ticketId, event) {
      try {
        if (!state.instance || !state.instance.recordEvent) return false;
        return state.instance.recordEvent(ticketId, event) !== false;
      } catch (err) {
        return false;
      }
    }

    /** 0.18：游戏页新实例接管已落库终局 ticket（事件缓冲跨页恢复）。 */
    function attach(input) {
      try {
        if (!state.instance || typeof state.instance.adoptRun !== 'function') return false;
        var options = isObject(input) ? input : {};
        if (!options.ticketId) return false;
        var ticket = isObject(options.ticket) ? options.ticket : {
          ticketId: options.ticketId,
          runId: options.ticketId,
          commissionId: options.commissionId || null,
          gameId: options.gameId || null,
          careerId: options.careerId || null,
          mode: 'commission',
        };
        var run = isObject(options.run) ? options.run : { ticketId: options.ticketId, runId: options.ticketId, commissionId: ticket.commissionId, gameId: ticket.gameId, careerId: ticket.careerId, status: 'active', mode: 'commission' };
        return state.instance.adoptRun(ticket, run);
      } catch (err) {
        return false;
      }
    }

    var api = {
      VERSION: VERSION,
      MODULE_VERSION: MODULE_VERSION,
      CONTENT_VERSION: CONTENT_VERSION,
      SCHEMA_VERSION: SCHEMA_VERSION,
      APPROACHES: APPROACHES,
      C4_FLAG: C4_FLAG,
      ENDING_FLAG: ENDING_FLAG,
      REASONS: REASONS,
      __endingReducerMounted: true,
      configure: configure,
      listEndings: listEndings,
      canStart: canStart,
      startEnding: startEnding,
      attach: attach,
      recordEvent: recordEvent,
      settleEnding: settleEnding,
      abandonEnding: abandonEnding,
      endingOf: endingOf,
      epilogueFor: epilogueFor,
      getState: getState,
      getCommission: getCommission,
      reset: reset,
    };

    if (isObject(opts) && (opts.endings !== undefined || opts.campaign !== undefined)) {
      configure({ endings: opts.endings, campaign: opts.campaign, db: opts.db, commission: opts.commission, storage: opts.storage, now: opts.now });
    }

    return api;
  }

  /* ------------------------------------------------------------------ *
   * 默认单例（浏览器 window.ArcadeCareerEnding / Node module.exports）
   * ------------------------------------------------------------------ */

  var singleton = createEndingReducer({});
  singleton.createEndingReducer = createEndingReducer;
  return singleton;
});
