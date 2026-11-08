/*
 * 街机厅共享运行时（Arcade Engine）
 * - 纯静态零依赖：不引入任何 CDN / 远程资源 / 框架（AGENTS.md 约束 4/7）。
 * - localStorage 命名空间：studiokit:arcade:*（AGENTS.md 约束 6）。
 * - ARCADE_VERSION 需与 shared/tool-registry.json 中 arcade 条目及 README 保持同步。
 */
(() => {
  'use strict';

  const ARCADE_VERSION = '0.1.0';
  const PROGRESS_KEY = 'studiokit:arcade:progress:v1';
  const PREFS_KEY = 'studiokit:arcade:prefs:v1';
  const PROGRESS_SCHEMA = 1;
  const EXPORT_FORMAT = 'studiokit-arcade-progress';

  /* ----------------------------------------------------------
   * 游戏清单（街机厅中心页与各游戏页共用的唯一来源）
   * file 相对于 apps/arcade/games/；id 同时是进度存储里的键。
   * ---------------------------------------------------------- */
  const GAMES = [
    {
      id: 'star-raid',
      file: 'star-raid.html',
      name: '星海突击',
      tagline: '雷电式纵版射击',
      icon: '🚀',
      accent: '#4f7cff',
      tags: ['射击', '弹幕'],
      how: '拖动 / ←→ 移动，自动开火；躲开敌机与弹幕。',
    },
    {
      id: 'shadow-leap',
      file: 'shadow-leap.html',
      name: '影跃',
      tagline: '忍者无尽上跳',
      icon: '🥷',
      accent: '#e0567f',
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
      tags: ['物理', '叠塔'],
      how: '看准摆动时机，点击 / 空格松手落箱；偏心会让塔倾斜倒塌。',
    },
    {
      id: 'snowbells',
      file: 'snowbells.html',
      name: '雪铃',
      tagline: '兔子跳铃铛',
      icon: '🐰',
      accent: '#2fa8a0',
      tags: ['弹跳', '连击'],
      how: '←→ 或触摸左右半屏移动，踩中铃铛向上弹；连击有倍率加成。',
    },
  ];

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

  /* ----------------------------------------------------------
   * 进度（全部游戏共用一个 key，中心页一次读出即可管理）
   * ---------------------------------------------------------- */
  const Progress = {
    load() {
      const data = safeGetJSON(PROGRESS_KEY);
      if (data && typeof data === 'object' && data.schemaVersion === PROGRESS_SCHEMA && data.games && typeof data.games === 'object') {
        return data;
      }
      return { schemaVersion: PROGRESS_SCHEMA, games: {} };
    },
    save(data) {
      safeSetJSON(PROGRESS_KEY, data);
    },
    get(gameId) {
      const rec = this.load().games[gameId];
      if (rec && typeof rec === 'object') {
        return {
          high: Number(rec.high) || 0,
          plays: Number(rec.plays) || 0,
          lastAt: rec.lastAt || null,
        };
      }
      return { high: 0, plays: 0, lastAt: null };
    },
    recordPlay(gameId, score) {
      const data = this.load();
      const rec = data.games[gameId] || { high: 0, plays: 0, lastAt: null };
      rec.plays += 1;
      rec.lastAt = new Date().toISOString();
      const isNewHigh = score > rec.high;
      if (isNewHigh) rec.high = score;
      data.games[gameId] = rec;
      this.save(data);
      return { isNewHigh, high: rec.high, plays: rec.plays };
    },
    resetGame(gameId) {
      const data = this.load();
      delete data.games[gameId];
      this.save(data);
    },
    resetAll() {
      this.save({ schemaVersion: PROGRESS_SCHEMA, games: {} });
    },
    exportText() {
      const payload = {
        format: EXPORT_FORMAT,
        schemaVersion: PROGRESS_SCHEMA,
        appVersion: ARCADE_VERSION,
        exportedAt: new Date().toISOString(),
        state: this.load().games,
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
      const games = {};
      Object.keys(parsed.state).forEach((id) => {
        const rec = parsed.state[id];
        if (!rec || typeof rec !== 'object') return;
        games[id] = {
          high: Number(rec.high) || 0,
          plays: Number(rec.plays) || 0,
          lastAt: rec.lastAt || null,
        };
      });
      this.save({ schemaVersion: PROGRESS_SCHEMA, games });
      return { ok: true, count: Object.keys(games).length };
    },
  };

  /* ----------------------------------------------------------
   * 偏好（静音等）
   * ---------------------------------------------------------- */
  const Prefs = {
    load() {
      const data = safeGetJSON(PREFS_KEY);
      return Object.assign({ muted: false }, data && typeof data === 'object' ? data : {});
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
    const pointer = { x: 0, y: 0, down: false, wentDown: false, wentUp: false };

    function normKey(e) {
      return e.key.length === 1 ? e.key.toLowerCase() : e.key;
    }
    function onKeyDown(e) {
      if (BLOCKED.has(e.key)) e.preventDefault();
      keys.add(normKey(e));
    }
    function onKeyUp(e) {
      keys.delete(normKey(e));
    }
    function onBlur() {
      keys.clear();
      pointer.down = false;
    }
    function toLogicalX(clientX) {
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 ? ((clientX - rect.left) / rect.width) * canvas.__arcadeLogicalW : 0;
    }
    function toLogicalY(clientY) {
      const rect = canvas.getBoundingClientRect();
      return rect.height > 0 ? ((clientY - rect.top) / rect.height) * canvas.__arcadeLogicalH : 0;
    }
    function onPointerDown(e) {
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 忽略捕获失败 */
      }
      pointer.down = true;
      pointer.wentDown = true;
      pointer.x = toLogicalX(e.clientX);
      pointer.y = toLogicalY(e.clientY);
    }
    function onPointerMove(e) {
      pointer.x = toLogicalX(e.clientX);
      pointer.y = toLogicalY(e.clientY);
    }
    function onPointerUp(e) {
      pointer.down = false;
      pointer.wentUp = true;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.style.touchAction = 'none';

    return {
      pointer,
      isDown(...codes) {
        return codes.some((c) => keys.has(c));
      },
      endFrame() {
        pointer.wentDown = false;
        pointer.wentUp = false;
      },
      destroy() {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
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

    function frame(now) {
      if (!running) return;
      const delta = Math.min(maxDelta, (now - last) / 1000);
      last = now;
      if (userPaused || autoPaused) {
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
      if (!running || userPaused) return;
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

  window.Arcade = {
    version: ARCADE_VERSION,
    GAMES,
    Progress,
    Prefs,
    Sfx,
    installSfxUnlock,
    createInput,
    createStage,
    createLoop,
    createParticles,
    createStarfield,
    Physics,
    draw,
    utils: { TAU, clamp, lerp, rand, randInt, pick },
    reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})();
