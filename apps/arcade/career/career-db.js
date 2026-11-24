/*!
 * StudioKit Arcade Life — 独立生涯 IndexedDB 事务层（0.15，D15-03）
 *
 * 浏览器挂到 window.ArcadeCareer.db；Node 中 module.exports 为同一 API 对象
 * （Node 没有 indexedDB 时所有 IDB 函数返回结构化失败 {ok:false, reason:'no-indexeddb'}，
 *  读函数按 return 类型返回 null / [] / 空钱包，绝不回退 localStorage）。
 *
 * 硬约束（docs/arcade-life/ADR-interfaces.md §7 / §8 / §10，STORAGE-AUDIT.md §4）：
 * - 唯一 IDB：studiokit:arcade:career，schema 版本 1，11 个 store；
 * - 跨表变更全部在同一 readwrite 事务内完成，失败即 abort（零半成品）；
 * - claims 以 runId 唯一；重复领取返回原收据且零增量；
 * - ledgers 以 txId 唯一，购买用 txId='purchase:<purchaseId>' 去重；
 * - 事务内禁止 await 非 IDB Promise：本文件全部用回调链，没有任何 await；
 * - versionchange 主动关闭连接；open blocked 3s 后结构化返回 {ok:false, reason:'blocked'}；
 * - 不写任何 studiokit:arcade:* localStorage 键。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    let core = null;
    try {
      if (typeof require === 'function') core = require('./career-core.js');
    } catch (err) {
      core = null;
    }
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : this, core, true);
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.db = factory(root, null, false);
})(typeof window !== 'undefined' ? window : globalThis, function (root, nodeCore, isNode) {
  'use strict';

  const DB_NAME = 'studiokit:arcade:career';
  const DB_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const STORES = Object.freeze([
    'state',
    'discovery',
    'profiles',
    'runs',
    'claims',
    'ledgers',
    'balances',
    'inventory',
    'equipment',
    'quests',
    'migrations',
  ]);
  const STORE_DEFS = Object.freeze({
    state: { keyPath: 'key' },
    discovery: { keyPath: 'clueId' },
    profiles: { keyPath: 'careerId' },
    runs: { keyPath: 'runId' },
    claims: { keyPath: 'runId' },
    ledgers: { keyPath: 'txId', indexes: [{ name: 'runId', keyPath: 'runId', unique: false }] },
    balances: { keyPath: 'careerId' },
    inventory: { keyPath: ['careerId', 'itemId'] },
    equipment: { keyPath: 'careerId' },
    quests: { keyPath: ['careerId', 'nodeId'] },
    migrations: { keyPath: 'id' },
  });
  const KEY_FIELDS = Object.freeze({
    state: 'key',
    discovery: 'clueId',
    profiles: 'careerId',
    runs: 'runId',
    claims: 'runId',
    ledgers: 'txId',
    balances: 'careerId',
    inventory: ['careerId', 'itemId'],
    equipment: 'careerId',
    quests: ['careerId', 'nodeId'],
    migrations: 'id',
  });
  const FORMAT = 'studiokit-arcade-career';
  const STATE_KEY_DISCOVERY = 'discovery';
  const STATE_KEY_CAREER = 'career';
  const STATE_KEY_DISCOVERY_GENERATION = 'discovery-generation';
  const BLOCKED_TIMEOUT_MS = 3000;
  const TX_TIMEOUT_MS = 15000;
  const MAX_IMPORT_ROWS = 20000;
  const COMMISSION_MODE = 'commission';
  const BLOCKED_RUN_STATUS = Object.freeze(['abandoned', 'failed', 'cancelled', 'expired', 'claimed', 'draft']);
  const CLAIM_STORES = Object.freeze(['claims', 'runs', 'ledgers', 'balances', 'inventory', 'equipment', 'quests']);
  const DEFAULT_CONTENT_VERSION = '0.18.0';
  const ENDING_C5_FLAG = 'C5.star_tower_resolved';

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS，无 IDB）
   * ------------------------------------------------------------------ */

  function coreApi() {
    if (nodeCore) return nodeCore;
    if (root && root.ArcadeCareer && root.ArcadeCareer.core) return root.ArcadeCareer.core;
    return null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /* 0.16 遗留材料别名：库存/成本/流水统一按 starcrystal 记账，读取时归并。 */
  function canonicalItemId(itemId) {
    return itemId === 'crystal' ? 'starcrystal' : itemId;
  }

  function canonicalItemMap(items) {
    const out = {};
    Object.keys(items || {}).forEach((itemId) => {
      const key = canonicalItemId(itemId);
      out[key] = (out[key] || 0) + Math.max(0, Math.floor(Number(items[itemId]) || 0));
    });
    return out;
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

  function failure(reason, error) {
    return { ok: false, reason: reason || 'failed', error: error === undefined ? reason || 'failed' : error };
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

  function sequence(tasks, done) {
    let index = 0;
    const next = () => {
      if (index >= tasks.length) {
        done();
        return;
      }
      const task = tasks[index];
      index += 1;
      task(next);
    };
    next();
  }

  function rowKey(storeName, row) {
    const fields = KEY_FIELDS[storeName];
    if (!fields || !row) return undefined;
    if (Array.isArray(fields)) return fields.map((field) => row[field]);
    return row[fields];
  }

  function sameKey(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (String(a[i]) !== String(b[i])) return false;
      return true;
    }
    return String(a) === String(b);
  }

  function factoryRef() {
    try {
      if (root && root.indexedDB) return root.indexedDB;
      if (typeof indexedDB !== 'undefined' && indexedDB) return indexedDB;
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 连接管理
   * ------------------------------------------------------------------ */

  let cachedDb = null;
  let pendingOpen = null;

  function upgradeSchema(db, tx) {
    STORES.forEach((name) => {
      const def = STORE_DEFS[name];
      let store = null;
      if (!db.objectStoreNames.contains(name)) store = db.createObjectStore(name, { keyPath: def.keyPath });
      else store = tx.objectStore(name);
      (def.indexes || []).forEach((index) => {
        if (!store.indexNames.contains(index.name)) store.createIndex(index.name, index.keyPath, { unique: index.unique === true });
      });
    });
  }

  /**
   * 打开（并缓存）连接。重复调用幂等；blocked 3s 后结构化失败。
   * @returns {Promise<{ok:boolean, db?:IDBDatabase, error?:string, reason?:string}>}
   */
  function openDb() {
    if (cachedDb) return Promise.resolve({ ok: true, db: cachedDb });
    if (pendingOpen) return pendingOpen;
    const factory = factoryRef();
    if (!factory) return Promise.resolve(failure('no-indexeddb', 'indexeddb-unavailable'));
    pendingOpen = new Promise((resolve) => {
      let settled = false;
      let upgradeError = null;
      let blockedTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (blockedTimer) {
          clearTimeout(blockedTimer);
          blockedTimer = null;
        }
        resolve(value);
      };
      blockedTimer = setTimeout(() => finish(failure('blocked', 'open-blocked')), BLOCKED_TIMEOUT_MS);
      let request;
      try {
        request = factory.open(DB_NAME, DB_VERSION);
      } catch (err) {
        finish(failure('open-failed', errorText(err)));
        return;
      }
      request.onupgradeneeded = (event) => {
        try {
          upgradeSchema(request.result, request.transaction);
        } catch (err) {
          upgradeError = errorText(err);
        }
      };
      request.onblocked = () => {
        /* 旧连接还没关：让 blockedTimer 决定，绝不永久挂起 */
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          try {
            db.close();
          } catch (err) {
            /* ignore */
          }
          return;
        }
        if (upgradeError) {
          try {
            db.close();
          } catch (err) {
            /* ignore */
          }
          finish(failure('upgrade-failed', upgradeError));
          return;
        }
        cachedDb = db;
        db.onversionchange = () => {
          try {
            db.close();
          } catch (err) {
            /* ignore */
          }
          if (cachedDb === db) cachedDb = null;
        };
        db.onclose = () => {
          if (cachedDb === db) cachedDb = null;
        };
        finish({ ok: true, db });
      };
      request.onerror = () => finish(failure('open-failed', errorText(request.error)));
    }).finally(() => {
      pendingOpen = null;
    });
    return pendingOpen;
  }

  /**
   * 事务运行器：body 必须是同步函数（只在 IDB 回调里继续），任何失败都 abort 并结构化返回。
   * @param {string[]} storeNames
   * @param {'readonly'|'readwrite'} mode
   * @param {(ctx:object)=>void} body
   * @returns {Promise<{ok:boolean, result?:any, reason?:string, error?:string}>}
   */
  function txRun(storeNames, mode, body, retried) {
    return openDb()
      .then((opened) => {
        if (!opened.ok) return failure(opened.reason || 'no-indexeddb', opened.error);
        return new Promise((resolve) => {
          let tx;
          try {
            tx = opened.db.transaction(storeNames, mode);
          } catch (err) {
            cachedDb = null;
            resolve(failure('connection-lost', errorText(err)));
            return;
          }
          let settled = false;
          let resultValue = null;
          let failureInfo = null;
          let guardTimer = null;
          const settle = (value) => {
            if (settled) return;
            settled = true;
            if (guardTimer) {
              clearTimeout(guardTimer);
              guardTimer = null;
            }
            resolve(value);
          };
          const fail = (reason, error) => {
            if (!failureInfo) failureInfo = { reason: reason || 'failed', error: error === undefined ? reason || 'failed' : error };
            try {
              tx.abort();
            } catch (err) {
              settle(failure(failureInfo.reason, failureInfo.error));
            }
          };
          tx.oncomplete = () => settle(failureInfo ? failure(failureInfo.reason, failureInfo.error) : { ok: true, result: resultValue });
          tx.onabort = () => settle(failureInfo ? failure(failureInfo.reason, failureInfo.error) : failure('aborted', errorText(tx.error)));
          tx.onerror = () => {
            if (!failureInfo) failureInfo = { reason: 'aborted', error: errorText(tx.error) };
          };
          guardTimer = setTimeout(() => fail('timeout', 'transaction-timeout'), TX_TIMEOUT_MS);
          const ctx = {
            tx,
            store(name) {
              return tx.objectStore(name);
            },
            bind(request, onOk) {
              request.onerror = () => fail('request-failed', errorText(request.error));
              request.onsuccess = () => {
                try {
                  onOk(request.result);
                } catch (err) {
                  fail('exception', errorText(err));
                }
              };
              return request;
            },
            bindConstraint(request, reason, onOk) {
              request.onerror = (event) => {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                const err = request.error;
                fail(err && err.name === 'ConstraintError' ? 'constraint' : reason, errorText(err));
              };
              request.onsuccess = () => {
                try {
                  onOk(request.result);
                } catch (err) {
                  fail('exception', errorText(err));
                }
              };
              return request;
            },
            fail,
            done(value) {
              resultValue = value;
            },
          };
          try {
            body(ctx);
          } catch (err) {
            fail('exception', errorText(err));
          }
        });
      })
      .then((res) => {
        if (!retried && res && res.ok === false && res.reason === 'connection-lost') return txRun(storeNames, mode, body, true);
        return res;
      });
  }

  /* ------------------------------------------------------------------ *
   * 发现状态（state / discovery）
   * ------------------------------------------------------------------ */

  function getDiscoveryState() {
    return txRun(['state'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('state').get(STATE_KEY_DISCOVERY), (row) => {
        if (!row || typeof row !== 'object') {
          ctx.done(null);
          return;
        }
        ctx.done(Object.prototype.hasOwnProperty.call(row, 'value') ? row.value : null);
      });
    }).then((res) => (res.ok ? res.result : null));
  }

  function readDiscoveryGeneration(ctx, done) {
    ctx.bind(ctx.store('state').get(STATE_KEY_DISCOVERY_GENERATION), (row) => {
      const value = row && Number.isFinite(Number(row.value)) && Number(row.value) >= 0 ? Math.floor(Number(row.value)) : 0;
      done(value);
    });
  }

  function writeDiscoveryGeneration(ctx, value, done) {
    ctx.bind(ctx.store('state').put({
      key: STATE_KEY_DISCOVERY_GENERATION,
      schemaVersion: SCHEMA_VERSION,
      value: Math.max(0, Math.floor(Number(value) || 0)),
      updatedAt: nowIso(),
    }), done);
  }

  function getDiscoveryGeneration() {
    return txRun(['state'], 'readonly', (ctx) => {
      readDiscoveryGeneration(ctx, (value) => ctx.done({ ok: true, generation: value }));
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function bumpDiscoveryGeneration() {
    return txRun(['state'], 'readwrite', (ctx) => {
      readDiscoveryGeneration(ctx, (value) => {
        const next = value + 1;
        writeDiscoveryGeneration(ctx, next, () => ctx.done({ ok: true, generation: next }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function getDiscoverySnapshot() {
    return txRun(['state'], 'readonly', (ctx) => {
      readDiscoveryGeneration(ctx, (generation) => {
        ctx.bind(ctx.store('state').get(STATE_KEY_DISCOVERY), (row) => {
          ctx.done({ ok: true, state: row && isObject(row.value) ? row.value : null, generation });
        });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function saveDiscoveryState(state) {
    const value = state === undefined ? null : state;
    const at = nowIso();
    return txRun(['state'], 'readwrite', (ctx) => {
      const row = { key: STATE_KEY_DISCOVERY, schemaVersion: SCHEMA_VERSION, updatedAt: at, value };
      ctx.bind(ctx.store('state').put(row), () => ctx.done({ ok: true }));
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /** 同事务读-合并-写发现状态：多标签并发时不会用旧快照覆盖另一页刚发现的线索。 */
  function mergeDiscoveryState(state, discoveryRecords, options) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!isObject(state)) return Promise.resolve(failure('bad-state'));
    const action = isObject(options) ? options.action : null;
    const actionType = action && typeof action.type === 'string' ? action.type : '';
    const value = jsonClone(state) || {};
    const records = Array.isArray(discoveryRecords)
      ? discoveryRecords
      : isObject(discoveryRecords)
        ? [discoveryRecords]
        : [];
    const at = nowIso();
    return txRun(['state', 'discovery'], 'readwrite', (ctx) => {
      const stateStore = ctx.store('state');
      readDiscoveryGeneration(ctx, (currentGeneration) => {
        const requestedGeneration = action && Number.isFinite(Number(action.generation)) ? Math.floor(Number(action.generation)) : null;
        if (requestedGeneration !== null && requestedGeneration !== currentGeneration) {
          ctx.done({ ok: false, reason: 'stale-generation', generation: currentGeneration });
          return;
        }
      ctx.bind(stateStore.get(STATE_KEY_DISCOVERY), (existingRow) => {
        const existing = existingRow && isObject(existingRow.value) ? existingRow.value : null;
        if (existing && isObject(existing.clues)) {
          value.clues = Object.assign({}, existing.clues, value.clues || {});
        }
        if (existing) {
          /* 设置只由 SET_HINTS 动作更新；普通结算不得用旧快照重新打开提示。 */
          if (actionType !== 'SET_HINTS') value.hintsEnabled = existing.hintsEnabled !== false;
          if (isObject(existing.runs) && isObject(value.runs)) {
            const mergedRuns = Object.assign({}, value.runs);
            Object.keys(existing.runs).forEach((gameId) => {
              const left = existing.runs[gameId] || {};
              const right = mergedRuns[gameId] || {};
              if (actionType === 'RUN_ENDED' && action.run && action.run.gameId === gameId) {
                const baseCount = action.baseRuns && action.baseRuns[gameId] ? Number(action.baseRuns[gameId].eligibleRuns) || 0 : 0;
                const incomingCount = Number(right.eligibleRuns) || 0;
                const delta = Math.max(0, incomingCount - baseCount);
                mergedRuns[gameId] = Object.assign({}, left, right, {
                  eligibleRuns: (Number(left.eligibleRuns) || 0) + delta,
                  lastRunAt: right.lastRunAt || left.lastRunAt,
                  lastRunId: right.lastRunId || left.lastRunId,
                });
                return;
              }
              const leftEligible = Number(left.eligibleRuns) || 0;
              const rightEligible = Number(right.eligibleRuns) || 0;
              mergedRuns[gameId] = Object.assign({}, left, right, {
                eligibleRuns: Math.max(leftEligible, rightEligible),
                lastRunAt: String(left.lastRunAt || '') > String(right.lastRunAt || '') ? left.lastRunAt : right.lastRunAt,
                lastRunId: String(left.lastRunAt || '') > String(right.lastRunAt || '') ? left.lastRunId : right.lastRunId,
              });
            });
            value.runs = mergedRuns;
          }
        }
        const row = { key: STATE_KEY_DISCOVERY, schemaVersion: SCHEMA_VERSION, updatedAt: at, value };
        ctx.bind(stateStore.put(row), () => {
          const store = ctx.store('discovery');
          const tasks = records.map((record) => (next) => {
            if (!isObject(record) || typeof record.clueId !== 'string' || !core.isToken(record.clueId)) { next(); return; }
            const copy = jsonClone(record) || {};
            copy.updatedAt = typeof copy.updatedAt === 'string' ? copy.updatedAt : at;
            ctx.bind(store.put(copy), next);
          });
          sequence(tasks, () => ctx.done({ ok: true, value, generation: currentGeneration }));
        });
      });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function listDiscovery() {
    return txRun(['discovery'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('discovery').getAll(), (rows) => ctx.done(Array.isArray(rows) ? rows : []));
    }).then((res) => (res.ok ? res.result : []));
  }

  function normalizeDiscoveryRecord(raw, at) {
    const record = {
      clueId: raw.clueId,
      sourceGame: typeof raw.sourceGame === 'string' ? raw.sourceGame : null,
      firstSeenRunId: typeof raw.firstSeenRunId === 'string' ? raw.firstSeenRunId : null,
      seenAt: typeof raw.seenAt === 'string' ? raw.seenAt : null,
      openedAt: typeof raw.openedAt === 'string' ? raw.openedAt : null,
      dismissed: raw.dismissed === true,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : at,
    };
    return record;
  }

  function putDiscovery(records) {
    const core = coreApi();
    const list = Array.isArray(records) ? records : isObject(records) ? [records] : null;
    if (!list) return Promise.resolve(failure('bad-records'));
    for (let i = 0; i < list.length; i += 1) {
      const record = list[i];
      if (!isObject(record) || !core || !core.isToken(record.clueId)) return Promise.resolve(failure('bad-record'));
    }
    const at = nowIso();
    return txRun(['discovery'], 'readwrite', (ctx) => {
      const store = ctx.store('discovery');
      const tasks = list.map((record) => (next) => {
        ctx.bind(store.put(normalizeDiscoveryRecord(record, at)), next);
      });
      sequence(tasks, () => ctx.done({ ok: true, count: list.length }));
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /* ------------------------------------------------------------------ *
   * 兼容适配层（非 ADR 必需接口）
   *
   * D15-04 的 bridge.js 在并行开发中以“候选方法名探测”的方式适配生涯 DB
   * （saveState / getState / putDiscovery(单条)），为了不修改他人文件，
   * 这里提供同名薄包装；语义与 saveDiscoveryState / getDiscoveryState 完全一致：
   * - saveState({key:'discovery', ...state}) → state store 行 {key, value: state}
   * - getState(key) → 扁平 {key, ...state}（bridge 侧 discovery.normalizeState 需要扁平对象）
   * ------------------------------------------------------------------ */

  function saveState(record) {
    if (!isObject(record)) return Promise.resolve(failure('bad-state'));
    const key = typeof record.key === 'string' && record.key && record.key.length <= 120 ? record.key : STATE_KEY_DISCOVERY;
    const copy = jsonClone(record) || {};
    delete copy.key;
    const keys = Object.keys(copy);
    const value = keys.length === 1 && Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : copy;
    const at = nowIso();
    return txRun(['state'], 'readwrite', (ctx) => {
      const row = { key, schemaVersion: SCHEMA_VERSION, updatedAt: at, value };
      ctx.bind(ctx.store('state').put(row), () => ctx.done({ ok: true }));
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function getState(key) {
    const name = typeof key === 'string' && key && key.length <= 120 ? key : STATE_KEY_DISCOVERY;
    return txRun(['state'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('state').get(name), (row) => {
        if (!row || typeof row !== 'object') {
          ctx.done(null);
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'value')) {
          ctx.done(jsonClone(row) || null);
          return;
        }
        const value = row.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const flat = jsonClone(value) || {};
          flat.key = name;
          ctx.done(flat);
          return;
        }
        ctx.done(value === undefined ? null : value);
      });
    }).then((res) => (res.ok ? res.result : null));
  }

  /* ------------------------------------------------------------------ *
   * 生涯身份 / 初始钱包
   * ------------------------------------------------------------------ */

  function getProfile(careerId) {
    const core = coreApi();
    if (!core || !core.isValidCareerId(careerId)) return Promise.resolve(null);
    return txRun(['profiles'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('profiles').get(careerId), (row) => ctx.done(row || null));
    }).then((res) => (res.ok ? res.result : null));
  }

  function putProfile(profile) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!isObject(profile) || !core.isValidCareerId(profile.careerId)) return Promise.resolve(failure('bad-profile'));
    const at = nowIso();
    return txRun(['profiles'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('profiles').get(profile.careerId), (existing) => {
        const record = jsonClone(profile) || {};
        record.careerId = profile.careerId;
        record.schemaVersion = SCHEMA_VERSION;
        record.createdAt = existing && typeof existing.createdAt === 'string' ? existing.createdAt : typeof profile.createdAt === 'string' ? profile.createdAt : at;
        record.updatedAt = at;
        ctx.bind(ctx.store('profiles').put(record), () => ctx.done({ profile: record }));
      });
    }).then((res) => (res.ok ? Object.assign({ ok: true }, res.result) : failure(res.reason, res.error)));
  }

  function writeInitialCareer(ctx, core, originGameId, at) {
    let initial;
    try {
      initial = core.initialCareer({ originGameId, now: at });
    } catch (err) {
      ctx.fail('core-error', errorText(err));
      return;
    }
    if (!initial || !isObject(initial.profile) || !isObject(initial.balance) || !isObject(initial.ledger)) {
      ctx.fail('core-incompatible');
      return;
    }
    const careerId = initial.profile.careerId;
    const pointer = {
      key: STATE_KEY_CAREER,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: at,
      value: { careerId, originGameId: initial.profile.originGameId, createdAt: at },
    };
    ctx.bind(ctx.store('profiles').add(initial.profile), () => {
      ctx.bind(ctx.store('balances').add(initial.balance), () => {
        ctx.bind(ctx.store('ledgers').add(initial.ledger), () => {
          ctx.bind(ctx.store('state').put(pointer), () => {
            ctx.done({
              ok: true,
              created: true,
              careerId,
              profile: initial.profile,
              balance: initial.balance,
            });
          });
        });
      });
    });
  }

  function ensureCareer(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const at = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const originGameId = typeof options.originGameId === 'string' ? options.originGameId : null;
    return txRun(['state', 'profiles', 'balances', 'ledgers'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('state').get(STATE_KEY_CAREER), (pointer) => {
        const value = pointer && isObject(pointer.value) ? pointer.value : null;
        const careerId = value && core.isValidCareerId(value.careerId) ? value.careerId : null;
        if (!careerId) {
          writeInitialCareer(ctx, core, originGameId, at);
          return;
        }
        ctx.bind(ctx.store('profiles').get(careerId), (profile) => {
          if (!profile) {
            writeInitialCareer(ctx, core, originGameId, at);
            return;
          }
          ctx.bind(ctx.store('balances').get(careerId), (balance) => {
            ctx.done({ ok: true, created: false, careerId, profile, balance: balance || null });
          });
        });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /* ------------------------------------------------------------------ *
   * 委托 run
   * ------------------------------------------------------------------ */

  function sanitizeRun(raw, at) {
    const core = coreApi();
    const clone = jsonClone(raw) || {};
    const record = {
      runId: raw.runId,
      careerId: core && core.isValidCareerId(raw.careerId) ? raw.careerId : null,
      gameId: typeof raw.gameId === 'string' && raw.gameId ? raw.gameId : null,
      commissionId: typeof raw.commissionId === 'string' && raw.commissionId ? raw.commissionId : null,
      nonce: typeof raw.nonce === 'string' && raw.nonce.length <= 200 ? raw.nonce : null,
      mode: typeof raw.mode === 'string' && raw.mode.length <= 32 ? raw.mode : null,
      sourceMode: typeof raw.sourceMode === 'string' && raw.sourceMode.length <= 32 ? raw.sourceMode : null,
      status: typeof raw.status === 'string' && raw.status.length <= 32 ? raw.status : 'active',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : at,
      updatedAt: at,
      schemaVersion: SCHEMA_VERSION,
    };
    Object.keys(clone).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(record, key)) return;
      record[key] = clone[key];
    });
    return record;
  }

  function createRun(run) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!isObject(run) || !core.isValidRunId(run.runId)) return Promise.resolve(failure('bad-run'));
    const at = nowIso();
    const record = sanitizeRun(run, at);
    return txRun(['runs'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('runs').get(record.runId), (existing) => {
        if (existing) {
          const same = existing.careerId === record.careerId && existing.nonce === record.nonce && existing.gameId === record.gameId;
          if (same) {
            ctx.done({ ok: true, duplicate: true, run: existing });
            return;
          }
          ctx.fail('conflict');
          return;
        }
        ctx.bindConstraint(ctx.store('runs').add(record), 'write-failed', () => ctx.done({ ok: true, duplicate: false, run: record }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function getRun(runId) {
    const core = coreApi();
    if (!core || !core.isValidRunId(runId)) return Promise.resolve(null);
    return txRun(['runs'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('runs').get(runId), (row) => ctx.done(row || null));
    }).then((res) => (res.ok ? res.result : null));
  }

  function updateRun(runId, patch, expectedStatus) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!core.isValidRunId(runId)) return Promise.resolve(failure('bad-run-id'));
    if (!isObject(patch)) return Promise.resolve(failure('bad-patch'));
    const at = nowIso();
    return txRun(['runs'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('runs').get(runId), (existing) => {
        if (!existing) {
          ctx.fail('missing-run');
          return;
        }
        const current = typeof existing.status === 'string' ? existing.status : '';
        if (typeof expectedStatus === 'string' && expectedStatus && current !== expectedStatus) {
          ctx.fail('run-state');
          return;
        }
        const target = typeof patch.status === 'string' ? patch.status : null;
        /* claimed 是终态：迟到失败/放弃不得覆盖已领奖记录。 */
        if (current === 'claimed' && target && target !== 'claimed') {
          ctx.fail('run-state');
          return;
        }
        /* failed/abandoned 不可被迟到的 active 重新拉起；重试必须签新票。 */
        if ((current === 'failed' || current === 'abandoned') && target === 'active') {
          ctx.fail('run-state');
          return;
        }
        const merged = jsonClone(existing) || {};
        const mergedPatch = jsonClone(patch);
        if (mergedPatch === undefined) {
          ctx.fail('bad-patch');
          return;
        }
        Object.keys(mergedPatch).forEach((key) => {
          if (key === 'runId' || key === 'careerId') return;
          const value = mergedPatch[key];
          if (value === undefined) delete merged[key];
          else merged[key] = value;
        });
        merged.updatedAt = at;
        ctx.bind(ctx.store('runs').put(merged), () => ctx.done({ ok: true, run: merged }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /* ------------------------------------------------------------------ *
   * 领奖（settleAndClaim）：claims / ledgers / balances / inventory / quests / equipment
   * ------------------------------------------------------------------ */

  const RECEIPT_FIELDS = Object.freeze([
    'receiptId',
    'careerId',
    'commissionId',
    'credits',
    'items',
    'evidence',
    'flags',
    'txIds',
    'claimedAt',
    'rulesetVersion',
    'contentVersion',
  ]);

  function receiptOf(row) {
    if (!row || typeof row !== 'object') return null;
    const receipt = {};
    RECEIPT_FIELDS.forEach((field) => {
      if (field === 'receiptId') receipt.receiptId = row.receiptId || row.runId || null;
      else if (field === 'credits') receipt.credits = Number.isFinite(Number(row.credits)) ? Math.max(0, Math.floor(Number(row.credits))) : 0;
      else if (field === 'items') receipt.items = isObject(row.items) ? row.items : {};
      else if (field === 'evidence') receipt.evidence = Array.isArray(row.evidence) ? row.evidence.slice() : [];
      else if (field === 'flags') receipt.flags = Array.isArray(row.flags) ? row.flags.slice() : [];
      else if (field === 'txIds') receipt.txIds = Array.isArray(row.txIds) ? row.txIds.slice() : [];
      else if (field === 'rulesetVersion') receipt.rulesetVersion = Number.isFinite(Number(row.rulesetVersion)) ? Math.floor(Number(row.rulesetVersion)) : 1;
      else receipt[field] = row[field] === undefined ? null : row[field];
    });
    return receipt;
  }

  function getClaim(runId) {
    const core = coreApi();
    if (!core || !core.isValidRunId(runId)) return Promise.resolve(null);
    return txRun(['claims'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('claims').get(runId), (row) => ctx.done(row || null));
    }).then((res) => (res.ok ? res.result : null));
  }

  function readClaimReceipt(runId) {
    return txRun(['claims'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('claims').get(runId), (row) => ctx.done(row || null));
    }).then((res) => (res.ok ? res.result : null));
  }

  function writeLedgerSteps(ctx, core, steps, meta, done) {
    const store = ctx.store('ledgers');
    const tasks = steps.map((step) => (next) => {
      const row = {
        txId: step.txId,
        schemaVersion: SCHEMA_VERSION,
        runId: meta.runId,
        careerId: meta.careerId,
        step: step.step,
        kind: step.kind,
        credits: step.credits || 0,
        items: step.items || {},
        evidence: step.evidence || [],
        flags: step.flags || [],
        at: meta.now,
        rulesetVersion: core.RULESET_VERSION,
        contentVersion: meta.contentVersion,
      };
      ctx.bindConstraint(store.add(row), 'write-failed', next);
    });
    sequence(tasks, done);
  }

  function incrementInventory(ctx, core, careerId, items, at, done) {
    const clean = canonicalItemMap(items);
    const ids = Object.keys(clean);
    const store = ctx.store('inventory');
    const tasks = ids.map((itemId) => (next) => {
      ctx.bind(store.get([careerId, itemId]), (existing) => {
        const prev = existing && Number.isFinite(Number(existing.count)) ? Math.max(0, Math.floor(Number(existing.count))) : 0;
        const cap = core.RULESET.inventoryStackCap;
        const row = {
          careerId,
          itemId,
          count: Math.min(prev + clean[itemId], cap),
          updatedAt: at,
        };
        ctx.bind(store.put(row), next);
      });
    });
    sequence(tasks, done);
  }

  /** 0.16/0.17：材料成本原子扣减（0.16 crystal 归并到 starcrystal；不足时在事务内 fail）。 */
  function applyInventoryCosts(ctx, core, careerId, costItems, at, done) {
    const need = canonicalItemMap(costItems);
    const ids = Object.keys(need);
    if (!ids.length) {
      done();
      return;
    }
    const store = ctx.store('inventory');
    ctx.bind(store.getAll(), (rows) => {
      const owned = {};
      const rawByCanonical = {};
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row || row.careerId !== careerId || typeof row.itemId !== 'string') return;
        const key = canonicalItemId(row.itemId);
        const count = Math.max(0, Math.floor(Number(row.count) || 0));
        owned[key] = (owned[key] || 0) + count;
        if (!rawByCanonical[key]) rawByCanonical[key] = {};
        rawByCanonical[key][row.itemId] = (rawByCanonical[key][row.itemId] || 0) + count;
      });
      for (let i = 0; i < ids.length; i += 1) {
        if ((owned[ids[i]] || 0) < need[ids[i]]) {
          ctx.fail('insufficient-items');
          return;
        }
      }
      const tasks = [];
      ids.forEach((itemId) => {
        let left = need[itemId];
        const rawKeys = Object.keys(rawByCanonical[itemId] || {});
        /* 优先消耗 0.16 遗留 crystal 行，再消耗 starcrystal，最后其它原始行（五材通用）。 */
        const ordered = ['crystal', 'starcrystal'].filter((rawId) => rawKeys.indexOf(rawId) >= 0)
          .concat(rawKeys.filter((rawId) => rawId !== 'crystal' && rawId !== 'starcrystal'));
        ordered.forEach((rawId) => {
          if (left <= 0) return;
          const rawCount = rawByCanonical[itemId] && rawByCanonical[itemId][rawId] ? rawByCanonical[itemId][rawId] : 0;
          if (!rawCount) return;
          const take = Math.min(left, rawCount);
          left -= take;
          const remaining = rawCount - take;
          tasks.push((next) => {
            if (remaining === 0) {
              ctx.bind(store.delete([careerId, rawId]), next);
              return;
            }
            ctx.bind(store.put({ careerId, itemId: rawId, count: remaining, updatedAt: at }), next);
          });
        });
      });
      sequence(tasks, done);
    });
  }

  function mergeEquipment(ctx, careerId, grants, at, done) {
    const keys = Object.keys(grants || {});
    if (!keys.length) {
      done();
      return;
    }
    const store = ctx.store('equipment');
    ctx.bind(store.get(careerId), (existing) => {
      const row = existing && isObject(existing) ? jsonClone(existing) : { careerId };
      row.careerId = careerId;
      keys.forEach((key) => {
        if (key === 'careerId' || key === 'updatedAt') return;
        row[key] = grants[key];
      });
      row.updatedAt = at;
      ctx.bind(store.put(row), done);
    });
  }

  function writeCommissionQuest(ctx, core, careerId, commissionId, plan, at, done, meta) {
    if (!core.isToken(commissionId)) {
      done();
      return;
    }
    const info = isObject(meta) ? meta : {};
    const existing = isObject(info.existing) ? info.existing : null;
    const mergeList = (base, add) => {
      const out = [];
      const seen = {};
      base.concat(add).forEach((value) => {
        if (typeof value !== 'string' || !value || seen[value]) return;
        seen[value] = true;
        out.push(value);
      });
      return out.sort();
    };
    const row = existing
      ? jsonClone(existing) || {}
      : {
          careerId,
          nodeId: commissionId,
          kind: 'commission',
          status: 'cleared',
          clearedAt: at,
          evidence: [],
          flags: [],
          schemaVersion: SCHEMA_VERSION,
        };
    row.status = 'cleared';
    row.evidence = mergeList(Array.isArray(row.evidence) ? row.evidence : [], plan.evidence || []);
    row.flags = mergeList(Array.isArray(row.flags) ? row.flags : [], plan.flags || []);
    if (!row.clearedAt) row.clearedAt = at;
    if (info.isFirst === true) {
      row.firstClearReceiptId = info.firstClearReceiptId;
      row.firstClearedAt = row.clearedAt;
    } else if (!row.firstClearReceiptId && info.firstClearReceiptId) {
      row.firstClearReceiptId = info.firstClearReceiptId;
    }
    row.updatedAt = at;
    row.schemaVersion = SCHEMA_VERSION;
    ctx.bind(ctx.store('quests').put(row), done);
  }

  function receiptMismatch(provided, expected, core) {
    const receipt = isObject(provided) ? provided : {};
    if (receipt.receiptId !== undefined && receipt.receiptId !== (expected.receiptId || expected.runId)) return 'receipt-mismatch';
    if (receipt.careerId !== undefined && receipt.careerId !== expected.careerId) return 'receipt-mismatch';
    if (receipt.credits !== undefined && Number(receipt.credits) !== expected.credits) return 'receipt-mismatch';
    if (receipt.items !== undefined) {
      const left = jsonClone(receipt.items);
      const right = jsonClone(expected.items);
      if (JSON.stringify(left) !== JSON.stringify(right)) return 'receipt-mismatch';
    }
    if (receipt.txIds !== undefined) {
      if (!Array.isArray(receipt.txIds) || receipt.txIds.length !== expected.txIds.length) return 'receipt-mismatch';
      for (let i = 0; i < receipt.txIds.length; i += 1) if (receipt.txIds[i] !== expected.txIds[i]) return 'receipt-mismatch';
    }
    if (receipt.commissionId !== undefined && receipt.commissionId !== expected.commissionId) return 'receipt-mismatch';
    return null;
  }

  /**
   * 单事务领奖：claims 唯一 + ledgers 唯一 + 钱包/库存/任务/装备增量。
   * 重复领取返回原收据且零增量；任何校验失败 abort（零写入）。
   * @param {{runId:string, careerId:string, nonce:string, receipt?:object, plan:object, now?:string, contentVersion?:string}} input
   * @returns {Promise<{ok:boolean, duplicate?:boolean, receipt?:object, reason?:string, error?:string}>}
   */
  /**
   * 旧档补发首通检测（只读）：旧 commission-first 占位 + 已有收据全是重复薪资、
   * quest 无首通旗标/证据/引用。返回 true 时下一张成功票按首通计划发一次。
   */
  function hasPendingFirstClear(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    const commissionId = options.commissionId;
    const repeatCredits = Number(options.repeatCredits);
    const firstCredits = Number(options.firstCredits);
    if (!core.isValidCareerId(careerId) || !core.isToken(commissionId)) return Promise.resolve(failure('bad-input'));
    if (!Number.isFinite(repeatCredits) || !Number.isFinite(firstCredits) || firstCredits === repeatCredits) {
      return Promise.resolve({ ok: true, pending: false });
    }
    const markerId = 'commission-first:' + careerId + ':' + commissionId;
    return txRun(['migrations', 'claims', 'quests'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('migrations').get(markerId), (markerRow) => {
        if (!markerRow || markerRow.kind !== 'commission-first') {
          ctx.done({ ok: true, pending: false });
          return;
        }
        ctx.bind(ctx.store('quests').get([careerId, commissionId]), (questRow) => {
          const flags = questRow && Array.isArray(questRow.flags) ? questRow.flags : [];
          const evidence = questRow && Array.isArray(questRow.evidence) ? questRow.evidence : [];
          if (!questRow || questRow.status !== 'cleared' || questRow.firstClearReceiptId || flags.length || evidence.length) {
            ctx.done({ ok: true, pending: false });
            return;
          }
          ctx.bind(ctx.store('claims').getAll(), (rows) => {
            const related = (Array.isArray(rows) ? rows : []).filter((row) => row && row.careerId === careerId && row.commissionId === commissionId);
            const allRepeat = related.length > 0 && related.every((row) => {
              const credits = Number(row.credits);
              const rowFlags = Array.isArray(row.flags) ? row.flags : [];
              const rowEvidence = Array.isArray(row.evidence) ? row.evidence : [];
              return credits === repeatCredits && rowFlags.length === 0 && rowEvidence.length === 0;
            });
            ctx.done({ ok: true, pending: allRepeat, claims: related.length });
          });
        });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function settleAndClaim(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const runId = options.runId;
    const careerId = options.careerId;
    const nonce = options.nonce;
    if (!core.isValidRunId(runId)) return Promise.resolve(failure('bad-run-id'));
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (typeof nonce !== 'string' || !nonce || nonce.length > 200) return Promise.resolve(failure('bad-nonce'));
    const planCheck = core.validateClaimPlan(options.plan);
    if (!planCheck.ok) return Promise.resolve(failure(planCheck.reason || 'bad-plan'));
    const plan = core.normalizePlan(options.plan);
    let repeatPlan = null;
    if (options.repeatPlan !== undefined) {
      const repeatCheck = core.validateClaimPlan(options.repeatPlan);
      if (!repeatCheck.ok) return Promise.resolve(failure(repeatCheck.reason || 'bad-repeat-plan'));
      repeatPlan = core.normalizePlan(options.repeatPlan);
    }
    const at = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const contentVersion =
      typeof options.contentVersion === 'string' && options.contentVersion
        ? options.contentVersion
        : typeof core.DEFAULT_CONTENT_VERSION === 'string'
          ? core.DEFAULT_CONTENT_VERSION
          : DEFAULT_CONTENT_VERSION;
    const providedReceipt = isObject(options.receipt) ? options.receipt : null;
    return txRun(CLAIM_STORES, 'readwrite', (ctx) => {
      ctx.bind(ctx.store('claims').get(runId), (existing) => {
        if (existing) {
          if (existing.careerId && existing.careerId !== careerId) {
            ctx.fail('career-mismatch');
            return;
          }
          ctx.done({ ok: true, duplicate: true, receipt: receiptOf(existing) });
          return;
        }
        ctx.bind(ctx.store('runs').get(runId), (run) => {
          if (!run) {
            ctx.fail('missing-run');
            return;
          }
          if (run.careerId !== careerId) {
            ctx.fail('career-mismatch');
            return;
          }
          if (run.nonce !== nonce) {
            ctx.fail('nonce-mismatch');
            return;
          }
          const status = typeof run.status === 'string' ? run.status : '';
          if (status && BLOCKED_RUN_STATUS.indexOf(status) >= 0) {
            ctx.fail('run-state');
            return;
          }
          if (typeof run.mode === 'string' && run.mode && run.mode !== COMMISSION_MODE) {
            ctx.fail('mode-not-allowed');
            return;
          }
          if (typeof run.sourceMode === 'string' && run.sourceMode && run.sourceMode !== COMMISSION_MODE) {
            ctx.fail('mode-not-allowed');
            return;
          }
          /* run 里的 commissionId 优先；若调用方 receipt 声明了不同值，保守拒绝（零写入）。 */
          const runCommissionId = core.isToken(run.commissionId) ? run.commissionId : null;
          const providedCommissionId =
            isObject(providedReceipt) && core.isToken(providedReceipt.commissionId) ? providedReceipt.commissionId : null;
          if (runCommissionId && providedCommissionId && runCommissionId !== providedCommissionId) {
            ctx.fail('receipt-mismatch');
            return;
          }
          const commissionId = runCommissionId || providedCommissionId;
          /* 首通归属由同一领奖事务内读到的 quest 行决定；旧预留 marker 不消耗首通。 */
          ctx.bind(commissionId ? ctx.store('quests').get([careerId, commissionId]) : null, (questRow) => {
            const wasCleared = !!(questRow && questRow.status === 'cleared');
            const historicalFirstRef = questRow && typeof questRow.firstClearReceiptId === 'string' && questRow.firstClearReceiptId;
            const canUseRepeat = !!repeatPlan;
            const retroFirstClear = options.retroFirstClear === true && wasCleared && !historicalFirstRef;
            const isFirst = retroFirstClear || (!wasCleared && !historicalFirstRef);
            const selected = isFirst || !canUseRepeat ? plan : repeatPlan;
            const firstClearReceiptId = isFirst ? runId : historicalFirstRef || null;
            let receipt;
            try {
              receipt = core.buildReceipt({ runId, careerId, commissionId, plan: selected, now: at, contentVersion });
            } catch (err) {
              ctx.fail('core-error', errorText(err));
              return;
            }
            if (!receipt) {
              ctx.fail('bad-receipt');
              return;
            }
            if (providedReceipt) {
              const mismatch = receiptMismatch(providedReceipt, receipt);
              if (mismatch) {
                ctx.fail(mismatch);
                return;
              }
            }
            const steps = core.claimTxSteps(runId, selected);
            const tasks = [
              (next) => writeLedgerSteps(ctx, core, steps, { runId, careerId, now: at, contentVersion }, next),
              (next) => {
                ctx.bind(ctx.store('balances').get(careerId), (balance) => {
                  if (!balance) {
                    ctx.fail('no-wallet');
                    return;
                  }
                  const prev = core.clampInt(balance.credits, 0, core.RULESET.balanceCap, 0);
                  const nextCredits = prev + selected.credits;
                  if (nextCredits > core.RULESET.balanceCap) {
                    ctx.fail('balance-cap');
                    return;
                  }
                  const row = {
                    careerId,
                    credits: nextCredits,
                    revision: core.clampInt(balance.revision, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
                    createdAt: typeof balance.createdAt === 'string' ? balance.createdAt : at,
                    updatedAt: at,
                  };
                  ctx.bind(ctx.store('balances').put(row), () => next(row));
                });
              },
              (next) => incrementInventory(ctx, core, careerId, selected.items, at, next),
              (next) => mergeEquipment(ctx, careerId, selected.equipment || {}, at, next),
              (next) => writeCommissionQuest(ctx, core, careerId, commissionId, selected, at, next, {
                existing: questRow || null,
                isFirst: isFirst && canUseRepeat,
                firstClearReceiptId: firstClearReceiptId,
              }),
              (next) => {
                const row = Object.assign({ runId, schemaVersion: SCHEMA_VERSION }, receipt);
                ctx.bindConstraint(ctx.store('claims').add(row), 'constraint', next);
              },
              (next) => {
                const updated = jsonClone(run) || {};
                updated.status = 'claimed';
                updated.claimedAt = at;
                updated.receiptId = runId;
                updated.updatedAt = at;
                ctx.bind(ctx.store('runs').put(updated), next);
              },
            ];
            sequence(tasks, () => ctx.done({ ok: true, duplicate: false, receipt, repeat: !isFirst && canUseRepeat, firstClear: isFirst && canUseRepeat }));
          });
        });
      });
    }).then((res) => {
      if (res.ok) return res.result;
      if (res.reason === 'constraint') {
        return readClaimReceipt(runId).then((row) => (row ? { ok: true, duplicate: true, receipt: receiptOf(row) } : failure('constraint', res.error)));
      }
      return failure(res.reason, res.error);
    });
  }

  /* ------------------------------------------------------------------ *
   * 终局单事务：唯一 C5 + 终局标记 + 收据 + 流水 + run 状态
   * ------------------------------------------------------------------ */

  const ENDING_C5_NODE = 'story:C5.star_tower_resolved';
  const ENDING_APPROACHES = Object.freeze(['combat', 'research', 'rescue']);

  function endingMarkerNode(approach) {
    return 'ending.' + approach;
  }

  function mergeTokenList(base, add) {
    const out = [];
    const seen = {};
    (Array.isArray(base) ? base : []).concat(Array.isArray(add) ? add : []).forEach((value) => {
      if (typeof value !== 'string' || !value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    });
    return out.sort();
  }

  function writeEndingQuestRows(ctx, core, careerId, approach, receipt, at, done) {
    const receiptId = receipt.receiptId || receipt.runId;
    const markerId = endingMarkerNode(approach);
    const questStore = ctx.store('quests');
    ctx.bind(questStore.get([careerId, markerId]), (previousMarker) => {
      ctx.bind(questStore.get([careerId, ENDING_C5_NODE]), (previousFlag) => {
        const flags = mergeTokenList([ENDING_C5_FLAG, markerId], previousMarker && previousMarker.flags);
        const evidence = mergeTokenList(receipt.evidence, previousMarker && previousMarker.evidence);
        const flagRow = {
          careerId,
          nodeId: ENDING_C5_NODE,
          kind: 'story-flag',
          status: 'cleared',
          flag: ENDING_C5_FLAG,
          flags: [ENDING_C5_FLAG],
          chapter: 'C5',
          approach,
          sourceReceipt: receiptId,
          receiptId,
          clearedAt: (previousFlag && previousFlag.clearedAt) || at,
          updatedAt: at,
          schemaVersion: SCHEMA_VERSION,
        };
        const markerRow = {
          careerId,
          nodeId: markerId,
          kind: 'ending',
          status: 'cleared',
          approach,
          commissionId: markerId,
          chapter: 'C5',
          flags,
          evidence,
          receiptId,
          sourceReceipt: receiptId,
          resolved: true,
          clearedAt: (previousMarker && previousMarker.clearedAt) || at,
          updatedAt: at,
          schemaVersion: SCHEMA_VERSION,
        };
        const tasks = [
          (next) => ctx.bind(questStore.put(flagRow), next),
          (next) => ctx.bind(questStore.put(markerRow), next),
        ];
        sequence(tasks, done);
      });
    });
  }

  function readEndingRows(ctx, careerId, done) {
    const store = ctx.store('quests');
    const rows = {};
    const want = [ENDING_C5_NODE].concat(ENDING_APPROACHES.map(endingMarkerNode));
    const tasks = want.map((nodeId) => (next) => {
      ctx.bind(store.get([careerId, nodeId]), (row) => { rows[nodeId] = row || null; next(); });
    });
    sequence(tasks, () => done(rows));
  }

  function resolvedEndingFromRows(rows) {
    const c5 = rows && rows[ENDING_C5_NODE];
    if (c5 && (c5.status === 'cleared' || c5.flags && c5.flags.indexOf(ENDING_C5_FLAG) >= 0)) {
      const approach = ENDING_APPROACHES.indexOf(c5.approach) >= 0 ? c5.approach : null;
      return { approach, receiptId: c5.receiptId || c5.sourceReceipt || null, source: 'c5' };
    }
    for (let i = 0; i < ENDING_APPROACHES.length; i += 1) {
      const approach = ENDING_APPROACHES[i];
      const row = rows && rows[endingMarkerNode(approach)];
      if (row && (row.resolved === true || row.status === 'cleared')) {
        return { approach, receiptId: row.receiptId || row.sourceReceipt || null, source: 'marker' };
      }
    }
    return null;
  }

  /**
   * 终局领奖：唯一性、收据、流水、balance/inventory/equipment、C5 与终局行在同一事务。
   * 别的路线已完成 → already-resolved 且零写入；同票据已有收据 → duplicate + 补写规范行。
   */
  function settleEndingAndClaim(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const runId = options.runId;
    const careerId = options.careerId;
    const approach = options.approach;
    const nonce = options.nonce;
    if (!core.isValidRunId(runId)) return Promise.resolve(failure('bad-run-id'));
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (ENDING_APPROACHES.indexOf(approach) < 0) return Promise.resolve(failure('bad-approach'));
    if (typeof nonce !== 'string' || !nonce) return Promise.resolve(failure('bad-nonce'));
    const planCheck = core.validateClaimPlan(options.plan);
    if (!planCheck.ok) return Promise.resolve(failure(planCheck.reason || 'bad-plan'));
    const plan = core.normalizePlan(options.plan);
    const at = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const contentVersion = typeof options.contentVersion === 'string' && options.contentVersion ? options.contentVersion : DEFAULT_CONTENT_VERSION;
    return txRun(CLAIM_STORES, 'readwrite', (ctx) => {
      ctx.bind(ctx.store('claims').get(runId), (existingClaim) => {
        readEndingRows(ctx, careerId, (rows) => {
          const canonicalResolved = resolvedEndingFromRows(rows);
          const canonicalReceiptId = canonicalResolved && canonicalResolved.receiptId ? canonicalResolved.receiptId : null;
          if (canonicalReceiptId && canonicalReceiptId !== runId) {
            ctx.done({ ok: false, reason: 'already-resolved', settled: false, wrote: false, resolvedApproach: canonicalResolved.approach || null, receipt: null, flagWritten: false });
            return;
          }
          const fixClaim = (claim, done) => {
            const receipt = receiptOf(claim);
            const resolved = resolvedEndingFromRows(rows);
            const resolvedApproach = resolved && resolved.approach ? resolved.approach : approach;
            if (resolved && resolved.approach && resolved.approach !== approach) {
              done({ ok: false, reason: 'already-resolved', settled: false, wrote: false, resolvedApproach: resolved.approach, receipt: null, flagWritten: false });
              return;
            }
            writeEndingQuestRows(ctx, core, careerId, approach, receipt, at, () => {
              ctx.bind(ctx.store('runs').get(runId), (run) => {
                if (!run) { done({ ok: true, duplicate: true, receipt, wrote: false }); return; }
                if (run.status === 'claimed') { done({ ok: true, duplicate: true, receipt, wrote: false }); return; }
                const updated = jsonClone(run) || {};
                updated.status = 'claimed';
                updated.claimedAt = receipt.claimedAt || at;
                updated.receiptId = runId;
                updated.updatedAt = at;
                ctx.bind(ctx.store('runs').put(updated), () => done({ ok: true, duplicate: true, receipt, wrote: false }));
              });
            });
          };
          if (existingClaim) {
            if (existingClaim.careerId && existingClaim.careerId !== careerId) {
              ctx.fail('career-mismatch');
              return;
            }
            fixClaim(existingClaim, (value) => ctx.done(value));
            return;
          }
          ctx.bind(ctx.store('runs').get(runId), (run) => {
            if (!run) { ctx.fail('missing-run'); return; }
            if (run.careerId !== careerId) { ctx.fail('career-mismatch'); return; }
            if (run.nonce !== nonce) { ctx.fail('nonce-mismatch'); return; }
            if (run.commissionId !== endingMarkerNode(approach)) { ctx.fail('receipt-mismatch'); return; }
            const status = typeof run.status === 'string' ? run.status : '';
            if (status && BLOCKED_RUN_STATUS.indexOf(status) >= 0) { ctx.fail('run-state'); return; }
            const resolved = resolvedEndingFromRows(rows);
            /* 每个生涯只认一张规范终局收据；已有任何终局（同路线不同票也算）都拒绝新写入。 */
            if (resolved) {
              ctx.done({ ok: false, reason: 'already-resolved', settled: false, wrote: false, resolvedApproach: resolved.approach || approach, receipt: null, flagWritten: false });
              return;
            }
            let receipt;
            try {
              receipt = core.buildReceipt({ runId, careerId, commissionId: endingMarkerNode(approach), plan, now: at, contentVersion });
            } catch (err) {
              ctx.fail('core-error', errorText(err));
              return;
            }
            if (!receipt) { ctx.fail('bad-receipt'); return; }
            const providedReceipt = isObject(options.receipt) ? options.receipt : null;
            if (providedReceipt) {
              const mismatch = receiptMismatch(providedReceipt, receipt, core);
              if (mismatch) { ctx.fail(mismatch); return; }
            }
            const steps = core.claimTxSteps(runId, plan);
            const tasks = [
              (next) => writeLedgerSteps(ctx, core, steps, { runId, careerId, now: at, contentVersion }, next),
              (next) => {
                ctx.bind(ctx.store('balances').get(careerId), (balance) => {
                  if (!balance) { ctx.fail('no-wallet'); return; }
                  const prev = core.clampInt(balance.credits, 0, core.RULESET.balanceCap, 0);
                  const nextCredits = prev + plan.credits;
                  if (nextCredits > core.RULESET.balanceCap) { ctx.fail('balance-cap'); return; }
                  const row = {
                    careerId,
                    credits: nextCredits,
                    revision: core.clampInt(balance.revision, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
                    createdAt: typeof balance.createdAt === 'string' ? balance.createdAt : at,
                    updatedAt: at,
                  };
                  ctx.bind(ctx.store('balances').put(row), () => next());
                });
              },
              (next) => incrementInventory(ctx, core, careerId, plan.items, at, next),
              (next) => mergeEquipment(ctx, careerId, plan.equipment || {}, at, next),
              (next) => writeEndingQuestRows(ctx, core, careerId, approach, receipt, at, next),
              (next) => {
                const row = Object.assign({ runId, schemaVersion: SCHEMA_VERSION }, receipt);
                ctx.bindConstraint(ctx.store('claims').add(row), 'constraint', next);
              },
              (next) => {
                const updated = jsonClone(run) || {};
                updated.status = 'claimed';
                updated.claimedAt = at;
                updated.receiptId = runId;
                updated.updatedAt = at;
                ctx.bind(ctx.store('runs').put(updated), next);
              },
            ];
            sequence(tasks, () => ctx.done({ ok: true, duplicate: false, receipt, wrote: true, settled: true, approach, flagsWritten: [ENDING_C5_FLAG, endingMarkerNode(approach)] }));
          });
        });
      });
    }).then((res) => {
      if (res.ok) return res.result;
      if (res.reason === 'constraint') {
        return readClaimReceipt(runId).then((row) => (row ? { ok: true, duplicate: true, receipt: receiptOf(row), wrote: false } : failure('constraint', res.error)));
      }
      return failure(res.reason, res.error);
    });
  }

  /**
   * 幂等修复历史半提交/旧预留：从正常入口调用。
   * - 有一个合法终局收据：补齐规范 C5 与对应终局行，run 恢复 claimed，复用原收据 ID/时间。
   * - 多个收据：以规范 C5/标记链接的收据为准，否则按 claimedAt/receiptId 确定性选择。
   * - 只有旧 ending-reservation 占位：删除占位，让新票据可重新开始。
   * - 不新增 claim/ledger/余额/库存。
   */
  function repairEndingRecords(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    return txRun(['claims', 'runs', 'quests', 'migrations'], 'readwrite', (ctx) => {
      const claimsStore = ctx.store('claims');
      const questsStore = ctx.store('quests');
      const migrationsStore = ctx.store('migrations');
      const readAll = (store, done) => { ctx.bind(store.getAll(), (rows) => done(Array.isArray(rows) ? rows : [])); };
      readAll(claimsStore, (claimRows) => {
        readAll(questsStore, (questRows) => {
          readAll(migrationsStore, (migrationRows) => {
            const endingClaims = claimRows
              .filter((row) => row && row.careerId === careerId && typeof row.commissionId === 'string' && row.commissionId.indexOf('ending.') === 0)
              .sort((a, b) => {
                const left = String(a.claimedAt || '');
                const right = String(b.claimedAt || '');
                if (left !== right) return left < right ? -1 : 1;
                return String(a.receiptId || a.runId || '') < String(b.receiptId || b.runId || '') ? -1 : 1;
              });
            const c5 = questRows.filter((row) => row && row.careerId === careerId && row.nodeId === ENDING_C5_NODE)[0] || null;
            const markers = {};
            ENDING_APPROACHES.forEach((approach) => {
              markers[approach] = questRows.filter((row) => row && row.careerId === careerId && row.nodeId === endingMarkerNode(approach))[0] || null;
            });
            let canonical = null;
            const c5ReceiptId = c5 && (c5.receiptId || c5.sourceReceipt);
            if (c5ReceiptId) canonical = endingClaims.filter((row) => (row.receiptId || row.runId) === c5ReceiptId)[0] || null;
            if (!canonical) {
              for (let i = 0; i < ENDING_APPROACHES.length && !canonical; i += 1) {
                const marker = markers[ENDING_APPROACHES[i]];
                const receiptId = marker && (marker.receiptId || marker.sourceReceipt);
                if (receiptId) canonical = endingClaims.filter((row) => (row.receiptId || row.runId) === receiptId)[0] || null;
              }
            }
            if (!canonical && c5 && ENDING_APPROACHES.indexOf(c5.approach) >= 0) {
              canonical = endingClaims.filter((row) => row.commissionId === endingMarkerNode(c5.approach))[0] || null;
            }
            if (!canonical && endingClaims.length) canonical = endingClaims[0];
            const staleReservations = migrationRows.filter((row) => row && row.kind === 'ending-reservation' && row.careerId === careerId);
            if (!canonical) {
              const tasks = staleReservations.map((row) => (next) => ctx.bind(migrationsStore.delete(row.id), next));
              sequence(tasks, () => ctx.done({ ok: true, repaired: false, clearedReservations: staleReservations.length, canonicalReceiptId: null }));
              return;
            }
            const approach = typeof canonical.commissionId === 'string' ? canonical.commissionId.slice('ending.'.length) : '';
            if (ENDING_APPROACHES.indexOf(approach) < 0) {
              ctx.done({ ok: true, repaired: false, clearedReservations: staleReservations.length, canonicalReceiptId: canonical.receiptId || canonical.runId });
              return;
            }
            const receipt = receiptOf(canonical);
            const receiptId = receipt.receiptId || canonical.runId;
            const at = typeof canonical.claimedAt === 'string' && canonical.claimedAt ? canonical.claimedAt : nowIso();
            writeEndingQuestRows(ctx, core, careerId, approach, receipt, at, () => {
              const tasks = [];
              tasks.push((next) => {
                ctx.bind(ctx.store('runs').get(receipt.runId || canonical.runId), (run) => {
                  if (!run || run.status === 'claimed') { next(); return; }
                  const updated = jsonClone(run) || {};
                  updated.status = 'claimed';
                  updated.claimedAt = at;
                  updated.receiptId = receipt.runId || canonical.runId;
                  updated.updatedAt = nowIso();
                  ctx.bind(ctx.store('runs').put(updated), next);
                });
              });
              staleReservations.forEach((row) => tasks.push((next) => ctx.bind(migrationsStore.delete(row.id), next)));
              sequence(tasks, () => ctx.done({
                ok: true,
                repaired: true,
                canonicalReceiptId: receiptId,
                approach,
                c5Present: !!c5,
                markerPresent: !!markers[approach],
                clearedReservations: staleReservations.length,
                claims: endingClaims.length,
              }));
            });
          });
        });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /* ------------------------------------------------------------------ *
   * 购买（purchases 用 ledgers 的 txId='purchase:<purchaseId>' 去重）
   * ------------------------------------------------------------------ */

  function purchaseReceiptFromLedger(row) {
    if (!row || typeof row !== 'object') return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'purchase',
      receiptId: row.txId,
      purchaseId: row.purchaseId,
      careerId: row.careerId,
      cost: Number(row.cost) || 0,
      items: isObject(row.items) ? row.items : {},
      equipment: isObject(row.equipment) ? row.equipment : {},
      txIds: [row.txId],
      balanceAfter: Number.isFinite(Number(row.balanceAfter)) ? Number(row.balanceAfter) : null,
      purchasedAt: row.at || null,
      rulesetVersion: Number(row.rulesetVersion) || 1,
      contentVersion: typeof row.contentVersion === 'string' ? row.contentVersion : '',
    };
  }

  function readInventoryMap(ctx, careerId, cb) {
    ctx.bind(ctx.store('inventory').getAll(), (rows) => {
      const items = {};
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row || row.careerId !== careerId || typeof row.itemId !== 'string') return;
        /* 0.16 遗留别名：旧库存里的 crystal 统一并按 0.17 的 starcrystal 计。 */
        const itemId = row.itemId === 'crystal' ? 'starcrystal' : row.itemId;
        const count = Math.max(0, Math.floor(Number(row.count) || 0));
        items[itemId] = (items[itemId] || 0) + count;
      });
      cb(items);
    });
  }

  /**
   * 单事务购买：余额检查 + 扣款 + 库存/装备增量；同一 purchaseId 双击只扣一次。
   * @param {{careerId:string, purchaseId:string, cost:number, grants?:object, now?:string, contentVersion?:string}} input
   * @returns {Promise<{ok:boolean, duplicate?:boolean, receipt?:object, reason?:string, error?:string}>}
   */
  function purchase(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    const purchaseId = options.purchaseId;
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (!core.isToken(purchaseId)) return Promise.resolve(failure('bad-purchase-id'));
    const cost = options.cost;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || Math.floor(cost) !== cost || cost <= 0 || cost > core.RULESET.maxPurchaseCost) {
      return Promise.resolve(failure('bad-cost'));
    }
    const grants = isObject(options.grants) ? options.grants : {};
    const costItems = isObject(options.costItems) ? options.costItems : {};
    const at = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const contentVersion =
      typeof options.contentVersion === 'string' && options.contentVersion
        ? options.contentVersion
        : typeof core.DEFAULT_CONTENT_VERSION === 'string'
          ? core.DEFAULT_CONTENT_VERSION
          : DEFAULT_CONTENT_VERSION;
    const txId = 'purchase:' + purchaseId;
    return txRun(['ledgers', 'balances', 'inventory', 'equipment'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('ledgers').get(txId), (existing) => {
        if (existing) {
          ctx.done({ ok: true, duplicate: true, receipt: existing.receipt || purchaseReceiptFromLedger(existing) });
          return;
        }
        ctx.bind(ctx.store('balances').get(careerId), (balance) => {
          if (!balance) {
            ctx.fail('no-wallet');
            return;
          }
          readInventoryMap(ctx, careerId, (items) => {
            let planResult;
            try {
              planResult = core.purchasePlan({ cost, costItems, grants, wallet: { credits: balance.credits, items } });
            } catch (err) {
              ctx.fail('core-error', errorText(err));
              return;
            }
            if (!planResult.ok) {
              ctx.fail(planResult.reason || 'purchase-rejected');
              return;
            }
            const plan = planResult.plan;
            const receipt = {
              schemaVersion: SCHEMA_VERSION,
              kind: 'purchase',
              receiptId: txId,
              purchaseId,
              careerId,
              cost: plan.cost,
              costItems: plan.costItems,
              items: plan.items,
              equipment: plan.equipment,
              txIds: [txId],
              balanceAfter: plan.balanceAfter,
              purchasedAt: at,
              rulesetVersion: core.RULESET_VERSION,
              contentVersion,
            };
            const ledgerRow = {
              txId,
              schemaVersion: SCHEMA_VERSION,
              kind: 'purchase',
              careerId,
              purchaseId,
              step: 1,
              credits: plan.creditsDelta,
              cost: plan.cost,
              costItems: plan.costItems,
              items: plan.items,
              equipment: plan.equipment,
              balanceAfter: plan.balanceAfter,
              at,
              rulesetVersion: core.RULESET_VERSION,
              contentVersion,
              receipt,
            };
            const tasks = [
              (next) => ctx.bind(ctx.store('equipment').get(careerId), (equipmentRow) => {
                const patch = isObject(plan.equipment) ? plan.equipment : {};
                const current = isObject(equipmentRow) ? equipmentRow : {};
                const keys = Object.keys(patch);
                const expectedLevel = options.expectedLevel;
                for (let i = 0; i < keys.length; i += 1) {
                  const match = /^module:([A-Za-z0-9_-]+):level$/.exec(keys[i]);
                  if (!match) continue;
                  const target = Number(patch[keys[i]]);
                  const existing = Number(current[keys[i]]);
                  const owned = Number.isFinite(existing) ? existing : 0;
                  if (Number.isFinite(target) && target <= owned) {
                    ctx.fail('already-owned');
                    return;
                  }
                  if (Number.isFinite(expectedLevel) && Math.floor(expectedLevel) >= 0 && Math.floor(expectedLevel) !== owned) {
                    ctx.fail('price-changed');
                    return;
                  }
                }
                next();
              }),
              (next) => ctx.bindConstraint(ctx.store('ledgers').add(ledgerRow), 'constraint', next),
              (next) => {
                const row = {
                  careerId,
                  credits: plan.balanceAfter,
                  revision: core.clampInt(balance.revision, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
                  createdAt: typeof balance.createdAt === 'string' ? balance.createdAt : at,
                  updatedAt: at,
                };
                ctx.bind(ctx.store('balances').put(row), next);
              },
              (next) => applyInventoryCosts(ctx, core, careerId, plan.costItems, at, next),
              (next) => incrementInventory(ctx, core, careerId, plan.items, at, next),
              (next) => mergeEquipment(ctx, careerId, plan.equipment, at, next),
            ];
            sequence(tasks, () => ctx.done({ ok: true, duplicate: false, receipt }));
          });
        });
      });
    }).then((res) => {
      if (res.ok) return res.result;
      if (res.reason === 'constraint') {
        return txRun(['ledgers'], 'readonly', (ctx) => {
          ctx.bind(ctx.store('ledgers').get(txId), (row) => ctx.done(row || null));
        }).then((readBack) => {
          const row = readBack.ok ? readBack.result : null;
          return row ? { ok: true, duplicate: true, receipt: row.receipt || purchaseReceiptFromLedger(row) } : failure('constraint', res.error);
        });
      }
      return failure(res.reason, res.error);
    });
  }

  /* ------------------------------------------------------------------ *
   * 钱包 / 任务读取与写入
   * ------------------------------------------------------------------ */

  function emptyWallet(reason, error) {
    return { ok: false, reason: reason || 'wallet-unavailable', error: error || reason || 'wallet-unavailable', credits: 0, items: {}, equipment: {} };
  }

  function readWallet(careerId) {
    const core = coreApi();
    if (!core) return Promise.resolve(emptyWallet('core-unavailable'));
    if (!core.isValidCareerId(careerId)) return Promise.resolve(emptyWallet('bad-career-id'));
    return txRun(['balances', 'inventory', 'equipment'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('balances').get(careerId), (balance) => {
        readInventoryMap(ctx, careerId, (items) => {
          ctx.bind(ctx.store('equipment').get(careerId), (equipment) => {
            ctx.done({
              ok: true,
              careerId,
              exists: !!balance,
              credits: balance ? core.clampInt(balance.credits, 0, core.RULESET.balanceCap, 0) : 0,
              revision: balance ? core.clampInt(balance.revision, 0, Number.MAX_SAFE_INTEGER, 0) : 0,
              items,
              equipment: isObject(equipment) ? equipment : {},
            });
          });
        });
      });
    }).then((res) => (res.ok ? res.result : emptyWallet(res.reason, res.error)));
  }

  /** ADR §18.5：读取生涯装备（扁平键；旧挂机库不在本表）。 */
  function getEquipment(careerId) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    return txRun(['equipment', 'balances'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('balances').get(careerId), (balance) => {
        if (!balance) {
          ctx.fail('no-wallet');
          return;
        }
        ctx.bind(ctx.store('equipment').get(careerId), (row) => {
          const equipment = isObject(row) ? jsonClone(row) : { careerId };
          delete equipment.careerId;
          delete equipment.updatedAt;
          ctx.done({ ok: true, careerId, equipment });
        });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /**
   * ADR §18.5：单事务读-合并-写扁平装备键（飞船拥有/切换、模块等级）。
   * patch 只接受 token 键；不可写 careerId/updatedAt；零成本，不入账本。
   */
  function writeEquipment(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    const patch = isObject(options.patch) ? options.patch : null;
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (!patch) return Promise.resolve(failure('bad-equipment'));
    const keys = Object.keys(patch);
    if (keys.length > 32) return Promise.resolve(failure('bad-equipment'));
    const clean = {};
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!core.isToken(key) || key === 'careerId' || key === 'updatedAt') return Promise.resolve(failure('bad-equipment'));
      const value = patch[key];
      if (!(value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value) && value >= 0) || isObject(value))) {
        return Promise.resolve(failure('bad-equipment'));
      }
      clean[key] = value === null ? null : typeof value === 'object' ? jsonClone(value) : value;
    }
    const at = typeof options.now === 'string' && options.now ? options.now : nowIso();
    return txRun(['equipment', 'balances'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('balances').get(careerId), (balance) => {
        if (!balance) {
          ctx.fail('no-wallet');
          return;
        }
        ctx.bind(ctx.store('equipment').get(careerId), (existing) => {
          const row = existing && isObject(existing) ? jsonClone(existing) : { careerId };
          row.careerId = careerId;
          keys.forEach((key) => {
            row[key] = jsonClone(clean[key]);
          });
          row.updatedAt = at;
          ctx.bind(ctx.store('equipment').put(row), () => {
            const equipment = jsonClone(row);
            delete equipment.careerId;
            delete equipment.updatedAt;
            ctx.done({ ok: true, careerId, equipment });
          });
        });
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /** ADR §18.5：最近流水（钱包/收据 UI 只读展示；按 careerId 过滤，最多 limit 条）。 */
  function readLedger(careerId, limit) {
    const core = coreApi();
    if (!core) return Promise.resolve({ ok: false, reason: 'core-unavailable', rows: [] });
    if (!core.isValidCareerId(careerId)) return Promise.resolve({ ok: false, reason: 'bad-career-id', rows: [] });
    const max = core.clampInt(limit, 1, 100, 30);
    return txRun(['ledgers'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('ledgers').getAll(), (rows) => {
        const list = (Array.isArray(rows) ? rows : [])
          .filter((row) => row && row.careerId === careerId)
          .sort((a, b) => String(b.at || b.clearedAt || '').localeCompare(String(a.at || a.clearedAt || '')))
          .slice(0, max)
          .map((row) => {
            const out = {
              txId: row.txId,
              kind: row.kind,
              runId: row.runId || null,
              credits: Number(row.credits) || 0,
              items: isObject(row.items) ? row.items : {},
              cost: Number(row.cost) || 0,
              at: row.at || row.clearedAt || null,
            };
            if (isObject(row.receipt)) out.receipt = row.receipt;
            return out;
          });
        ctx.done({ ok: true, careerId, rows: list });
      });
    }).then((res) => (res.ok ? res.result : { ok: false, reason: res.reason, error: res.error, rows: [] }));
  }

  /** ADR §19.7：原子卖材料：扣库存 → 加信用点 → 写 sale 流水；saleId 幂等、失败零写入。 */
  function sellItems(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    const saleId = options.saleId;
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (!core.isToken(saleId)) return Promise.resolve(failure('bad-sale-id'));
    const items = isObject(options.items) ? options.items : null;
    const credits = options.credits;
    if (!items) return Promise.resolve(failure('bad-items'));
    if (typeof credits !== 'number' || !Number.isFinite(credits) || Math.floor(credits) !== credits || credits <= 0 || credits > core.RULESET.payoutCap) {
      return Promise.resolve(failure('bad-credits'));
    }
    const cleanItems = {};
    const ids = Object.keys(items);
    if (!ids.length || ids.length > core.RULESET.itemKindsCap) return Promise.resolve(failure('bad-items'));
    for (let i = 0; i < ids.length; i += 1) {
      const itemId = ids[i];
      const count = items[itemId];
      if (!core.isToken(itemId)) return Promise.resolve(failure('bad-items'));
      if (!Number.isFinite(count) || Math.floor(count) !== count || count <= 0 || count > core.RULESET.itemCapPerItem) {
        return Promise.resolve(failure('bad-items'));
      }
      cleanItems[itemId] = count;
    }
    const canonicalItems = canonicalItemMap(cleanItems);
    const canonicalIds = Object.keys(canonicalItems);
    const at = typeof options.now === 'string' && options.now ? options.now : nowIso();
    const contentVersion =
      typeof options.contentVersion === 'string' && options.contentVersion
        ? options.contentVersion
        : typeof core.DEFAULT_CONTENT_VERSION === 'string'
          ? core.DEFAULT_CONTENT_VERSION
          : DEFAULT_CONTENT_VERSION;
    const txId = 'sale:' + saleId;
    return txRun(['ledgers', 'balances', 'inventory'], 'readwrite', (ctx) => {
      ctx.bind(ctx.store('ledgers').get(txId), (existing) => {
        if (existing) {
          ctx.done({ ok: true, duplicate: true, receipt: existing.receipt || null });
          return;
        }
        ctx.bind(ctx.store('balances').get(careerId), (balance) => {
          if (!balance) {
            ctx.fail('no-wallet');
            return;
          }
          readInventoryMap(ctx, careerId, (owned) => {
            for (let i = 0; i < canonicalIds.length; i += 1) {
              const itemId = canonicalIds[i];
              if ((owned[itemId] || 0) < canonicalItems[itemId]) {
                ctx.fail('insufficient-items');
                return;
              }
            }
            const nextCredits = core.clampInt(balance.credits, 0, core.RULESET.balanceCap, 0) + credits;
            if (nextCredits > core.RULESET.balanceCap) {
              ctx.fail('balance-cap');
              return;
            }
            const receipt = {
              receiptId: txId,
              kind: 'sale',
              careerId,
              saleId,
              credits,
              items: jsonClone(canonicalItems),
              soldAt: at,
              balanceAfter: nextCredits,
              rulesetVersion: core.RULESET_VERSION,
              contentVersion,
            };
            const ledgerRow = {
              txId,
              schemaVersion: SCHEMA_VERSION,
              kind: 'sale',
              careerId,
              saleId,
              step: 1,
              credits,
              items: jsonClone(canonicalItems),
              at,
              rulesetVersion: core.RULESET_VERSION,
              contentVersion,
              receipt,
            };
            const tasks = [
              (next) => ctx.bindConstraint(ctx.store('ledgers').add(ledgerRow), 'constraint', next),
              (next) => {
                const row = {
                  careerId,
                  credits: nextCredits,
                  revision: core.clampInt(balance.revision, 0, Number.MAX_SAFE_INTEGER, 0) + 1,
                  createdAt: typeof balance.createdAt === 'string' ? balance.createdAt : at,
                  updatedAt: at,
                };
                ctx.bind(ctx.store('balances').put(row), next);
              },
              (next) => applyInventoryCosts(ctx, core, careerId, canonicalItems, at, next),
            ];
            sequence(tasks, () => ctx.done({ ok: true, duplicate: false, receipt }));
          });
        });
      });
    }).then((res) => {
      if (res.ok) return res.result;
      if (res.reason === 'constraint') return failure('duplicate-sale', res.error);
      return failure(res.reason, res.error);
    });
  }

  function readQuestState(careerId) {
    const core = coreApi();
    if (!core) return Promise.resolve({ ok: false, reason: 'core-unavailable', quests: [] });
    if (!core.isValidCareerId(careerId)) return Promise.resolve({ ok: false, reason: 'bad-career-id', quests: [] });
    return txRun(['quests'], 'readonly', (ctx) => {
      ctx.bind(ctx.store('quests').getAll(), (rows) => {
        const quests = (Array.isArray(rows) ? rows : []).filter((row) => row && row.careerId === careerId);
        const byNode = {};
        quests.forEach((row) => {
          if (typeof row.nodeId === 'string') byNode[row.nodeId] = row;
        });
        ctx.done({ ok: true, careerId, quests, byNode });
      });
    }).then((res) => (res.ok ? res.result : { ok: false, reason: res.reason, error: res.error, quests: [] }));
  }

  /**
   * 0.18 终局唯一性预留：migrations 以 marker id 唯一，跨标签只有一个事务能 add 成功。
   * 成功者才继续 settle；失败者零收据/零流水/零旗标。
   */
  function reserveEnding(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    const markerId = options.markerId;
    const ticketId = options.ticketId;
    const approach = options.approach;
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (!core.isToken(markerId) || !core.isToken(ticketId)) return Promise.resolve(failure('bad-ending-marker'));
    const at = nowIso();
    return txRun(['migrations', 'runs'], 'readwrite', (ctx) => {
      const store = ctx.store('migrations');
      const runs = ctx.store('runs');
      ctx.bind(store.get(markerId), (existing) => {
        if (existing) {
          if (existing.ticketId === ticketId) {
            /* 同票据刷新/重试：继续使用自己的预留，凭活跃 claim 幂等取回收据。 */
            ctx.done({ ok: true, resumed: true, row: jsonClone(existing) });
            return;
          }
          /* 其它票据：持有者 run 仍活跃才拒绝；已结束/丢失则回收残留预留。 */
          ctx.bind(runs.get(existing.ticketId), (ownerRun) => {
            var reclaimable = !ownerRun || ['failed', 'abandoned', 'cancelled', 'expired'].indexOf(ownerRun.status) >= 0;
            if (!reclaimable) {
              ctx.done({ ok: false, duplicate: true, existing: jsonClone(existing) });
              return;
            }
            ctx.bind(store.delete(markerId), () => {
              const row = {
                id: markerId,
                kind: 'ending-reservation',
                careerId,
                ticketId,
                approach: typeof approach === 'string' ? approach : '',
                appliedAt: at,
                fromVersion: 0,
                toVersion: 0,
              };
              ctx.bindConstraint(store.add(row), 'constraint', () => ctx.done({ ok: true, row }, null));
            });
          });
          return;
        }
        const row = {
          id: markerId,
          kind: 'ending-reservation',
          careerId,
          ticketId,
          approach: typeof approach === 'string' ? approach : '',
          appliedAt: at,
          fromVersion: 0,
          toVersion: 0,
        };
        ctx.bindConstraint(store.add(row), 'constraint', () => ctx.done({ ok: true, row }, null));
      });
    }).then((res) => {
      if (res.ok) return res.result;
      if (res.reason === 'constraint') return { ok: false, duplicate: true, existing: null };
      return failure(res.reason, res.error);
    });
  }

  function releaseEnding(markerId, ticketId) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!core.isToken(markerId)) return Promise.resolve(failure('bad-ending-marker'));
    return txRun(['migrations'], 'readwrite', (ctx) => {
      const store = ctx.store('migrations');
      ctx.bind(store.get(markerId), (existing) => {
        if (!existing || existing.kind !== 'ending-reservation') {
          ctx.done({ ok: true, released: false });
          return;
        }
        /* 只有预留持有者本人能释放；放弃其它票据不得解除赢家预留。 */
        if (typeof ticketId === 'string' && ticketId && existing.ticketId !== ticketId) {
          ctx.done({ ok: true, released: false, reason: 'not-owner' });
          return;
        }
        ctx.bind(store.delete(markerId), () => ctx.done({ ok: true, released: true }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /** 同一生涯同一委托只能有一个首通：quests 已清 → repeat；同票据中断可恢复；他人活跃占位 → repeat。 */
  function reserveCommissionFirstClear(input) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    const options = isObject(input) ? input : {};
    const careerId = options.careerId;
    const commissionId = options.commissionId;
    const ticketId = options.ticketId;
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    if (!core.isToken(commissionId)) return Promise.resolve(failure('bad-commission-id'));
    if (!core.isToken(ticketId)) return Promise.resolve(failure('bad-ticket'));
    const markerId = 'commission-first:' + careerId + ':' + commissionId;
    return txRun(['migrations', 'quests', 'runs'], 'readwrite', (ctx) => {
      const quests = ctx.store('quests');
      ctx.bind(quests.get([careerId, commissionId]), (questRow) => {
        if (questRow && questRow.status === 'cleared') {
          ctx.done({ ok: false, duplicate: true, reason: 'already-cleared' });
          return;
        }
        const migrations = ctx.store('migrations');
        const runs = ctx.store('runs');
        const addMarker = (done) => {
          const row = {
            id: markerId,
            kind: 'commission-first',
            careerId,
            commissionId,
            ticketId,
            appliedAt: nowIso(),
            fromVersion: 0,
            toVersion: 0,
          };
          ctx.bindConstraint(migrations.add(row), 'constraint', () => done({ ok: true, markerId }));
        };
        ctx.bind(migrations.get(markerId), (existing) => {
          if (existing) {
            if (existing.ticketId === ticketId) {
              ctx.done({ ok: true, resumed: true, markerId });
              return;
            }
            ctx.bind(runs.get(existing.ticketId), (ownerRun) => {
              var reclaimable = !ownerRun || ['failed', 'abandoned', 'cancelled', 'expired'].indexOf(ownerRun.status) >= 0;
              if (!reclaimable) {
                ctx.done({ ok: false, duplicate: true, reason: 'already-reserved' });
                return;
              }
              ctx.bind(migrations.delete(markerId), () => addMarker((value) => ctx.done(value)));
            });
            return;
          }
          addMarker((value) => ctx.done(value));
        });
      });
    }).then((res) => {
      if (res.ok) return res.result;
      if (res.reason === 'constraint') return { ok: false, duplicate: true, reason: 'already-reserved' };
      return failure(res.reason, res.error);
    });
  }

  function releaseCommissionFirstClear(markerId, ticketId) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!core.isToken(markerId)) return Promise.resolve(failure('bad-marker'));
    return txRun(['migrations'], 'readwrite', (ctx) => {
      const store = ctx.store('migrations');
      ctx.bind(store.get(markerId), (existing) => {
        if (!existing || existing.kind !== 'commission-first') {
          ctx.done({ ok: true, released: false });
          return;
        }
        if (typeof ticketId === 'string' && ticketId && existing.ticketId !== ticketId) {
          ctx.done({ ok: true, released: false, reason: 'not-owner' });
          return;
        }
        ctx.bind(store.delete(markerId), () => ctx.done({ ok: true, released: true }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function putQuests(careerId, quests) {    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    let list = quests;
    if (isObject(quests)) list = Object.keys(quests).map((key) => quests[key]);
    if (!Array.isArray(list)) return Promise.resolve(failure('bad-quests'));
    const at = nowIso();
    const records = [];
    for (let i = 0; i < list.length; i += 1) {
      const raw = list[i];
      if (!isObject(raw) || !core.isToken(raw.nodeId)) return Promise.resolve(failure('bad-quest'));
      const row = jsonClone(raw) || {};
      row.careerId = careerId;
      row.nodeId = raw.nodeId;
      row.schemaVersion = SCHEMA_VERSION;
      row.updatedAt = at;
      records.push(row);
    }
    return txRun(['quests'], 'readwrite', (ctx) => {
      const store = ctx.store('quests');
      const tasks = records.map((record) => (next) => ctx.bind(store.put(record), next));
      sequence(tasks, () => ctx.done({ ok: true, count: records.length }));
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /* ------------------------------------------------------------------ *
   * 重置 / 备份
   * ------------------------------------------------------------------ */

  function deleteRows(ctx, storeName, predicate) {
    return (next) => {
      const store = ctx.store(storeName);
      ctx.bind(store.getAll(), (rows) => {
        const targets = (Array.isArray(rows) ? rows : []).filter(predicate);
        const tasks = targets.map((row) => (done) => ctx.bind(store.delete(rowKey(storeName, row)), done));
        sequence(tasks, next);
      });
    };
  }

  /**
   * 清除单个生涯（profile/balances/inventory/equipment/quests/claims/ledgers/runs），
   * 单事务；不影响其它 careerId 的记录。
   */
  function resetCareer(careerId) {
    const core = coreApi();
    if (!core) return Promise.resolve(failure('core-unavailable'));
    if (!core.isValidCareerId(careerId)) return Promise.resolve(failure('bad-career-id'));
    return txRun(['state', 'profiles', 'balances', 'equipment', 'inventory', 'quests', 'claims', 'ledgers', 'runs'], 'readwrite', (ctx) => {
      const inCareer = (row) => !!row && row.careerId === careerId;
      const tasks = [
        (next) => ctx.bind(ctx.store('profiles').delete(careerId), next),
        (next) => ctx.bind(ctx.store('balances').delete(careerId), next),
        (next) => ctx.bind(ctx.store('equipment').delete(careerId), next),
        deleteRows(ctx, 'inventory', inCareer),
        deleteRows(ctx, 'quests', inCareer),
        deleteRows(ctx, 'claims', inCareer),
        deleteRows(ctx, 'ledgers', inCareer),
        deleteRows(ctx, 'runs', inCareer),
        (next) => {
          ctx.bind(ctx.store('state').get(STATE_KEY_CAREER), (pointer) => {
            if (pointer && isObject(pointer.value) && pointer.value.careerId === careerId) {
              ctx.bind(ctx.store('state').delete(STATE_KEY_CAREER), next);
              return;
            }
            next();
          });
        },
      ];
      sequence(tasks, () => ctx.done({ ok: true, careerId }));
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /** 清除发现状态（state 的 'discovery' 记录 + 整个 discovery store），不动生涯资产。 */
  function resetDiscovery() {
    return txRun(['state', 'discovery'], 'readwrite', (ctx) => {
      readDiscoveryGeneration(ctx, (current) => {
        const next = current + 1;
        const tasks = [
          (nextTask) => ctx.bind(ctx.store('discovery').clear(), nextTask),
          (nextTask) => ctx.bind(ctx.store('state').delete(STATE_KEY_DISCOVERY), nextTask),
          (nextTask) => writeDiscoveryGeneration(ctx, next, nextTask),
        ];
        sequence(tasks, () => ctx.done({ ok: true, generation: next }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  function exportAll(options) {
    const core = coreApi();
    const opts = typeof options === 'string' ? { contentVersion: options } : isObject(options) ? options : {};
    const contentVersion =
      typeof opts.contentVersion === 'string' && opts.contentVersion
        ? opts.contentVersion
        : core && typeof core.DEFAULT_CONTENT_VERSION === 'string'
          ? core.DEFAULT_CONTENT_VERSION
          : DEFAULT_CONTENT_VERSION;
    const exportedAt = typeof opts.exportedAt === 'string' && opts.exportedAt ? opts.exportedAt : nowIso();
    return txRun(STORES, 'readonly', (ctx) => {
      const data = {};
      const names = STORES.slice();
      const tasks = names.map((name) => (next) => {
        ctx.bind(ctx.store(name).getAll(), (rows) => {
          data[name] = Array.isArray(rows) ? rows : [];
          next();
        });
      });
      sequence(tasks, () => {
        const payload = {
          format: FORMAT,
          careerSchemaVersion: SCHEMA_VERSION,
          contentVersion,
          exportedAt,
        };
        STORES.forEach((name) => {
          payload[name] = data[name] || [];
        });
        /* 发现代次是本机防旧标签回写的内部元数据，不随旧港档案迁移。 */
        if (Array.isArray(payload.state)) {
          payload.state = payload.state.filter((row) => !row || row.key !== STATE_KEY_DISCOVERY_GENERATION);
        }
        ctx.done(payload);
      });
    }).then((res) => (res.ok ? { ok: true, payload: res.result } : failure(res.reason, res.error)));
  }

  function validateSnapshot(snapshot) {
    if (!isObject(snapshot)) return { ok: false, reason: 'bad-snapshot', error: 'snapshot-not-object' };
    if (snapshot.format !== FORMAT) return { ok: false, reason: 'bad-format', error: 'expected:' + FORMAT };
    if (Number(snapshot.careerSchemaVersion) !== SCHEMA_VERSION) {
      return { ok: false, reason: 'unsupported-schema', error: 'careerSchemaVersion=' + JSON.stringify(snapshot.careerSchemaVersion) };
    }
    const entries = {};
    const counts = {};
    for (let i = 0; i < STORES.length; i += 1) {
      const name = STORES[i];
      const raw = snapshot[name];
      if (!Array.isArray(raw)) return { ok: false, reason: 'bad-snapshot', error: 'missing-store:' + name };
      if (raw.length > MAX_IMPORT_ROWS) return { ok: false, reason: 'too-many-rows', error: name + ':' + raw.length };
      const seen = [];
      const clean = [];
      for (let j = 0; j < raw.length; j += 1) {
        const record = raw[j];
        if (!isObject(record)) return { ok: false, reason: 'bad-record', error: name + '[' + j + ']' };
        const key = rowKey(name, record);
        const usable = Array.isArray(key) ? key.every((part) => typeof part === 'string' && part) : typeof key === 'string' && key;
        if (!usable) return { ok: false, reason: 'bad-record', error: name + '[' + j + '].key' };
        for (let k = 0; k < seen.length; k += 1) {
          if (sameKey(seen[k], key)) return { ok: false, reason: 'duplicate-key', error: name + ':' + String(key) };
        }
        seen.push(key);
        const clone = jsonClone(record);
        if (clone === undefined) return { ok: false, reason: 'bad-record', error: name + '[' + j + '].json' };
        clean.push(clone);
      }
      entries[name] = clean;
      counts[name] = clean.length;
    }
    return { ok: true, entries, counts };
  }

  /**
   * 导入快照：先整体校验（staging），再单事务替换（或合并）；不做迁移（迁移在 backup.js）。
   * @param {object} snapshot
   * @param {{mode?:'replace'|'merge'}} [options]
   */
  function importAll(snapshot, options) {
    const opts = isObject(options) ? options : {};
    const mode = opts.mode === 'merge' ? 'merge' : 'replace';
    const validated = validateSnapshot(snapshot);
    if (!validated.ok) return Promise.resolve(failure(validated.reason, validated.error));
    return txRun(STORES, 'readwrite', (ctx) => {
      const stateStore = ctx.store('state');
      readDiscoveryGeneration(ctx, (currentGeneration) => {
        const nextGeneration = currentGeneration + 1;
        const entries = {};
        STORES.forEach((name) => {
          entries[name] = (validated.entries[name] || []).filter((record) => {
            return !(name === 'state' && record && record.key === STATE_KEY_DISCOVERY_GENERATION);
          });
        });
        const tasks = [];
        if (mode === 'replace') {
          STORES.forEach((name) => tasks.push((next) => ctx.bind(ctx.store(name).clear(), next)));
        }
        STORES.forEach((name) => {
          const store = ctx.store(name);
          entries[name].forEach((record) => {
            tasks.push((next) => ctx.bindConstraint(store.put(record), 'write-failed', next));
          });
        });
        tasks.push((next) => writeDiscoveryGeneration(ctx, nextGeneration, next));
        sequence(tasks, () => ctx.done({ ok: true, mode, counts: validated.counts, generation: nextGeneration }));
      });
    }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
  }

  /* ------------------------------------------------------------------ *
   * 测试辅助（仅供 tools/career_db_test.mjs；生产代码不得依赖）
   * ------------------------------------------------------------------ */

  function deleteDatabase() {
    const factory = factoryRef();
    if (!factory) return Promise.resolve(failure('no-indexeddb', 'indexeddb-unavailable'));
    try {
      if (cachedDb) {
        try {
          cachedDb.close();
        } catch (err) {
          /* ignore */
        }
        cachedDb = null;
      }
    } catch (err) {
      /* ignore */
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve(value);
      };
      timer = setTimeout(() => finish(failure('blocked', 'delete-blocked')), BLOCKED_TIMEOUT_MS);
      let request;
      try {
        request = factory.deleteDatabase(DB_NAME);
      } catch (err) {
        finish(failure('delete-failed', errorText(err)));
        return;
      }
      request.onsuccess = () => finish({ ok: true });
      request.onerror = () => finish(failure('delete-failed', errorText(request.error)));
      request.onblocked = () => {
        /* blockedTimer 兜底 */
      };
    });
  }

  const coreTest = {
    STORES: STORES.slice(),
    STORE_DEFS,
    txRun,
    open: openDb,
    close() {
      return api.close();
    },
    deleteDatabase,
    clearAll() {
      return txRun(STORES, 'readwrite', (ctx) => {
        const tasks = STORES.map((name) => (next) => ctx.bind(ctx.store(name).clear(), next));
        sequence(tasks, () => ctx.done({ ok: true }));
      }).then((res) => (res.ok ? res.result : failure(res.reason, res.error)));
    },
    countRecords(storeName) {
      if (STORES.indexOf(storeName) < 0) return Promise.resolve(-1);
      return txRun([storeName], 'readonly', (ctx) => {
        ctx.bind(ctx.store(storeName).count(), (count) => ctx.done(count));
      }).then((res) => (res.ok ? res.result : -1));
    },
    getDb() {
      return cachedDb;
    },
  };

  /* ------------------------------------------------------------------ *
   * 对外 API
   * ------------------------------------------------------------------ */

  const api = {
    DB_NAME,
    DB_VERSION,
    SCHEMA_VERSION,
    STORES: STORES.slice(),
    FORMAT,
    open: openDb,
    close() {
      const db = cachedDb;
      cachedDb = null;
      if (!db) return { ok: true, closed: false };
      try {
        db.close();
        return { ok: true, closed: true };
      } catch (err) {
        return failure('close-failed', errorText(err));
      }
    },
    isAvailable() {
      if (!factoryRef()) return Promise.resolve(false);
      if (cachedDb) return Promise.resolve(true);
      return openDb().then((opened) => opened.ok === true);
    },
    getDiscoveryState,
    saveDiscoveryState,
    mergeDiscoveryState,
    getDiscoveryGeneration,
    bumpDiscoveryGeneration,
    getDiscoverySnapshot,
    listDiscovery,
    putDiscovery,
    /* 兼容适配层（非 ADR 必需）：供 D15-04 bridge.js 探测名使用，语义同 discovery 读写。 */
    saveState,
    getState,
    getProfile,
    putProfile,
    ensureCareer,
    createRun,
    getRun,
    updateRun,
    getClaim,
    settleAndClaim,
    hasPendingFirstClear,
    settleEndingAndClaim,
    repairEndingRecords,
    purchase,
    sellItems,
    reserveEnding,
    releaseEnding,
    reserveCommissionFirstClear,
    releaseCommissionFirstClear,
    readWallet,
    getEquipment,
    writeEquipment,
    readLedger,
    readQuestState,
    putQuests,
    resetCareer,
    resetDiscovery,
    exportAll,
    importAll,
    __coreTest: coreTest,
  };

  return api;
});
