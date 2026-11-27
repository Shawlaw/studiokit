/*!
 * StudioKit Arcade Life — 经历页视图增强（0.24 T23）
 *
 * 浏览器普通 <script>（非 ESM），加载时只创建 window.ArcadeCareerUI.journal，
 * 不读 DOM、不写存储、不发请求。bridge 在港口打开前装载本文件；缺失时
 * town.js 回落到 0.23 的 JournalTimeline 基础渲染。
 *
 * 只消费投影（ADR-0.24-world §5；ADR-0.23-ui §3/§4.11）：
 *
 *   view.story.history[] = {
 *     label: string,                 // 白名单静态文案，必填
 *     at?: string|null,              // 合法 ISO；组件只显示 YYYY-MM-DD
 *     source?: string,               // 只作诊断，不渲染
 *     person?: string|null,          // 真实人物显示名，仅用于筛选（可选）
 *     professionId?: string|null,    // 已接受职业的内部 id，仅用于筛选（可选）
 *     detail?: {                     // 白名单静态回读文本（可选）
 *       text: string,
 *       person?: string|null
 *     }
 *   }
 *
 * person / professionId / detail 由 bridge 在投影后按白名单内容加性注入，
 * 不落盘、不新增 storyEvents 字段。筛选值只从本投影派生：
 * - 人物选项 = 实际出现事件里的真实人名；
 * - 职业选项 = 投影 view.professions 中已接受职业，未接受职业不进筛选器；
 * - 没有任何可筛选数据时不渲染筛选器。
 *
 * 约束：所有玩家文本 textContent；不显示总数、百分比、锁定项、内部 id；
 * 回读只展开静态文本与人物，不触发任务、奖励或状态写入；关闭后焦点回到
 * 原条目。全部复用 T11 组件（JournalTimeline / SecondaryAction）与 token
 * 类，不注入样式、不新增全局选择器。
 */
(function (root) {
  'use strict';

  var VERSION = '0.24.0';
  var ACCEPTED_STATES = ['accepted', 'developed', 'completed'];
  var MAX_LABEL = 60;
  var MAX_DETAIL = 240;
  var MAX_PERSON = 24;

  /* 内部 id / token / 进度 / 经济承诺 / 系统话术一律不进玩家文本。 */
  var INTERNAL_EVENT = /\b[a-z][a-z0-9-]*:[A-Za-z0-9]/;
  var INTERNAL_CODE = /\b(?:eventId|commissionId|professionId|narrativeNodeId|pairId|reason)\b/i;
  var INTERNAL_PREFIX = /\b(?:E|BP|MAP|DEC)-[A-Za-z0-9]/;
  var INTERNAL_TAG = /\b[A-Z]{1,3}-\d{1,4}\b/;
  var CHAPTER_CODE = /(?:^|[^A-Za-z0-9])C[0-5](?:\.|\b)/;
  var COMMISSION_SUFFIX = /\.[Tt][1-6](?![0-9])/;
  var PROGRESS = /\b\d+\s*\/\s*\d+\b|\d+(?:\.\d+)?\s*%/;
  var REWARD = /信用点|星币|工钱|奖励|报酬|积分|材料\s*[×x]|\b(?:credits?|rewards?)\b/i;
  var SYSTEM = /系统检测到|恭喜解锁|必须完成|已解锁|未解锁|锁定|暂未开放|总数|完成度|百分比|进度|还差/;
  var ROUTE = /第一步|第二步|依次前往|完整路线|路线攻略|通关攻略|必做|必经|唯一解|速通/;
  var PLACEHOLDER = /\{\{|\}\}|^占位[:：]/;
  var ASCII_ID = /^[A-Za-z0-9._:\- ]+$/;

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

  function idText(value) {
    return cleanText(value).replace(/\s+/g, '');
  }

  function element(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** 返回拒绝原因（诊断用，不渲染）；空串表示安全。 */
  function textRejection(text, maxLength) {
    if (!text) return 'empty';
    if (text.length > maxLength) return 'too-long';
    if (INTERNAL_EVENT.test(text)) return 'event-id';
    if (INTERNAL_CODE.test(text)) return 'internal-code';
    if (INTERNAL_PREFIX.test(text)) return 'evidence-token';
    if (INTERNAL_TAG.test(text)) return 'internal-tag';
    if (CHAPTER_CODE.test(text)) return 'chapter-code';
    if (COMMISSION_SUFFIX.test(text)) return 'commission-suffix';
    if (PROGRESS.test(text)) return 'progress';
    if (REWARD.test(text)) return 'reward';
    if (SYSTEM.test(text)) return 'system-text';
    if (ROUTE.test(text)) return 'route-text';
    if (PLACEHOLDER.test(text)) return 'placeholder';
    if (/[<>]/.test(text)) return 'markup';
    if (/^[\d\s._:\-]+$/.test(text)) return 'numeric';
    if (ASCII_ID.test(text) && /[._:\-]/.test(text)) return 'ascii-id';
    return '';
  }

  function safeLabel(value) {
    var text = cleanText(value);
    return textRejection(text, MAX_LABEL) ? '' : text;
  }

  function safePerson(value) {
    var text = cleanText(value);
    if (!text || text.length > MAX_PERSON) return '';
    if (/[\d:：<>{}]/.test(text)) return '';
    if (INTERNAL_EVENT.test(text) || INTERNAL_PREFIX.test(text) || INTERNAL_TAG.test(text)) return '';
    if (COMMISSION_SUFFIX.test(text) || CHAPTER_CODE.test(text)) return '';
    if (SYSTEM.test(text) || REWARD.test(text) || ROUTE.test(text)) return '';
    if (!/^[\u3400-\u9fffA-Za-z\u00b7\-\s.]+$/.test(text)) return '';
    if (/^[A-Za-z0-9._:\- ]+$/.test(text) && /[._:\-]/.test(text)) return '';
    return text;
  }

  function safeDetail(value) {
    var input = isObject(value) ? value : null;
    if (!input) return null;
    var raw = input.text || input.body || input.narration;
    if (Array.isArray(raw)) raw = raw.map(cleanText).filter(Boolean).join(' ');
    var text = cleanText(raw);
    if (textRejection(text, MAX_DETAIL)) return null;
    var person = safePerson(input.person || input.from || input.name);
    return { text: text, person: person };
  }

  function acceptedProfessionMap(view) {
    var map = Object.create(null);
    var list = view && Array.isArray(view.professions) ? view.professions : [];
    list.forEach(function (entry) {
      if (!isObject(entry)) return;
      var professionId = idText(entry.professionId);
      if (!professionId) return;
      var state = cleanText(entry.state).toLowerCase();
      if (ACCEPTED_STATES.indexOf(state) < 0) return;
      var displayName = cleanText(entry.displayName);
      if (!displayName) return;
      map[professionId] = displayName;
    });
    return map;
  }

  function publicHistoryOf(view) {
    var story = view && isObject(view.story) ? view.story : null;
    return story && Array.isArray(story.history) ? story.history : [];
  }

  /**
   * 投影 → 经历模型。纯函数：不读 DOM/存储/时钟，不修改入参。
   * 返回 { entries, filters, dropped, hasFilters }；dropped 只供诊断。
   */
  function buildModel(view) {
    var professionNames = acceptedProfessionMap(view);
    var history = publicHistoryOf(view);
    var entries = [];
    var dropped = [];

    history.forEach(function (row, index) {
      if (!isObject(row)) {
        dropped.push({ index: index, reason: 'not-object' });
        return;
      }
      if (row.internalOnly === true || row.whitelisted === false || row.public === false) {
        dropped.push({ index: index, reason: 'not-whitelisted' });
        return;
      }
      var label = safeLabel(row.label || row.text);
      if (!label) {
        dropped.push({ index: index, reason: 'unsafe-label' });
        return;
      }
      var professionId = null;
      var rawProfessionId = idText(row.professionId);
      if (rawProfessionId) {
        if (!Object.prototype.hasOwnProperty.call(professionNames, rawProfessionId)) {
          /* 投影里出现未接受职业的关联：整行不进入经历，筛选器也不出现该职业。 */
          dropped.push({ index: index, reason: 'unaccepted-profession' });
          return;
        }
        professionId = rawProfessionId;
      }
      var detail = safeDetail(row.detail);
      if (row.detail && !detail) dropped.push({ index: index, reason: 'unsafe-detail' });
      var person = safePerson(row.person || row.from || (detail && detail.person));
      if ((row.person || row.from) && !person) dropped.push({ index: index, reason: 'unsafe-person' });
      entries.push({
        label: label,
        at: cleanText(row.at),
        source: cleanText(row.source),
        professionId: professionId,
        professionName: professionId ? professionNames[professionId] : '',
        person: person,
        detail: detail,
      });
    });

    var persons = [];
    var professionOptions = [];
    entries.forEach(function (entry) {
      if (entry.person && persons.indexOf(entry.person) < 0) persons.push(entry.person);
      if (entry.professionId) {
        var seen = professionOptions.some(function (row) { return row.id === entry.professionId; });
        if (!seen) professionOptions.push({ id: entry.professionId, label: entry.professionName });
      }
    });

    return {
      entries: entries,
      filters: { persons: persons, professions: professionOptions },
      dropped: dropped,
      hasFilters: !!entries.length && (persons.length > 0 || professionOptions.length > 0),
    };
  }

  function normalizeFilter(filter, model) {
    if (isObject(filter)) {
      if (filter.scope === 'person') {
        var person = cleanText(filter.value);
        if (model.filters.persons.indexOf(person) >= 0) return { scope: 'person', value: person, label: person };
      }
      if (filter.scope === 'profession') {
        var professionId = idText(filter.value);
        var row = model.filters.professions.filter(function (option) { return option.id === professionId; })[0];
        if (row) return { scope: 'profession', value: row.id, label: row.label };
      }
    }
    return { scope: 'all', value: '', label: '' };
  }

  function matches(entry, filter) {
    if (!filter || filter.scope === 'all') return true;
    if (filter.scope === 'person') return entry.person === filter.value;
    if (filter.scope === 'profession') return entry.professionId === filter.value;
    return true;
  }

  function decorateReadback(doc, components, model, items) {
    model.entries.forEach(function (entry, index) {
      var item = items[index];
      if (!item || typeof item.setAttribute !== 'function') return;
      item.setAttribute('data-journal-entry', String(index + 1));
      if (!entry.detail) return;

      var toggleId = 'ac-career-ui-journal-read-' + (index + 1);
      var detailId = 'ac-career-ui-journal-detail-' + (index + 1);
      var detail = element(doc, 'div', 'ac-career-ui__stack ac-career-ui__stack--small');
      detail.id = detailId;
      detail.hidden = true;
      detail.setAttribute('data-journal-readback', 'true');
      if (entry.detail.person) {
        var personNode = element(doc, 'p', 'ac-career-ui__gold ac-career-ui__npc-name', entry.detail.person);
        personNode.setAttribute('data-journal-readback-person', 'true');
        detail.appendChild(personNode);
      }
      detail.appendChild(element(doc, 'p', 'ac-career-ui__npc-paragraph', entry.detail.text));

      var open = false;
      var toggle = components.SecondaryAction({
        id: toggleId,
        label: '回读这段',
        variant: 'text',
        onClick: function () {
          open = !open;
          detail.hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
          toggle.setAttribute('data-journal-open', String(open));
          item.setAttribute('data-journal-expanded', String(open));
          /* 关闭回读后焦点回到原条目控件；展开时保持焦点在同一控件。 */
          if (!open && typeof toggle.focus === 'function') toggle.focus();
        },
      });
      toggle.setAttribute('data-journal-read', String(index + 1));
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', detailId);
      item.setAttribute('data-journal-expanded', 'false');
      item.appendChild(toggle);
      item.appendChild(detail);
    });
  }

  function applyFilter(state, next, notify) {
    var normalized = normalizeFilter(next, state.model);
    state.filter = normalized;
    state.model.entries.forEach(function (entry, index) {
      var item = state.items[index];
      if (!item) return;
      item.hidden = !matches(entry, normalized);
    });
    var visible = 0;
    state.items.forEach(function (item) {
      if (item && !item.hidden) visible += 1;
    });
    state.buttons.forEach(function (row) {
      row.button.setAttribute('aria-pressed', String(normalized.scope === row.scope && normalized.value === row.value));
    });
    if (state.reset) state.reset.setAttribute('aria-pressed', String(normalized.scope === 'all'));
    if (state.caption) {
      state.caption.hidden = normalized.scope === 'all';
      state.caption.textContent = normalized.scope === 'all'
        ? ''
        : (normalized.scope === 'person' ? '正在看人物：' : '正在看职业：') + normalized.label;
    }
    if (state.empty) state.empty.hidden = visible > 0 || !state.model.entries.length;
    if (notify && typeof state.notify === 'function') {
      try {
        state.notify({ scope: normalized.scope, value: normalized.value });
      } catch (err) {
        /* 宿主回调失败不影响只读经历页 */
      }
    }
  }

  function filterGroup(doc, components, state, scope, summaryText, options) {
    var details = element(doc, 'details', 'ac-career-ui__work-details');
    details.setAttribute('data-journal-filter-group', scope);
    details.appendChild(element(doc, 'summary', 'ac-career-ui__work-more', summaryText));
    var actions = element(doc, 'div', 'ac-career-ui__actions');
    options.forEach(function (option) {
      var button = components.SecondaryAction({
        label: (scope === 'person' ? '人物' : '职业') + ' · ' + option.label,
        variant: 'text',
        onClick: function () {
          var active = state.filter.scope === scope && state.filter.value === option.value;
          applyFilter(state, active ? { scope: 'all', value: '' } : { scope: scope, value: option.value }, true);
        },
      });
      button.setAttribute('data-journal-filter', scope);
      button.setAttribute('aria-pressed', 'false');
      actions.appendChild(button);
      state.buttons.push({ scope: scope, value: option.value, button: button });
    });
    details.appendChild(actions);
    return details;
  }

  function buildFilters(doc, components, section, timeline, state) {
    var model = state.model;
    var wrapper = element(doc, 'div', 'ac-career-ui__stack ac-career-ui__stack--small');
    wrapper.setAttribute('data-journal-filters', 'true');

    var caption = element(doc, 'p', 'ac-career-ui__caption');
    caption.setAttribute('data-journal-active-filter', 'true');
    caption.hidden = true;
    wrapper.appendChild(caption);

    if (model.filters.persons.length) {
      wrapper.appendChild(filterGroup(doc, components, state, 'person', '按人物筛选',
        model.filters.persons.map(function (person) { return { value: person, label: person }; })));
    }
    if (model.filters.professions.length) {
      wrapper.appendChild(filterGroup(doc, components, state, 'profession', '按职业筛选',
        model.filters.professions.map(function (row) { return { value: row.id, label: row.label }; })));
    }

    var reset = components.SecondaryAction({
      label: '看全部经历',
      variant: 'text',
      onClick: function () { applyFilter(state, { scope: 'all', value: '' }, true); },
    });
    reset.setAttribute('data-journal-reset', 'true');
    reset.setAttribute('aria-pressed', 'false');
    wrapper.appendChild(reset);

    var emptyNotice = element(doc, 'p', 'ac-career-ui__caption', '按这个条件还没有能回读的事。');
    emptyNotice.setAttribute('data-journal-filter-empty', 'true');
    emptyNotice.hidden = true;
    wrapper.appendChild(emptyNotice);

    state.caption = caption;
    state.reset = reset;
    state.empty = emptyNotice;

    if (timeline && typeof section.insertBefore === 'function') section.insertBefore(wrapper, timeline);
    else section.appendChild(wrapper);
  }

  /**
   * 渲染经历页内容。返回的 section.ac-career-ui__journal 直接挂在港口
   * tabpanel 下；ol.ac-career-ui__timeline 仍是 section 的直接子节点
   * （0.23 P09 结构不变）。
   */
  function render(options) {
    var input = isObject(options) ? options : {};
    var doc = documentOf();
    var components = isObject(input.components) ? input.components : null;
    if (!doc || !components) return null;
    if (typeof components.JournalTimeline !== 'function' || typeof components.SecondaryAction !== 'function') return null;

    var model = buildModel(input.view);
    var section = components.JournalTimeline({
      state: model.entries.length ? 'filled' : 'empty',
      events: model.entries.map(function (entry) {
        return { label: entry.label, at: entry.at };
      }),
    });
    if (!section) return null;
    section.setAttribute('data-journal-surface', 'experience');

    var timeline = typeof section.querySelector === 'function' ? section.querySelector('.ac-career-ui__timeline') : null;
    /* 真实 DOM 的 children 是 HTMLCollection（没有 forEach），必须显式转数组；
       纯 Node 夹具用数组，容易漏测，这里统一按数组处理。 */
    var items = timeline && timeline.children
      ? (Array.isArray(timeline.children) ? timeline.children : Array.prototype.slice.call(timeline.children))
      : [];
    var state = {
      model: model,
      items: items,
      filter: normalizeFilter(input.filter, model),
      buttons: [],
      caption: null,
      reset: null,
      empty: null,
      notify: typeof input.onFilterChange === 'function' ? input.onFilterChange : null,
    };

    decorateReadback(doc, components, model, items);
    if (model.hasFilters) buildFilters(doc, components, section, timeline, state);
    applyFilter(state, state.filter, false);
    return section;
  }

  var api = Object.freeze({
    VERSION: VERSION,
    buildModel: buildModel,
    render: render,
    safeLabel: safeLabel,
    safePerson: safePerson,
  });

  if (root && root.document) {
    root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
    root.ArcadeCareerUI.journal = api;
  }
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
