/*
 * 街机厅共享运行时（Arcade Engine）
 * - 纯静态零依赖：不引入任何 CDN / 远程资源 / 框架（AGENTS.md 约束 4/7）。
 * - localStorage 命名空间：studiokit:arcade:*（AGENTS.md 约束 6）。
 * - ARCADE_VERSION 需与 shared/tool-registry.json 中 arcade 条目及 README 保持同步。
 */
(() => {
  'use strict';

  const ARCADE_VERSION = '0.6.1';
  const PROGRESS_KEY = 'studiokit:arcade:progress:v1';
  const PREFS_KEY = 'studiokit:arcade:prefs:v1';
  const RUNS_KEY = 'studiokit:arcade:runs:v1';
  const PLAYTIME_KEY = 'studiokit:arcade:playtime:v1';
  const PROGRESS_SCHEMA = 1;
  const RUN_SCHEMA = 1;
  const PLAYTIME_SCHEMA = 1;
  const EXPORT_FORMAT = 'studiokit-arcade-progress';

  /* 引擎脚本自身的目录（apps/arcade/），用于子路径部署、分享链接与 Service Worker。 */
  const ARCADE_BASE = (() => {
    try {
      if (document.currentScript && document.currentScript.src) return new URL('.', document.currentScript.src);
    } catch (err) {
      /* 回退到路径推断 */
    }
    const path = location.pathname;
    const marker = path.indexOf('/apps/arcade/');
    const basePath = marker >= 0 ? path.slice(0, marker + '/apps/arcade/'.length) : path.slice(0, path.lastIndexOf('/') + 1);
    try {
      return new URL(basePath, location.origin);
    } catch (err) {
      return new URL('./', location.href);
    }
  })();

  /* ----------------------------------------------------------
   * 游戏清单（街机厅中心页与各游戏页共用的唯一来源）
   * file 相对于 apps/arcade/games/；id 同时是进度存储里的键。
   * ---------------------------------------------------------- */
  const GAMES = [
    {
      id: 'memory-flip',
      file: 'memory-flip.html',
      name: '记忆翻牌',
      tagline: '翻牌配对，记住位置',
      icon: '🃏',
      accent: '#5ad1a0',
      category: '益智',
      difficulty: 1,
      session: '2–5 分钟',
      tags: ['记忆', '配对'],
      how: '点开两张牌找相同图案；配对成功即锁定，关卡越高牌越多。',
    },
    {
      id: 'merge-2048',
      file: 'merge-2048.html',
      name: '2048 合成',
      tagline: '滑动数字，合成 2048',
      icon: '🔢',
      accent: '#f2b33d',
      category: '益智',
      difficulty: 1,
      session: '3–8 分钟',
      tags: ['数字', '合成'],
      how: '上下左右滑动 / 方向键移动方块；同数相撞合并，一步可撤销。',
    },
    {
      id: 'snowbells',
      file: 'snowbells.html',
      name: '雪铃',
      tagline: '兔子跳铃铛',
      icon: '🐰',
      accent: '#2fa8a0',
      category: '休闲',
      difficulty: 2,
      session: '1–3 分钟',
      tags: ['弹跳', '连击'],
      how: '←→ 或触摸左右半屏移动，踩中铃铛向上弹；连击有倍率加成。',
    },
    {
      id: 'brick-breaker',
      file: 'brick-breaker.html',
      name: '砖块计划',
      tagline: '挡板反弹，打碎砖墙',
      icon: '🧱',
      accent: '#4fc3f7',
      category: '消除',
      difficulty: 2,
      session: '2–5 分钟',
      tags: ['打砖块', '反弹'],
      how: '拖动 / ←→ 移动挡板，点击 / 空格发球；接住道具，逐关加速。',
    },
    {
      id: 'gravity-flip',
      file: 'gravity-flip.html',
      name: '重力翻转',
      tagline: '一键翻转重力躲尖刺',
      icon: '🌀',
      accent: '#9b7cff',
      category: '反应',
      difficulty: 2,
      session: '1–2 分钟',
      tags: ['一键', '反应'],
      how: '点击 / 空格翻转重力，在上下尖刺之间穿行；速度会越来越快。',
    },
    {
      id: 'snake-run',
      file: 'snake-run.html',
      name: '贪吃蛇',
      tagline: '吃果实，别咬到自己',
      icon: '🐍',
      accent: '#66d36e',
      category: '反应',
      difficulty: 2,
      session: '2–5 分钟',
      tags: ['经典', '贪吃'],
      how: '方向键 / WASD 或滑动转向；吃果实变长，越吃越快。',
    },
    {
      id: 'mole-whack',
      file: 'mole-whack.html',
      name: '打地鼠',
      tagline: '45 秒连击敲地鼠',
      icon: '🔨',
      accent: '#ff9a3d',
      category: '反应',
      difficulty: 2,
      session: '1 分钟',
      tags: ['连击', '限时'],
      how: '点击冒头的地鼠得分，连击有倍率；别敲炸弹，也别放跑金鼠。',
    },
    {
      id: 'block-drop',
      file: 'block-drop.html',
      name: '俄罗斯方块',
      tagline: '经典落块消除',
      icon: '🧊',
      accent: '#7c5cff',
      category: '消除',
      difficulty: 3,
      session: '3–8 分钟',
      tags: ['消除', '经典'],
      how: '←→ 移动 · ↑ 旋转 · ↓ 软降 · 空格硬降；触摸分区操作。',
    },
    {
      id: 'star-raid',
      file: 'star-raid.html',
      name: '星海突击',
      tagline: '雷电式纵版射击',
      icon: '🚀',
      accent: '#4f7cff',
      category: '动作',
      difficulty: 3,
      session: '2–4 分钟',
      tags: ['射击', '弹幕'],
      how: '拖动 / ←→ 移动，自动开火；吃散射 / 激光 / 追踪 / 速射 Buff 切换弹种。',
    },
    {
      id: 'road-rush',
      file: 'road-rush.html',
      name: '极速车道',
      tagline: '四车道赛车避障',
      icon: '🏎',
      accent: '#ff7847',
      category: '竞速',
      difficulty: 3,
      session: '1–3 分钟',
      tags: ['赛车', '竞速'],
      how: '←→ 或触摸左右半屏变道；躲开车流，速度会越来越快。',
    },
    {
      id: 'shadow-leap',
      file: 'shadow-leap.html',
      name: '影跃',
      tagline: '忍者无尽上跳',
      icon: '🥷',
      accent: '#e0567f',
      category: '动作',
      difficulty: 4,
      session: '2–5 分钟',
      tags: ['跳跃', '平台'],
      how: '←→ 或触摸左右半屏横移，触墙反弹；别掉出屏幕底部。',
    },
    {
      id: 'pendulum-tower',
      file: 'pendulum-tower.html',
      name: '层塔',
      tagline: '钟摆叠箱子',
      icon: '🏗',
      accent: '#e5941b',
      category: '物理',
      difficulty: 4,
      session: '2–4 分钟',
      tags: ['物理', '叠塔'],
      how: '看准摆动时机，点击 / 空格松手落箱；偏心会让塔倾斜倒塌。',
    },
    {
      id: 'gold-miner',
      file: 'gold-miner.html',
      name: '黄金矿工',
      tagline: '摆钩挖金',
      icon: '⛏',
      accent: '#f5c542',
      category: '物理',
      difficulty: 4,
      session: '3–6 分钟',
      tags: ['物理', '关卡'],
      how: '看准角度点击 / 空格放钩；重物拉得慢；1/2/3 使用限量道具；限时达标进入下一关。',
    },
  ];

  const DIFFICULTY_NAMES = { 1: '轻松', 2: '适中', 3: '挑战', 4: '硬核' };

  /* ----------------------------------------------------------
   * 数学工具
   * ---------------------------------------------------------- */
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ----------------------------------------------------------
   * 安全存储
   * ---------------------------------------------------------- */
  function safeGetJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }
  function safeSetJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }
  function safeGetRaw(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }
  function safeRestoreRaw(key, raw) {
    try {
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch (err) {
      /* 回滚失败时只能保留当前值 */
    }
  }

  /* ----------------------------------------------------------
   * 局内进度存档（每个游戏一条，独立于最高分记录）
   * 只存 JSON 可序列化的快照；游戏恢复时仍会做字段校验。
   * ---------------------------------------------------------- */
  function readRunMap() {
    const raw = safeGetJSON(RUNS_KEY);
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== RUN_SCHEMA || !raw.games || typeof raw.games !== 'object') {
      return {};
    }
    const out = Object.create(null);
    Object.keys(raw.games).forEach((id) => {
      const rec = raw.games[id];
      if (!rec || typeof rec !== 'object' || !rec.data || typeof rec.data !== 'object') return;
      out[id] = {
        savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : null,
        score: Number(rec.score) || 0,
        summary: typeof rec.summary === 'string' ? rec.summary : '',
        data: rec.data,
      };
    });
    return out;
  }

  const RunSave = {
    schema: RUN_SCHEMA,
    all() {
      return readRunMap();
    },
    get(gameId) {
      return readRunMap()[gameId] || null;
    },
    has(gameId) {
      return !!this.get(gameId);
    },
    count() {
      return Object.keys(readRunMap()).length;
    },
    save(gameId, data, meta) {
      if (!data || typeof data !== 'object') return false;
      const all = readRunMap();
      all[gameId] = {
        savedAt: new Date().toISOString(),
        score: Number(meta && meta.score) || 0,
        summary: String((meta && meta.summary) || ''),
        data,
      };
      return safeSetJSON(RUNS_KEY, { schemaVersion: RUN_SCHEMA, games: all });
    },
    clear(gameId) {
      const all = readRunMap();
      if (!all[gameId]) return;
      delete all[gameId];
      safeSetJSON(RUNS_KEY, { schemaVersion: RUN_SCHEMA, games: all });
    },
    clearAll() {
      try {
        localStorage.removeItem(RUNS_KEY);
      } catch (err) {
        /* 忽略存储不可用 */
      }
    },
    importMap(games) {
      if (!games || typeof games !== 'object') return { ok: true, count: 0, skipped: 0 };
      const validIds = new Set(GAMES.map((g) => g.id));
      const out = Object.create(null);
      let skipped = 0;
      Object.keys(games).forEach((id) => {
        const rec = games[id];
        if (!validIds.has(id) || !rec || typeof rec !== 'object' || !rec.data || typeof rec.data !== 'object') {
          skipped += 1;
          return;
        }
        let encoded;
        try {
          encoded = JSON.stringify(rec.data);
        } catch (err) {
          skipped += 1;
          return;
        }
        if (encoded.length > 256 * 1024) {
          skipped += 1;
          return;
        }
        out[id] = {
          savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : null,
          score: Number(rec.score) || 0,
          summary: typeof rec.summary === 'string' ? rec.summary : '',
          data: rec.data,
        };
      });
      const count = Object.keys(out).length;
      if (count === 0) {
        /* 全部条目都无效时不要覆盖当前局内档。 */
        return { ok: true, count: 0, skipped };
      }
      const ok = safeSetJSON(RUNS_KEY, { schemaVersion: RUN_SCHEMA, games: out });
      return { ok, count, skipped };
    },
  };

  /* 游戏内的低频自动存档：默认每 4 秒落一次，暂停/离开时手动 saveNow。 */
  function createRunAutosave(gameId, serialize, opts) {
    const o = opts || {};
    const every = o.every || 4;
    let acc = 0;
    function write() {
      let data = null;
      try {
        data = serialize();
      } catch (err) {
        return false;
      }
      if (!data || typeof data !== 'object') return false;
      let meta = o.meta;
      if (typeof meta === 'function') {
        try {
          meta = meta();
        } catch (err) {
          meta = null;
        }
      }
      return RunSave.save(gameId, data, meta || {});
    }
    return {
      tick(dt) {
        acc += dt;
        if (acc < every) return;
        acc = 0;
        write();
      },
      saveNow: write,
      load() {
        return RunSave.get(gameId);
      },
      clear() {
        RunSave.clear(gameId);
      },
    };
  }

  /* ----------------------------------------------------------
   * 游玩时长 / 轮次统计（0.5.0）
   * - 只累计真正处于游玩态的时间：开始/暂停弹层关闭且页面可见；
   *   暂停、切后台、停在开始界面都不计时。
   * - 每款游戏记录总时长、完成轮次、最近 30 轮明细与最近 120 天日汇总。
   * - 新增独立 key，既有 progress/runs 的 key 与 Schema 不变。
   * ---------------------------------------------------------- */
  const PLAYTIME_ROUNDS = 30;
  const PLAYTIME_DAYS = 120;
  const PLAYTIME_TICK_MS = 15000;

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function dayOffsetKey(offset) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return localDateKey(d);
  }

  function detectCurrentGame() {
    let pathname = location.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch (err) {
      /* 保留原始路径 */
    }
    const marker = pathname.lastIndexOf('/games/');
    if (marker < 0) return null;
    const file = pathname.slice(marker + '/games/'.length);
    return GAMES.find((g) => g.file === file) || null;
  }

  function sanitizePlayRec(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const msValue = Number(rec.ms);
    const countValue = Number(rec.count);
    const out = {
      ms: Number.isFinite(msValue) ? Math.max(0, Math.round(msValue)) : 0,
      count: Number.isFinite(countValue) ? Math.max(0, Math.floor(countValue)) : 0,
      lastAt: typeof rec.lastAt === 'string' ? rec.lastAt : null,
      days: Object.create(null),
      rounds: [],
    };
    if (rec.days && typeof rec.days === 'object') {
      Object.keys(rec.days).forEach((key) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        const value = Number(rec.days[key]);
        const ms = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
        if (ms > 0) out.days[key] = ms;
      });
    }
    if (Array.isArray(rec.rounds)) {
      rec.rounds.slice(0, PLAYTIME_ROUNDS).forEach((round) => {
        if (!round || typeof round !== 'object' || typeof round.at !== 'string') return;
        const roundMs = Number(round.ms);
        const roundScore = Number(round.score);
        out.rounds.push({
          at: round.at,
          ms: Number.isFinite(roundMs) ? Math.max(0, Math.round(roundMs)) : 0,
          score: Number.isFinite(roundScore) ? roundScore : 0,
          newHigh: !!round.newHigh,
        });
      });
    }
    const dayKeys = Object.keys(out.days).sort();
    if (dayKeys.length > PLAYTIME_DAYS) {
      dayKeys.slice(0, dayKeys.length - PLAYTIME_DAYS).forEach((key) => delete out.days[key]);
    }
    out.count = Math.max(out.count, out.rounds.length);
    return out;
  }

  function readPlaytime() {
    const raw = safeGetJSON(PLAYTIME_KEY);
    const data = { schemaVersion: PLAYTIME_SCHEMA, games: Object.create(null), updatedAt: null };
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== PLAYTIME_SCHEMA || !raw.games || typeof raw.games !== 'object') {
      return data;
    }
    const validIds = new Set(GAMES.map((g) => g.id));
    Object.keys(raw.games).forEach((id) => {
      if (!validIds.has(id)) return;
      const rec = sanitizePlayRec(raw.games[id]);
      if (rec) data.games[id] = rec;
    });
    data.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
    return data;
  }

  const Playtime = (() => {
    const currentGame = detectCurrentGame();
    let overlayOpen = true;
    let visible = !document.hidden;
    let focused = true;
    let segStart = 0;
    let sessionMs = 0;
    let roundMs = 0;
    let installed = false;
    let tickTimer = 0;

    function closeSegment() {
      if (!segStart) return;
      const delta = Math.max(0, performance.now() - segStart);
      segStart = 0;
      sessionMs += delta;
      roundMs += delta;
    }

    function startSegment() {
      if (!currentGame || overlayOpen || !visible || !focused || segStart) return;
      segStart = performance.now();
    }

    function pruneDays(rec) {
      const keys = Object.keys(rec.days).sort();
      if (keys.length <= PLAYTIME_DAYS) return;
      keys.slice(0, keys.length - PLAYTIME_DAYS).forEach((key) => delete rec.days[key]);
    }

    function blankRec() {
      return { ms: 0, count: 0, lastAt: null, days: Object.create(null), rounds: [] };
    }

    function addTime(ms) {
      if (!currentGame || ms <= 0) return;
      const data = readPlaytime();
      const rec = data.games[currentGame.id] || blankRec();
      const now = new Date();
      rec.ms += ms;
      const dayKey = localDateKey(now);
      rec.days[dayKey] = (Number(rec.days[dayKey]) || 0) + ms;
      rec.lastAt = now.toISOString();
      pruneDays(rec);
      data.games[currentGame.id] = rec;
      data.updatedAt = now.toISOString();
      safeSetJSON(PLAYTIME_KEY, data);
    }

    function flushTime() {
      closeSegment();
      const ms = Math.floor(sessionMs);
      if (ms <= 0) return;
      sessionMs -= ms;
      addTime(ms);
    }

    function setOverlayVisible(value) {
      const open = !!value;
      if (open === overlayOpen) return;
      overlayOpen = open;
      if (open) flushTime();
      else startSegment();
    }

    function recordRound(gameId, score, isNewHigh) {
      if (!currentGame || gameId !== currentGame.id) return;
      closeSegment();
      flushTime();
      const duration = Math.max(0, Math.round(roundMs));
      roundMs = 0;
      const data = readPlaytime();
      const rec = data.games[currentGame.id] || blankRec();
      const now = new Date();
      rec.count += 1;
      rec.lastAt = now.toISOString();
      rec.rounds.unshift({ at: rec.lastAt, ms: duration, score: Number(score) || 0, newHigh: !!isNewHigh });
      if (rec.rounds.length > PLAYTIME_ROUNDS) rec.rounds.length = PLAYTIME_ROUNDS;
      data.games[currentGame.id] = rec;
      data.updatedAt = now.toISOString();
      safeSetJSON(PLAYTIME_KEY, data);
    }

    function install() {
      if (installed || !currentGame) return;
      installed = true;
      document.addEventListener('visibilitychange', () => {
        visible = !document.hidden;
        if (!visible) flushTime();
        else if (!overlayOpen) startSegment();
      });
      /* createLoop 在窗口失焦时也会自动暂停；计时必须跟随同一语义。 */
      window.addEventListener('blur', () => {
        focused = false;
        flushTime();
      });
      window.addEventListener('focus', () => {
        focused = true;
        if (!overlayOpen && visible) startSegment();
      });
      window.addEventListener('pagehide', flushTime);
      window.addEventListener('beforeunload', flushTime);
      tickTimer = setInterval(() => {
        if (overlayOpen || !visible || !focused) return;
        flushTime();
        /* flushTime 会关闭当前时间片；持续游玩时必须立即开启下一段，否则第一次 15s 落盘后不再计时。 */
        startSegment();
      }, PLAYTIME_TICK_MS);
    }

    function stats() {
      const data = readPlaytime();
      const dayKeys = [];
      for (let i = 6; i >= 0; i--) dayKeys.push(dayOffsetKey(-i));
      const todayKey = dayKeys[dayKeys.length - 1];
      let totalMs = 0;
      let todayMs = 0;
      let weekMs = 0;
      let rounds = 0;
      const games = [];
      GAMES.forEach((game, order) => {
        const rec = data.games[game.id];
        if (!rec) return;
        let gameToday = 0;
        let gameWeek = 0;
        dayKeys.forEach((key) => {
          const ms = Number(rec.days[key]) || 0;
          if (key === todayKey) gameToday = ms;
          gameWeek += ms;
        });
        totalMs += rec.ms;
        todayMs += gameToday;
        weekMs += gameWeek;
        rounds += rec.count;
        games.push({
          id: game.id,
          game,
          order,
          ms: rec.ms,
          count: rec.count,
          lastAt: rec.lastAt,
          todayMs: gameToday,
          weekMs: gameWeek,
          rounds: rec.rounds.slice(),
        });
      });
      games.sort((a, b) => b.ms - a.ms || a.order - b.order);
      const daily = dayKeys.map((key) => {
        let ms = 0;
        GAMES.forEach((game) => {
          const rec = data.games[game.id];
          if (rec) ms += Number(rec.days[key]) || 0;
        });
        return { key, ms };
      });
      return { totalMs, todayMs, weekMs, rounds, games, daily, updatedAt: data.updatedAt };
    }

    function resetGame(gameId) {
      const data = readPlaytime();
      if (!data.games[gameId]) return;
      delete data.games[gameId];
      data.updatedAt = new Date().toISOString();
      safeSetJSON(PLAYTIME_KEY, data);
    }

    function resetAll() {
      try {
        localStorage.removeItem(PLAYTIME_KEY);
      } catch (err) {
        /* 忽略存储不可用 */
      }
    }

    function exportData() {
      const data = readPlaytime();
      const games = Object.create(null);
      Object.keys(data.games).forEach((id) => {
        games[id] = data.games[id];
      });
      return { schemaVersion: PLAYTIME_SCHEMA, games, updatedAt: data.updatedAt };
    }

    function importData(payload) {
      if (!payload || typeof payload !== 'object' || payload.schemaVersion !== PLAYTIME_SCHEMA || !payload.games || typeof payload.games !== 'object') {
        return { ok: true, count: 0, skipped: true };
      }
      const validIds = new Set(GAMES.map((g) => g.id));
      const games = Object.create(null);
      let skipped = 0;
      Object.keys(payload.games).forEach((id) => {
        if (!validIds.has(id)) {
          skipped += 1;
          return;
        }
        const rec = sanitizePlayRec(payload.games[id]);
        if (!rec) {
          skipped += 1;
          return;
        }
        games[id] = rec;
      });
      const ok = safeSetJSON(PLAYTIME_KEY, { schemaVersion: PLAYTIME_SCHEMA, games, updatedAt: new Date().toISOString() });
      return { ok, count: Object.keys(games).length, skipped };
    }

    install();

    return {
      schema: PLAYTIME_SCHEMA,
      currentGame,
      setOverlayVisible,
      recordRound,
      stats,
      resetGame,
      resetAll,
      exportData,
      importData,
      flush: flushTime,
      get tracking() {
        return !!currentGame;
      },
      get timer() {
        return tickTimer;
      },
    };
  })();

  function formatDuration(ms) {
    const raw = Number(ms) || 0;
    if (raw <= 0) return '0 分钟';
    const sec = Math.max(0, Math.round(raw / 1000));
    if (sec < 10) return '不足 10 秒';
    if (sec < 60) return sec + ' 秒';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + ' 分钟';
    const hours = Math.floor(min / 60);
    const restMin = min % 60;
    if (hours < 24) return restMin ? `${hours} 小时 ${restMin} 分` : `${hours} 小时`;
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`;
  }

  function formatClock(ms) {
    const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const rest = sec % 60;
    return hours ? `${hours}:${pad2(mins)}:${pad2(rest)}` : `${pad2(mins)}:${pad2(rest)}`;
  }

  function formatRoundAt(iso) {
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return '';
    const d = new Date(time);
    const now = new Date();
    const prefix = d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '-';
    return `${prefix}${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /* ----------------------------------------------------------
   * 进度（全部游戏共用一个 key，中心页一次读出即可管理）
   * ---------------------------------------------------------- */
  const Progress = {
    load() {
      const data = safeGetJSON(PROGRESS_KEY);
      if (data && typeof data === 'object' && data.schemaVersion === PROGRESS_SCHEMA && data.games && typeof data.games === 'object') {
        const games = Object.create(null);
        Object.keys(data.games).forEach((id) => {
          const rec = data.games[id];
          if (rec && typeof rec === 'object' && !Array.isArray(rec)) games[id] = rec;
        });
        return { schemaVersion: PROGRESS_SCHEMA, games };
      }
      return { schemaVersion: PROGRESS_SCHEMA, games: Object.create(null) };
    },
    save(data) {
      return safeSetJSON(PROGRESS_KEY, data);
    },
    get(gameId) {
      const rec = this.load().games[gameId];
      if (rec && typeof rec === 'object') {
        return {
          high: Number(rec.high) || 0,
          plays: Number(rec.plays) || 0,
          lastAt: rec.lastAt || null,
          lastScore: Number(rec.lastScore) || 0,
        };
      }
      return { high: 0, plays: 0, lastAt: null, lastScore: 0 };
    },
    recordPlay(gameId, score) {
      const data = this.load();
      const rec = data.games[gameId] || { high: 0, plays: 0, lastAt: null, lastScore: 0 };
      rec.plays = (Number(rec.plays) || 0) + 1;
      rec.high = Number(rec.high) || 0;
      rec.lastAt = new Date().toISOString();
      rec.lastScore = Number(score) || 0;
      const isNewHigh = Number(score) > rec.high;
      if (isNewHigh) rec.high = Number(score) || 0;
      data.games[gameId] = rec;
      this.save(data);
      Playtime.recordRound(gameId, score, isNewHigh);
      return { isNewHigh, high: rec.high, plays: rec.plays };
    },
    resetGame(gameId) {
      const data = this.load();
      delete data.games[gameId];
      this.save(data);
      RunSave.clear(gameId);
      Playtime.resetGame(gameId);
    },
    resetAll() {
      this.save({ schemaVersion: PROGRESS_SCHEMA, games: {} });
      RunSave.clearAll();
      Playtime.resetAll();
    },
    exportText() {
      const payload = {
        format: EXPORT_FORMAT,
        schemaVersion: PROGRESS_SCHEMA,
        appVersion: ARCADE_VERSION,
        exportedAt: new Date().toISOString(),
        state: this.load().games,
        runs: RunSave.all(),
        playtime: Playtime.exportData(),
      };
      return JSON.stringify(payload, null, 2);
    },
    importText(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return { ok: false, reason: '不是有效的 JSON' };
      }
      if (!parsed || parsed.format !== EXPORT_FORMAT || parsed.schemaVersion !== PROGRESS_SCHEMA || !parsed.state || typeof parsed.state !== 'object') {
        return { ok: false, reason: '不是街机厅进度备份文件' };
      }
      const games = Object.create(null);
      Object.keys(parsed.state).forEach((id) => {
        const rec = parsed.state[id];
        if (!rec || typeof rec !== 'object') return;
        games[id] = {
          high: Number(rec.high) || 0,
          plays: Number(rec.plays) || 0,
          lastAt: rec.lastAt || null,
          lastScore: Number(rec.lastScore) || 0,
        };
      });
      const prevProgress = safeGetRaw(PROGRESS_KEY);
      const prevRuns = safeGetRaw(RUNS_KEY);
      const prevPlaytime = safeGetRaw(PLAYTIME_KEY);
      const progressSaved = this.save({ schemaVersion: PROGRESS_SCHEMA, games });
      if (!progressSaved) return { ok: false, reason: '浏览器存储已满或不可用' };
      /* 新备份包含局内存档；旧备份没有 runs 字段时保留当前局内存档。 */
      let runCount = 0;
      let runSkipped = 0;
      if (parsed.runs && typeof parsed.runs === 'object') {
        const imported = RunSave.importMap(parsed.runs);
        if (!imported.ok) {
          safeRestoreRaw(PROGRESS_KEY, prevProgress);
          safeRestoreRaw(RUNS_KEY, prevRuns);
          safeRestoreRaw(PLAYTIME_KEY, prevPlaytime);
          return { ok: false, reason: '浏览器存储已满或不可用' };
        }
        runCount = imported.count;
        runSkipped = imported.skipped;
      }
      /* 0.5.0 备份包含游玩时长；旧备份没有 playtime 字段时保留当前统计。 */
      let playtimeCount = 0;
      if (parsed.playtime && typeof parsed.playtime === 'object') {
        const imported = Playtime.importData(parsed.playtime);
        if (!imported.ok) {
          safeRestoreRaw(PROGRESS_KEY, prevProgress);
          safeRestoreRaw(RUNS_KEY, prevRuns);
          safeRestoreRaw(PLAYTIME_KEY, prevPlaytime);
          return { ok: false, reason: '浏览器存储已满或不可用' };
        }
        playtimeCount = imported.count;
      }
      return { ok: true, count: Object.keys(games).length, runCount, runSkipped, playtimeCount };
    },
  };

  /* ----------------------------------------------------------
   * 偏好（静音等）
   * ---------------------------------------------------------- */
  const Prefs = {
    load() {
      const data = safeGetJSON(PREFS_KEY);
      /* immersive 为 0.4.0 新增字段；旧偏好对象缺少该字段时按关闭处理。 */
      return Object.assign({ muted: false, immersive: false }, data && typeof data === 'object' ? data : {});
    },
    save(prefs) {
      safeSetJSON(PREFS_KEY, prefs);
    },
  };

  /* ----------------------------------------------------------
   * WebAudio 合成音效（无音频文件，纯振荡器/噪声）
   * ---------------------------------------------------------- */
  const Sfx = (() => {
    let ctx = null;
    let muted = Prefs.load().muted;

    function ensureCtx() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          try {
            ctx = new AC();
          } catch (err) {
            ctx = null;
          }
        }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(opts) {
      const o = Object.assign({ freq: 440, endFreq: null, dur: 0.12, type: 'square', vol: 0.12, delay: 0 }, opts);
      const ac = ensureCtx();
      if (!ac) return;
      const t0 = ac.currentTime + o.delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = o.type;
      osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
      if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.endFreq), t0 + o.dur);
      gain.gain.setValueAtTime(o.vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.05);
    }

    function noise(opts) {
      const o = Object.assign({ dur: 0.25, vol: 0.2, delay: 0, cutoff: 1600 }, opts);
      const ac = ensureCtx();
      if (!ac) return;
      const t0 = ac.currentTime + o.delay;
      const len = Math.max(1, Math.floor(ac.sampleRate * o.dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(o.vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.cutoff;
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(t0);
    }

    const presets = {
      shoot: () => tone({ freq: 900, endFreq: 300, dur: 0.07, vol: 0.04 }),
      hit: () => tone({ freq: 520, endFreq: 140, dur: 0.1, vol: 0.1 }),
      explode: () => {
        noise({ dur: 0.32, vol: 0.22 });
        tone({ freq: 170, endFreq: 40, dur: 0.32, type: 'sawtooth', vol: 0.1 });
      },
      jump: () => tone({ freq: 300, endFreq: 680, dur: 0.12, vol: 0.07 }),
      land: () => tone({ freq: 190, endFreq: 95, dur: 0.08, type: 'triangle', vol: 0.09 }),
      spring: () => tone({ freq: 420, endFreq: 1050, dur: 0.16, vol: 0.09 }),
      bell: (step) => {
        const f = 660 * Math.pow(1.0595, clamp(step || 0, 0, 24));
        tone({ freq: f, dur: 0.3, type: 'sine', vol: 0.14 });
        tone({ freq: f * 2.01, dur: 0.18, type: 'sine', vol: 0.05 });
      },
      perfect: () => {
        tone({ freq: 880, dur: 0.09, vol: 0.11 });
        tone({ freq: 1318, dur: 0.13, vol: 0.09, delay: 0.09 });
      },
      over: () => tone({ freq: 420, endFreq: 100, dur: 0.55, type: 'sawtooth', vol: 0.12 }),
      ui: () => tone({ freq: 660, dur: 0.06, vol: 0.07 }),
      crash: () => {
        noise({ dur: 0.5, vol: 0.26, cutoff: 900 });
        tone({ freq: 130, endFreq: 30, dur: 0.5, type: 'sawtooth', vol: 0.12 });
      },
    };

    return {
      unlock() {
        ensureCtx();
      },
      play(name, arg) {
        if (muted) return;
        const fn = presets[name];
        if (fn) fn(arg);
      },
      setMuted(value) {
        muted = !!value;
        const prefs = Prefs.load();
        prefs.muted = muted;
        Prefs.save(prefs);
      },
      get muted() {
        return muted;
      },
    };
  })();

  /* 在首次用户手势时解锁 AudioContext（浏览器自动播放策略）。 */
  function installSfxUnlock() {
    const unlock = () => {
      Sfx.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /* ----------------------------------------------------------
   * 输入：键盘 + 指针（触摸/鼠标统一）
   * ---------------------------------------------------------- */
  function createInput(canvas) {
    const keys = new Set();
    const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar']);
    const pointer = {
      x: 0,
      y: 0,
      startX: 0,
      startY: 0,
      dx: 0,
      dy: 0,
      down: false,
      wentDown: false,
      wentUp: false,
      wentCancel: false,
      moved: false,
      seen: false,
      id: null,
      type: '',
    };

    function normKey(e) {
      return e.key.length === 1 ? e.key.toLowerCase() : e.key;
    }
    function isEditableTarget(target) {
      if (!target || !target.tagName) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }
    function onKeyDown(e) {
      if (isEditableTarget(e.target)) return;
      if (BLOCKED.has(e.key)) e.preventDefault();
      keys.add(normKey(e));
    }
    function onKeyUp(e) {
      keys.delete(normKey(e));
    }
    function clearPointer() {
      pointer.down = false;
      pointer.wentDown = false;
      pointer.wentUp = false;
      pointer.wentCancel = false;
      pointer.moved = false;
      pointer.id = null;
      pointer.type = '';
    }
    function onBlur() {
      keys.clear();
      clearPointer();
    }
    function onVisibility() {
      if (document.hidden) onBlur();
    }
    function toLogicalX(clientX) {
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 ? ((clientX - rect.left) / rect.width) * canvas.__arcadeLogicalW : 0;
    }
    function toLogicalY(clientY) {
      const rect = canvas.getBoundingClientRect();
      return rect.height > 0 ? ((clientY - rect.top) / rect.height) * canvas.__arcadeLogicalH : 0;
    }
    function updatePosition(e) {
      pointer.x = toLogicalX(e.clientX);
      pointer.y = toLogicalY(e.clientY);
      pointer.seen = true;
      pointer.dx = pointer.x - pointer.startX;
      pointer.dy = pointer.y - pointer.startY;
      if (Math.abs(pointer.dx) > 4 || Math.abs(pointer.dy) > 4) pointer.moved = true;
    }
    function onPointerDown(e) {
      /* 只让第一根手指拥有指针；第二根手指不能劫持拖动坐标。 */
      if (pointer.id !== null && pointer.id !== e.pointerId) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      pointer.id = e.pointerId;
      pointer.type = e.pointerType || 'mouse';
      pointer.down = true;
      pointer.wentDown = true;
      pointer.wentUp = false;
      pointer.wentCancel = false;
      pointer.moved = false;
      pointer.seen = true;
      pointer.x = toLogicalX(e.clientX);
      pointer.y = toLogicalY(e.clientY);
      pointer.startX = pointer.x;
      pointer.startY = pointer.y;
      pointer.dx = 0;
      pointer.dy = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 忽略捕获失败 */
      }
    }
    function onPointerMove(e) {
      if (pointer.id !== null && e.pointerId !== pointer.id) return;
      if (pointer.id === null) return;
      updatePosition(e);
    }
    function onPointerUp(e) {
      if (pointer.id === null) return;
      if (e.pointerId !== pointer.id) return;
      updatePosition(e);
      pointer.down = false;
      pointer.wentUp = true;
      pointer.wentCancel = false;
      pointer.id = null;
    }
    function onPointerCancel(e) {
      if (pointer.id === null) return;
      if (e.pointerId !== pointer.id) return;
      pointer.down = false;
      pointer.wentUp = false;
      pointer.wentCancel = true;
      pointer.moved = false;
      pointer.id = null;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    /* 捕获失败或指针在画布外抬起/移动时，仍要更新/释放按住状态，避免粘键。 */
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    canvas.style.touchAction = 'none';

    return {
      pointer,
      isDown(...codes) {
        return codes.some((c) => keys.has(c));
      },
      endFrame() {
        pointer.wentDown = false;
        pointer.wentUp = false;
        pointer.wentCancel = false;
      },
      destroy() {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
      },
    };
  }

  /* ----------------------------------------------------------
   * 舞台：逻辑分辨率固定，CSS 负责等比缩放；这里负责 DPR 像素适配
   * ---------------------------------------------------------- */
  function createStage(canvas, logicalW, logicalH) {
    canvas.__arcadeLogicalW = logicalW;
    canvas.__arcadeLogicalH = logicalH;
    const ctx = canvas.getContext('2d');
    const stage = {
      canvas,
      ctx,
      w: logicalW,
      h: logicalH,
      scaleX: 1,
      scaleY: 1,
      fit() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        if (rect.width > 0 && rect.height > 0) {
          canvas.width = Math.round(rect.width * dpr);
          canvas.height = Math.round(rect.height * dpr);
        }
        stage.scaleX = canvas.width / logicalW;
        stage.scaleY = canvas.height / logicalH;
      },
      beginFrame() {
        ctx.setTransform(stage.scaleX, 0, 0, stage.scaleY, 0, 0);
      },
    };
    stage.fit();
    window.addEventListener('resize', () => stage.fit());
    /* 移动端旋转/全屏切换后，部分浏览器会在 resize 之后才稳定视口尺寸。 */
    window.addEventListener('orientationchange', () => setTimeout(() => stage.fit(), 140));
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => stage.fit());
      ro.observe(canvas);
    }
    return stage;
  }

  /* ----------------------------------------------------------
   * 固定步长游戏循环（rAF + accumulator，dt 上限防螺旋）
   * ---------------------------------------------------------- */
  function createLoop({ step = 1 / 60, maxDelta = 0.1, update, render, onAutoPause, onAutoResume }) {
    let rafId = 0;
    let last = 0;
    let acc = 0;
    let running = false;
    let userPaused = false;
    let autoPaused = false;
    let lastPausedRender = 0;

    function frame(now) {
      if (!running) return;
      const delta = Math.min(maxDelta, (now - last) / 1000);
      last = now;
      if (userPaused || autoPaused) {
        /* 暂停时 resize 会重建 canvas 像素缓冲；低频重绘保证不出现空白画布。 */
        if (now - lastPausedRender > 200) {
          lastPausedRender = now;
          render();
        }
        rafId = requestAnimationFrame(frame);
        return;
      }
      acc += delta;
      while (acc >= step) {
        update(step);
        acc -= step;
      }
      render();
      rafId = requestAnimationFrame(frame);
    }

    const loop = {
      start() {
        if (running) return;
        running = true;
        last = performance.now();
        acc = 0;
        rafId = requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        cancelAnimationFrame(rafId);
      },
      pause() {
        userPaused = true;
      },
      resume() {
        userPaused = false;
        last = performance.now();
        acc = 0;
      },
      renderOnce() {
        render();
      },
      get running() {
        return running;
      },
      get paused() {
        return userPaused || autoPaused;
      },
    };

    function onWindowBlur() {
      if (!running || userPaused || autoPaused) return;
      autoPaused = true;
      if (onAutoPause) onAutoPause();
    }
    function onWindowFocus() {
      if (!autoPaused) return;
      autoPaused = false;
      last = performance.now();
      acc = 0;
      if (onAutoResume) onAutoResume();
    }
    function onVisibility() {
      if (document.hidden) onWindowBlur();
      else onWindowFocus();
    }
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return loop;
  }

  /* ----------------------------------------------------------
   * 物理辅助：AABB / 圆碰撞 / 单向平台 / 单摆积分
   * ---------------------------------------------------------- */
  const Physics = {
    aabbOverlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },
    circleBox(cx, cy, r, b) {
      const nx = clamp(cx, b.x, b.x + b.w);
      const ny = clamp(cy, b.y, b.y + b.h);
      const dx = cx - nx;
      const dy = cy - ny;
      return dx * dx + dy * dy <= r * r;
    },
    circleCircle(x1, y1, r1, x2, y2, r2) {
      const dx = x1 - x2;
      const dy = y1 - y2;
      const rr = r1 + r2;
      return dx * dx + dy * dy <= rr * rr;
    },
    /* 单向平台：仅当下落中、上一帧双脚还在平台上方、本帧穿过平台顶时着陆。 */
    oneWayLanding(body, prevBottom, plat, tolerance = 0.6) {
      return (
        body.vy >= 0 &&
        prevBottom <= plat.y + tolerance &&
        body.y + body.h >= plat.y &&
        body.x + body.w > plat.x + 2 &&
        body.x < plat.x + plat.w - 2
      );
    },
    /* 真单摆积分（角度制弧度）：state = { angle, vel, length, gravity } */
    pendulumStep(state, dt) {
      const acc = -(state.gravity / state.length) * Math.sin(state.angle) - state.damping * state.vel;
      state.vel += acc * dt;
      state.angle += state.vel * dt;
      return state.angle;
    },
  };

  /* ----------------------------------------------------------
   * 粒子系统（池化）
   * ---------------------------------------------------------- */
  function createParticles(max = 320) {
    const pool = [];
    const live = [];
    for (let i = 0; i < max; i++) pool.push({});

    function emit(x, y, opts) {
      const o = Object.assign(
        { count: 8, speed: [40, 160], angle: [0, TAU], life: [0.3, 0.7], size: [2, 5], colors: ['#ffffff'], gravity: 0, fade: true },
        opts
      );
      for (let i = 0; i < o.count; i++) {
        if (!pool.length || live.length >= max) return;
        const p = pool.pop();
        const ang = rand(o.angle[0], o.angle[1]);
        const spd = rand(o.speed[0], o.speed[1]);
        p.x = x;
        p.y = y;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd;
        p.maxLife = rand(o.life[0], o.life[1]);
        p.life = p.maxLife;
        p.size = rand(o.size[0], o.size[1]);
        p.color = pick(o.colors);
        p.gravity = o.gravity;
        p.fade = o.fade;
        live.push(p);
      }
    }

    function update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.life -= dt;
        if (p.life <= 0) {
          live.splice(i, 1);
          pool.push(p);
          continue;
        }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    function draw(ctx) {
      for (let i = 0; i < live.length; i++) {
        const p = live[i];
        ctx.globalAlpha = p.fade ? clamp(p.life / p.maxLife, 0, 1) : 1;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }

    function clear() {
      while (live.length) pool.push(live.pop());
    }

    return { emit, update, draw, clear };
  }

  /* ----------------------------------------------------------
   * 滚动星空（纵版射击 / 雪铃共用）
   * ---------------------------------------------------------- */
  function createStarfield(w, h, opts) {
    const o = Object.assign({ layers: 3, count: 46, colors: ['#8fa3d9', '#c3cfe8', '#f0f4ff'] }, opts);
    const stars = [];
    for (let i = 0; i < o.count; i++) {
      const layer = randInt(0, o.layers - 1);
      stars.push({
        x: rand(0, w),
        y: rand(0, h),
        layer,
        speed: 18 + layer * 26,
        size: 0.7 + layer * 0.55,
        color: o.colors[layer % o.colors.length],
      });
    }
    return {
      update(dt, factor) {
        const f = factor == null ? 1 : factor;
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          s.y += s.speed * f * dt;
          if (s.y > h) {
            s.y = -2;
            s.x = rand(0, w);
          }
        }
      },
      draw(ctx) {
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          ctx.globalAlpha = 0.35 + s.layer * 0.25;
          ctx.fillStyle = s.color;
          ctx.fillRect(s.x, s.y, s.size, s.size * (1 + s.layer * 0.6));
        }
        ctx.globalAlpha = 1;
      },
    };
  }

  /* ----------------------------------------------------------
   * 绘制辅助
   * ---------------------------------------------------------- */
  const draw = {
    roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, rr);
      } else {
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
      }
    },
    label(ctx, text, x, y, opts) {
      const o = Object.assign({ font: '14px system-ui, sans-serif', color: '#fff', align: 'center', baseline: 'middle', alpha: 1 }, opts);
      ctx.save();
      ctx.globalAlpha = o.alpha;
      ctx.font = o.font;
      ctx.fillStyle = o.color;
      ctx.textAlign = o.align;
      ctx.textBaseline = o.baseline;
      ctx.fillText(text, x, y);
      ctx.restore();
    },
  };

  /* ----------------------------------------------------------
   * 通用 UI 小工具：覆盖层 / 暂停按钮 / 续玩提示
   * ---------------------------------------------------------- */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSavedAt(iso) {
    if (!iso) return '未游玩';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '未游玩';
    const diff = Math.max(0, Date.now() - t);
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function createOverlayUiBase(dom) {
    let previousFocus = null;
    if (dom.overlay) {
      dom.overlay.setAttribute('role', 'dialog');
      dom.overlay.setAttribute('aria-modal', 'true');
      if (dom.ovTitle) {
        if (!dom.ovTitle.id) dom.ovTitle.id = 'arcade-overlay-title';
        dom.overlay.setAttribute('aria-labelledby', dom.ovTitle.id);
      }
    }
    function hide() {
      dom.overlay.hidden = true;
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try {
          previousFocus.focus({ preventScroll: true });
        } catch (err) {
          /* 忽略焦点恢复失败 */
        }
      }
      previousFocus = null;
    }
    function show(opts) {
      const o = opts || {};
      if (dom.overlay.hidden) previousFocus = document.activeElement;
      dom.ovTitle.textContent = o.title || '';
      dom.ovText.innerHTML = o.text || '';
      dom.ovBtn.textContent = o.btn || '开始游戏';
      dom.ovBtn.onclick = () => {
        Sfx.play('ui');
        if (o.onBtn) o.onBtn();
      };
      if (dom.ovBtn2) {
        const hasSecond = !!o.btn2;
        dom.ovBtn2.hidden = !hasSecond;
        dom.ovBtn2.textContent = o.btn2 || '';
        dom.ovBtn2.onclick = hasSecond
          ? () => {
              Sfx.play('ui');
              if (o.onBtn2) o.onBtn2();
            }
          : null;
      }
      dom.overlay.hidden = false;
      try {
        dom.ovBtn.focus({ preventScroll: true });
      } catch (err) {
        /* 忽略焦点设置失败 */
      }
    }
    return {
      show,
      hide,
      get visible() {
        return !dom.overlay.hidden;
      },
    };
  }

  /* 在共享弹层上挂接游玩计时：弹层关闭=开始计时，弹层打开=暂停计时。 */
  function createOverlayUi(dom) {
    const ui = createOverlayUiBase(dom);
    /* 初始保持“弹层打开”，由 show/hide 显式切换；避免把页面上屏前的初始化间隙计入游玩。 */
    return {
      show(opts) {
        ui.show(opts);
        Playtime.setOverlayVisible(true);
      },
      hide() {
        ui.hide();
        Playtime.setOverlayVisible(false);
      },
      get visible() {
        return ui.visible;
      },
    };
  }

  /* 顶栏暂停按钮 + P / Esc 快捷键；按钮在非游玩态自动禁用。 */
  function bindPause(opts) {
    const button = opts.button;
    function sync() {
      if (!button) return;
      const paused = !!opts.isPaused();
      const playing = !!opts.isPlaying();
      button.disabled = !paused && !playing;
      button.textContent = paused ? '▶' : '⏸';
      button.setAttribute('aria-label', paused ? '继续游戏' : '暂停游戏');
      button.title = paused ? '继续游戏（P / Esc）' : '暂停游戏（P / Esc）';
    }
    if (button) {
      button.addEventListener('click', () => {
        if (opts.isPaused()) opts.resume();
        else if (opts.isPlaying()) opts.pause();
        sync();
      });
    }
    if (opts.keyboard !== false) {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const target = e.target;
        if (target && target.tagName) {
          const tag = target.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
        }
        if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
          if (opts.isPaused()) opts.resume();
          else if (opts.isPlaying()) opts.pause();
          sync();
        }
      });
    }
    sync();
    return { sync };
  }

  function showResumePrompt(ui, saved, opts) {
    const o = opts || {};
    const summary = saved && saved.summary ? '<br/>' + escapeHtml(saved.summary) : '';
    ui.show({
      title: '继续上次？',
      text:
        `${o.name ? escapeHtml(o.name) + ' ' : ''}的局内进度已自动保存在本机。` +
        `<br/>保存于 ${escapeHtml(formatSavedAt(saved && saved.savedAt))}${summary}`,
      btn: '继续上次',
      onBtn: o.onResume,
      btn2: '重新开始',
      onBtn2: o.onRestart,
    });
  }

  /* ----------------------------------------------------------
   * 全屏 / 沉浸模式（0.4.0）
   * - 有原生 Fullscreen API 时请求整页全屏；没有或被拒绝时退化为纯 CSS 沉浸。
   * - 只有游戏页（存在 .game-page）会自动安装，中心页不受影响。
   * - 全屏只由显式入口触发（⛶ / F / 弹层按钮）；点开始/继续不会自动进入全屏。
 *   prefs.immersive 仍记录上次选择，避免把“点开始”误当成全屏指令。
   * ---------------------------------------------------------- */
  function showArcadeToast(text, duration) {
    if (!document.body) return;
    const el = document.createElement('div');
    el.className = 'ac-toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 260);
    }, duration || 3800);
  }

  /* ----------------------------------------------------------
   * 分享（0.5.0）
   * - 优先系统分享面板（navigator.share），不支持或失败时复制链接。
   * - 只分享公开 URL 与推荐文案，不读取、不上传最高分或游玩记录。
   * ---------------------------------------------------------- */
  function copyText(text) {
    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, area.value.length);
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch (err) {
        return false;
      }
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        return navigator.clipboard.writeText(text).then(
          () => true,
          () => fallback()
        );
      } catch (err) {
        return Promise.resolve(fallback());
      }
    }
    return Promise.resolve(fallback());
  }

  const Share = {
    get canNative() {
      return typeof navigator.share === 'function';
    },
    hubUrl() {
      return new URL('./', ARCADE_BASE).href;
    },
    gameUrl(game) {
      return new URL('./games/' + game.file, ARCADE_BASE).href;
    },
    async open(payload) {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share(payload);
          return { ok: true, mode: 'native' };
        } catch (err) {
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            return { ok: false, aborted: true };
          }
        }
      }
      try {
        const copied = await copyText(payload.text + '\n' + payload.url);
        return { ok: copied, mode: 'copy' };
      } catch (err) {
        return { ok: false, mode: 'copy' };
      }
    },
    shareHub() {
      const url = this.hubUrl();
      return this.open({
        title: '街机厅 Arcade · StudioKit',
        text: '推荐你玩 StudioKit 街机厅：13 款竖屏小游戏，打开即玩，无需登录，还能预载到本地离线玩。',
        url,
      });
    },
    shareGame(game) {
      const url = this.gameUrl(game);
      return this.open({
        title: `${game.name} · 街机厅 Arcade`,
        text: `推荐你玩「${game.name}」：${game.tagline}。13 款竖屏小游戏，打开即玩，可离线预载。`,
        url,
      });
    },
  };

  function installShareInline() {
    const panel = document.querySelector('.game-page .overlay-panel');
    const game = detectCurrentGame();
    if (!panel || !game || panel.querySelector('[data-share-inline]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ac-fs-inline ac-share-inline';
    button.dataset.shareInline = '';
    button.textContent = '↗ 分享给朋友';
    panel.appendChild(button);
    button.addEventListener('click', async () => {
      const result = await Share.shareGame(game);
      if (result.aborted) return;
      if (result.ok) {
        showArcadeToast(result.mode === 'copy' ? '游戏链接已复制，发给朋友即可。' : '已打开系统分享。');
      } else {
        showArcadeToast('分享没有成功，请手动复制地址栏链接。');
      }
    });
  }

  /* ----------------------------------------------------------
   * 离线缓存（0.5.0）
   * - 任意 Arcade 页面都会注册 apps/arcade/sw.js；中心页负责“预载全部游戏”UI。
   * - 核心外壳在 SW 安装时缓存；13 款游戏由用户点按钮后逐项缓存并反馈进度。
   * - file:// 或非安全上下文自动降级为 unsupported，不抛错、不影响游戏。
   * ---------------------------------------------------------- */
  const Offline = (() => {
    const supported =
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.protocol === 'http:');
    const CORE_PATHS = [
      './',
      './index.html',
      './engine.js',
      './arcade.css',
      './manifest.webmanifest',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './icons/maskable-512.png',
      './icons/apple-touch-icon.png',
      '../../shared/site.css',
      '../../shared/site-shell.js',
    ];
    let registerPromise = null;

    function absolute(path) {
      return new URL(path, ARCADE_BASE).href;
    }

    function coreUrls() {
      return CORE_PATHS.map(absolute);
    }

    function gameUrls() {
      return GAMES.map((game) => absolute('./games/' + game.file));
    }

    function preloadUrls() {
      return Array.from(new Set(coreUrls().concat(gameUrls())));
    }

    function register() {
      if (!supported) return Promise.reject(new Error('service worker unsupported'));
      if (registerPromise) return registerPromise;
      const scriptUrl = absolute('./sw.js');
      registerPromise = navigator.serviceWorker
        .register(scriptUrl, { scope: ARCADE_BASE.pathname })
        .then((registration) => {
          try {
            const update = registration.update();
            if (update && typeof update.catch === 'function') update.catch(() => {});
          } catch (err) {
            /* 更新检查失败不影响当前注册 */
          }
          return registration;
        })
        .catch(async (err) => {
          registerPromise = null;
          /* 离线重开时更新检查可能失败；已有注册仍可继续服务当前页面。 */
          try {
            const existing = await navigator.serviceWorker.getRegistration(ARCADE_BASE.href);
            if (existing) return existing;
          } catch (lookupError) {
            /* 忽略查询失败，保留原始错误 */
          }
          throw err;
        });
      return registerPromise;
    }

    function activeRegistration() {
      const ready = navigator.serviceWorker.ready;
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('arcade service worker not ready')), 12000);
      });
      return Promise.race([ready, timeout]).then(() =>
        navigator.serviceWorker.getRegistration(ARCADE_BASE.href).then((registration) => {
          if (!registration) throw new Error('arcade service worker not registered');
          return registration;
        })
      );
    }

    function precache(urls, onEvent) {
      return activeRegistration().then(
        (registration) =>
          new Promise((resolve, reject) => {
            const target = registration.active || registration.waiting || registration.installing;
            if (!target) {
              reject(new Error('service worker is not active'));
              return;
            }
            const channel = new MessageChannel();
            let settled = false;
            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              channel.port1.close();
              reject(new Error('precache timeout'));
            }, 180000);
            function finish(payload) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              channel.port1.close();
              resolve(payload);
            }
            channel.port1.onmessage = (event) => {
              const message = event.data || {};
              if (message.type === 'arcade-precache-progress') {
                if (onEvent) onEvent(message);
              } else if (message.type === 'arcade-precache-done') {
                finish(message);
              }
            };
            target.postMessage({ type: 'arcade-precache', urls }, [channel.port2]);
          })
      );
    }

    async function cacheStatus() {
      const blank = {
        supported,
        cached: 0,
        total: 0,
        coreCached: 0,
        coreTotal: 0,
        gamesCached: 0,
        gamesTotal: GAMES.length,
      };
      if (!supported || typeof caches === 'undefined') return blank;
      await activeRegistration();
      const core = coreUrls();
      const games = gameUrls();
      const hits = await Promise.all(
        core.concat(games).map((url) =>
          caches
            .match(url, { ignoreSearch: true })
            .then((response) => !!response)
            .catch(() => false)
        )
      );
      const coreCached = hits.slice(0, core.length).filter(Boolean).length;
      const gamesCached = hits.slice(core.length).filter(Boolean).length;
      return {
        supported,
        cached: coreCached + gamesCached,
        total: core.length + games.length,
        coreCached,
        coreTotal: core.length,
        gamesCached,
        gamesTotal: games.length,
      };
    }

    function autoRegister() {
      if (!supported) return;
      register().catch(() => {
        /* 离线不可用不应影响在线游玩 */
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoRegister, { once: true });
    } else {
      autoRegister();
    }

    return {
      supported,
      register,
      precache,
      cacheStatus,
      preloadUrls,
      coreUrls,
      gameUrls,
    };
  })();

  let displayMode = null;
  let displayAutoInstalled = false;

  function installDisplayMode() {
    if (displayMode) return displayMode;
    const gamePage = document.querySelector('.game-page');
    if (!gamePage) return null;
    const topbar = gamePage.querySelector('.game-topbar');
    const overlayPanel = gamePage.querySelector('.overlay-panel');
    const docEl = document.documentElement;

    let active = false;
    let nativeActive = false;
    let opToken = 0;
    let fallbackNotified = false;

    const topButton = document.createElement('button');
    topButton.type = 'button';
    topButton.className = 'ac-icon-btn ac-fs-btn';
    topButton.dataset.fullscreen = '';
    if (topbar) {
      const pause = topbar.querySelector('[data-pause]');
      topbar.insertBefore(topButton, pause || null);
    }

    const inlineButton = document.createElement('button');
    inlineButton.type = 'button';
    inlineButton.className = 'ac-fs-inline';
    inlineButton.dataset.fullscreenInline = '';
    inlineButton.textContent = '⛶ 全屏模式';
    if (overlayPanel) {
      overlayPanel.appendChild(inlineButton);
      inlineButton.hidden = false;
    }

    function fsElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function sync() {
      docEl.classList.toggle('arcade-immersive', active);
      document.body.classList.toggle('arcade-immersive', active);
      topButton.textContent = active ? '⤡' : '⛶';
      topButton.setAttribute('aria-label', active ? '退出全屏模式' : '进入全屏模式');
      topButton.setAttribute('aria-pressed', String(active));
      topButton.title = active ? '退出全屏模式（F）' : '进入全屏模式（F）';
      inlineButton.hidden = active;
      /* 尺寸切换后 ResizeObserver 会重算；再补两次 resize，覆盖 Safari 的延迟视口更新。 */
      setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 280);
    }

    function savePref(value) {
      const prefs = Prefs.load();
      prefs.immersive = !!value;
      Prefs.save(prefs);
    }

    function isAppleTouch() {
      const ua = navigator.userAgent || '';
      if (/iP(hone|ad|od)/.test(ua)) return true;
      return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
    }

    function lockOrientation() {
      try {
        const so = window.screen && window.screen.orientation;
        if (so && typeof so.lock === 'function') {
          const result = so.lock('portrait');
          if (result && typeof result.catch === 'function') result.catch(() => {});
        }
      } catch (err) {
        /* 桌面浏览器 / 未获授权时忽略 */
      }
    }

    function unlockOrientation() {
      try {
        const so = window.screen && window.screen.orientation;
        if (so && typeof so.unlock === 'function') so.unlock();
      } catch (err) {
        /* 忽略 */
      }
    }

    function exitNative() {
      const fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (!fn) return;
      try {
        const result = fn.call(document);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch (err) {
        /* 忽略 */
      }
    }

    async function enter() {
      if (active) return;
      const token = ++opToken;
      active = true;
      sync();
      const request = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
      if (request) {
        try {
          const result = request.call(docEl, { navigationUI: 'hide' });
          if (result && typeof result.then === 'function') await result;
          nativeActive = !!fsElement();
        } catch (err) {
          nativeActive = false;
        }
      }
      if (token !== opToken) {
        /* 请求期间用户已经退出，避免把状态又切回全屏。 */
        if (fsElement()) exitNative();
        return;
      }
      if (!nativeActive && !fallbackNotified) {
        fallbackNotified = true;
        showArcadeToast(
          isAppleTouch()
            ? '已进入沉浸模式；iOS 浏览器暂不支持网页全屏，可「添加到主屏幕」获得更纯粹的显示。'
            : '已进入沉浸模式（当前浏览器不支持网页全屏）。',
          4600
        );
      }
      lockOrientation();
      savePref(true);
    }

    function exit() {
      opToken++;
      const wasNative = nativeActive || !!fsElement();
      active = false;
      nativeActive = false;
      sync();
      savePref(false);
      if (wasNative) exitNative();
      unlockOrientation();
    }

    function toggle() {
      if (active) exit();
      else enter();
    }

    function onFullscreenChange() {
      const el = fsElement();
      if (el) {
        nativeActive = true;
        if (!active) {
          active = true;
          sync();
          savePref(true);
        }
        return;
      }
      if (!nativeActive) return;
      nativeActive = false;
      if (active) {
        active = false;
        sync();
        savePref(false);
        unlockOrientation();
      }
    }

    topButton.addEventListener('click', toggle);
    inlineButton.addEventListener('click', toggle);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      const target = e.target;
      if (target && target.tagName) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }
      e.preventDefault();
      toggle();
    });

    sync();
    displayMode = {
      enter,
      exit,
      toggle,
      element: gamePage,
      get active() {
        return active;
      },
      get native() {
        return nativeActive;
      },
    };
    return displayMode;
  }

  function autoInstallDisplayMode() {
    if (displayAutoInstalled) return;
    displayAutoInstalled = true;
    installDisplayMode();
    installShareInline();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInstallDisplayMode, { once: true });
  } else {
    autoInstallDisplayMode();
  }

  window.Arcade = {
    version: ARCADE_VERSION,
    get displayMode() {
      return displayMode;
    },
    installDisplayMode,
    showToast: showArcadeToast,
    baseUrl: ARCADE_BASE.href,
    GAMES,
    DIFFICULTY_NAMES,
    Progress,
    RunSave,
    Playtime,
    Share,
    Offline,
    Prefs,
    Sfx,
    installSfxUnlock,
    createInput,
    createStage,
    createLoop,
    createParticles,
    createStarfield,
    createRunAutosave,
    createOverlayUi,
    bindPause,
    showResumePrompt,
    formatSavedAt,
    formatDuration,
    formatClock,
    formatRoundAt,
    escapeHtml,
    Physics,
    draw,
    utils: { TAU, clamp, lerp, rand, randInt, pick },
    reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})();
