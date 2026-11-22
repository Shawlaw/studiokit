/*!
 * StudioKit Arcade Life — 免费租机路径（0.16，D16-07）
 *
 * 职责：把内容里声明为可租用的飞船（当前只有「旧翼」）做成一条零成本路线——
 * 玩家在机库/告示板点一次「免费租用」，模块只写一张仅限本标签页会话的租机凭证，
 * 出击页激活委托时由 bridge 读同一张凭证并合入 startParams.rentalShipId；
 * 同时提供「租机 + 接单」的一次性便捷方法。失败不影响既有探索，也不留下凭证。
 *
 * 边界（不得越界）：
 * - 纯 UMD：浏览器挂 window.ArcadeCareerRental，并镜像到 window.ArcadeCareer.rental；
 *   Node 中 module.exports 返回同一 API（同一套方法可在测试里直接 require）。
 * - 无网络、无持久存档、无 DOM：内容与情况由调用方注入（configure / create）；
 *   存储只接受调用方注入的会话级 storage，模块自身不碰任何宿主存储。
 * - 只维护一张会话凭证：不扣信用点/材料、不写账本、不写生涯数据库、不写旧机库；
 *   任何失败都返回结构化结果，绝不向调用方抛异常，也不留下半截凭证。
 * - 数字只来自内容（价格 > 0 才可租）与注入的时钟；本模块不发明价格、不按分数换算。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  var api = factory(root, false);
  root.ArcadeCareerRental = api;
  /* bridge 的统一依赖装载约定：模块镜像到 window.ArcadeCareer.<global>，
     hangar/UI 也可以用 window.ArcadeCareerRental 直接取到同一对象。 */
  var career = root.ArcadeCareer;
  if (!career || typeof career !== 'object') career = root.ArcadeCareer = {};
  if (career.rental !== api) {
    try {
      career.rental = api;
    } catch (err) {
      /* 只读宿主：忽略 */
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, isNode) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量
   * ------------------------------------------------------------------ */

  var MODULE_VERSION = '0.16.0';
  var CONTENT_VERSION = '0.16.0';
  /* ADR §18.3：ticket 与本凭证都只用于当前标签页会话，不是持久存档。 */
  var STORAGE_KEY = 'studiokit:arcade:career:rental.v1';
  var MARKER_SCHEMA_VERSION = 1;
  /* 6 小时只是「清理提示」：current() 会标 expired，但绝不据此阻塞出击。 */
  var DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
  var STORAGE_MAX_BYTES = 512;
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

  var NOTE_FREE = '本次出击免费，不改变拥有/装备';
  var NOTE_OWNED = '这艘船本来就在你名下';
  var NOTE_EXPIRED = '这张租机凭证已经过期，只作提醒，不挡出击。';

  var REASONS = {
    contentMissing: 'content-missing',
    contentInvalid: 'content-invalid',
    contentVersionMismatch: 'content-version-mismatch',
    badShipId: 'bad-ship-id',
    unknownShip: 'unknown-ship',
    notRentable: 'not-rentable',
    badCareerId: 'bad-career-id',
    badCommissionId: 'bad-commission-id',
    storageUnavailable: 'storage-unavailable',
    writeFailed: 'write-failed',
    removeFailed: 'remove-failed',
    commissionUnavailable: 'commission-unavailable',
    commissionFailed: 'commission-failed',
    failed: 'failed',
    exception: 'exception',
  };

  /* ------------------------------------------------------------------ *
   * 基础工具（纯 JS）
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFunction(value) {
    return typeof value === 'function';
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

  function byteLength(text) {
    try {
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(text)).length;
    } catch (err) {
      /* 旧宿主 / 受限上下文：按字符数近似（凭证只有 ASCII 字段） */
    }
    return String(text).length;
  }

  function toPositiveInt(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num) || Math.floor(num) < 1) return fallback;
    return Math.floor(num);
  }

  function toFiniteNumber(value) {
    var num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function trimText(value, max) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (max && text.length > max) text = text.slice(0, max);
    return text;
  }

  /** 0.x 预发布版本链：0.16.x 互相兼容，0.15 与 0.16 不兼容（与 commission-core 一致）。 */
  function versionKey(version) {
    if (typeof version !== 'string') return null;
    var match = /^v?(\d+)\.(\d+)/.exec(version.trim());
    if (!match) return null;
    var major = parseInt(match[1], 10);
    var minor = parseInt(match[2], 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
    return major === 0 ? '0.' + minor : String(major);
  }

  function versionsCompatible(version) {
    var a = versionKey(version);
    var b = versionKey(CONTENT_VERSION);
    return a !== null && b !== null && a === b;
  }

  function cryptoRef() {
    try {
      if (root && root.crypto) return root.crypto;
      if (typeof crypto !== 'undefined' && crypto) return crypto;
    } catch (err) {
      /* 隐私模式 / 非安全上下文 */
    }
    return null;
  }

  function hexFallback(length) {
    var out = '';
    while (out.length < length) {
      out += Math.floor(Math.random() * 0x100000000)
        .toString(16)
        .slice(-8);
    }
    return out.slice(0, length).replace(/[^0-9a-f]/g, '0');
  }

  /** 凭证 nonce：与 ticket 同形的 32+ hex；crypto 不可用时退化为普通随机（非安全用途）。 */
  function makeNonce() {
    var api = cryptoRef();
    if (api && isFunction(api.getRandomValues)) {
      try {
        var buffer = new Uint8Array(16);
        api.getRandomValues(buffer);
        var out = '';
        for (var i = 0; i < buffer.length; i += 1) {
          out += (buffer[i] + 256).toString(16).slice(1);
        }
        if (/^[0-9a-f]{32}$/.test(out)) return out;
      } catch (err) {
        /* 落到回退 */
      }
    }
    return hexFallback(32);
  }

  function failure(reason, extra) {
    var out = { ok: false, reason: reason || 'failed' };
    if (isObject(extra)) {
      Object.keys(extra).forEach(function (key) {
        if (key !== 'ok' && key !== 'reason') out[key] = extra[key];
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 内容规范化（items.json → 可租白名单）
   * ------------------------------------------------------------------ */

  function normalizeShipEntry(raw, index, errors, warnings) {
    if (!isObject(raw)) {
      errors.push('ship-not-object:' + index);
      return null;
    }
    var shipId = trimText(raw.shipId, 80);
    if (!shipId || !ID_RE.test(shipId)) {
      errors.push('ship-id-invalid:' + (shipId || '<empty>'));
      return null;
    }
    var name = trimText(raw.name, 80) || shipId;
    var price = toFiniteNumber(raw.price);
    var rental = raw.rental === true;
    var rentable = false;
    if (rental) {
      if (price === null || price <= 0) {
        errors.push('rental-price-invalid:' + shipId);
      } else {
        rentable = true;
      }
    }
    if (raw.rental !== undefined && raw.rental !== true && raw.rental !== false) {
      warnings.push('ship-rental-flag-normalized:' + shipId);
    }
    return {
      shipId: shipId,
      name: name,
      price: price === null ? 0 : price,
      rental: rental,
      rentable: rentable,
    };
  }

  /**
   * 内容规范化：可租 = rental:true 且价格 > 0 的飞船；非法条目记 errors 但不抛。
   * `valid` 只表示 ships 结构可用（可继续提供有效条目），`usable` 表示至少有一艘可租。
   */
  function normalizeItems(raw) {
    var errors = [];
    var warnings = [];
    var contentVersion = '';
    var ships = [];
    var rentals = [];
    var byId = Object.create(null);
    var present = raw !== undefined && raw !== null;
    var valid = false;

    if (!present) {
      errors.push('content-missing');
    } else if (!isObject(raw)) {
      errors.push('content-invalid');
    } else {
      if (typeof raw.contentVersion === 'string' && raw.contentVersion.trim()) {
        contentVersion = raw.contentVersion.trim();
      } else {
        warnings.push('content-version-missing');
      }
      if (contentVersion && !versionsCompatible(contentVersion)) {
        errors.push('content-version-mismatch:' + contentVersion);
      }
      if (!Array.isArray(raw.ships)) {
        errors.push('ships-not-array');
      } else {
        valid = true;
        for (var i = 0; i < raw.ships.length; i += 1) {
          var clean = normalizeShipEntry(raw.ships[i], i, errors, warnings);
          if (!clean) continue;
          if (byId[clean.shipId]) {
            errors.push('ship-duplicate:' + clean.shipId);
            continue;
          }
          byId[clean.shipId] = clean;
          ships.push(clean);
          if (clean.rentable) {
            rentals.push({ shipId: clean.shipId, name: clean.name, price: clean.price });
          }
        }
        if (ships.length === 0) errors.push('ships-empty');
      }
    }

    var versionMismatch = errors.some(function (code) {
      return code.indexOf('content-version-mismatch:') === 0;
    });

    return {
      present: present,
      valid: valid,
      blocked: versionMismatch,
      contentVersion: contentVersion,
      ships: ships,
      rentals: rentals,
      byId: byId,
      errors: errors,
      warnings: warnings,
      usable: valid && rentals.length > 0 && !versionMismatch,
    };
  }

  /* ------------------------------------------------------------------ *
   * 工厂：每个实例有独立的注入内容 / 存储 / 时钟，便于 Node 测试与 UI 隔离
   * ------------------------------------------------------------------ */

  function createRental(options) {
    var opts = isObject(options) ? options : {};

    var state = {
      /* storage 必须显式注入（create 或 configure）；null 表示「没有可用的会话上下文」。 */
      storage: opts.storage !== undefined ? opts.storage : null,
      commission: isObject(opts.commission) ? opts.commission : null,
      now: isFunction(opts.now) ? opts.now : null,
      ttlMs: toPositiveInt(opts.ttlMs, DEFAULT_TTL_MS),
      equipment: isObject(opts.equipment) ? clone(opts.equipment) : null,
      content: null,
    };

    function applyItems(raw) {
      state.content = normalizeItems(raw);
      return state.content;
    }

    if (opts.items !== undefined) applyItems(opts.items);

    /* ---------------- 时钟 ---------------- */

    function nowIso() {
      if (state.now) {
        try {
          var value = state.now();
          if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
          if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
          if (typeof value === 'string' && value) {
            var parsed = Date.parse(value);
            if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
          }
        } catch (err) {
          /* 落到系统时间 */
        }
      }
      return new Date().toISOString();
    }

    function nowMs() {
      var parsed = Date.parse(nowIso());
      return Number.isFinite(parsed) ? parsed : Date.now();
    }

    /* ---------------- 会话级存储（只接受注入） ---------------- */

    function storageRef() {
      var storage = state.storage;
      if (!storage || typeof storage !== 'object') return null;
      if (!isFunction(storage.setItem) || !isFunction(storage.removeItem)) return null;
      return storage;
    }

    function readRaw() {
      var storage = storageRef();
      if (!storage || !isFunction(storage.getItem)) return null;
      try {
        var raw = storage.getItem(STORAGE_KEY);
        if (!raw || typeof raw !== 'string' || raw.length > STORAGE_MAX_BYTES) return null;
        var parsed = JSON.parse(raw);
        return isObject(parsed) ? { marker: parsed, raw: raw } : null;
      } catch (err) {
        return null;
      }
    }

    function writeRaw(marker) {
      var storage = storageRef();
      if (!storage) return failure(REASONS.storageUnavailable, { markerWritten: false });
      var previousRaw = null;
      try {
        if (isFunction(storage.getItem)) previousRaw = storage.getItem(STORAGE_KEY);
      } catch (err) {
        previousRaw = null;
      }
      try {
        var text = JSON.stringify(marker);
        if (typeof text !== 'string' || byteLength(text) > STORAGE_MAX_BYTES) {
          return failure(REASONS.writeFailed, { markerWritten: false, error: 'marker-too-large' });
        }
        storage.setItem(STORAGE_KEY, text);
      } catch (err) {
        return failure(REASONS.writeFailed, { markerWritten: false, error: errorText(err) });
      }
      return { ok: true, markerWritten: true, previousRaw: previousRaw };
    }

    function restoreRaw(previousRaw) {
      var storage = storageRef();
      if (!storage) return false;
      try {
        if (typeof previousRaw === 'string' && previousRaw) storage.setItem(STORAGE_KEY, previousRaw);
        else storage.removeItem(STORAGE_KEY);
        return true;
      } catch (err) {
        return false;
      }
    }

    /* ---------------- 凭证 ---------------- */

    function buildMarker(shipId, careerId) {
      var at = nowIso();
      var base = Date.parse(at);
      if (!Number.isFinite(base)) base = Date.now();
      return {
        schemaVersion: MARKER_SCHEMA_VERSION,
        shipId: shipId,
        careerId: careerId,
        at: at,
        expiresAt: new Date(base + state.ttlMs).toISOString(),
        nonce: makeNonce(),
        contentVersion: CONTENT_VERSION,
      };
    }

    function isOwned(shipId, input) {
      if (input && input.owned === true) return true;
      if (input && isObject(input.ship) && input.ship.owned === true) return true;
      var key = 'ship:' + shipId + ':owned';
      var sources = [input && input.equipment, input && input.wallet && input.wallet.equipment, state.equipment];
      for (var i = 0; i < sources.length; i += 1) {
        if (isObject(sources[i]) && sources[i][key] === true) return true;
      }
      return false;
    }

    function ownedHint(shipId) {
      return {
        ok: true,
        owned: true,
        shipId: shipId,
        rental: null,
        marker: false,
        note: NOTE_OWNED,
      };
    }

    /* ---------------- 公开方法：configure ---------------- */

    function configure(input) {
      try {
        var opts = isObject(input) ? input : null;
        var hasItems = false;
        var items = null;
        if (opts && Object.prototype.hasOwnProperty.call(opts, 'items')) {
          hasItems = true;
          items = opts.items;
        } else if (opts && (Object.prototype.hasOwnProperty.call(opts, 'ships') ||
          Object.prototype.hasOwnProperty.call(opts, 'contentVersion'))) {
          /* 容错：直接传 items.json 本体也接受（与 commission-core.configure 一致）。 */
          hasItems = true;
          items = opts;
        }
        if (hasItems) applyItems(items);
        if (opts) {
          if (Object.prototype.hasOwnProperty.call(opts, 'storage')) {
            state.storage = opts.storage === undefined ? state.storage : opts.storage;
          }
          if (isObject(opts.commission)) state.commission = opts.commission;
          if (isFunction(opts.now)) state.now = opts.now;
          if (opts.ttlMs !== undefined) state.ttlMs = toPositiveInt(opts.ttlMs, DEFAULT_TTL_MS);
          if (isObject(opts.equipment)) state.equipment = clone(opts.equipment);
        }
        var content = state.content || normalizeItems(undefined);
        return {
          ok: content.errors.length === 0,
          contentVersion: content.contentVersion || CONTENT_VERSION,
          shipCount: content.ships.length,
          rentalCount: content.rentals.length,
          rentals: clone(content.rentals) || [],
          errors: content.errors.slice(),
          warnings: content.warnings.slice(),
          usable: content.usable,
        };
      } catch (err) {
        return {
          ok: false,
          contentVersion: CONTENT_VERSION,
          shipCount: 0,
          rentalCount: 0,
          rentals: [],
          errors: [errorText(err)],
          warnings: [],
          usable: false,
        };
      }
    }

    /* ---------------- 公开方法：rent ---------------- */

    function rent(input) {
      try {
        var opts = isObject(input) ? input : {};
        var rawShipId = typeof opts.shipId === 'string' ? opts.shipId.trim() : '';
        if (!rawShipId || !ID_RE.test(rawShipId)) {
          return failure(REASONS.badShipId, { shipId: typeof opts.shipId === 'string' ? opts.shipId : null });
        }
        var careerId = opts.careerId;
        if (careerId === undefined || careerId === null) careerId = '';
        if (typeof careerId !== 'string') return failure(REASONS.badCareerId, { shipId: rawShipId });

        var content = state.content;
        if (!content || !content.present || content.errors.indexOf('content-missing') >= 0) {
          return failure(REASONS.contentMissing, { shipId: rawShipId });
        }
        if (!content.valid) return failure(REASONS.contentInvalid, { shipId: rawShipId, errors: content.errors.slice() });
        if (content.blocked) {
          return failure(REASONS.contentVersionMismatch, {
            shipId: rawShipId,
            contentVersion: content.contentVersion || null,
          });
        }
        var ship = content.byId[rawShipId];
        if (!ship) return failure(REASONS.unknownShip, { shipId: rawShipId });
        if (ship.rental !== true || !ship.rentable) return failure(REASONS.notRentable, { shipId: rawShipId });

        if (isOwned(rawShipId, opts)) {
          var owned = ownedHint(rawShipId);
          owned.careerId = careerId;
          return owned;
        }

        var marker = buildMarker(rawShipId, careerId);
        var written = writeRaw(marker);
        if (!written.ok) {
          written.shipId = rawShipId;
          return written;
        }
        return {
          ok: true,
          owned: false,
          marker: true,
          shipId: rawShipId,
          careerId: careerId,
          rental: {
            shipId: rawShipId,
            careerId: careerId,
            at: marker.at,
            expiresAt: marker.expiresAt,
            nonce: marker.nonce,
          },
          ship: { shipId: ship.shipId, name: ship.name, price: ship.price, rental: true },
          note: NOTE_FREE,
        };
      } catch (err) {
        return failure(REASONS.exception, { error: errorText(err) });
      }
    }

    /* ---------------- 公开方法：current / clear ---------------- */

    function current() {
      try {
        var found = readRaw();
        if (!found) return null;
        var marker = found.marker;
        var shipId = typeof marker.shipId === 'string' ? marker.shipId.trim() : '';
        if (!shipId) return null;
        var at = typeof marker.at === 'string' && marker.at ? marker.at : null;
        var expiresAt = typeof marker.expiresAt === 'string' && marker.expiresAt ? marker.expiresAt : null;
        if (!expiresAt && at) {
          var atMs = Date.parse(at);
          if (Number.isFinite(atMs)) expiresAt = new Date(atMs + state.ttlMs).toISOString();
        }
        var expired = false;
        if (expiresAt) {
          var expiresMs = Date.parse(expiresAt);
          if (Number.isFinite(expiresMs)) expired = nowMs() > expiresMs;
        }
        return {
          ok: true,
          shipId: shipId,
          careerId: typeof marker.careerId === 'string' ? marker.careerId : '',
          at: at,
          expiresAt: expiresAt,
          expired: expired,
          nonce: typeof marker.nonce === 'string' ? marker.nonce : '',
          note: expired ? NOTE_EXPIRED : NOTE_FREE,
        };
      } catch (err) {
        return null;
      }
    }

    function clear() {
      try {
        var storage = storageRef();
        if (!storage) return failure(REASONS.storageUnavailable, { cleared: false });
        var had = !!readRaw();
        storage.removeItem(STORAGE_KEY);
        return { ok: true, cleared: had };
      } catch (err) {
        return failure(REASONS.removeFailed, { cleared: false, error: errorText(err) });
      }
    }

    /* ---------------- 公开方法：prepareCommission ---------------- */

    function resolveCommission(override) {
      var candidates = [
        override,
        state.commission,
        root && root.ArcadeCareer && root.ArcadeCareer.commission,
        root && root.ArcadeCareerCommission,
      ];
      for (var i = 0; i < candidates.length; i += 1) {
        var candidate = candidates[i];
        if (isObject(candidate) && isFunction(candidate.start)) return candidate;
      }
      return null;
    }

    function tightenMarker(careerId) {
      if (typeof careerId !== 'string' || !careerId) return false;
      var found = readRaw();
      if (!found) return false;
      if (found.marker.careerId === careerId) return true;
      var next = clone(found.marker) || {};
      next.careerId = careerId;
      var written = writeRaw(next);
      return written.ok === true;
    }

    /**
     * 便捷组合：先写免费租机凭证，再叫注入的 commission.start。
     * 不自行发钱、不写账本/数据库；start 失败时把凭证恢复到调用前的状态
     * （没写过则不留下任何「免费租机」状态）。
     */
    function prepareCommission(input) {
      return new Promise(function (resolve) {
        try {
          var opts = isObject(input) ? input : {};
          var commissionId = trimText(opts.commissionId, 120);
          if (!commissionId) {
            resolve(failure(REASONS.badCommissionId, { rental: null, ticket: null, url: null }));
            return;
          }
          var commission = resolveCommission(opts.commission);
          if (!commission) {
            resolve(failure(REASONS.commissionUnavailable, {
              commissionId: commissionId,
              rental: null,
              ticket: null,
              url: null,
            }));
            return;
          }
          var rawCareerId = opts.careerId;
          var requestedCareerId = typeof rawCareerId === 'string' ? rawCareerId.trim() : '';
          var previous = readRaw();

          var rentResult = rent({
            shipId: opts.shipId,
            careerId: rawCareerId,
            owned: opts.owned,
            ship: opts.ship,
            equipment: opts.equipment,
            wallet: opts.wallet,
          });
          if (!rentResult || rentResult.ok !== true) {
            resolve({
              ok: false,
              reason: (rentResult && rentResult.reason) || REASONS.failure,
              commissionId: commissionId,
              rental: null,
              ticket: null,
              url: null,
            });
            return;
          }

          var writtenMarker = rentResult.marker === true;
          var startRequest = { commissionId: commissionId };
          if (requestedCareerId) startRequest.careerId = requestedCareerId;

          function failStart(reason, extra) {
            if (writtenMarker) restoreRaw(previous ? previous.raw : null);
            resolve(failure(reason || REASONS.commissionFailed, Object.assign({
              commissionId: commissionId,
              rental: null,
              ticket: null,
              url: null,
              markerCleared: writtenMarker,
            }, isObject(extra) ? extra : {})));
          }

          var started;
          try {
            started = commission.start(startRequest);
          } catch (err) {
            failStart(REASONS.commissionFailed, { error: errorText(err) });
            return;
          }

          Promise.resolve(started).then(function (result) {
            if (!result || result.ok !== true) {
              failStart(result && result.reason, { start: clone(result) });
              return;
            }
            var ticket = isObject(result.ticket) ? result.ticket : null;
            var ticketCareerId = ticket && typeof ticket.careerId === 'string' && ticket.careerId
              ? ticket.careerId
              : (typeof result.careerId === 'string' ? result.careerId : '');
            if (!rentResult.owned && !requestedCareerId && ticketCareerId) {
              tightenMarker(ticketCareerId);
            }
            var markerNow = rentResult.owned ? null : current();
            resolve({
              ok: true,
              commissionId: commissionId,
              owned: rentResult.owned === true,
              rental: rentResult.owned ? null : (markerNow || rentResult.rental || null),
              ticket: ticket,
              ticketId: result.ticketId || (ticket && ticket.ticketId) || null,
              url: typeof result.url === 'string' ? result.url : null,
              careerId: result.careerId || ticketCareerId || null,
              gameId: typeof result.gameId === 'string'
                ? result.gameId
                : (ticket && typeof ticket.gameId === 'string' ? ticket.gameId : null),
              note: rentResult.owned ? NOTE_OWNED : NOTE_FREE,
            });
          }, function (err) {
            failStart(REASONS.commissionFailed, { error: errorText(err) });
          });
        } catch (err) {
          resolve(failure(REASONS.exception, {
            rental: null,
            ticket: null,
            url: null,
            error: errorText(err),
          }));
        }
      });
    }

    /* ---------------- 实例 API ---------------- */

    var api = {
      MODULE_VERSION: MODULE_VERSION,
      CONTENT_VERSION: CONTENT_VERSION,
      STORAGE_KEY: STORAGE_KEY,
      DEFAULT_TTL_MS: DEFAULT_TTL_MS,
      REASONS: REASONS,
      configure: configure,
      rent: rent,
      current: current,
      clear: clear,
      prepareCommission: prepareCommission,
    };
    return api;
  }

  /* ------------------------------------------------------------------ *
   * 默认实例（浏览器全局 / Node module.exports）
   * ------------------------------------------------------------------ */

  var api = createRental();
  api.create = createRental;
  return api;
});
