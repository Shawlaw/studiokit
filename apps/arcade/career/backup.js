/*!
 * StudioKit Arcade Life — 生涯独立备份与迁移 v1（0.15，D15-14）
 *
 * 浏览器挂到 window.ArcadeCareer.backup；Node 中 module.exports 为同一 API。
 * 纯函数部分（buildExportPayload / parseAndValidate / formatFilename / migrateSnapshot）
 * 在 Node 可直接使用；exportCareerLife / importCareerLife 需要 career-db
 * （无 IndexedDB 时返回结构化失败，绝不回退任何浏览器存储）。
 *
 * 硬约束（docs/arcade-life/ADR-interfaces.md §7.1 / §7.3 / §9 / §10 / §12）：
 * - 备份格式：{format, careerSchemaVersion, contentVersion, rulesetVersion, exportedAt,
 *   profiles, state, discovery, runs, claims, ledgers, balances, inventory, equipment,
 *   quests, migrations}（11 个 store 数组，state 为数组形式）；
 * - 导入前完成全部纯校验（结构 / 白名单 ID / 数值上限 / 唯一键 / 引用完整性 / 总量），
 *   坏条目整体拒绝，绝不做部分导入；
 * - 校验通过后只调用一次 db.importAll(snapshot, {mode})（单事务；失败整体回滚由 db 负责），
 *   backup 只把结果翻译成结构化返回，不自行补写；
 * - 旧档（缺字段 / 无 discovery / 生涯为空）返回 {ok:true, preserved:true, reason:'legacy'}，
 *   不覆盖、不删除，且零写库；
 * - careerSchemaVersion 只增不减；v1 无迁移；更高版本拒绝并提示升级；
 * - 本文件不触达任何浏览器存储、UI DOM、网络或 SW；除挂载 API 外无副作用。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    let core = null;
    let db = null;
    try {
      if (typeof require === 'function') core = require('./career-core.js');
    } catch (err) {
      core = null;
    }
    try {
      if (typeof require === 'function') db = require('./career-db.js');
    } catch (err) {
      db = null;
    }
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this, core, db, true);
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  /* 重复注入保护：同一页面只会有一份 backup API。 */
  if (root.ArcadeCareer.backup && root.ArcadeCareer.backup.FORMAT === 'studiokit-arcade-career') return;
  root.ArcadeCareer.backup = factory(root, null, null, false);
})(typeof window !== 'undefined' ? window : globalThis, function (root, nodeCore, nodeDb, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 冻结常量
   * ------------------------------------------------------------------ */

  const FORMAT = 'studiokit-arcade-career';
  const SCHEMA_VERSION = 1;
  const DEFAULT_CONTENT_VERSION = '0.18.0';
  const DEFAULT_RULESET_VERSION = 1;

  /* ADR §10 冻结的 11 个 store（顺序即导出 JSON 的字段顺序）。 */
  const STORES = Object.freeze([
    'profiles',
    'state',
    'discovery',
    'runs',
    'claims',
    'ledgers',
    'balances',
    'inventory',
    'equipment',
    'quests',
    'migrations',
  ]);

  const STORE_LOOKUP = Object.freeze({
    profiles: 1,
    state: 1,
    discovery: 1,
    runs: 1,
    claims: 1,
    ledgers: 1,
    balances: 1,
    inventory: 1,
    equipment: 1,
    quests: 1,
    migrations: 1,
  });

  /* v1 备份必须出现的 store；migrations 允许缺省（旧导出没有该 store，补空数组）。 */
  const REQUIRED_STORES = Object.freeze([
    'profiles',
    'state',
    'discovery',
    'runs',
    'claims',
    'ledgers',
    'balances',
    'inventory',
    'equipment',
    'quests',
  ]);

  const META_FIELDS = Object.freeze({
    format: 1,
    careerSchemaVersion: 1,
    contentVersion: 1,
    rulesetVersion: 1,
    exportedAt: 1,
  });

  const MAX_ROWS_PER_STORE = 20000;
  const MAX_TEXT_BYTES = 2 * 1024 * 1024;
  const MAX_ISSUES = 20;
  const MAX_CREDITS = 1000000;
  const MAX_ITEM_COUNT = 999;
  const MAX_REVISION = 1000000000;
  const MAX_TX_STEPS = 16;
  const MAX_EVIDENCE = 24;
  const MAX_FLAGS = 24;
  const MAX_ITEM_KINDS = 8;
  const MAX_ARRAY_ITEMS = 64;
  const MAX_STRING_LENGTH = 200;
  const MAX_TIMESTAMP_LENGTH = 64;
  const MAX_CONTENT_VERSION_LENGTH = 64;

  /* 与 career-core.js 完全一致的 ID / token 形状（core 不可用时本地兜底）。 */
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

  /* ------------------------------------------------------------------ *
   * 依赖解析（全部惰性：Node 用 require，浏览器用 ArcadeCareer 命名空间）
   * ------------------------------------------------------------------ */

  function coreApi() {
    if (nodeCore) return nodeCore;
    const ac = root && root.ArcadeCareer;
    return ac && ac.core ? ac.core : null;
  }

  function dbApi() {
    if (nodeDb) return nodeDb;
    const ac = root && root.ArcadeCareer;
    return ac && ac.db ? ac.db : null;
  }

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS，无 DOM / 无存储 / 无网络）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function errorText(err) {
    if (!err) return 'unknown-error';
    if (typeof err === 'string') return err;
    try {
      const name = err.name ? String(err.name) : '';
      const message = err.message ? String(err.message) : '';
      if (name && message) return name + ': ' + message;
      return name || message || 'unknown-error';
    } catch (e) {
      return 'unknown-error';
    }
  }

  function failure(code, detail, extra) {
    const out = { ok: false, error: code || 'failed', detail: detail === undefined ? code || 'failed' : detail };
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (extra[key] !== undefined) out[key] = extra[key];
      });
    }
    return out;
  }

  function jsonClone(value) {
    if (value === undefined) return undefined;
    try {
      const text = JSON.stringify(value);
      if (typeof text !== 'string') return undefined;
      return JSON.parse(text);
    } catch (err) {
      return undefined;
    }
  }

  function preview(value) {
    try {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (typeof text !== 'string') return String(value);
      return text.length > 60 ? text.slice(0, 60) + '…' : text;
    } catch (err) {
      return String(value);
    }
  }

  function isId(value) {
    return typeof value === 'string' && ID_RE.test(value);
  }

  function isTokenValue(value) {
    return typeof value === 'string' && TOKEN_RE.test(value);
  }

  /** 文本的 UTF-8 字节数（TextEncoder 可用时用它，否则手算；两者都不产生副作用）。 */
  function utf8Bytes(text) {
    if (typeof text !== 'string') return 0;
    /* 每个 UTF-16 码元至少 1 字节：超长字符串可先走快速拒绝路径，避免编码整段 2MB+ 文本。 */
    if (text.length > MAX_TEXT_BYTES) return text.length;
    try {
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    } catch (err) {
      /* 落到手算分支 */
    }
    let bytes = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i += 1;
        } else {
          bytes += 3;
        }
      } else bytes += 3;
    }
    return bytes;
  }

  function toDate(value) {
    if (value instanceof Date) return isNaN(value.getTime()) ? new Date() : value;
    if (value === undefined || value === null || value === '') return new Date();
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
  }

  function toTimestampString(value) {
    if (typeof value === 'string') {
      const text = value.trim();
      if (text && text.length <= MAX_TIMESTAMP_LENGTH) return text;
      return null;
    }
    if (value instanceof Date || typeof value === 'number') {
      const date = toDate(value);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 版本与默认值
   * ------------------------------------------------------------------ */

  function runtimeVersion() {
    const ac = root && root.ArcadeCareer;
    return ac && typeof ac.version === 'string' && ac.version ? ac.version : null;
  }

  function normalizeContentVersion(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > MAX_CONTENT_VERSION_LENGTH) return null;
    return text;
  }

  function normalizeRulesetVersion(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return isInteger(num) && num >= 1 && num <= 1000 ? num : null;
  }

  function coreRulesetVersion() {
    const core = coreApi();
    if (!core) return null;
    if (isInteger(core.RULESET_VERSION) && core.RULESET_VERSION >= 1) return core.RULESET_VERSION;
    if (core.RULESET && isInteger(core.RULESET.version) && core.RULESET.version >= 1) return core.RULESET.version;
    return null;
  }

  function caps() {
    const core = coreApi();
    const ruleset = core && core.RULESET && typeof core.RULESET === 'object' ? core.RULESET : null;
    const intOr = (value, fallback) => (isInteger(value) && value > 0 ? value : fallback);
    return {
      balanceCap: intOr(ruleset && ruleset.balanceCap, MAX_CREDITS),
      inventoryStackCap: intOr(ruleset && ruleset.inventoryStackCap, MAX_ITEM_COUNT),
      evidenceCap: intOr(ruleset && ruleset.evidenceCap, MAX_EVIDENCE),
      flagsCap: intOr(ruleset && ruleset.flagsCap, MAX_FLAGS),
      itemKindsCap: intOr(ruleset && ruleset.itemKindsCap, MAX_ITEM_KINDS),
      maxTxSteps: intOr(ruleset && ruleset.maxTxSteps, MAX_TX_STEPS),
    };
  }

  function defaultContentVersion() {
    return runtimeVersion() || (coreApi() && coreApi().DEFAULT_CONTENT_VERSION) || DEFAULT_CONTENT_VERSION;
  }

  function defaultRulesetVersion() {
    return coreRulesetVersion() || DEFAULT_RULESET_VERSION;
  }

  /* ------------------------------------------------------------------ *
   * 迁移（careerSchemaVersion 只增不减；v1 无迁移）
   * ------------------------------------------------------------------ */

  /**
   * 把旧版本快照迁移到当前版本。
   * v1 是首个 schema 版本，因此没有 0→1 路径；输入 v1 原样返回（深拷贝），
   * 更高版本直接拒绝并要求升级，绝不降级。
   *
   * @param {object} snapshot
   * @param {number} [fromVersion] 缺省时取 snapshot.careerSchemaVersion
   * @returns {{ok:boolean, snapshot?:object, migrations?:object[], error?:string, detail?:string, upgrade?:boolean}}
   */
  function migrateSnapshot(snapshot, fromVersion) {
    if (!isObject(snapshot)) return failure('bad-snapshot', 'snapshot must be a JSON object');
    let version = fromVersion;
    if (version === undefined || version === null) version = snapshot.careerSchemaVersion;
    if (version === undefined || version === null || version === '') {
      return failure('bad-version', 'missing careerSchemaVersion');
    }
    const from = Number(version);
    if (!isInteger(from) || from < 0) {
      return failure('bad-version', 'careerSchemaVersion=' + preview(version));
    }
    if (from > SCHEMA_VERSION) {
      return failure(
        'unsupported-schema',
        '备份来自更高版本（careerSchemaVersion=' + from + '），请先升级 Arcade 后再导入',
        { upgrade: true, fromVersion: from, toVersion: SCHEMA_VERSION },
      );
    }
    if (from !== SCHEMA_VERSION) {
      return failure('no-migration', '没有从 careerSchemaVersion=' + from + ' 到 ' + SCHEMA_VERSION + ' 的迁移路径', {
        fromVersion: from,
        toVersion: SCHEMA_VERSION,
      });
    }
    const cloned = jsonClone(snapshot);
    if (!isObject(cloned)) return failure('bad-snapshot', 'snapshot is not JSON-serializable');
    cloned.careerSchemaVersion = SCHEMA_VERSION;
    return { ok: true, snapshot: cloned, migrations: [] };
  }

  /* ------------------------------------------------------------------ *
   * 导出格式
   * ------------------------------------------------------------------ */

  /**
   * 把 career-db.exportAll() 的快照整理成 ADR §10 冻结的备份对象。
   * 缺 store / 非数组一律补空数组；未知顶层字段丢弃；返回对象不含任何其它键。
   *
   * @param {object} snapshot
   * @param {{contentVersion?:string, rulesetVersion?:number, exportedAt?:string|Date|number, now?:string|Date|number}} [meta]
   * @returns {object}
   */
  function buildExportPayload(snapshot, meta) {
    const snap = isObject(snapshot) ? snapshot : {};
    const options = isObject(meta) ? meta : {};
    const contentVersion =
      normalizeContentVersion(options.contentVersion) ||
      runtimeVersion() ||
      normalizeContentVersion(snap.contentVersion) ||
      DEFAULT_CONTENT_VERSION;
    const rulesetVersion =
      normalizeRulesetVersion(options.rulesetVersion) ||
      coreRulesetVersion() ||
      normalizeRulesetVersion(snap.rulesetVersion) ||
      DEFAULT_RULESET_VERSION;
    const exportedAt =
      toTimestampString(options.exportedAt) ||
      toTimestampString(options.now) ||
      toTimestampString(snap.exportedAt) ||
      nowIso();
    const payload = {
      format: FORMAT,
      careerSchemaVersion: SCHEMA_VERSION,
      contentVersion,
      rulesetVersion,
      exportedAt,
    };
    STORES.forEach((name) => {
      const rows = snap[name];
      payload[name] = Array.isArray(rows) ? jsonClone(rows) || [] : [];
    });
    return payload;
  }

  function pad(value, width) {
    let text = String(value);
    while (text.length < width) text = '0' + text;
    return text;
  }

  /**
   * 备份文件名：studiokit-arcade-career-YYYYMMDD-HHMMSS.json（本地时间）。
   * 非法 now 回退到当前时间；本函数永远返回字符串，不抛异常。
   *
   * @param {Date|number|string} [now]
   * @returns {string}
   */
  function formatFilename(now) {
    const date = toDate(now);
    return (
      'studiokit-arcade-career-' +
      pad(date.getFullYear(), 4) +
      pad(date.getMonth() + 1, 2) +
      pad(date.getDate(), 2) +
      '-' +
      pad(date.getHours(), 2) +
      pad(date.getMinutes(), 2) +
      pad(date.getSeconds(), 2) +
      '.json'
    );
  }

  /* ------------------------------------------------------------------ *
   * 校验工具（所有问题都带 path，便于定位到具体行）
   * ------------------------------------------------------------------ */

  function pushIssue(ctx, code, path, message) {
    if (ctx.issues.length >= MAX_ISSUES) return;
    ctx.issues.push({ code, path, message });
  }

  function checkObject(row, path, ctx) {
    if (isObject(row)) return true;
    pushIssue(ctx, 'bad-record', path, 'record must be a JSON object');
    return false;
  }

  function checkId(value, path, ctx) {
    if (isId(value)) return true;
    pushIssue(ctx, 'bad-id', path, 'invalid id: ' + preview(value));
    return false;
  }

  function checkToken(value, path, ctx) {
    if (isTokenValue(value)) return true;
    pushIssue(ctx, 'bad-id', path, 'invalid token: ' + preview(value));
    return false;
  }

  function checkOptionalId(value, path, ctx) {
    if (value === undefined || value === null) return true;
    return checkId(value, path, ctx);
  }

  function checkOptionalToken(value, path, ctx) {
    if (value === undefined || value === null) return true;
    return checkToken(value, path, ctx);
  }

  function checkOptionalString(value, path, ctx, maxLength) {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string') {
      pushIssue(ctx, 'bad-value', path, 'expected string: ' + preview(value));
      return false;
    }
    if (value.length > (maxLength || MAX_STRING_LENGTH)) {
      pushIssue(ctx, 'bad-value', path, 'string too long: ' + value.length);
      return false;
    }
    return true;
  }

  function checkOptionalTimestamp(value, path, ctx) {
    return checkOptionalString(value, path, ctx, MAX_TIMESTAMP_LENGTH);
  }

  function checkInt(value, path, ctx, min, max, required) {
    if (value === undefined || value === null) {
      if (required) pushIssue(ctx, 'bad-value', path, 'missing integer');
      return !required;
    }
    if (!isInteger(value) || value < min || value > max) {
      pushIssue(ctx, 'bad-value', path, 'expected integer ' + min + '..' + max + ': ' + preview(value));
      return false;
    }
    return true;
  }

  function checkBooleanFlag(value, path, ctx) {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'boolean') {
      pushIssue(ctx, 'bad-value', path, 'expected boolean: ' + preview(value));
      return false;
    }
    return true;
  }

  function checkTokenArray(value, path, ctx, maxLength) {
    if (value === undefined || value === null) return true;
    if (!Array.isArray(value)) {
      pushIssue(ctx, 'bad-value', path, 'expected array: ' + preview(value));
      return false;
    }
    if (value.length > maxLength) {
      pushIssue(ctx, 'bad-value', path, 'too many entries: ' + value.length + ' > ' + maxLength);
      return false;
    }
    for (let i = 0; i < value.length; i += 1) {
      if (!isTokenValue(value[i])) {
        pushIssue(ctx, 'bad-id', path + '[' + i + ']', 'invalid token: ' + preview(value[i]));
        return false;
      }
    }
    return true;
  }

  /** claims.items / ledgers.items：token→正整数（上限 inventoryStackCap、种类上限 itemKindsCap）。 */
  function checkItemMap(value, path, ctx, capsRef) {
    if (value === undefined || value === null) return true;
    if (!isObject(value)) {
      pushIssue(ctx, 'bad-value', path, 'expected object: ' + preview(value));
      return false;
    }
    const keys = Object.keys(value);
    if (keys.length > capsRef.itemKindsCap) {
      pushIssue(ctx, 'bad-value', path, 'too many item kinds: ' + keys.length);
      return false;
    }
    for (let i = 0; i < keys.length; i += 1) {
      const itemId = keys[i];
      if (!isTokenValue(itemId)) {
        pushIssue(ctx, 'bad-id', path + '.' + itemId, 'invalid item id');
        return false;
      }
      const count = value[itemId];
      if (!isInteger(count) || count < 0 || count > capsRef.inventoryStackCap) {
        pushIssue(ctx, 'bad-value', path + '.' + itemId, 'item count out of range: ' + preview(count));
        return false;
      }
    }
    return true;
  }

  function makeKeyGuard(ctx) {
    const seen = Object.create(null);
    return function guard(store, key, path) {
      const composite = store + '\u0000' + key;
      if (seen[composite]) {
        pushIssue(ctx, 'duplicate-key', path, 'duplicate ' + store + ' key: ' + key);
        return false;
      }
      seen[composite] = true;
      return true;
    };
  }

  function keyOf2(a, b) {
    return String(a) + '\u0000' + String(b);
  }

  /* ------------------------------------------------------------------ *
   * 逐 store 校验（唯一键 / ID / 数值上限）
   * ------------------------------------------------------------------ */

  function validateStateRows(rows, ctx, guard) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'state[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.key, path + '.key', ctx)) continue;
      guard('state', row.key, path + '.key');
      if (row.key === 'career') {
        if (!isObject(row.value)) {
          pushIssue(ctx, 'bad-value', path + '.value', 'career pointer value must be an object');
          continue;
        }
        checkId(row.value.careerId, path + '.value.careerId', ctx);
      }
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateDiscoveryRows(rows, ctx, guard) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'discovery[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkToken(row.clueId, path + '.clueId', ctx)) continue;
      guard('discovery', row.clueId, path + '.clueId');
      checkOptionalId(row.sourceGame, path + '.sourceGame', ctx);
      checkOptionalString(row.firstSeenRunId, path + '.firstSeenRunId', ctx, MAX_STRING_LENGTH);
      checkOptionalTimestamp(row.seenAt, path + '.seenAt', ctx);
      checkOptionalTimestamp(row.openedAt, path + '.openedAt', ctx);
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
      checkBooleanFlag(row.dismissed, path + '.dismissed', ctx);
    }
  }

  function validateProfilesRows(rows, ctx, guard) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'profiles[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.careerId, path + '.careerId', ctx)) continue;
      guard('profiles', row.careerId, path + '.careerId');
      checkOptionalToken(row.originGameId, path + '.originGameId', ctx);
      checkTokenArray(row.capabilities, path + '.capabilities', ctx, MAX_ARRAY_ITEMS);
      checkTokenArray(row.flags, path + '.flags', ctx, MAX_ARRAY_ITEMS);
      checkTokenArray(row.evidence, path + '.evidence', ctx, MAX_ARRAY_ITEMS);
      if (row.settings !== undefined && row.settings !== null && !isObject(row.settings)) {
        pushIssue(ctx, 'bad-value', path + '.settings', 'expected object');
      }
      checkOptionalTimestamp(row.createdAt, path + '.createdAt', ctx);
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateRunsRows(rows, ctx, guard) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'runs[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.runId, path + '.runId', ctx)) continue;
      guard('runs', row.runId, path + '.runId');
      checkOptionalId(row.careerId, path + '.careerId', ctx);
      checkOptionalString(row.gameId, path + '.gameId', ctx, 120);
      checkOptionalString(row.commissionId, path + '.commissionId', ctx, 120);
      checkOptionalString(row.nonce, path + '.nonce', ctx, MAX_STRING_LENGTH);
      checkOptionalString(row.mode, path + '.mode', ctx, 32);
      checkOptionalString(row.sourceMode, path + '.sourceMode', ctx, 32);
      checkOptionalString(row.status, path + '.status', ctx, 32);
      checkOptionalTimestamp(row.createdAt, path + '.createdAt', ctx);
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateClaimsRows(rows, ctx, guard, capsRef) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'claims[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.runId, path + '.runId', ctx)) continue;
      guard('claims', row.runId, path + '.runId');
      checkOptionalId(row.careerId, path + '.careerId', ctx);
      checkInt(row.credits, path + '.credits', ctx, 0, capsRef.balanceCap, false);
      checkItemMap(row.items, path + '.items', ctx, capsRef);
      checkTokenArray(row.txIds, path + '.txIds', ctx, capsRef.maxTxSteps);
      checkTokenArray(row.evidence, path + '.evidence', ctx, capsRef.evidenceCap);
      checkTokenArray(row.flags, path + '.flags', ctx, capsRef.flagsCap);
      checkOptionalTimestamp(row.claimedAt, path + '.claimedAt', ctx);
    }
  }

  function validateLedgersRows(rows, ctx, guard, capsRef) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'ledgers[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkToken(row.txId, path + '.txId', ctx)) continue;
      guard('ledgers', row.txId, path + '.txId');
      /* 引用完整性要求每条流水都属于某个生涯（migrations 以外的账目没有匿名行）。 */
      checkId(row.careerId, path + '.careerId', ctx);
      checkOptionalString(row.runId, path + '.runId', ctx, 120);
      checkOptionalString(row.purchaseId, path + '.purchaseId', ctx, 120);
      checkOptionalString(row.kind, path + '.kind', ctx, 32);
      checkInt(row.step, path + '.step', ctx, 0, 1000, false);
      /* 流水允许负数（购买扣款），余额永不为负由 balances 校验。 */
      checkInt(row.credits, path + '.credits', ctx, -capsRef.balanceCap, capsRef.balanceCap, false);
      checkInt(row.balanceAfter, path + '.balanceAfter', ctx, 0, capsRef.balanceCap, false);
      checkItemMap(row.items, path + '.items', ctx, capsRef);
      checkTokenArray(row.evidence, path + '.evidence', ctx, capsRef.evidenceCap);
      checkTokenArray(row.flags, path + '.flags', ctx, capsRef.flagsCap);
      checkOptionalTimestamp(row.at, path + '.at', ctx);
    }
  }

  function validateBalancesRows(rows, ctx, guard, capsRef) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'balances[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.careerId, path + '.careerId', ctx)) continue;
      guard('balances', row.careerId, path + '.careerId');
      /* 余额永不为负（ADR §7.1）；上限与 core.RULESET.balanceCap 一致。 */
      checkInt(row.credits, path + '.credits', ctx, 0, capsRef.balanceCap, true);
      checkInt(row.revision, path + '.revision', ctx, 0, MAX_REVISION, false);
      checkOptionalTimestamp(row.createdAt, path + '.createdAt', ctx);
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateInventoryRows(rows, ctx, guard, capsRef) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'inventory[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.careerId, path + '.careerId', ctx)) continue;
      if (!checkToken(row.itemId, path + '.itemId', ctx)) continue;
      guard('inventory', keyOf2(row.careerId, row.itemId), path + '.itemId');
      checkInt(row.count, path + '.count', ctx, 0, capsRef.inventoryStackCap, true);
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateEquipmentRows(rows, ctx, guard) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'equipment[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.careerId, path + '.careerId', ctx)) continue;
      guard('equipment', row.careerId, path + '.careerId');
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateQuestsRows(rows, ctx, guard, capsRef) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'quests[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkId(row.careerId, path + '.careerId', ctx)) continue;
      if (!checkToken(row.nodeId, path + '.nodeId', ctx)) continue;
      guard('quests', keyOf2(row.careerId, row.nodeId), path + '.nodeId');
      checkOptionalString(row.kind, path + '.kind', ctx, 32);
      checkOptionalString(row.status, path + '.status', ctx, 32);
      checkTokenArray(row.evidence, path + '.evidence', ctx, capsRef.evidenceCap);
      checkTokenArray(row.flags, path + '.flags', ctx, capsRef.flagsCap);
      checkOptionalTimestamp(row.clearedAt, path + '.clearedAt', ctx);
      checkOptionalTimestamp(row.updatedAt, path + '.updatedAt', ctx);
    }
  }

  function validateMigrationsRows(rows, ctx, guard) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const path = 'migrations[' + i + ']';
      if (!checkObject(row, path, ctx)) continue;
      if (!checkToken(row.id, path + '.id', ctx)) continue;
      guard('migrations', row.id, path + '.id');
      checkOptionalTimestamp(row.appliedAt, path + '.appliedAt', ctx);
      checkOptionalString(row.inputHash, path + '.inputHash', ctx, 128);
      checkInt(row.fromVersion, path + '.fromVersion', ctx, 0, 1000, false);
      checkInt(row.toVersion, path + '.toVersion', ctx, 0, 1000, false);
    }
  }

  /* ------------------------------------------------------------------ *
   * 引用完整性（runs→profile、claims→run、ledgers→career 为硬错误；
   * 其余跨表 careerId 是软引用，只记 warning，避免把可修复的脏数据当坏档）
   * ------------------------------------------------------------------ */

  function validateReferences(stores, ctx) {
    const profileIds = Object.create(null);
    stores.profiles.forEach((row) => {
      if (isObject(row) && isId(row.careerId)) profileIds[row.careerId] = true;
    });
    const runIds = Object.create(null);
    stores.runs.forEach((row) => {
      if (isObject(row) && isId(row.runId)) runIds[row.runId] = true;
    });

    stores.runs.forEach((row, i) => {
      if (!isObject(row)) return;
      if (typeof row.careerId === 'string') {
        if (!profileIds[row.careerId]) {
          pushIssue(ctx, 'bad-reference', 'runs[' + i + '].careerId', 'profile not found: ' + row.careerId);
        }
      } else if (row.careerId === null || row.careerId === undefined) {
        ctx.warnings.push('run-without-career:' + (row.runId || i));
      }
    });

    stores.claims.forEach((row, i) => {
      if (!isObject(row)) return;
      if (!runIds[row.runId]) {
        pushIssue(ctx, 'bad-reference', 'claims[' + i + '].runId', 'run not found: ' + preview(row.runId));
      }
      if (typeof row.careerId === 'string' && !profileIds[row.careerId]) {
        ctx.warnings.push('orphan-claim-career:' + row.careerId);
      }
    });

    stores.ledgers.forEach((row, i) => {
      if (!isObject(row)) return;
      if (!profileIds[row.careerId]) {
        pushIssue(ctx, 'bad-reference', 'ledgers[' + i + '].careerId', 'profile not found: ' + preview(row.careerId));
      }
    });

    const softStores = [
      ['balances', 'careerId'],
      ['inventory', 'careerId'],
      ['equipment', 'careerId'],
      ['quests', 'careerId'],
    ];
    softStores.forEach(([name, field]) => {
      stores[name].forEach((row, i) => {
        if (isObject(row) && typeof row[field] === 'string' && !profileIds[row[field]]) {
          ctx.warnings.push('orphan-' + name + ':' + row[field] + '[' + i + ']');
        }
      });
    });

    stores.state.forEach((row, i) => {
      if (!isObject(row) || row.key !== 'career' || !isObject(row.value)) return;
      if (typeof row.value.careerId === 'string' && !profileIds[row.value.careerId]) {
        ctx.warnings.push('orphan-career-pointer:' + row.value.careerId + '[' + i + ']');
      }
    });
  }

  function validateStores(stores, warnings) {
    const ctx = { issues: [], warnings };
    const guard = makeKeyGuard(ctx);
    const capsRef = caps();
    validateStateRows(stores.state, ctx, guard);
    validateDiscoveryRows(stores.discovery, ctx, guard);
    validateProfilesRows(stores.profiles, ctx, guard);
    validateRunsRows(stores.runs, ctx, guard);
    validateClaimsRows(stores.claims, ctx, guard, capsRef);
    validateLedgersRows(stores.ledgers, ctx, guard, capsRef);
    validateBalancesRows(stores.balances, ctx, guard, capsRef);
    validateInventoryRows(stores.inventory, ctx, guard, capsRef);
    validateEquipmentRows(stores.equipment, ctx, guard);
    validateQuestsRows(stores.quests, ctx, guard, capsRef);
    validateMigrationsRows(stores.migrations, ctx, guard);
    if (!ctx.issues.length) validateReferences(stores, ctx);
    return ctx;
  }

  /* ------------------------------------------------------------------ *
   * 解析 + 校验（纯函数）
   * ------------------------------------------------------------------ */

  function legacyResult(detail, bytes, warnings, extra) {
    const result = {
      ok: true,
      legacy: true,
      preserved: true,
      reason: 'legacy',
      detail,
      payload: null,
      warnings,
      stats: { bytes, legacy: true, reason: 'legacy', detail },
    };
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (extra[key] !== undefined) result.stats[key] = extra[key];
      });
    }
    return result;
  }

  /**
   * 解析并校验备份文本。纯函数：不做任何写入，也不依赖 career-db。
   *
   * 返回：
   * - {ok:true, payload, warnings, stats}                   合法 v1 档，可交给 db.importAll
   * - {ok:true, legacy:true, preserved:true, reason:'legacy'}旧档/空档：语义为“保留现有生涯”
   * - {ok:false, error, detail, issues?}                    坏档：整体拒绝
   *
   * @param {string} text
   * @param {object} [opts]
   * @returns {object}
   */
  function parseAndValidate(text, opts) {
    const warnings = [];
    if (typeof text !== 'string') return failure('bad-input', 'backup text must be a string');
    if (!text.length) return failure('bad-json', 'empty backup text');
    const bytes = utf8Bytes(text);
    if (bytes > MAX_TEXT_BYTES) {
      return failure('too-large', 'backup text exceeds ' + MAX_TEXT_BYTES + ' bytes', { bytes });
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return failure('bad-json', errorText(err), { bytes });
    }
    if (!isObject(raw)) return failure('bad-format', 'backup root must be a JSON object', { bytes });

    /* format 缺失 = 旧归档（不是本格式的坏档）：语义是保留现有生涯，绝不覆盖。 */
    if (raw.format === undefined || raw.format === null) {
      return legacyResult('missing-format', bytes, warnings);
    }
    if (raw.format !== FORMAT) {
      return failure('bad-format', 'expected format ' + FORMAT + ', got ' + preview(raw.format), { bytes });
    }

    if (raw.careerSchemaVersion === undefined || raw.careerSchemaVersion === null) {
      return legacyResult('missing-career-schema-version', bytes, warnings);
    }
    const version = Number(raw.careerSchemaVersion);
    if (!isInteger(version) || version < 0) {
      return failure('bad-version', 'careerSchemaVersion=' + preview(raw.careerSchemaVersion), { bytes });
    }
    if (version > SCHEMA_VERSION) {
      return failure(
        'unsupported-schema',
        '备份来自更高版本（careerSchemaVersion=' + version + '），请先升级 Arcade 后再导入',
        { bytes, upgrade: true, fromVersion: version, toVersion: SCHEMA_VERSION },
      );
    }
    if (version < SCHEMA_VERSION) {
      const migrated = migrateSnapshot(raw, version);
      if (!migrated.ok) {
        return failure(migrated.error || 'no-migration', migrated.detail, { bytes, fromVersion: version });
      }
      raw = migrated.snapshot;
    }

    /* 未知 store：顶层出现非白名单数组字段即视为坏档（未知标量字段忽略）。 */
    const unknownStores = [];
    Object.keys(raw).forEach((key) => {
      if (STORE_LOOKUP[key] || META_FIELDS[key]) return;
      if (Array.isArray(raw[key])) unknownStores.push(key);
      else warnings.push('unknown-field:' + key);
    });
    if (unknownStores.length) {
      return failure('unknown-store', 'unknown store: ' + unknownStores.join(','), { bytes, unknownStores });
    }

    /* 旧档缺字段（例如 0.15 之前没有 discovery）：保留现有生涯，不做部分导入。 */
    const missing = REQUIRED_STORES.filter((name) => !Object.prototype.hasOwnProperty.call(raw, name));
    if (missing.length) return legacyResult('missing-store:' + missing[0], bytes, warnings);

    const stores = {};
    for (let i = 0; i < STORES.length; i += 1) {
      const name = STORES[i];
      const value = raw[name];
      if (value === undefined) {
        /* 只有 migrations 允许缺省。 */
        if (name !== 'migrations') return legacyResult('missing-store:' + name, bytes, warnings);
        stores[name] = [];
        warnings.push('missing-migrations');
        continue;
      }
      if (!Array.isArray(value)) {
        return failure('bad-record', name + ' must be an array', { bytes, path: name });
      }
      if (value.length > MAX_ROWS_PER_STORE) {
        return failure('too-many-rows', name + ' rows=' + value.length + ' > ' + MAX_ROWS_PER_STORE, { bytes, path: name });
      }
      stores[name] = value;
    }

    /* 生涯为空（没有 profiles）的档同样保留现有生涯，避免用空档清库。 */
    if (stores.profiles.length === 0) return legacyResult('empty-career', bytes, warnings);

    const ctx = validateStores(stores, warnings);
    if (ctx.issues.length) {
      return failure(ctx.issues[0].code, ctx.issues[0].message, {
        bytes,
        path: ctx.issues[0].path,
        issues: ctx.issues,
        warnings,
      });
    }

    const counts = {};
    let total = 0;
    const payload = {
      format: FORMAT,
      careerSchemaVersion: SCHEMA_VERSION,
      contentVersion:
        normalizeContentVersion(raw.contentVersion) || defaultContentVersion(),
      rulesetVersion: normalizeRulesetVersion(raw.rulesetVersion) || defaultRulesetVersion(),
      exportedAt: toTimestampString(raw.exportedAt) || nowIso(),
    };
    STORES.forEach((name) => {
      const rows = jsonClone(stores[name]);
      payload[name] = Array.isArray(rows) ? rows : [];
      counts[name] = payload[name].length;
      total += counts[name];
    });
    if (normalizeContentVersion(raw.contentVersion) !== raw.contentVersion && raw.contentVersion !== undefined) {
      warnings.push('unknown-content-version');
    }
    if (normalizeRulesetVersion(raw.rulesetVersion) !== raw.rulesetVersion && raw.rulesetVersion !== undefined) {
      warnings.push('unknown-ruleset-version');
    }
    return {
      ok: true,
      payload,
      warnings,
      stats: {
        bytes,
        total,
        counts,
        careerSchemaVersion: SCHEMA_VERSION,
        contentVersion: payload.contentVersion,
        rulesetVersion: payload.rulesetVersion,
        exportedAt: payload.exportedAt,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * 导出 / 导入（需要 career-db）
   * ------------------------------------------------------------------ */

  /**
   * 导出当前生涯为独立备份。
   * @param {{db?:object, contentVersion?:string, rulesetVersion?:number, exportedAt?:string, now?:string|Date|number, filenameNow?:string|Date|number}} [opts]
   * @returns {Promise<{ok:boolean, filename?:string, text?:string, payload?:object, error?:string, detail?:string}>}
   */
  function exportCareerLife(opts) {
    const options = isObject(opts) ? opts : {};
    const db = options.db || dbApi();
    if (!db || typeof db.exportAll !== 'function') {
      return Promise.resolve(failure('db-unavailable', 'career-db exportAll is not available'));
    }
    const now = options.now;
    const meta = {
      contentVersion: options.contentVersion,
      rulesetVersion: options.rulesetVersion,
      exportedAt: options.exportedAt,
      now,
    };
    return Promise.resolve()
      .then(() => db.exportAll())
      .then((exported) => {
        if (!exported || exported.ok !== true || !isObject(exported.payload)) {
          const reason = exported && (exported.reason || exported.error);
          return failure('export-failed', reason ? String(reason) : 'exportAll returned no payload');
        }
        const payload = buildExportPayload(exported.payload, meta);
        let text = '';
        try {
          text = JSON.stringify(payload);
        } catch (err) {
          return failure('serialize-failed', errorText(err));
        }
        if (typeof text !== 'string' || !text) return failure('serialize-failed', 'empty JSON text');
        const filename = formatFilename(options.filenameNow !== undefined ? options.filenameNow : now);
        return { ok: true, filename, text, payload };
      })
      .catch((err) => failure('export-failed', errorText(err)));
  }

  /**
   * 导入独立备份：先纯校验，再交给 db.importAll 单事务写入。
   * 旧档（缺字段 / 生涯为空）返回 preserved:true 且零写库；坏档整体拒绝且零写库。
   *
   * @param {string} text
   * @param {{mode?:'replace'|'merge', db?:object}} [opts]
   * @returns {Promise<{ok:boolean, mode?:string, preserved?:boolean, reason?:string, counts?:object, error?:string, detail?:string}>}
   */
  function importCareerLife(text, opts) {
    const options = isObject(opts) ? opts : {};
    const parsed = parseAndValidate(text, options);
    if (!parsed.ok) {
      return Promise.resolve({
        ok: false,
        error: parsed.error,
        detail: parsed.detail,
        path: parsed.path,
        issues: parsed.issues,
        warnings: parsed.warnings,
      });
    }
    if (parsed.legacy === true) {
      return Promise.resolve({
        ok: true,
        mode: 'none',
        preserved: true,
        reason: 'legacy',
        detail: parsed.detail,
        counts: {},
        warnings: parsed.warnings,
      });
    }
    const mode = options.mode === 'merge' ? 'merge' : 'replace';
    const db = options.db || dbApi();
    if (!db || typeof db.importAll !== 'function') {
      return Promise.resolve(failure('db-unavailable', 'career-db importAll is not available'));
    }
    return Promise.resolve()
      .then(() => db.importAll(parsed.payload, { mode }))
      .then((imported) => {
        if (!imported || imported.ok !== true) {
          const reason = imported && (imported.reason || imported.error);
          return failure('import-failed', reason ? String(reason) : 'importAll failed', {
            mode,
            reason: imported && imported.reason,
            warnings: parsed.warnings,
          });
        }
        return {
          ok: true,
          mode,
          preserved: false,
          counts: imported.counts || parsed.stats.counts,
          warnings: parsed.warnings,
        };
      })
      .catch((err) => failure('import-failed', errorText(err), { mode }));
  }

  /* ------------------------------------------------------------------ *
   * 对外 API（冻结）
   * ------------------------------------------------------------------ */

  return {
    FORMAT,
    SCHEMA_VERSION,
    buildExportPayload,
    parseAndValidate,
    formatFilename,
    exportCareerLife,
    importCareerLife,
    migrateSnapshot,
  };
});
