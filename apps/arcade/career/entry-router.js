/*!
 * StudioKit Arcade Life — 16 源归一化入口（0.15，D15-12 入口路由基础）
 *
 * 纯函数、无 DOM、无存储副作用；浏览器挂到 window.ArcadeCareer.entryRouter，
 * Node 中可直接 require()。
 *
 * 设计约束（docs/arcade-life/ADR-interfaces.md §5.1、D15-12）：
 * - 「首源短文案」只从线索内容本身（ambientText / letter.body / title / ambientLabel）派生，
 *   代码里没有 16 款游戏的文案表；未来第 17 款只加内容即可；
 * - 任意单一来源都能独立进入同一 LOCAL 语义（不需要第二款游戏）；
 * - normalizeOrigins 按任意数量线索归一化，不出现 16 / 17 等规模常量；
 * - entryForClue 返回 null 时由调用方决定默认文案（bridge 负责）。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
    return;
  }
  root.ArcadeCareer = root.ArcadeCareer || {};
  root.ArcadeCareer.entryRouter = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* 所有来源归一化到同一港口语义；不随游戏数量变化。 */
  const LOCAL_STAGE = 'LOCAL';
  /* 短文案长度上限（按 Unicode 码点计，避免切开代理对）。 */
  const MAX_GREETING_CHARS = 32;
  /* 太短的派生结果不像一句可读 cue，回退到下一个字段。 */
  const MIN_GREETING_CHARS = 3;
  const SENTENCE_END_RE = /[。！？!?；;\n\r]/;
  const TRIM_RE = /^[\s"'“”‘’「」]+|[\s"'“”‘’「」]+$/g;

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function textOf(value) {
    return typeof value === 'string' ? value.replace(TRIM_RE, '') : '';
  }

  function codePoints(text) {
    return Array.from(String(text));
  }

  function clip(text, max) {
    const chars = codePoints(text);
    if (chars.length <= max) return text;
    return chars.slice(0, max).join('').replace(/[\s，,、：:·.\-]+$/, '') + '…';
  }

  /** 取一句话/第一个分句，作为「短文案」。 */
  function firstClause(text) {
    const value = textOf(text);
    if (!value) return '';
    const match = value.match(SENTENCE_END_RE);
    const head = match && match.index > 0 ? value.slice(0, match.index) : value;
    return textOf(head);
  }

  function isClueLike(clue) {
    if (!isObject(clue)) return false;
    if (typeof clue.clueId !== 'string' || !clue.clueId) return false;
    if (typeof clue.gameId !== 'string' || !clue.gameId) return false;
    return true;
  }

  function sourceGameOf(clue) {
    if (!isClueLike(clue)) return null;
    return clue.gameId.trim().toLowerCase();
  }

  function addressOf(clue) {
    if (!isClueLike(clue)) return null;
    const letter = isObject(clue.letter) ? clue.letter : null;
    const address = textOf(letter && letter.address);
    return address || null;
  }

  /**
   * 数据驱动派生「首源短文案」：ambientText → letter.body 首句 → title → ambientLabel。
   * @param {object} clue 已通过 discovery.normalizeClueBundle 的线索
   * @returns {string} 无可用内容时返回 ''
   */
  function greetingForClue(clue) {
    if (!isClueLike(clue)) return '';
    const letter = isObject(clue.letter) ? clue.letter : {};
    const candidates = [
      clue.ambientText,
      letter.body,
      clue.title,
      clue.ambientLabel,
      letter.sender,
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const raw = textOf(candidates[i]);
      if (!raw) continue;
      const cue = clip(firstClause(raw), MAX_GREETING_CHARS);
      if (codePoints(cue.replace(/…$/, '')).length >= MIN_GREETING_CHARS) return cue;
    }
    return '';
  }

  /**
   * 起源稳定键：每个来源一个；不因线索顺序/数量变化。
   * @param {object} clue
   * @returns {string} 形如 'origin:<gameId>'，非法线索返回 ''
   */
  function originKey(clue) {
    const gameId = sourceGameOf(clue);
    return gameId ? 'origin:' + gameId : '';
  }

  function clueListOf(input) {
    if (Array.isArray(input)) return input;
    if (isObject(input) && Array.isArray(input.clues)) return input.clues;
    return [];
  }

  /**
   * 把任意数量的线索归一化成统一 LOCAL 入口清单。
   * - 同一来源只保留第一条线索（originKey 去重）；
   * - 短文案在内容重复时按数据（title/address/sourceGame）确定性去重，仍然完全数据驱动；
   * - 不做任何 16 款游戏的数量断言。
   * @param {Array|{clues?:Array}} clues
   * @returns {Array<{originKey:string, sourceGame:string, clueId:string, greeting:string, address:string|null, stage:'LOCAL'}>}
   */
  function normalizeOrigins(clues) {
    const list = clueListOf(clues);
    const out = [];
    const seenOrigins = Object.create(null);
    const usedGreetings = Object.create(null);
    list.forEach((clue) => {
      if (!isClueLike(clue)) return;
      const key = originKey(clue);
      if (!key || seenOrigins[key]) return;
      let greeting = greetingForClue(clue);
      if (!greeting) return;
      if (usedGreetings[greeting]) {
        const suffix = textOf(clue.title) || addressOf(clue) || sourceGameOf(clue) || '';
        if (suffix) greeting = clip(greeting, MAX_GREETING_CHARS - codePoints(suffix).length - 1) + '·' + clip(suffix, 12);
        let attempt = 1;
        while (usedGreetings[greeting] && attempt < 32) {
          greeting = clip(greetingForClue(clue), MAX_GREETING_CHARS - 4) + '·' + attempt;
          attempt += 1;
        }
      }
      if (usedGreetings[greeting]) return;
      usedGreetings[greeting] = true;
      seenOrigins[key] = true;
      out.push({
        originKey: key,
        sourceGame: sourceGameOf(clue),
        clueId: clue.clueId,
        greeting: greeting,
        address: addressOf(clue),
        stage: LOCAL_STAGE,
      });
    });
    return out;
  }

  function discoveredClueIds(state) {
    if (!isObject(state) || !isObject(state.clues)) return null;
    const ids = Object.keys(state.clues);
    return ids.length ? ids : null;
  }

  /**
   * 该线索所在来源是否已被玩家发现（无持久状态时按「规则上可进入」返回 true）。
   * @param {object|null|undefined} state 发现状态快照
   * @param {object} clue
   * @returns {boolean}
   */
  function canEnterLocal(state, clue) {
    if (!isClueLike(clue)) return false;
    if (!greetingForClue(clue)) return false;
    const discovered = discoveredClueIds(state);
    if (!discovered) return true;
    return discovered.indexOf(clue.clueId) >= 0 || (isObject(state) && state.firstClueId === clue.clueId);
  }

  /**
   * 当前来源的首源短文案：单条线索即可独立接入 LOCAL。
   * @param {object} clue 线索内容（来自 clues.json，不含剧情谜底）
   * @param {object} [state] 发现状态（若已持久化则要求该线索已发现）
   * @returns {{sourceGame:string, clueId:string, greeting:string, address:string|null}|null}
   */
  function entryForClue(clue, state) {
    if (!isClueLike(clue)) return null;
    const greeting = greetingForClue(clue);
    if (!greeting) return null;
    const discovered = discoveredClueIds(state);
    if (discovered && discovered.indexOf(clue.clueId) < 0) return null;
    return {
      sourceGame: sourceGameOf(clue),
      clueId: clue.clueId,
      greeting: greeting,
      address: addressOf(clue),
    };
  }

  return {
    LOCAL_STAGE,
    MAX_GREETING_CHARS,
    originKey,
    normalizeOrigins,
    greetingForClue,
    addressOf,
    canEnterLocal,
    entryForClue,
  };
});
