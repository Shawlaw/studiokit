/*!
 * StudioKit Arcade Life — gameId / 基址 / 内容 URL 路由（0.15，D15-04/D15-13 共用）
 *
 * 纯函数、无 DOM 副作用、无网络；浏览器挂到 window.ArcadeCareer.router，
 * Node 中可直接 require()（传入形如 { pathname, search, hash } 的 locationLike 即可）。
 *
 * 约束（docs/arcade-life/ADR-interfaces.md §11）：
 * - detectGameId 语义与 engine.detectCurrentGame 一致：/games/ 之后、去 .html、
 *   小写化、URL 解码、尾斜杠容错、无后缀（CF Pages pretty URL）兼容；
 * - 不得依赖域名根绝对路径：GH 项目子路径 / CF 根路径 / file:// / 本地目录都成立；
 * - careerBase 以 bridge.js 自身脚本 URL 为准（无 document.currentScript 时回退 location）。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.router = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* 与 engine.js 的 detectCurrentGame 保持同一个分隔段；改这里必须同步 engine。 */
  const GAMES_SEGMENT = '/games/';
  const ARCADE_SEGMENT = '/apps/arcade/';
  const CONTENT_DIR = 'career/content/';

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (err) {
      return value;
    }
  }

  /** locationLike 允许是标准 Location、测试对象 { pathname, search, hash, href, origin } 或 URL 字符串。 */
  function asLocation(locationLike) {
    if (typeof locationLike === 'string' && locationLike) {
      try {
        return new URL(locationLike, 'http://local.invalid/');
      } catch (err) {
        return null;
      }
    }
    if (isObject(locationLike)) return locationLike;
    if (typeof location !== 'undefined' && location) return location;
    return null;
  }

  function searchOf(loc) {
    if (!loc) return '';
    if (typeof loc.search === 'string') return loc.search;
    if (typeof loc.href === 'string') {
      const index = loc.href.indexOf('?');
      if (index < 0) return '';
      const hashIndex = loc.href.indexOf('#', index);
      return hashIndex < 0 ? loc.href.slice(index) : loc.href.slice(index, hashIndex);
    }
    return '';
  }

  function hashOf(loc) {
    if (!loc) return '';
    if (typeof loc.hash === 'string') return loc.hash;
    if (typeof loc.href === 'string') {
      const index = loc.href.indexOf('#');
      return index < 0 ? '' : loc.href.slice(index);
    }
    return '';
  }

  function hrefOf(loc) {
    if (!loc) return '';
    if (typeof loc.href === 'string' && loc.href) return loc.href;
    if (typeof loc.pathname !== 'string') return '';
    const origin = typeof loc.origin === 'string' && loc.origin && loc.origin !== 'null' ? loc.origin : 'http://local.invalid';
    return origin + loc.pathname + searchOf(loc) + hashOf(loc);
  }

  function originOf(loc) {
    if (!loc) return 'http://local.invalid';
    if (typeof loc.origin === 'string' && loc.origin && loc.origin !== 'null') return loc.origin;
    if (typeof loc.protocol === 'string' && typeof loc.host === 'string' && loc.host) return loc.protocol + '//' + loc.host;
    return 'http://local.invalid';
  }

  function resolveUrl(value, base) {
    try {
      return base ? new URL(value, base) : new URL(value);
    } catch (err) {
      return null;
    }
  }

  function withTrailingSlash(value) {
    const text = String(value == null ? '' : value);
    if (!text) return '';
    return text.charAt(text.length - 1) === '/' ? text : text + '/';
  }

  /** 复制一个 URL 并替换 pathname（同时清空 search/hash），避免手工拼 origin 破坏 file:// 语义。 */
  function urlWithPath(url, pathname) {
    try {
      const copy = new URL(url.href);
      copy.pathname = pathname;
      copy.search = '';
      copy.hash = '';
      return withTrailingSlash(copy.href);
    } catch (err) {
      return withTrailingSlash(originOf(url) + pathname);
    }
  }

  /**
   * 与 engine.detectCurrentGame() 等价的纯路径解析。
   * @param {Location|{pathname?:string, search?:string, hash?:string, href?:string}|string} [locationLike]
   * @returns {string|null} 小写 gameId（即 /games/ 之后、去掉 .html 的段），无法识别时 null
   */
  function detectGameId(locationLike) {
    const loc = asLocation(locationLike);
    if (!loc || typeof loc.pathname !== 'string') return null;
    const pathname = safeDecode(loc.pathname);
    const marker = pathname.lastIndexOf(GAMES_SEGMENT);
    if (marker < 0) return null;
    const raw = pathname.slice(marker + GAMES_SEGMENT.length).replace(/\/+$/, '');
    if (!raw) return null;
    const slug = raw.replace(/\.html$/i, '').toLowerCase();
    /* 仍然含分隔符说明是 /games/<子目录>/... 之类的非游戏页，不猜测。 */
    if (!slug || slug.indexOf('/') >= 0) return null;
    return slug;
  }

  /**
   * apps/arcade/ 目录的绝对基址（始终以 / 结尾）。
   * 优先依据 bridge.js 自身脚本 URL（GH 子路径 / CF 根路径 / file:// 都成立），
   * 没有 document.currentScript 时回退 location 推断。
   * @param {Document|{currentScript?:{src?:string}, location?:object}} [docLike]
   * @returns {string} 形如 https://host/studiokit/apps/arcade/ ；完全无法推断时返回 ''
   */
  function careerBase(docLike) {
    const doc = docLike && typeof docLike === 'object' ? docLike : (typeof document !== 'undefined' ? document : null);
    const loc = (doc && doc.location) || (typeof location !== 'undefined' ? location : null);
    const href = hrefOf(loc);
    let scriptSrc = '';
    try {
      scriptSrc = (doc && doc.currentScript && doc.currentScript.src) || '';
    } catch (err) {
      scriptSrc = '';
    }
    if (scriptSrc) {
      const scriptUrl = resolveUrl(String(scriptSrc), href || undefined);
      if (scriptUrl) {
        const path = scriptUrl.pathname || '';
        const careerIndex = path.lastIndexOf('/career/');
        if (careerIndex >= 0) {
          /* …/apps/arcade/career/bridge.js → …/apps/arcade/ */
          return urlWithPath(scriptUrl, path.slice(0, careerIndex + 1));
        }
        /* 非标准布局：脚本目录再上一级（保持相对可移植，不做根绝对路径）。 */
        const parent = resolveUrl('../', scriptUrl.href);
        if (parent) return withTrailingSlash(parent.href);
        const dir = resolveUrl('.', scriptUrl.href);
        if (dir) return withTrailingSlash(dir.href);
      }
    }
    const pathname = loc && typeof loc.pathname === 'string' ? safeDecode(loc.pathname) : '';
    if (pathname) {
      const arcadeIndex = pathname.indexOf(ARCADE_SEGMENT);
      if (arcadeIndex >= 0) {
        return withTrailingSlash(originOf(loc) + pathname.slice(0, arcadeIndex + ARCADE_SEGMENT.length));
      }
      const gamesIndex = pathname.lastIndexOf(GAMES_SEGMENT);
      if (gamesIndex >= 0) {
        return withTrailingSlash(originOf(loc) + pathname.slice(0, gamesIndex + 1));
      }
      const parent = resolveUrl('../', href || undefined);
      if (parent) return withTrailingSlash(parent.href);
      return withTrailingSlash(originOf(loc) + pathname.slice(0, pathname.lastIndexOf('/') + 1));
    }
    return '';
  }

  /**
   * 内容 JSON 的 URL：base + 'career/content/' + name。
   * @param {string} name 例如 'registry.json' / 'clues.json'
   * @param {Document|object} [docLike]
   * @returns {string}
   */
  function contentUrl(name, docLike) {
    const filename = String(name == null ? '' : name).replace(/^\/+/, '');
    const base = careerBase(docLike);
    if (!base) return CONTENT_DIR + filename;
    return base + CONTENT_DIR + filename;
  }

  /**
   * 仅 ?careerTest=1 视为生涯测试模式（生产 URL 不得命中）。
   * @param {Location|{search?:string, href?:string}|string} [locationLike]
   * @returns {boolean}
   */
  function isTestMode(locationLike) {
    const loc = asLocation(locationLike);
    if (!loc) return false;
    let search = searchOf(loc);
    if (!search) return false;
    if (search.charAt(0) === '?') search = search.slice(1);
    if (!search) return false;
    const pairs = search.split('&');
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
      const value = eq < 0 ? '' : safeDecode(pair.slice(eq + 1));
      if (key === 'careerTest' && value === '1') return true;
    }
    return false;
  }

  /**
   * 既有 smoke 探针：15 款 `location.hash === '#test'`、blackjack 用 indexOf。
   * 与 engine 一致按「hash 含 #test」判断。
   * @param {Location|{hash?:string, href?:string}|string} [locationLike]
   * @returns {boolean}
   */
  function isHashTest(locationLike) {
    const loc = asLocation(locationLike);
    if (!loc) return false;
    let hash = hashOf(loc);
    if (!hash) return false;
    if (hash.charAt(0) !== '#') hash = '#' + hash;
    return hash.indexOf('#test') !== -1;
  }

  return {
    GAMES_SEGMENT,
    ARCADE_SEGMENT,
    CONTENT_DIR,
    detectGameId,
    careerBase,
    contentUrl,
    isTestMode,
    isHashTest,
  };
});
