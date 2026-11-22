/*!
 * StudioKit Arcade Life — 经济 / 领奖 / 故事谓词纯逻辑（0.15，D15-03）
 *
 * 纯函数、无 DOM、无 IndexedDB、无副作用；浏览器挂到 window.ArcadeCareer.core，
 * Node 中可直接 require() 用于确定性测试。
 *
 * 职责边界（docs/arcade-life/ADR-interfaces.md §5.2 / §7 / §8）：
 * - 只做 clamp 与校验；所有可调数值来自内容（commission.reward 等）与 RULESET；
 * - 不从 score 推算货币（本模块没有分数输入）；
 * - 奖励计划、领奖收据、购买计划都是不可变普通对象，可 JSON 序列化；
 * - IndexedDB 事务与幂等由 career-db.js 负责，本模块绝不写库。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this, true);
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.core = factory(root, false);
})(typeof window !== 'undefined' ? window : globalThis, function (root, isNode) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const RULESET_VERSION = 1;
  const DEFAULT_CONTENT_VERSION = '0.17.0';

  /* ID / token 形状：URL 与 IndexedDB 双端安全，不含冒号（txId 需要能解析 runId）。 */
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  const KIND_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
  const PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;

  const VALID_MODES = Object.freeze(['classic', 'challenge', 'zen', 'commission']);
  const COMMISSION_MODE = 'commission';

  /** 规则集（版本化；内容只覆盖可覆盖的字段，上限永远由这里兜底）。 */
  const RULESET = Object.freeze({
    version: RULESET_VERSION,
    initialCredits: 80,
    payoutCap: 400,
    objectiveBonus: 0,
    masteryBonusByRank: Object.freeze([0, 10, 20, 30]),
    itemCapPerItem: 99,
    itemKindsCap: 8,
    inventoryStackCap: 999,
    evidenceCap: 24,
    flagsCap: 24,
    balanceCap: 1000000,
    maxDigestKinds: 64,
    maxDigestFacets: 128,
    maxTxSteps: 16,
    maxPurchaseCost: 1000000,
  });

  const REASONS = Object.freeze({
    missingCommission: 'missing-commission',
    badCommission: 'bad-commission',
    badObjective: 'bad-objective',
    objectiveNotMet: 'objective-not-met',
    modeNotAllowed: 'mode-not-allowed',
    gameMismatch: 'game-mismatch',
    contextMismatch: 'context-mismatch',
    digestUnavailable: 'digest-unavailable',
    badPlan: 'bad-plan',
    badCredits: 'bad-credits',
    badItems: 'bad-items',
    badEvidence: 'bad-evidence',
    badFlags: 'bad-flags',
    badTxSteps: 'bad-txsteps',
    badCost: 'bad-cost',
    badGrants: 'bad-grants',
    badCostItems: 'bad-cost-items',
    insufficient: 'insufficient',
    insufficientItems: 'insufficient-items',
    valueNotMet: 'value-not-met',
    walletUnavailable: 'wallet-unavailable',
    itemCap: 'item-cap',
    balanceCap: 'balance-cap',
  });

  function nowIso() {
    return new Date().toISOString();
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clampInt(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : min;
    const floored = Math.floor(num);
    if (floored < min) return min;
    if (floored > max) return max;
    return floored;
  }

  function nonNegInt(value, fallback) {
    return clampInt(value, 0, Number.MAX_SAFE_INTEGER, typeof fallback === 'number' ? fallback : 0);
  }

  /** 深拷贝纯 JSON；非法/不可序列化输入返回 null（绝不把异常抛给调用方）。 */
  function deepClone(value) {
    if (value === undefined) return undefined;
    try {
      const text = JSON.stringify(value);
      if (typeof text !== 'string') return null;
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function isValidId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isValidRunId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isValidCareerId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isToken(value) {
    return typeof value === 'string' && TOKEN_RE.test(value);
  }

  function isKind(value) {
    return typeof value === 'string' && KIND_RE.test(value);
  }

  /* ------------------------------------------------------------------ *
   * ID 生成
   * ------------------------------------------------------------------ */

  let fallbackCounter = 0;

  function cryptoRef() {
    try {
      if (root && root.crypto) return root.crypto;
      if (typeof crypto !== 'undefined' && crypto) return crypto;
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function randomToken() {
    const api = cryptoRef();
    if (!api) return null;
    try {
      if (typeof api.randomUUID === 'function') {
        const uuid = String(api.randomUUID());
        const cleaned = uuid.replace(/[^A-Za-z0-9]/g, '');
        if (cleaned.length >= 16) return cleaned;
      }
      if (typeof api.getRandomValues === 'function') {
        const buf = new Uint8Array(16);
        api.getRandomValues(buf);
        let out = '';
        for (let i = 0; i < buf.length; i += 1) out += (buf[i] + 256).toString(16).slice(1);
        if (out.length >= 16) return out;
      }
    } catch (err) {
      /* 隐私模式 / 非安全上下文：落到确定性回退 */
    }
    return null;
  }

  /**
   * 生成稳定前缀 ID（run / career / purchase ...）。
   * crypto.randomUUID 可用时用它；否则确定性回退（时间 + 单调计数），同毫秒也不冲突。
   * @param {string} [prefix]
   * @returns {string}
   */
  function newId(prefix) {
    const safePrefix = typeof prefix === 'string' && PREFIX_RE.test(prefix) ? prefix.toLowerCase() : 'id';
    const token = randomToken();
    if (token) return safePrefix + '-' + token;
    fallbackCounter += 1;
    const time = Date.now().toString(36);
    const count = fallbackCounter.toString(36);
    return safePrefix + '-' + time + '-' + count;
  }

  /* ------------------------------------------------------------------ *
   * 事件摘要
   * ------------------------------------------------------------------ */

  function facetKey(kind, field, value) {
    return kind + '.' + field + '=' + String(value);
  }

  function facetValueOk(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  function emptyDigest() {
    return { schemaVersion: SCHEMA_VERSION, counts: {}, facets: {}, maxima: {}, total: 0 };
  }

  /**
   * 事件摘要：kind → count；payload 里的原始值额外汇总成 facets（供 objective.context 校验）。
   * 未知 / 非法结构被丢弃，绝不抛异常。
   * @param {Array|object} events 事件数组，或 kind→count 映射
   * @returns {{schemaVersion:number, counts:object, facets:object, total:number}}
   */
  function summarizeEvents(events) {
    const digest = emptyDigest();
    const counts = digest.counts;
    const facets = digest.facets;
    let kindCount = 0;
    let facetCount = 0;
    const addCount = (kind, amount) => {
      if (!isKind(kind)) return;
      if (counts[kind] === undefined) {
        if (kindCount >= RULESET.maxDigestKinds) return;
        kindCount += 1;
        counts[kind] = 0;
      }
      counts[kind] += amount;
      digest.total += amount;
    };
    const addFacets = (kind, payload) => {
      if (!isObject(payload)) return;
      const fields = Object.keys(payload);
      for (let i = 0; i < fields.length; i += 1) {
        const field = fields[i];
        const value = payload[field];
        if (!isToken(field) && !KIND_RE.test(field)) continue;
        if (!facetValueOk(value)) continue;
        if (facetCount >= RULESET.maxDigestFacets && facets[facetKey(kind, field, value)] === undefined) continue;
        const key = facetKey(kind, field, value);
        if (facets[key] === undefined) {
          facetCount += 1;
          facets[key] = 0;
        }
        facets[key] += 1;
      }
    };
    /* 0.17：数值型目标的“达到/超过”证据（距离、高度、格子值等），按 kind/field 取最大值。 */
    const addMaxima = (kind, payload) => {
      if (!isObject(payload)) return;
      const fields = Object.keys(payload);
      for (let i = 0; i < fields.length; i += 1) {
        const field = fields[i];
        const value = payload[field];
        if (!isToken(field) && !KIND_RE.test(field)) continue;
        if (!isFiniteNumber(value)) continue;
        const byField = digest.maxima[kind] && isObject(digest.maxima[kind]) ? digest.maxima[kind] : (digest.maxima[kind] = {});
        if (byField[field] === undefined || value > byField[field]) byField[field] = value;
      }
    };
    if (Array.isArray(events)) {
      events.forEach((event) => {
        if (typeof event === 'string') {
          addCount(event, 1);
          return;
        }
        if (!isObject(event)) return;
        const kind = event.kind;
        if (!isKind(kind)) return;
        let amount = 1;
        if (event.count !== undefined) {
          const parsed = Number(event.count);
          if (Number.isFinite(parsed) && parsed > 0) amount = Math.floor(parsed);
        }
        addCount(kind, amount);
        addFacets(kind, event.payload);
        addMaxima(kind, event.payload);
      });
      return digest;
    }
    if (isObject(events)) {
      if (isObject(events.counts)) {
        Object.keys(events.counts).forEach((kind) => {
          const parsed = Number(events.counts[kind]);
          if (Number.isFinite(parsed) && parsed > 0) addCount(kind, Math.floor(parsed));
        });
      } else {
        Object.keys(events).forEach((kind) => {
          const parsed = Number(events[kind]);
          if (Number.isFinite(parsed) && parsed > 0) addCount(kind, Math.floor(parsed));
        });
      }
      if (isObject(events.facets)) {
        Object.keys(events.facets).forEach((key) => {
          const parsed = Number(events.facets[key]);
          if (parsed > 0 && key.indexOf('=') > 0) {
            facets[key] = (facets[key] || 0) + Math.floor(parsed);
            facetCount += 1;
          }
        });
      }
      if (isObject(events.maxima)) {
        Object.keys(events.maxima).forEach((kind) => {
          if (!isKind(kind) || !isObject(events.maxima[kind])) return;
          const fields = Object.keys(events.maxima[kind]);
          fields.forEach((field) => {
            const parsed = Number(events.maxima[kind][field]);
            if (!isFiniteNumber(parsed)) return;
            const byField = digest.maxima[kind] && isObject(digest.maxima[kind]) ? digest.maxima[kind] : (digest.maxima[kind] = {});
            if (byField[field] === undefined || parsed > byField[field]) byField[field] = parsed;
          });
        });
      }
    }
    return digest;
  }

  /** 合并两个摘要（同一局多段事件）。 */
  function combineDigest(a, b) {
    const left = summarizeEvents(a);
    const right = summarizeEvents(b);
    const out = emptyDigest();
    [left, right].forEach((part) => {
      Object.keys(part.counts).forEach((kind) => {
        out.counts[kind] = (out.counts[kind] || 0) + part.counts[kind];
      });
      Object.keys(part.facets).forEach((key) => {
        out.facets[key] = (out.facets[key] || 0) + part.facets[key];
      });
      if (isObject(part.maxima)) {
        Object.keys(part.maxima).forEach((kind) => {
          if (!isObject(part.maxima[kind])) return;
          const byField = out.maxima[kind] && isObject(out.maxima[kind]) ? out.maxima[kind] : (out.maxima[kind] = {});
          Object.keys(part.maxima[kind]).forEach((field) => {
            const value = Number(part.maxima[kind][field]);
            if (!isFiniteNumber(value)) return;
            if (byField[field] === undefined || value > byField[field]) byField[field] = value;
          });
        });
      }
      out.total += part.total;
    });
    return out;
  }

  /** 容错摘要：接受 null / 数组 / kind→count 映射；无法识别时返回空摘要。 */
  function normalizeDigest(raw) {
    if (isObject(raw) && isObject(raw.counts) && isFiniteNumber(raw.total)) {
      return summarizeEvents(raw);
    }
    return summarizeEvents(raw);
  }

  /* ------------------------------------------------------------------ *
   * 委托校验与奖励计划
   * ------------------------------------------------------------------ */

  function sanitizeObjective(raw) {
    if (!isObject(raw)) return null;
    if (!isKind(raw.kind)) return null;
    const atLeast = Number(raw.atLeast);
    const objective = {
      kind: raw.kind,
      atLeast: Number.isFinite(atLeast) && atLeast > 0 ? Math.floor(atLeast) : 1,
      context: isObject(raw.context) ? deepClone(raw.context) : {},
    };
    /* 0.17：达到阈值型目标（距离/高度/格子值/连击等），按 payload 字段最大值判定。 */
    if (isObject(raw.minValue)) {
      const field = raw.minValue.field;
      const value = Number(raw.minValue.value);
      if ((typeof field === 'string' && (isToken(field) || KIND_RE.test(field))) && isFiniteNumber(value)) {
        objective.minValue = { field, value };
      } else {
        return null;
      }
    }
    return objective;
  }

  function contextMatches(objective, digest, ctx) {
    const context = objective.context;
    const keys = Object.keys(context);
    if (!keys.length) return true;
    const stats = isObject(ctx) && isObject(ctx.stats) ? ctx.stats : null;
    for (let i = 0; i < keys.length; i += 1) {
      const field = keys[i];
      const value = context[field];
      if (!facetValueOk(value)) return false;
      if (digest.facets[facetKey(objective.kind, field, value)] > 0) continue;
      if (stats && Object.prototype.hasOwnProperty.call(stats, field) && String(stats[field]) === String(value)) continue;
      return false;
    }
    return true;
  }

  /**
   * 校验委托是否被本局事件满足。
   * @param {object} commission registry.js 规范化后的委托（或内容原始对象）
   * @param {object|Array} digest summarizeEvents 的结果（也接受裸事件数组）
   * @param {{mode?:string, gameId?:string, stats?:object}} [ctx]
   * @returns {{ok:boolean, reason?:string, observed?:number, digest?:object, objective?:object}}
   */
  function validateCommission(commission, digest, ctx) {
    const options = isObject(ctx) ? ctx : {};
    if (!isObject(commission)) return { ok: false, reason: REASONS.missingCommission };
    if (!isToken(commission.commissionId)) return { ok: false, reason: REASONS.badCommission };
    const objective = sanitizeObjective(commission.objective);
    if (!objective) return { ok: false, reason: REASONS.badObjective };
    /* 0.16：委托结算只接受 commission 来源；未声明 mode 时按纯计算处理（dry-run）。 */
    if (options.mode !== undefined && options.mode !== COMMISSION_MODE) {
      return { ok: false, reason: REASONS.modeNotAllowed };
    }
    if (typeof options.gameId === 'string' && options.gameId && typeof commission.gameId === 'string' && commission.gameId) {
      if (options.gameId !== commission.gameId) return { ok: false, reason: REASONS.gameMismatch };
    }
    const summary = normalizeDigest(digest);
    const observed = summary.counts[objective.kind] || 0;
    if (observed < objective.atLeast) {
      return { ok: false, reason: REASONS.objectiveNotMet, observed, digest: summary, objective };
    }
    if (!contextMatches(objective, summary, options)) {
      return { ok: false, reason: REASONS.contextMismatch, observed, digest: summary, objective };
    }
    if (objective.minValue) {
      const byField = summary.maxima && summary.maxima[objective.kind];
      const reached = byField && isFiniteNumber(byField[objective.minValue.field]) ? byField[objective.minValue.field] : null;
      if (reached === null || reached < objective.minValue.value) {
        return { ok: false, reason: REASONS.valueNotMet, observed, reached, digest: summary, objective };
      }
    }
    return { ok: true, observed, digest: summary, objective };
  }

  function normalizeItems(raw) {
    const out = {};
    if (!isObject(raw)) return out;
    const ids = Object.keys(raw);
    for (let i = 0; i < ids.length; i += 1) {
      const itemId = ids[i];
      if (!isToken(itemId)) continue;
      const count = nonNegInt(raw[itemId], 0);
      if (count > 0) out[itemId] = Math.min(count, RULESET.itemCapPerItem);
    }
    return out;
  }

  function normalizeTokens(raw, cap) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (let i = 0; i < raw.length; i += 1) {
      const value = raw[i];
      if (!isToken(value)) continue;
      if (out.indexOf(value) >= 0) continue;
      out.push(value);
      if (out.length >= cap) break;
    }
    return out;
  }

  /** 规范化奖励计划：clamp 到规则上限，永不产生负数。 */
  function normalizePlan(plan) {
    const source = isObject(plan) ? plan : {};
    return {
      credits: clampInt(source.credits, 0, RULESET.payoutCap, 0),
      items: normalizeItems(source.items),
      evidence: normalizeTokens(source.evidence, RULESET.evidenceCap),
      flags: normalizeTokens(source.flags, RULESET.flagsCap),
    };
  }

  /**
   * 由委托与事件摘要计算本局奖励计划。
   * credits = clamp(baseByMission + objectiveBonus + masteryBonus, 0, payoutCap)；
   * 重复有效局只发固定 repeatSalaryCredits，不重复发首次奖励。
   * @param {object} commission
   * @param {object|Array} digest
   * @param {{mode?:string, repeat?:boolean, mastery?:number, objectiveBonus?:number, stats?:object, contentVersion?:string}} [ctx]
   * @returns {{ok:boolean, credits?:number, items?:object, evidence?:string[], flags?:string[], txSteps?:Array, reason?:string}}
   */
  function rewardPlan(commission, digest, ctx) {
    const options = isObject(ctx) ? ctx : {};
    const check = validateCommission(commission, digest, options);
    if (!check.ok) return { ok: false, reason: check.reason };
    const reward = isObject(commission.reward) ? commission.reward : {};
    const repeat = options.repeat === true;
    if (repeat) {
      const salary = clampInt(commission.repeatSalaryCredits, 0, RULESET.payoutCap, 0);
      const plan = normalizePlan({ credits: salary, items: {}, evidence: [], flags: [] });
      return { ok: true, credits: plan.credits, items: plan.items, evidence: plan.evidence, flags: plan.flags, txSteps: planTxSteps(plan) };
    }
    const base = clampInt(reward.credits, 0, RULESET.payoutCap, 0);
    const contentBonus = clampInt(commission.objectiveBonus, 0, RULESET.payoutCap, 0);
    const ctxBonus = clampInt(options.objectiveBonus, 0, RULESET.payoutCap, 0);
    const objectiveBonus = contentBonus + ctxBonus + RULESET.objectiveBonus;
    let masteryBonus = 0;
    if (options.mastery !== undefined) {
      const rank = clampInt(options.mastery, 0, RULESET.masteryBonusByRank.length - 1, 0);
      masteryBonus = RULESET.masteryBonusByRank[rank];
    }
    const plan = normalizePlan({
      credits: clampInt(base + objectiveBonus + masteryBonus, 0, RULESET.payoutCap, 0),
      items: reward.items,
      evidence: reward.evidence,
      flags: reward.flags,
    });
    return { ok: true, credits: plan.credits, items: plan.items, evidence: plan.evidence, flags: plan.flags, txSteps: planTxSteps(plan) };
  }

  /** 计划 → 不可变流水步骤（不含 txId；txId 由 makeTxIds 按 runId 生成）。 */
  function planTxSteps(plan) {
    const normalized = normalizePlan(plan);
    const steps = [];
    if (normalized.credits > 0) {
      steps.push({ step: steps.length + 1, kind: 'credits', credits: normalized.credits });
    }
    if (Object.keys(normalized.items).length > 0) {
      steps.push({ step: steps.length + 1, kind: 'items', items: deepClone(normalized.items) });
    }
    if (normalized.evidence.length > 0 || normalized.flags.length > 0) {
      steps.push({ step: steps.length + 1, kind: 'progress', evidence: normalized.evidence.slice(), flags: normalized.flags.slice() });
    }
    if (steps.length > RULESET.maxTxSteps) steps.length = RULESET.maxTxSteps;
    return steps;
  }

  /**
   * 可重放的流水 ID：tx:<runId>:<step>（ADR §7.1）。
   * @param {string} runId
   * @param {number} stepCount
   * @returns {string[]}
   */
  function makeTxIds(runId, stepCount) {
    if (!isValidRunId(runId)) return [];
    const count = clampInt(stepCount, 0, RULESET.maxTxSteps, 0);
    const ids = [];
    for (let step = 1; step <= count; step += 1) ids.push('tx:' + runId + ':' + step);
    return ids;
  }

  /** 计划对应的完整流水步骤（带 txId），供 career-db 在同一事务内 add()。 */
  function claimTxSteps(runId, plan) {
    const steps = planTxSteps(plan);
    const ids = makeTxIds(runId, steps.length);
    return steps.map((step, index) => {
      const out = deepClone(step);
      out.txId = ids[index] || '';
      return out;
    });
  }

  /**
   * 构造领奖收据（ADR §8 字段）。
   * 输入非法返回 null；调用方（career-db）负责结构化失败。
   */
  function buildReceipt(input) {
    const options = isObject(input) ? input : {};
    if (!isValidRunId(options.runId)) return null;
    if (!isValidCareerId(options.careerId)) return null;
    const checked = validateClaimPlan(options.plan);
    if (!checked.ok) return null;
    const plan = normalizePlan(options.plan);
    const steps = claimTxSteps(options.runId, plan);
    const now = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const commissionId = isToken(options.commissionId) ? options.commissionId : null;
    return {
      receiptId: options.runId,
      careerId: options.careerId,
      commissionId,
      credits: plan.credits,
      items: plan.items,
      evidence: plan.evidence,
      flags: plan.flags,
      txIds: steps.map((step) => step.txId),
      claimedAt: now,
      rulesetVersion: RULESET_VERSION,
      contentVersion: typeof options.contentVersion === 'string' && options.contentVersion ? options.contentVersion : DEFAULT_CONTENT_VERSION,
    };
  }

  /**
   * 校验调用方传入的奖励计划（career-db 在事务内写库前的最后一道门）。
   * 超上限/负数/非法物品一律拒绝，确保 DB 不可能写入负余额或伪造金额。
   */
  function validateClaimPlan(plan) {
    if (!isObject(plan)) return { ok: false, reason: REASONS.badPlan };
    const credits = plan.credits === undefined ? 0 : plan.credits;
    if (!isFiniteNumber(credits) || Math.floor(credits) !== credits || credits < 0 || credits > RULESET.payoutCap) {
      return { ok: false, reason: REASONS.badCredits };
    }
    if (plan.items !== undefined) {
      if (!isObject(plan.items)) return { ok: false, reason: REASONS.badItems };
      const ids = Object.keys(plan.items);
      if (ids.length > RULESET.itemKindsCap) return { ok: false, reason: REASONS.badItems };
      for (let i = 0; i < ids.length; i += 1) {
        const itemId = ids[i];
        const count = plan.items[itemId];
        if (!isToken(itemId)) return { ok: false, reason: REASONS.badItems };
        if (!isFiniteNumber(count) || Math.floor(count) !== count || count <= 0 || count > RULESET.itemCapPerItem) {
          return { ok: false, reason: REASONS.badItems };
        }
      }
    }
    if (plan.evidence !== undefined) {
      if (!Array.isArray(plan.evidence) || plan.evidence.length > RULESET.evidenceCap) return { ok: false, reason: REASONS.badEvidence };
      for (let i = 0; i < plan.evidence.length; i += 1) {
        if (!isToken(plan.evidence[i])) return { ok: false, reason: REASONS.badEvidence };
      }
    }
    if (plan.flags !== undefined) {
      if (!Array.isArray(plan.flags) || plan.flags.length > RULESET.flagsCap) return { ok: false, reason: REASONS.badFlags };
      for (let i = 0; i < plan.flags.length; i += 1) {
        if (!isToken(plan.flags[i])) return { ok: false, reason: REASONS.badFlags };
      }
    }
    if (plan.txSteps !== undefined) {
      if (!Array.isArray(plan.txSteps) || plan.txSteps.length > RULESET.maxTxSteps) return { ok: false, reason: REASONS.badTxSteps };
    }
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * 初始生涯 / 购买 / 剧情上下文
   * ------------------------------------------------------------------ */

  /**
   * 初始生涯结构（80 credits）。事务由 career-db 写入，这里只返回不可变数据。
   * @param {{originGameId?:string, now?:string}} [input]
   * @returns {{profile:object, balance:object, ledger:object}}
   */
  function initialCareer(input) {
    const options = isObject(input) ? input : {};
    const now = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const careerId = newId('career');
    const originGameId = typeof options.originGameId === 'string' && isToken(options.originGameId) ? options.originGameId : null;
    const credits = RULESET.initialCredits;
    const profile = {
      careerId,
      schemaVersion: SCHEMA_VERSION,
      rulesetVersion: RULESET_VERSION,
      originGameId,
      createdAt: now,
      updatedAt: now,
      capabilities: [],
      flags: [],
      evidence: [],
      settings: { hintsEnabled: true },
    };
    const balance = {
      careerId,
      credits,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const ledger = {
      txId: 'tx:init:' + careerId + ':1',
      schemaVersion: SCHEMA_VERSION,
      kind: 'initial-grant',
      careerId,
      step: 1,
      credits,
      items: {},
      at: now,
      rulesetVersion: RULESET_VERSION,
      contentVersion: DEFAULT_CONTENT_VERSION,
    };
    return { profile, balance, ledger };
  }

  /**
   * 购买计划：事务内先校验余额与库存上限，再扣款；余额永不为负。
   * @param {{cost:number, grants?:{items?:object, equipment?:object}, wallet?:{credits:number, items?:object}}} input
   * @returns {{ok:boolean, reason?:string, plan?:object}}
   */
  function purchasePlan(input) {
    const options = isObject(input) ? input : {};
    const cost = options.cost;
    if (!isFiniteNumber(cost) || Math.floor(cost) !== cost || cost <= 0 || cost > RULESET.maxPurchaseCost) {
      return { ok: false, reason: REASONS.badCost };
    }
    const grants = isObject(options.grants) ? options.grants : {};
    /* 0.16：材料成本与信用点在同一交易内校验/扣减（飞船材料门槛不可被绕过）。 */
    const costItemsRaw = options.costItems;
    const costItems = {};
    if (costItemsRaw !== undefined) {
      if (!isObject(costItemsRaw)) return { ok: false, reason: REASONS.badCostItems };
      const costIds = Object.keys(costItemsRaw);
      if (costIds.length > RULESET.itemKindsCap) return { ok: false, reason: REASONS.badCostItems };
      for (let i = 0; i < costIds.length; i += 1) {
        const itemId = costIds[i];
        const count = costItemsRaw[itemId];
        if (!isToken(itemId)) return { ok: false, reason: REASONS.badCostItems };
        if (!isFiniteNumber(count) || Math.floor(count) !== count || count <= 0 || count > RULESET.itemCapPerItem) {
          return { ok: false, reason: REASONS.badCostItems };
        }
        costItems[itemId] = count;
      }
    }
    const unknownGrantKeys = Object.keys(grants).filter((key) => key !== 'items' && key !== 'equipment');
    if (unknownGrantKeys.length) return { ok: false, reason: REASONS.badGrants };
    const items = {};
    if (grants.items !== undefined) {
      if (!isObject(grants.items)) return { ok: false, reason: REASONS.badGrants };
      const ids = Object.keys(grants.items);
      if (ids.length > RULESET.itemKindsCap) return { ok: false, reason: REASONS.badGrants };
      for (let i = 0; i < ids.length; i += 1) {
        const itemId = ids[i];
        const count = grants.items[itemId];
        if (!isToken(itemId)) return { ok: false, reason: REASONS.badGrants };
        if (!isFiniteNumber(count) || Math.floor(count) !== count || count <= 0 || count > RULESET.itemCapPerItem) {
          return { ok: false, reason: REASONS.badGrants };
        }
        items[itemId] = count;
      }
    }
    const equipment = {};
    if (grants.equipment !== undefined) {
      if (!isObject(grants.equipment)) return { ok: false, reason: REASONS.badGrants };
      const keys = Object.keys(grants.equipment);
      if (keys.length > 32) return { ok: false, reason: REASONS.badGrants };
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const value = grants.equipment[key];
        if (!isToken(key)) return { ok: false, reason: REASONS.badGrants };
        if (!(typeof value === 'boolean' || typeof value === 'string' || (isFiniteNumber(value) && value >= 0) || isObject(value))) {
          return { ok: false, reason: REASONS.badGrants };
        }
        equipment[key] = deepClone(value);
      }
    }
    const wallet = isObject(options.wallet) ? options.wallet : null;
    if (!wallet || !isFiniteNumber(wallet.credits) || wallet.credits < 0) {
      return { ok: false, reason: REASONS.walletUnavailable };
    }
    const credits = Math.floor(wallet.credits);
    if (credits > RULESET.balanceCap) return { ok: false, reason: REASONS.balanceCap };
    if (credits < cost) return { ok: false, reason: REASONS.insufficient };
    const owned = isObject(wallet.items) ? wallet.items : {};
    const costIds = Object.keys(costItems);
    for (let i = 0; i < costIds.length; i += 1) {
      const itemId = costIds[i];
      const have = nonNegInt(owned[itemId], 0);
      if (have < costItems[itemId]) return { ok: false, reason: REASONS.insufficientItems };
    }
    const itemIds = Object.keys(items);
    for (let i = 0; i < itemIds.length; i += 1) {
      const itemId = itemIds[i];
      const current = nonNegInt(owned[itemId], 0);
      if (current + items[itemId] > RULESET.inventoryStackCap) return { ok: false, reason: REASONS.itemCap };
    }
    const balanceAfter = credits - cost;
    if (balanceAfter < 0) return { ok: false, reason: REASONS.insufficient };
    return {
      ok: true,
      plan: {
        cost,
        creditsDelta: -cost,
        balanceAfter,
        costItems,
        items,
        equipment,
      },
    };
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function tokenList(value) {
    return normalizeTokens(value, RULESET.evidenceCap);
  }

  /**
   * 构造故事谓词上下文（registry.resolveStory 的 ctx）。
   * @param {{profile?:object, wallet?:object, quests?:Array|object, claims?:Array|object}} input
   * @returns {{capabilities:Set<string>, evidence:Set<string>, flags:Set<string>, items:Map<string,number>, credits:number, cleared:Set<string>}}
   */
  function storyContextFrom(input) {
    const options = isObject(input) ? input : {};
    const profile = isObject(options.profile) ? options.profile : {};
    const wallet = isObject(options.wallet) ? options.wallet : {};
    const quests = Array.isArray(options.quests) ? options.quests : Object.keys(isObject(options.quests) ? options.quests : {}).map((key) => options.quests[key]);
    const claims = Array.isArray(options.claims) ? options.claims : Object.keys(isObject(options.claims) ? options.claims : {}).map((key) => options.claims[key]);
    const capabilities = new Set(tokenList(profile.capabilities));
    const evidence = new Set(tokenList(profile.evidence));
    const flags = new Set(tokenList(profile.flags));
    const cleared = new Set();
    const items = new Map();
    const walletItems = isObject(wallet.items) ? wallet.items : {};
    Object.keys(walletItems).forEach((itemId) => {
      const count = nonNegInt(walletItems[itemId], 0);
      if (count > 0) items.set(itemId, count);
    });
    quests.forEach((quest) => {
      if (!isObject(quest)) return;
      tokenList(quest.capabilities).forEach((id) => capabilities.add(id));
      tokenList(quest.evidence).forEach((id) => evidence.add(id));
      tokenList(quest.flags).forEach((id) => flags.add(id));
      if (quest.status === 'cleared') {
        if (isToken(quest.nodeId)) cleared.add(quest.nodeId);
        if (isToken(quest.commissionId)) cleared.add(quest.commissionId);
      }
    });
    claims.forEach((claim) => {
      if (!isObject(claim)) return;
      const receipt = isObject(claim.receipt) ? claim.receipt : claim;
      tokenList(receipt.evidence).forEach((id) => evidence.add(id));
      tokenList(receipt.flags).forEach((id) => flags.add(id));
      if (isToken(receipt.commissionId)) cleared.add(receipt.commissionId);
    });
    return {
      capabilities,
      evidence,
      flags,
      items,
      credits: clampInt(wallet.credits, 0, RULESET.balanceCap, 0),
      cleared,
    };
  }

  /* ------------------------------------------------------------------ *
   * 谓词复用（registry.js 是唯一实现，core 只做转发，缺失时保守返回 false）
   * ------------------------------------------------------------------ */

  let nodeRegistry = null;
  if (isNode && typeof require === 'function') {
    try {
      nodeRegistry = require('./registry.js');
    } catch (err) {
      nodeRegistry = null;
    }
  }

  function registryRef() {
    if (nodeRegistry && typeof nodeRegistry.conditionMatches === 'function') return nodeRegistry;
    if (root && root.ArcadeCareer && root.ArcadeCareer.registry && typeof root.ArcadeCareer.registry.conditionMatches === 'function') {
      return root.ArcadeCareer.registry;
    }
    return null;
  }

  /** 复用 registry.conditionMatches；注册表未装载时保守返回 false（宁可不显示，不误发放）。 */
  function resolveStory(condition, ctx) {
    const api = registryRef();
    if (!api) return false;
    try {
      return api.conditionMatches(condition, ctx || {});
    } catch (err) {
      return false;
    }
  }

  const api = {
    SCHEMA_VERSION,
    RULESET_VERSION,
    DEFAULT_CONTENT_VERSION,
    RULESET,
    REASONS,
    VALID_MODES,
    ID_RE,
    TOKEN_RE,
    nowIso,
    clampInt,
    newId,
    isValidId,
    isValidRunId,
    isValidCareerId,
    isToken,
    isKind,
    validateCommission,
    rewardPlan,
    planTxSteps,
    makeTxIds,
    claimTxSteps,
    buildReceipt,
    validateClaimPlan,
    normalizePlan,
    summarizeEvents,
    combineDigest,
    normalizeDigest,
    initialCareer,
    purchasePlan,
    storyContextFrom,
    resolveStory,
  };

  return api;
});
