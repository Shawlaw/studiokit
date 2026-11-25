/*!
 * StudioKit Arcade Life — 钱包与交易收据（0.16 / D16-08）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.receipt，
 * 不读 DOM、不写存储、不发请求、不读 localStorage。bridge.js 在需要时调用：
 *
 *   window.ArcadeCareerUI.receipt.open(ctx);       // 钱包面板（modal，可关闭）
 *   window.ArcadeCareerUI.receipt.render(ctx);     // 面板已开时刷新；未开则等同 open
 *   window.ArcadeCareerUI.receipt.close();         // 收起面板与戏内收据卡
 *   window.ArcadeCareerUI.receipt.show(payload);   // 结算后由 bridge 调用；非 modal 收据卡
 *
 * show() 的入参两种形态都接受（bridge 传 {api,result,careerId,announce,reducedMotion}，
 * 测试/直接调用也可传结算结果本身）：
 *   { result: { ok, receipt?, runId?, reason?, duplicate? }, ... }
 *   { ok: true, receipt: { receiptId, credits, items, txIds, ... } }
 *
 * 数据来源硬规则（ADR §18.7）：
 * - 金额/材料只读 db.readWallet / db.readLedger / db.getClaim 的 DB 行（txId），UI 不自算；
 * - 同一 txId 重复行只渲染一次；同 run 重复 show 只保留一张卡；同 run 重复打开面板显示
 *   db.getClaim(runId) 里的原收据（没有则明确显示空态，不伪造）；
 * - careerId 来源优先级：ctx.careerId → ctx.commissionRun.careerId →
 *   ctx.commission.listAvailable({ensure:true}).careerId → ctx.api.commissionRun；
 *   都没有时显示「还没有可查的账目」并不抛异常；
 * - DB 不可用 / ctx.api 无 commission 模块：面板显示降级提示，控制台不报 error。
 *
 * 交互与视觉：
 * - 面板复用 clue-surface.css 的 ac-career-overlay / ac-career-sheet 体系（modal、Esc、
 *   按钮、遮罩、焦点返回、焦点圈闭）；收据卡是无遮罩的浮动卡片（role=status + aria-live），
 *   不抢焦点、不拦截游戏输入，自带 ≥44px 的「收起」按钮；
 * - prefers-reduced-motion / ctx.reducedMotion：面板与卡片都无动画；
 * - 文案全部戏内语言；失败原因映射成一句人话（不把系统 reason 原样甩给玩家）。
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (root && (typeof root === 'object' || typeof root === 'function')) {
    root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
    root.ArcadeCareerUI.receipt = api;
  }
  /* Node 侧（UMD）：require('./receipt.js') 返回同一 API；无 DOM 时 open/show 返回 null。 */
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* ---------------------------------------------------------------- 常量与文案 */

  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet ac-career-sheet--small';
  const TITLE_ID = 'ac-career-receipt-title';
  const PANEL_TITLE = '钱袋与账本';
  const PANEL_CLOSE_LABEL = '收起账本';
  const CLOSE_GLYPH = '×';
  const SUMMARY_TITLE = '眼下的家当';
  const CLAIM_TITLE = '这张收据';
  const LEDGER_TITLE = '最近的流水';
  const CARD_SUCCESS_TITLE = '这趟活儿的收据';
  const CARD_FAILURE_TITLE = '这趟没结成';
  const CARD_CLOSE_TEXT = '收起';
  const CARD_CLOSE_LABEL = '收起这张收据';
  const CREDITS_LABEL = '信用点';

  const LOADING_TEXT = '正在翻账本…';
  const NO_CAREER_TEXT = '还没有可查的账目。';
  const NO_CAREER_HINT = '先在港口的告示板上接一单活儿吧。';
  const DB_UNAVAILABLE_TEXT = '账本这会儿打不开，过会儿再来看看。';
  const WALLET_FAILED_TEXT = '这个钱袋暂时打不开，过会儿再来看看。';
  const NO_WALLET_TEXT = '这个钱袋还没有开张。';
  const LEDGER_EMPTY_TEXT = '账本还是空的。';
  const LEDGER_FAILED_TEXT = '最近的流水暂时翻不到。';
  const LEDGER_QUIET_HINT = '除了开张的底钱，还没有新的进账。';
  const CLAIM_EMPTY_TEXT = '还没有能对账的收据。';
  const CLAIM_FAILED_TEXT = '这张收据暂时核对不了。';
  const NO_MATERIALS_TEXT = '还没有';
  const NO_SHIP_TEXT = '还没有自己的飞船';
  const NO_MONEY_TEXT = '没有动钱';
  const DEFAULT_FAILURE_TEXT = '这笔工钱还没结清。';
  const CARD_TOWN_TEXT = '回告示板';
  const CARD_CONTINUE_TEXT = '读回信';
  const CARD_TOWN_LABEL = '关闭收据并回到告示板';
  const CARD_CONTINUE_LABEL = '关闭收据并读回信';
  const STORY_NEW_LINE = '这趟留下了一条新线索。';
  const STORY_RECORDED_LINE = '这趟留下的线索已经归档。';
  const DUPLICATE_NOTE = '这张收据先前已经开过，工钱不会重复进账。';

  /* 戏内语言：这些系统/营销词不允许出现在 UI 文案里（失败 message 透传时也过滤）。 */
  const FORBIDDEN_WORDS = ['奖励', '领取', '系统', '数值', '签到', '概率', '解锁', '生涯模式', '职业系统'];

  const KIND_LABEL = {
    'initial-grant': '开张的底钱',
    credits: '委托的工钱',
    items: '带回来的材料',
    progress: '路上的记号',
    purchase: '机库里的开销',
  };

  /* 失败 reason → 一句人话（映射不到时用兜底句；不把系统 reason 直接展示）。 */
  const FAILURE_SENTENCES = {
    'objective-not-met': '这趟活儿没干成，工钱还没结清。',
    'objective-missed': '这趟活儿没干成，工钱还没结清。',
    'target-not-met': '这趟活儿没干成，工钱还没结清。',
    missed: '这趟活儿没干成，工钱还没结清。',
    'bad-objective': '这趟活儿没干成，工钱还没结清。',
    'missing-run': '找不到这趟活儿的凭据，工钱还没结清。',
    'run-not-found': '找不到这趟活儿的凭据，工钱还没结清。',
    'invalid-run': '找不到这趟活儿的凭据，工钱还没结清。',
    'bad-run-id': '找不到这趟活儿的凭据，工钱还没结清。',
    'run-state': '这趟活儿还没到结账的时候。',
    'mode-not-allowed': '这趟活儿不算数，工钱结不了。',
    'game-mismatch': '这趟活儿不算数，工钱结不了。',
    'context-mismatch': '这趟活儿在别处起的头，工钱结不了。',
    'nonce-mismatch': '这笔账对不上，工钱暂时结不了。',
    'receipt-mismatch': '这笔账对不上，工钱暂时结不了。',
    'career-mismatch': '这笔账对不上，工钱暂时结不了。',
    'digest-unavailable': '这趟的经过记不清了，工钱暂时结不了。',
    'bad-plan': '这笔账对不上，工钱暂时结不了。',
    'bad-credits': '这笔账对不上，工钱暂时结不了。',
    'bad-items': '这笔账对不上，工钱暂时结不了。',
    'bad-receipt': '这笔账对不上，工钱暂时结不了。',
    'core-unavailable': '账本这会儿打不开，工钱先记着。',
    'core-error': '账本这会儿打不开，工钱先记着。',
    'wallet-unavailable': '账本这会儿打不开，工钱先记着。',
    'no-wallet': '这个钱袋还没有开张。',
    'no-indexeddb': '这台设备暂时存不下账目，过会儿再来。',
    'db-unavailable': '账本这会儿打不开，过会儿再来看看。',
    'balance-cap': '钱袋已经塞满了，先花掉一些再来结账。',
    'commission-module-missing': '这笔工钱还没结清。',
    'commission-settle-empty': '这笔工钱还没结清。',
    'commission-settle-error': '这笔工钱还没结清。',
    'commission-failed': '这笔工钱还没结清。',
  };

  /* ---------------------------------------------------------------- 模块状态 */

  let panel = null;
  let card = null;
  let panelSeq = 0;

  /* ---------------------------------------------------------------- 通用小工具 */

  function documentOf() {
    return typeof document !== 'undefined' && document && typeof document.createElement === 'function' ? document : null;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function finiteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function wholeNumber(value) {
    const num = finiteNumber(value);
    if (num === null) return 0;
    return Math.max(0, Math.floor(num));
  }

  function signedWhole(value) {
    const num = finiteNumber(value);
    if (num === null) return 0;
    return Math.round(num);
  }

  function isValidId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value);
  }

  function isValidToken(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
  }

  function focusableIn(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return [];
    const nodes = scope.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || node.disabled) continue;
      if (typeof node.tabIndex === 'number' && node.tabIndex < 0) continue;
      if (node.hidden) continue;
      if (typeof node.closest === 'function' && node.closest('[hidden]')) continue;
      if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) continue;
      out.push(node);
    }
    return out;
  }

  function safelyFocus(node) {
    if (!node || typeof node.focus !== 'function') return;
    try {
      node.focus();
    } catch (err) {
      /* 焦点失败不影响面板可用性 */
    }
  }

  function reducedMotionPreferred() {
    try {
      if (root && typeof root.matchMedia === 'function') {
        const query = root.matchMedia('(prefers-reduced-motion: reduce)');
        return !!(query && query.matches);
      }
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function contextReducedMotion(context) {
    return !!(isObject(context) && context.reducedMotion === true) || reducedMotionPreferred();
  }

  function make(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function applyStyle(node, styles) {
    if (!node || !node.style || !isObject(styles)) return node;
    Object.keys(styles).forEach((key) => {
      try {
        /* CSS 自定义属性必须走 setProperty；普通属性用驼峰赋值。 */
        if (key.indexOf('--') === 0 && typeof node.style.setProperty === 'function') node.style.setProperty(key, styles[key]);
        else node.style[key] = styles[key];
      } catch (err) {
        /* ignore */
      }
    });
    return node;
  }

  function thenable(value) {
    return !!value && typeof value.then === 'function';
  }

  function safeCall(fn, thisArg, args) {
    try {
      return fn.apply(thisArg, args || []);
    } catch (err) {
      return undefined;
    }
  }

  function looksSafeText(text) {
    const value = cleanText(text);
    if (!value) return '';
    if (value.length > 90) return '';
    for (let i = 0; i < FORBIDDEN_WORDS.length; i += 1) {
      if (value.indexOf(FORBIDDEN_WORDS[i]) >= 0) return '';
    }
    return value;
  }

  /* ---------------------------------------------------------------- 数据读取 */

  /** 找 DB 句柄：ctx.db（QA 注入）→ ctx.api.db（bridge 的 career-db）→ window.ArcadeCareer.db。 */
  function dbModuleOf(context) {
    const ctx = isObject(context) ? context : {};
    if (isObject(ctx.db) && typeof ctx.db.readWallet === 'function') return ctx.db;
    if (isObject(ctx.api) && isObject(ctx.api.db) && typeof ctx.api.db.readWallet === 'function') return ctx.api.db;
    try {
      if (root && isObject(root.ArcadeCareer) && isObject(root.ArcadeCareer.db) && typeof root.ArcadeCareer.db.readWallet === 'function') {
        return root.ArcadeCareer.db;
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function careerIdOf(value) {
    if (typeof value === 'string') return isValidId(value) ? value : null;
    if (!isObject(value)) return null;
    if (isValidId(value.careerId)) return value.careerId;
    if (isValidId(value.result && value.result.careerId)) return value.result.careerId;
    if (isValidId(value.data && value.data.careerId)) return value.data.careerId;
    if (isValidId(value.wallet && value.wallet.careerId)) return value.wallet.careerId;
    return null;
  }

  /**
   * careerId 解析（异步，因为 listAvailable 可能返回 Promise）。
   * 优先级：ctx.careerId → ctx.commissionRun.careerId → commission.listAvailable({ensure:true})
   *        → ctx.api.commissionRun → ctx.profile.careerId（额外兜底，不改变前三项优先级）。
   */
  function resolveCareerId(context) {
    const ctx = isObject(context) ? context : {};
    const direct = careerIdOf(ctx.careerId);
    if (direct) return Promise.resolve(direct);
    if (isObject(ctx.commissionRun)) {
      const runId = careerIdOf(ctx.commissionRun);
      if (runId) return Promise.resolve(runId);
    }
    const fallbackFromApi = () => {
      const api = isObject(ctx.api) ? ctx.api : null;
      if (api) {
        let candidate = api.commissionRun;
        if (typeof candidate === 'function') candidate = safeCall(candidate, api, []);
        const id = careerIdOf(candidate);
        if (id) return id;
      }
      const profileId = careerIdOf(ctx.profile);
      if (profileId) return profileId;
      return null;
    };
    const module = isObject(ctx.commission) ? ctx.commission : null;
    let pending = null;
    if (module && typeof module.listAvailable === 'function') {
      pending = safeCall(module.listAvailable, module, [{ ensure: true }]);
    }
    return Promise.resolve(pending).then(
      (out) => careerIdOf(out) || fallbackFromApi(),
      () => fallbackFromApi()
    );
  }

  function readLastRunId(context) {
    const ctx = isObject(context) ? context : {};
    const candidates = [ctx.lastRunId, ctx.runId];
    if (isObject(ctx.commissionRun)) candidates.push(ctx.commissionRun.runId);
    for (let i = 0; i < candidates.length; i += 1) {
      if (isValidId(candidates[i])) return candidates[i];
    }
    return null;
  }

  /** 调一次 DB 读方法；同步返回值/Promise/异常/缺方法都收敛成 {ok:false,reason} 或原值。 */
  function callReader(db, method, args) {
    return new Promise((resolve) => {
      const fn = db && typeof db[method] === 'function' ? db[method] : null;
      if (!fn) {
        resolve({ ok: false, reason: 'missing-reader' });
        return;
      }
      let returned;
      try {
        returned = fn.apply(db, args || []);
      } catch (err) {
        resolve({ ok: false, reason: 'reader-exception' });
        return;
      }
      if (thenable(returned)) {
        returned.then(
          (value) => resolve(value),
          () => resolve({ ok: false, reason: 'reader-rejected' })
        );
        return;
      }
      resolve(returned);
    });
  }

  /* ---------------------------------------------------------------- 展示格式化 */

  function formatTime(value) {
    if (typeof value !== 'string' || !value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const now = new Date();
    const pad = (num) => (num < 10 ? '0' + num : String(num));
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    if (date.getFullYear() === now.getFullYear()) return month + '月' + day + '日 ' + hour + ':' + minute;
    return date.getFullYear() + '年' + month + '月' + day + '日 ' + hour + ':' + minute;
  }

  function formatCredits(value) {
    const num = signedWhole(value);
    if (num > 0) return '+' + num + ' ' + CREDITS_LABEL;
    if (num < 0) return num + ' ' + CREDITS_LABEL;
    return '0 ' + CREDITS_LABEL;
  }

  function materialName(itemId, context) {
    const ctx = isObject(context) ? context : {};
    const content = isObject(ctx.items) ? ctx.items : null;
    const materials = content && Array.isArray(content.materials) ? content.materials : [];
    for (let i = 0; i < materials.length; i += 1) {
      const entry = materials[i];
      if (isObject(entry) && entry.itemId === itemId && cleanText(entry.name)) return cleanText(entry.name);
    }
    /* 内容包尚未加载时的已知材料名（items.json schema 的 alloy/合金）；其余保留 ID。 */
    if (itemId === 'alloy') return '合金';
    return itemId;
  }

  function shipName(shipId, context) {
    const ctx = isObject(context) ? context : {};
    const content = isObject(ctx.items) ? ctx.items : null;
    const ships = content && Array.isArray(content.ships) ? content.ships : [];
    for (let i = 0; i < ships.length; i += 1) {
      const entry = ships[i];
      if (isObject(entry) && entry.shipId === shipId && cleanText(entry.name)) return cleanText(entry.name);
    }
    return shipId;
  }

  function formatItems(items, context) {
    if (!isObject(items)) return '';
    const parts = [];
    Object.keys(items).forEach((itemId) => {
      const count = Math.floor(finiteNumber(items[itemId]) === null ? 0 : finiteNumber(items[itemId]));
      if (!(count > 0)) return;
      parts.push(materialName(itemId, context) + ' ×' + count);
    });
    return parts.join('、');
  }

  function itemKindCount(items) {
    if (!isObject(items)) return 0;
    let total = 0;
    Object.keys(items).forEach((itemId) => {
      const count = Math.floor(finiteNumber(items[itemId]) === null ? 0 : finiteNumber(items[itemId]));
      if (count > 0) total += 1;
    });
    return total;
  }

  function kindLabel(kind) {
    const key = cleanText(kind);
    if (KIND_LABEL[key]) return KIND_LABEL[key];
    return '一笔记录';
  }

  /** 装备摘要（扁平键：ship:<id>:owned / equippedShip / module:<id>:level）。 */
  function equipmentLines(equipment, context) {
    const lines = [];
    const owned = [];
    let equipped = null;
    let modules = 0;
    if (isObject(equipment)) {
      Object.keys(equipment).forEach((key) => {
        const value = equipment[key];
        const shipMatch = /^ship:([^:]+):owned$/.exec(key);
        if (shipMatch && value === true) {
          owned.push(shipMatch[1]);
          return;
        }
        if (key === 'equippedShip' && typeof value === 'string' && value) {
          equipped = value;
          return;
        }
        if (/^module:[^:]+:level$/.test(key) && finiteNumber(value) !== null && Number(value) > 0) modules += 1;
      });
    }
    if (equipped) lines.push('随船：' + shipName(equipped, context));
    else if (owned.length) lines.push('随船：还没挑定（名下 ' + owned.length + ' 艘）');
    else lines.push('随船：' + NO_SHIP_TEXT);
    if (modules > 0) lines.push('改装：' + modules + ' 项');
    return lines;
  }

  /* ---------------------------------------------------------------- 收据解析 */

  /** 从 bridge 的 show 入参或结算结果里取出收据字段（有 receipt 时一律用 receipt 字段）。 */
  function readReceiptFields(result, payload) {
    const outer = isObject(payload) ? payload : {};
    const value = isObject(result) ? result : outer;
    const receipt = isObject(value.receipt) ? value.receipt : isObject(outer.receipt) ? outer.receipt : null;
    const ok = receipt ? value.ok !== false : value.ok === true;
    let key = '';
    if (receipt) {
      key = cleanText(receipt.receiptId) || cleanText(receipt.runId) || '';
      if (!key && Array.isArray(receipt.txIds) && receipt.txIds.length) key = cleanText(receipt.txIds[0]);
    } else {
      key = cleanText(value.runId) || cleanText(value.receiptId) || cleanText(value.ticketId) || '';
    }
    if (!key) key = cleanText(outer.runId) || cleanText(outer.receiptId) || '';
    const creditsValue = receipt && receipt.credits !== undefined ? receipt.credits : value.credits;
    const credits = creditsValue === undefined || creditsValue === null ? null : wholeNumber(creditsValue);
    const items = receipt && isObject(receipt.items) ? receipt.items : isObject(value.items) ? value.items : null;
    const reason = cleanText(value.reason) || cleanText(value.error) || cleanText(outer.reason);
    const duplicate = value.duplicate === true || (receipt && receipt.duplicate === true);
    const claimedAt = cleanText((receipt && receipt.claimedAt) || value.claimedAt);
    return {
      ok: ok,
      key: key.slice(0, 120),
      credits: credits,
      items: items,
      reason: reason,
      message: typeof value.message === 'string' ? value.message : '',
      duplicate: duplicate,
      claimedAt: claimedAt,
    };
  }

  function storyTextOf(value, limit) {
    const text = cleanText(value);
    if (!text) return '';
    const capped = limit || 160;
    const chars = Array.from(text);
    return chars.length > capped ? chars.slice(0, capped).join('') + '…' : text;
  }

  function readStoryFeedback(outer, result) {
    const rawValue = isObject(outer.storyFeedback) ? outer.storyFeedback : isObject(result.storyFeedback) ? result.storyFeedback : null;
    if (!isObject(rawValue)) return null;
    const raw = rawValue;
    const status = storyTextOf(raw.status, 24);
    if (status !== 'new' && status !== 'recorded' && status !== 'unavailable') return null;
    const lines = [];
    const discovered = Array.isArray(raw.discovered) ? raw.discovered : [];
    discovered.slice(0, 3).forEach((item) => {
      const text = storyTextOf(isObject(item) ? item.text : item);
      if (text && lines.indexOf(text) < 0) lines.push(text);
    });
    if (status === 'new' && !lines.length) lines.push(STORY_NEW_LINE);
    if (status === 'recorded' && !lines.length) lines.push(STORY_RECORDED_LINE);
    const replies = [];
    const rawReplies = Array.isArray(raw.replies) ? raw.replies : [];
    rawReplies.slice(0, 2).forEach((item) => {
      if (!isObject(item)) return;
      const name = storyTextOf(item.name, 40);
      const text = storyTextOf(item.text);
      if (name && text) replies.push({ name: name, text: text });
    });
    const rawChapter = isObject(raw.chapter) ? raw.chapter : null;
    const chapterId = /^C[0-5]$/.test(storyTextOf(rawChapter && rawChapter.id, 12)) ? storyTextOf(rawChapter.id, 12) : '';
    /* 只保留玩家语言标题；C1/C2 这类内部章号绝不出现在玩家可见文案。 */
    const chapterTitle = chapterId ? storyTextOf(rawChapter.title, 160) : '';
    return {
      status: status,
      lines: lines,
      replies: replies,
      chapterTitle: chapterTitle,
      chapterCount: Math.max(0, Math.floor(Number(raw.chapterCount) || 0)),
      nextStep: storyTextOf(raw.nextStep),
      unavailable: status === 'unavailable' ? storyTextOf(raw.unavailable) || '剧情这会儿没能记进账。' : '',
    };
  }

  function storyActionOf(feedback, outer) {
    if (!feedback) return null;
    let handler = null;
    if ((feedback.status === 'new' || feedback.status === 'recorded') && (feedback.chapterTitle || feedback.replies.length || feedback.nextStep)) {
      handler = typeof outer.openCampaign === 'function'
        ? () => outer.openCampaign()
        : typeof outer.openMailbox === 'function'
          ? () => outer.openMailbox()
          : null;
      if (handler) return { text: CARD_CONTINUE_TEXT, label: CARD_CONTINUE_LABEL, run: handler };
    }
    const api = isObject(outer.api) ? outer.api : null;
    if (api && typeof api.openTown === 'function') {
      handler = () => api.openTown();
    } else if (typeof outer.openTown === 'function') {
      handler = () => outer.openTown();
    }
    if (!handler) return null;
    return { text: CARD_TOWN_TEXT, label: CARD_TOWN_LABEL, run: handler };
  }

  function failureSentenceOf(fields) {
    const reasonKey = cleanText(fields && fields.reason).toLowerCase();
    if (reasonKey && FAILURE_SENTENCES[reasonKey]) return FAILURE_SENTENCES[reasonKey];
    const message = looksSafeText(fields && fields.message);
    if (message) return message;
    return DEFAULT_FAILURE_TEXT;
  }

  /* ---------------------------------------------------------------- 面板：生命周期 */

  function normalizeContext(ctx) {
    return isObject(ctx) ? ctx : {};
  }

  function removeStrayPanel(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    try {
      const nodes = doc.querySelectorAll('[data-career-panel="receipt"]');
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
    } catch (err) {
      /* ignore */
    }
  }

  function isLivePanel(target) {
    return !!target && panel === target && target.seq === panelSeq;
  }

  function clearBody(target) {
    if (!target || !target.body) return;
    while (target.body.firstChild) {
      try {
        target.body.removeChild(target.body.firstChild);
      } catch (err) {
        break;
      }
    }
  }

  function setPanelState(target, state) {
    if (target && target.overlay) {
      try {
        target.overlay.setAttribute('data-state', state);
      } catch (err) {
        /* ignore */
      }
    }
  }

  function appendBlock(target, node) {
    if (!target || !target.body || !node) return node;
    applyStyle(node, { marginBottom: '10px' });
    target.body.appendChild(node);
    return node;
  }

  function addLine(target, parent, className, text) {
    const node = make(target.doc, 'p', className, text);
    parent.appendChild(node);
    return node;
  }

  /** 读屏播报：优先 bridge 的 announce（toast/aria-live），否则用面板自带 polite 区域。 */
  function announceFor(target, text) {
    const value = cleanText(text);
    if (!value) return;
    const context = target && isObject(target.context) ? target.context : {};
    if (typeof context.announce === 'function') {
      try {
        context.announce(value);
        return;
      } catch (err) {
        /* 回落到面板自带 live region */
      }
    }
    const region = target && target.liveRegion;
    if (!region) return;
    try {
      region.textContent = '';
      region.textContent = value;
    } catch (err) {
      /* ignore */
    }
  }

  function renderLoading(target) {
    clearBody(target);
    setPanelState(target, 'loading');
    addLine(target, target.body, 'ac-career-status', LOADING_TEXT);
  }

  function renderNoCareer(target) {
    clearBody(target);
    setPanelState(target, 'degraded');
    const box = appendBlock(target, make(target.doc, 'div', 'ac-career-letter'));
    box.setAttribute('data-section', 'degraded');
    addLine(target, box, 'ac-career-letter__body', NO_CAREER_TEXT);
    addLine(target, box, 'ac-career-mailbox__empty', NO_CAREER_HINT);
    announceFor(target, NO_CAREER_TEXT);
  }

  function renderUnavailable(target) {
    clearBody(target);
    setPanelState(target, 'unavailable');
    const box = appendBlock(target, make(target.doc, 'div', 'ac-career-letter'));
    box.setAttribute('data-section', 'degraded');
    addLine(target, box, 'ac-career-letter__body', DB_UNAVAILABLE_TEXT);
    announceFor(target, DB_UNAVAILABLE_TEXT);
  }

  function renderLoadFailure(target) {
    clearBody(target);
    setPanelState(target, 'error');
    const box = appendBlock(target, make(target.doc, 'div', 'ac-career-letter'));
    box.setAttribute('data-section', 'degraded');
    addLine(target, box, 'ac-career-letter__body', WALLET_FAILED_TEXT);
    announceFor(target, WALLET_FAILED_TEXT);
  }

  function dedupeRows(rows) {
    const seen = Object.create(null);
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!isObject(row) || typeof row.txId !== 'string' || !row.txId) return;
      if (seen[row.txId]) return;
      seen[row.txId] = true;
      out.push(row);
    });
    return out;
  }

  function hasMoneyMovement(rows) {
    return rows.some((row) => {
      if (row.kind === 'initial-grant') return false;
      if (signedWhole(row.credits) !== 0) return true;
      return itemKindCount(row.items) > 0;
    });
  }

  function makeLedgerRow(target, row, context) {
    const node = make(target.doc, 'div', 'ac-career-setting');
    node.setAttribute('data-tx-id', row.txId);
    if (typeof row.runId === 'string' && row.runId) node.setAttribute('data-run-id', row.runId);
    const when = formatTime(row.at);
    const headText = (when ? when + ' · ' : '') + kindLabel(row.kind);
    addLine(target, node, 'ac-career-letter__body', headText);
    const parts = [];
    const credits = signedWhole(row.credits);
    if (credits !== 0) parts.push(formatCredits(credits));
    const itemText = formatItems(row.items, context);
    if (itemText) parts.push('材料 ' + itemText);
    if (!parts.length) parts.push(NO_MONEY_TEXT);
    addLine(target, node, 'ac-career-status', parts.join(' · '));
    return node;
  }

  function renderClaimBox(target, claim, claimFailed, context) {
    const box = appendBlock(target, make(target.doc, 'div', 'ac-career-letter'));
    box.setAttribute('data-section', 'claim');
    box.appendChild(make(target.doc, 'h3', 'ac-career-letter__title', CLAIM_TITLE));
    if (isObject(claim) && claim.ok !== false) {
      const credits = wholeNumber(claim.credits);
      const creditsLine = addLine(target, box, 'ac-career-letter__body', '工钱：' + formatCredits(credits));
      creditsLine.setAttribute('data-field', 'claim-credits');
      creditsLine.setAttribute('data-credits', String(credits));
      const itemText = formatItems(claim.items, context);
      addLine(target, box, 'ac-career-letter__body', '带回的材料：' + (itemText || '没有'));
      const claimKey = cleanText(claim.receiptId) || cleanText(claim.runId);
      if (claimKey) addLine(target, box, 'ac-career-status', '凭据号：' + claimKey.slice(0, 120));
      const when = formatTime(claim.claimedAt);
      if (when) addLine(target, box, 'ac-career-status', '立据时间：' + when);
      return box;
    }
    if (claimFailed) addLine(target, box, 'ac-career-status', CLAIM_FAILED_TEXT);
    else addLine(target, box, 'ac-career-mailbox__empty', CLAIM_EMPTY_TEXT);
    return box;
  }

  function renderPanelData(target, data) {
    clearBody(target);
    setPanelState(target, 'ready');
    const context = target.context;
    const wallet = isObject(data.wallet) ? data.wallet : null;
    const ledger = isObject(data.ledger) ? data.ledger : null;

    /* 家当摘要（金额/材料全部来自 readWallet 的 DB 行） */
    const summary = appendBlock(target, make(target.doc, 'div', 'ac-career-letter'));
    summary.setAttribute('data-section', 'summary');
    summary.appendChild(make(target.doc, 'h3', 'ac-career-letter__title', SUMMARY_TITLE));
    const walletOk = !!(wallet && wallet.ok !== false && wallet.exists !== false);
    if (walletOk) {
      const credits = wholeNumber(wallet.credits);
      const creditsLine = addLine(target, summary, 'ac-career-letter__body', '信用点：' + credits);
      creditsLine.setAttribute('data-field', 'credits');
      creditsLine.setAttribute('data-credits', String(credits));
      const itemText = formatItems(wallet.items, context);
      addLine(target, summary, 'ac-career-letter__body', '随身材料：' + (itemText || NO_MATERIALS_TEXT));
      equipmentLines(wallet.equipment, context).forEach((line) => {
        addLine(target, summary, 'ac-career-letter__body', line);
      });
    } else if (wallet && wallet.exists === false) {
      addLine(target, summary, 'ac-career-letter__body', NO_WALLET_TEXT);
    } else {
      addLine(target, summary, 'ac-career-letter__body', WALLET_FAILED_TEXT);
    }

    /* 原收据（同 run 重复打开时来自 db.getClaim 的 claim 行，不重算金额） */
    renderClaimBox(target, data.claim, data.claimFailed === true, context);

    /* 最近流水（按 txId 去重；顺序即 DB readLedger 的顺序） */
    const ledgerBox = appendBlock(target, make(target.doc, 'div', 'ac-career-letter'));
    ledgerBox.setAttribute('data-section', 'ledger');
    ledgerBox.appendChild(make(target.doc, 'h3', 'ac-career-letter__title', LEDGER_TITLE));
    if (!ledger || ledger.ok === false) {
      addLine(target, ledgerBox, 'ac-career-status', LEDGER_FAILED_TEXT);
    } else {
      const rows = dedupeRows(ledger.rows);
      if (!rows.length) {
        addLine(target, ledgerBox, 'ac-career-mailbox__empty', LEDGER_EMPTY_TEXT);
      } else {
        const list = make(target.doc, 'div', 'ac-career-mailbox__list');
        list.setAttribute('data-section', 'ledger-rows');
        rows.forEach((row) => {
          list.appendChild(makeLedgerRow(target, row, context));
        });
        ledgerBox.appendChild(list);
        if (!hasMoneyMovement(rows)) addLine(target, ledgerBox, 'ac-career-status', LEDGER_QUIET_HINT);
      }
    }

    if (walletOk) announceFor(target, '账本翻好了，眼下 ' + wholeNumber(wallet.credits) + ' ' + CREDITS_LABEL + '。');
  }

  function loadPanel(target) {
    if (!isLivePanel(target)) return;
    const context = target.context;
    renderLoading(target);
    resolveCareerId(context)
      .then((careerId) => {
        if (!isLivePanel(target)) return null;
        if (!careerId) {
          target.careerId = '';
          renderNoCareer(target);
          return null;
        }
        target.careerId = careerId;
        const db = dbModuleOf(context);
        if (!db) {
          renderUnavailable(target);
          return null;
        }
        const runId = readLastRunId(context);
        const claimJob = runId && typeof db.getClaim === 'function'
          ? callReader(db, 'getClaim', [runId])
          : Promise.resolve(null);
        return Promise.all([
          callReader(db, 'readWallet', [careerId]),
          callReader(db, 'readLedger', [careerId, 30]),
          claimJob,
        ]).then((values) => {
          if (!isLivePanel(target)) return;
          const claim = values[2];
          renderPanelData(target, {
            wallet: values[0],
            ledger: values[1],
            claim: isObject(claim) && claim.ok !== false ? claim : null,
            claimFailed: isObject(claim) && claim.ok === false,
          });
        });
      })
      .catch(() => {
        if (isLivePanel(target)) renderLoadFailure(target);
      });
  }

  function onPanelKeyDown(target, event) {
    if (!event) return;
    const key = typeof event.key === 'string' ? event.key : '';
    const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
    if (key === 'Escape' || key === 'Esc' || code === 27) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      closePanel();
      return;
    }
    if (key !== 'Tab' && code !== 9) return;
    const items = focusableIn(target.sheet);
    if (!items.length) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      safelyFocus(target.sheet);
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = target.doc.activeElement;
    const outside = !target.sheet.contains(active);
    if (event.shiftKey) {
      if (active === first || active === target.sheet || outside) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(last);
      }
      return;
    }
    if (active === last || outside) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      safelyFocus(first);
    }
  }

  function closePanel() {
    const current = panel;
    panel = null;
    panelSeq += 1;
    if (!current) return false;
    try {
      current.doc.removeEventListener('keydown', current.onKeyDown, true);
    } catch (err) {
      /* ignore */
    }
    try {
      if (current.overlay.parentNode) current.overlay.parentNode.removeChild(current.overlay);
    } catch (err) {
      /* ignore */
    }
    const previous = current.previousFocus;
    if (previous && typeof previous.focus === 'function') {
      const connected = typeof previous.isConnected === 'boolean' ? previous.isConnected : true;
      if (connected) safelyFocus(previous);
    }
    return true;
  }

  /* ---------------------------------------------------------------- 面板：打开/渲染 */

  /**
   * 打开钱包面板（modal）。
   * @param {object} [ctx] bridge 上下文（缺字段按空处理，不抛）
   * @returns {Element|null} 面板元素；无 DOM 或挂载失败返回 null
   */
  function open(ctx) {
    const doc = documentOf();
    if (!doc || !doc.body) return null;
    const context = normalizeContext(ctx);
    closePanel();
    removeCard();
    removeStrayPanel(doc);

    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    const overlay = make(doc, 'div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', 'receipt');
    overlay.setAttribute('data-state', 'loading');
    if (contextReducedMotion(context)) overlay.classList.add('is-reduced-motion');

    const sheet = make(doc, 'div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('tabindex', '-1');

    const head = make(doc, 'div', 'ac-career-sheet__head');
    const heading = make(doc, 'h2', 'ac-career-sheet__title', PANEL_TITLE);
    heading.id = TITLE_ID;
    const closeBtn = make(doc, 'button', 'ac-career-icon-btn ac-career-close', CLOSE_GLYPH);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', PANEL_CLOSE_LABEL);
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make(doc, 'div', 'ac-career-sheet__body');
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);

    const liveRegion = make(doc, 'div', 'ac-career-sr-only');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    overlay.appendChild(liveRegion);

    try {
      doc.body.appendChild(overlay);
    } catch (err) {
      return null;
    }

    const current = {
      doc: doc,
      overlay: overlay,
      sheet: sheet,
      body: body,
      liveRegion: liveRegion,
      previousFocus: previousFocus,
      context: context,
      seq: ++panelSeq,
      careerId: '',
      onKeyDown: null,
    };
    current.onKeyDown = (event) => onPanelKeyDown(current, event);
    panel = current;

    closeBtn.addEventListener('click', () => closePanel(), false);

    let pressedBackdrop = false;
    overlay.addEventListener('pointerdown', (event) => {
      pressedBackdrop = !!(event && event.target === overlay);
    }, false);
    overlay.addEventListener('pointercancel', () => {
      pressedBackdrop = false;
    }, false);
    overlay.addEventListener('click', (event) => {
      const onBackdrop = !!(event && event.target === overlay) && pressedBackdrop;
      pressedBackdrop = false;
      if (onBackdrop) closePanel();
    }, false);

    doc.addEventListener('keydown', current.onKeyDown, true);

    safelyFocus(closeBtn);
    announceFor(current, PANEL_TITLE + '打开了。');
    loadPanel(current);
    return sheet;
  }

  /**
   * 面板已打开时用新上下文刷新；未打开时等同 open(ctx)。
   * @param {object} [ctx]
   * @returns {Element|null}
   */
  function render(ctx) {
    if (!panel) return open(ctx);
    const target = panel;
    const next = normalizeContext(ctx);
    target.context = Object.assign({}, target.context, next);
    target.seq = ++panelSeq;
    loadPanel(target);
    return target.sheet;
  }

  /* ---------------------------------------------------------------- 收据卡（非 modal） */

  function removeCard() {
    const current = card;
    card = null;
    if (!current) return false;
    try {
      if (current.el && current.el.parentNode) current.el.parentNode.removeChild(current.el);
    } catch (err) {
      /* ignore */
    }
    return true;
  }

  function cardCss(doc) {
    return {
      '--ac-career-bg': 'var(--ac-bg, #0b1020)',
      '--ac-career-panel': 'var(--ac-panel, #151d3a)',
      '--ac-career-line': 'var(--ac-line, #2a3560)',
      '--ac-career-ink': 'var(--ac-ink, #eef1ff)',
      '--ac-career-muted': 'var(--ac-muted, #93a0c8)',
      '--ac-career-accent': 'var(--ac-accent, #ffd23f)',
      '--ac-career-danger': 'var(--ac-danger, #ff5d5d)',
    };
  }

  function appendStoryBlock(doc, parent, feedback) {
    if (!feedback) return;
    const block = make(doc, 'section', 'ac-career-receipt-story');
    applyStyle(block, { display: 'flex', flexDirection: 'column', gap: '4px' });
    const heading = make(doc, 'h3', 'ac-career-receipt-story__title', '这趟带回来的事');
    applyStyle(heading, { margin: '2px 0 0', fontSize: '12px', fontWeight: '600' });
    block.appendChild(heading);
    if (feedback.status === 'unavailable') {
      block.appendChild(make(doc, 'p', 'ac-career-status', feedback.unavailable));
    } else {
      feedback.lines.forEach((text) => block.appendChild(make(doc, 'p', 'ac-career-status', text)));
      if (feedback.chapterTitle) {
        block.appendChild(make(doc, 'p', 'ac-career-status', '新完成的段落：' + feedback.chapterTitle));
      }
      if (feedback.nextStep) block.appendChild(make(doc, 'p', 'ac-career-status', '下一步：' + feedback.nextStep));
      feedback.replies.forEach((reply) => {
        block.appendChild(make(doc, 'p', 'ac-career-status', reply.name + '：' + reply.text));
      });
    }
    parent.appendChild(block);
  }

  function buildCard(doc, fields, reducedMotion, feedback, action) {
    const el = make(doc, 'div', 'ac-career-card');
    el.setAttribute('data-career-card', 'receipt');
    el.setAttribute('data-state', fields.ok ? 'success' : 'failure');
    if (fields.key) el.setAttribute('data-run-id', fields.key);
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    applyStyle(el, cardCss(doc));
    applyStyle(el, {
      boxSizing: 'border-box',
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      zIndex: '68',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      width: 'min(92vw, 360px)',
      maxHeight: '55vh',
      overflowY: 'auto',
      padding: '10px 12px',
      border: '1px solid var(--ac-career-line)',
      borderRadius: '12px',
      background: 'var(--ac-career-panel)',
      color: 'var(--ac-career-ink)',
      fontSize: '12px',
      lineHeight: '1.7',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
      pointerEvents: 'auto',
    });
    if (reducedMotion) {
      el.classList.add('is-reduced-motion');
      applyStyle(el, { animation: 'none', transition: 'none' });
    }

    const head = make(doc, 'div', 'ac-career-receipt-head');
    applyStyle(head, { display: 'flex', alignItems: 'flex-start', gap: '8px' });
    const title = make(doc, 'h2', 'ac-career-card__title', fields.ok ? CARD_SUCCESS_TITLE : CARD_FAILURE_TITLE);
    applyStyle(title, {
      flex: '1 1 auto',
      minWidth: '0',
      margin: '0',
      color: 'var(--ac-career-ink)',
      fontSize: '13px',
      fontWeight: '600',
      lineHeight: '1.5',
      overflowWrap: 'anywhere',
    });
    const closeBtn = make(doc, 'button', 'ac-career-btn ac-career-btn--ghost', CARD_CLOSE_TEXT);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', CARD_CLOSE_LABEL);
    applyStyle(closeBtn, { flex: '0 0 auto', minWidth: '44px', minHeight: '44px', padding: '4px 12px' });
    head.appendChild(title);
    head.appendChild(closeBtn);
    el.appendChild(head);

    const bodyBox = make(doc, 'div', 'ac-career-receipt-body');
    if (fields.ok) {
      const primary = make(doc, 'p', 'ac-career-card__line', fields.credits === null ? '这单没有现钱' : '工钱：' + formatCredits(fields.credits));
      applyStyle(primary, { margin: '0', fontSize: '13px', fontWeight: '600', overflowWrap: 'anywhere' });
      bodyBox.appendChild(primary);
      const itemText = formatItems(fields.items, null);
      bodyBox.appendChild(make(doc, 'p', 'ac-career-status', '带回的材料：' + (itemText || '没有')));
      if (fields.key) bodyBox.appendChild(make(doc, 'p', 'ac-career-status', '凭据号：' + fields.key));
      const when = formatTime(fields.claimedAt);
      if (when) bodyBox.appendChild(make(doc, 'p', 'ac-career-status', '立据时间：' + when));
      if (fields.duplicate) bodyBox.appendChild(make(doc, 'p', 'ac-career-status', DUPLICATE_NOTE));
      if (fields.credits === 0 && !itemText) {
        bodyBox.appendChild(make(doc, 'p', 'ac-career-status', '这一单没有现钱，也没有带回材料。'));
      }
    } else {
      const primary = make(doc, 'p', 'ac-career-card__line', failureSentenceOf(fields));
      applyStyle(primary, { margin: '0', fontSize: '13px', fontWeight: '600', overflowWrap: 'anywhere' });
      bodyBox.appendChild(primary);
      if (fields.key) bodyBox.appendChild(make(doc, 'p', 'ac-career-status', '凭据号：' + fields.key));
      bodyBox.appendChild(make(doc, 'p', 'ac-career-status', '工钱：还没结清'));
    }
    el.appendChild(bodyBox);
    appendStoryBlock(doc, el, feedback);

    if (action) {
      const actionBtn = make(doc, 'button', 'ac-career-btn ac-career-btn--primary', action.text);
      actionBtn.type = 'button';
      actionBtn.setAttribute('aria-label', action.label);
      applyStyle(actionBtn, { width: '100%', minHeight: '44px' });
      actionBtn.addEventListener('click', () => {
        removeCard();
        action.run();
      }, false);
      el.appendChild(actionBtn);
    }

    closeBtn.addEventListener('click', () => removeCard(), false);
    el.addEventListener('keydown', (event) => {
      if (!event) return;
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
      if (key !== 'Escape' && key !== 'Esc' && code !== 27) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      removeCard();
    }, false);
    return el;
  }

  /**
   * 结算后展示戏内收据卡（bridge 调用）。同一 runId 重复 show 只保留一张。
   * 形态：{ result: {...} } 或直接传结算结果。
   * @param {object} payload
   * @returns {Element|null}
   */
  function show(payload) {
    const doc = documentOf();
    if (!doc || !doc.body) return null;
    const outer = isObject(payload) ? payload : {};
    const result = isObject(outer.result) ? outer.result : outer;
    const fields = readReceiptFields(result, outer);
    const feedback = readStoryFeedback(outer, result);
    const action = storyActionOf(feedback, outer);
    closePanel();
    removeCard();
    let reduced = outer.reducedMotion === true;
    if (!reduced && isObject(result) && result.reducedMotion === true) reduced = true;
    const el = buildCard(doc, fields, reduced, feedback, action);
    try {
      doc.body.appendChild(el);
    } catch (err) {
      return null;
    }
    card = { el: el, key: fields.key, fields: fields };
    return el;
  }

  /* ---------------------------------------------------------------- 对外 API */

  function close() {
    const closedPanel = closePanel();
    const closedCard = removeCard();
    return closedPanel || closedCard;
  }

  return {
    open: open,
    close: close,
    render: render,
    show: show,
  };
});
