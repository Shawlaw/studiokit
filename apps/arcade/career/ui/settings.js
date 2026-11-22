/*!
 * StudioKit Arcade Life — 线索偏好开关（0.15 / D15-07）
 *
 * 浏览器普通 <script>（非 ESM）。加载时只创建 window.ArcadeCareerUI.settings，
 * 不读 DOM、不写存储、不发请求。bridge.js 在 DOMContentLoaded 之后调用：
 *
 *   window.ArcadeCareerUI.settings.open(ctx);
 *   window.ArcadeCareerUI.settings.close();
 *
 * ctx（bridge 构造，见 docs/arcade-life/ADR-interfaces.md §17）：
 *   { state, setHintsEnabled(bool), resetDiscovery(), announce(text), ... }
 *
 * 约束：
 * - 小面板：开关「街机里的神秘线索」+「清除本机线索记录」；
 * - 开关只写显示偏好（ctx.setHintsEnabled），不清任何已发现内容；
 * - 清除必须二次确认（先出现确认文案与「取消 / 确认清除」），未确认时绝不调用 resetDiscovery；
 * - 关闭按钮 + Esc；无声音；prefers-reduced-motion 下无动画；焦点返回打开前元素。
 */
(function (root) {
  'use strict';

  const OVERLAY_CLASS = 'ac-career-overlay';
  const SHEET_CLASS = 'ac-career-sheet ac-career-sheet--small';
  const TITLE_ID = 'ac-career-settings-title';
  const DESC_ID = 'ac-career-settings-hints-desc';
  const PANEL_LABEL = '线索提示';
  const SWITCH_LABEL = '街机里的神秘线索';
  const SWITCH_DESC = '关闭后不再出现新的线索提示；已发现内容仍可在信箱找回。';
  const RESET_LABEL = '清除本机线索记录';
  const CONFIRM_TEXT = '清除后，本机已发现的线索与信件不会保留；街机里的记录不受影响。';
  const CANCEL_LABEL = '取消';
  const CONFIRM_LABEL = '确认清除';
  const STATUS_ON = '又开始留意街机里的小东西了。';
  const STATUS_OFF = '新的线索提示已经收起来了。';
  const STATUS_SAVE_FAILED = '这次没能记下来，可以再试一次。';
  const STATUS_CLEARED = '本机的线索记录已经清空。';
  const STATUS_CLEAR_FAILED = '没能清空，可以再试一次。';

  /* 旧港档案（可选区块）：只有 bridge 在 ctx 里提供 backup 时才渲染。 */
  const ARCHIVE_TITLE = '旧港档案';
  const ARCHIVE_DESC = '把本机的旧港记录存成一份文件，或从文件里取回旧港记录。';
  const EXPORT_LABEL = '导出旧港档案';
  const IMPORT_LABEL = '导入旧港档案';
  const EXPORT_OK = '档案已经存成文件。';
  const EXPORT_FAILED = '导出失败，请稍后再试';
  const IMPORT_FAILED = '档案无法识别，已保留当前线索';
  const IMPORT_OK = '档案已导入。';
  const IMPORT_CONFIRM_TEXT = '导入会把文件里的旧港记录放回本机；本机现有的线索记录可能被文件里的记录覆盖，街机里的经典记录不受影响。';
  const CONFIRM_IMPORT_LABEL = '确认导入';
  const DEFAULT_FILENAME = 'studiokit-arcade-career.json';
  const IMPORT_MODE_TEXT = {
    restore: '已恢复',
    restored: '已恢复',
    replace: '已替换本机记录',
    replaced: '已替换本机记录',
    keep: '当前生涯保留',
    kept: '当前生涯保留',
    preserve: '当前生涯保留',
    preserved: '当前生涯保留',
    merge: '已并入本机记录',
    merged: '已并入本机记录',
  };

  let panel = null;

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
      .replace(/[ \t]+/g, ' ')
      .trim();
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

  /** 关闭设置浮层并把焦点还给打开前的元素（可重复调用）。 */
  function close() {
    const current = panel;
    panel = null;
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

  /**
   * 打开线索偏好面板。
   * @param {object} [ctx] bridge 上下文（缺失字段按空处理，不抛异常）
   * @returns {Element|null} 面板元素；无 DOM 或挂载失败时返回 null
   */
  function open(ctx) {
    const doc = documentOf();
    if (!doc) return null;
    const context = isObject(ctx) ? ctx : {};
    close();

    const state = isObject(context.state) ? context.state : {};
    /* bridge.openSettings() 会显式传 hintsEnabled；缺省回落到 state 快照，再缺省按开启。 */
    let hintsEnabled = typeof context.hintsEnabled === 'boolean'
      ? context.hintsEnabled
      : typeof state.hintsEnabled === 'boolean' ? state.hintsEnabled : true;
    let confirming = false;
    const previousFocus = doc.activeElement && typeof doc.activeElement.focus === 'function' ? doc.activeElement : null;

    function make(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    const overlay = make('div', OVERLAY_CLASS);
    overlay.setAttribute('data-career-panel', 'settings');
    /* ctx.reducedMotion 与系统偏好双保险：由 bridge 传入的偏好直接关掉动画。 */
    if (context.reducedMotion) overlay.classList.add('is-reduced-motion');

    const sheet = make('div', SHEET_CLASS);
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', TITLE_ID);
    sheet.setAttribute('tabindex', '-1');

    const head = make('div', 'ac-career-sheet__head');
    const heading = make('h2', 'ac-career-sheet__title', PANEL_LABEL);
    heading.id = TITLE_ID;
    const closeBtn = make('button', 'ac-career-icon-btn ac-career-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '收起设置');
    head.appendChild(heading);
    head.appendChild(closeBtn);

    const body = make('div', 'ac-career-sheet__body');

    const switchRow = make('div', 'ac-career-setting');
    const switchBtn = make('button', 'ac-career-switch');
    switchBtn.type = 'button';
    switchBtn.id = 'ac-career-settings-hints';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', hintsEnabled ? 'true' : 'false');
    switchBtn.setAttribute('aria-describedby', DESC_ID);
    const track = make('span', 'ac-career-switch__track');
    track.setAttribute('aria-hidden', 'true');
    track.appendChild(make('span', 'ac-career-switch__knob'));
    const switchLabel = make('span', 'ac-career-switch__label', SWITCH_LABEL);
    const switchState = make('span', 'ac-career-switch__state', hintsEnabled ? '开' : '关');
    switchState.setAttribute('aria-hidden', 'true');
    switchBtn.appendChild(track);
    switchBtn.appendChild(switchLabel);
    switchBtn.appendChild(switchState);
    const switchDesc = make('p', 'ac-career-switch__desc', SWITCH_DESC);
    switchDesc.id = DESC_ID;
    switchRow.appendChild(switchBtn);
    switchRow.appendChild(switchDesc);

    const dangerRow = make('div', 'ac-career-setting ac-career-setting--danger');
    const resetBtn = make('button', 'ac-career-btn ac-career-btn--ghost', RESET_LABEL);
    resetBtn.type = 'button';

    const confirmBox = make('div', 'ac-career-confirm');
    confirmBox.hidden = true;
    const confirmText = make('p', 'ac-career-confirm__text', CONFIRM_TEXT);
    const confirmActions = make('div', 'ac-career-confirm__actions');
    const cancelBtn = make('button', 'ac-career-btn ac-career-btn--ghost', CANCEL_LABEL);
    cancelBtn.type = 'button';
    const confirmBtn = make('button', 'ac-career-btn ac-career-btn--danger', CONFIRM_LABEL);
    confirmBtn.type = 'button';
    confirmActions.appendChild(cancelBtn);
    confirmActions.appendChild(confirmBtn);
    confirmBox.appendChild(confirmText);
    confirmBox.appendChild(confirmActions);

    const statusLine = make('p', 'ac-career-status');
    statusLine.hidden = true;

    dangerRow.appendChild(resetBtn);
    dangerRow.appendChild(confirmBox);
    dangerRow.appendChild(statusLine);

    /* 旧港档案区块：ctx.backup 不存在时整块不渲染（可选字段，不报错）。 */
    const backup = isObject(context.backup) ? context.backup : null;
    let archiveRow = null;
    let exportBtn = null;
    let importBtn = null;
    let fileInput = null;
    let importConfirmBox = null;
    let importConfirmText = null;
    let archiveCancelBtn = null;
    let archiveConfirmBtn = null;
    let archiveStatus = null;
    if (backup) {
      archiveRow = make('div', 'ac-career-setting ac-career-setting--archive');
      const archiveTitle = make('h3', 'ac-career-setting__title', ARCHIVE_TITLE);
      const archiveDesc = make('p', 'ac-career-switch__desc', ARCHIVE_DESC);
      exportBtn = make('button', 'ac-career-btn ac-career-btn--ghost', EXPORT_LABEL);
      exportBtn.type = 'button';
      exportBtn.setAttribute('data-action', 'export-career-life');
      importBtn = make('button', 'ac-career-btn ac-career-btn--ghost', IMPORT_LABEL);
      importBtn.type = 'button';
      importBtn.setAttribute('data-action', 'import-career-life');
      const archiveActions = make('div', 'ac-career-confirm__actions');
      archiveActions.appendChild(exportBtn);
      archiveActions.appendChild(importBtn);

      fileInput = make('input', 'ac-career-file-input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.setAttribute('tabindex', '-1');
      fileInput.setAttribute('aria-hidden', 'true');

      importConfirmBox = make('div', 'ac-career-confirm');
      importConfirmBox.hidden = true;
      importConfirmText = make('p', 'ac-career-confirm__text');
      const importActions = make('div', 'ac-career-confirm__actions');
      archiveCancelBtn = make('button', 'ac-career-btn ac-career-btn--ghost', CANCEL_LABEL);
      archiveCancelBtn.type = 'button';
      archiveConfirmBtn = make('button', 'ac-career-btn', CONFIRM_IMPORT_LABEL);
      archiveConfirmBtn.type = 'button';
      importActions.appendChild(archiveCancelBtn);
      importActions.appendChild(archiveConfirmBtn);
      importConfirmBox.appendChild(importConfirmText);
      importConfirmBox.appendChild(importActions);

      archiveStatus = make('p', 'ac-career-status');
      archiveStatus.hidden = true;

      archiveRow.appendChild(archiveTitle);
      archiveRow.appendChild(archiveDesc);
      archiveRow.appendChild(archiveActions);
      archiveRow.appendChild(fileInput);
      archiveRow.appendChild(importConfirmBox);
      archiveRow.appendChild(archiveStatus);
    }

    body.appendChild(switchRow);
    body.appendChild(dangerRow);
    if (archiveRow) body.appendChild(archiveRow);
    sheet.appendChild(head);
    sheet.appendChild(body);
    overlay.appendChild(sheet);

    const liveRegion = make('div', 'ac-career-sr-only');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    overlay.appendChild(liveRegion);

    if (!doc.body) return null;
    try {
      doc.body.appendChild(overlay);
    } catch (err) {
      return null;
    }

    function announce(text) {
      const value = cleanText(text);
      if (!value) return;
      if (typeof context.announce === 'function') {
        try {
          context.announce(value);
          return;
        } catch (err) {
          /* 回落到面板自带的 polite 区域 */
        }
      }
      liveRegion.textContent = '';
      liveRegion.textContent = value;
    }

    function setStatus(text) {
      const value = cleanText(text);
      statusLine.textContent = value;
      statusLine.hidden = !value;
    }

    function applySwitch() {
      switchBtn.setAttribute('aria-checked', hintsEnabled ? 'true' : 'false');
      switchState.textContent = hintsEnabled ? '开' : '关';
      if (hintsEnabled) switchBtn.classList.add('is-on');
      else switchBtn.classList.remove('is-on');
    }

    function applyToggleResult(result, next, previous) {
      if (result && isObject(result) && result.ok === false) {
        hintsEnabled = previous;
        applySwitch();
        setStatus(STATUS_SAVE_FAILED);
        announce(STATUS_SAVE_FAILED);
        return;
      }
      if (result && isObject(result) && isObject(result.state) && typeof result.state.hintsEnabled === 'boolean') {
        hintsEnabled = result.state.hintsEnabled;
      } else {
        hintsEnabled = next;
      }
      applySwitch();
      const text = hintsEnabled ? STATUS_ON : STATUS_OFF;
      setStatus(text);
      announce(text);
    }

    function toggleHints() {
      const previous = hintsEnabled;
      const next = !previous;
      hintsEnabled = next;
      applySwitch();
      if (typeof context.setHintsEnabled !== 'function') {
        const text = hintsEnabled ? STATUS_ON : STATUS_OFF;
        setStatus(text);
        announce(text);
        return;
      }
      let result = null;
      try {
        result = context.setHintsEnabled(next);
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => applyToggleResult(value, next, previous),
          () => applyToggleResult({ ok: false }, next, previous)
        );
        return;
      }
      applyToggleResult(result, next, previous);
    }

    function showConfirm() {
      confirming = true;
      confirmBox.hidden = false;
      resetBtn.hidden = true;
      setStatus('');
      safelyFocus(cancelBtn);
    }

    function hideConfirm(focusReset) {
      confirming = false;
      confirmBox.hidden = true;
      resetBtn.hidden = false;
      confirmBtn.disabled = false;
      if (focusReset) safelyFocus(resetBtn);
    }

    function settleReset(result) {
      confirmBtn.disabled = false;
      hideConfirm(false);
      if (result && isObject(result) && result.ok === false) {
        setStatus(STATUS_CLEAR_FAILED);
        announce(STATUS_CLEAR_FAILED);
        return;
      }
      if (result && isObject(result) && isObject(result.state) && typeof result.state.hintsEnabled === 'boolean') {
        hintsEnabled = result.state.hintsEnabled;
        applySwitch();
      }
      setStatus(STATUS_CLEARED);
      announce(STATUS_CLEARED);
    }

    /** 解析清除入口：ADR §17 的 ctx.resetDiscovery；兼容 bridge 通过 ctx.api 暴露的实现。 */
    function resetHandlerOf() {
      if (typeof context.resetDiscovery === 'function') return context.resetDiscovery;
      if (isObject(context.api) && typeof context.api.resetDiscovery === 'function') return context.api.resetDiscovery;
      return null;
    }

    /* 只有确认按钮走这里；未确认时不会有任何 resetDiscovery 调用。 */
    function confirmReset() {
      if (!confirming) return;
      confirmBtn.disabled = true;
      const reset = resetHandlerOf();
      if (typeof reset !== 'function') {
        settleReset({ ok: false });
        return;
      }
      let result = null;
      try {
        result = reset.call(context);
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => settleReset(value),
          () => settleReset({ ok: false })
        );
        return;
      }
      settleReset(result);
    }

    /* ---------- 旧港档案：导出 / 导入（可选区块） ---------- */

    let pendingImportText = null;

    function setArchiveStatus(text) {
      if (!archiveStatus) return;
      const value = cleanText(text);
      archiveStatus.textContent = value;
      archiveStatus.hidden = !value;
    }

    function readFileText(file, done) {
      if (!file) {
        done('');
        return;
      }
      if (typeof file.text === 'function') {
        file.text().then(
          (value) => done(typeof value === 'string' ? value : ''),
          () => done('')
        );
        return;
      }
      if (typeof FileReader !== 'function') {
        done('');
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = () => done(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => done('');
        reader.readAsText(file);
      } catch (err) {
        done('');
      }
    }

    function downloadText(filename, text) {
      const urlApi = typeof URL !== 'undefined' && URL ? URL : (root && root.URL ? root.URL : null);
      if (!urlApi || typeof urlApi.createObjectURL !== 'function' || typeof Blob !== 'function' || !doc.body) return false;
      let objectUrl = '';
      try {
        const blob = new Blob([text], { type: 'application/json' });
        objectUrl = urlApi.createObjectURL(blob);
        const link = doc.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        link.rel = 'noopener';
        link.style.display = 'none';
        doc.body.appendChild(link);
        link.click();
        doc.body.removeChild(link);
      } catch (err) {
        if (objectUrl && typeof urlApi.revokeObjectURL === 'function') {
          try {
            urlApi.revokeObjectURL(objectUrl);
          } catch (revokeErr) {
            /* ignore */
          }
        }
        return false;
      }
      if (objectUrl && typeof urlApi.revokeObjectURL === 'function') {
        const timer = root && typeof root.setTimeout === 'function' ? root.setTimeout : (typeof setTimeout === 'function' ? setTimeout : null);
        if (timer) {
          timer(() => {
            try {
              urlApi.revokeObjectURL(objectUrl);
            } catch (err) {
              /* ignore */
            }
          }, 4000);
        }
      }
      return true;
    }

    function failExport() {
      setArchiveStatus(EXPORT_FAILED);
      announce(EXPORT_FAILED);
    }

    function handleExportResult(result) {
      if (!result || (isObject(result) && result.ok === false)) {
        failExport();
        return;
      }
      const text = typeof result === 'string' ? result : typeof result.text === 'string' ? result.text : '';
      if (!text) {
        failExport();
        return;
      }
      const filename = cleanText(result.filename) || DEFAULT_FILENAME;
      if (!downloadText(filename, text)) {
        failExport();
        return;
      }
      setArchiveStatus(EXPORT_OK);
      announce(EXPORT_OK);
    }

    function startExport() {
      if (!backup || typeof backup.exportCareerLife !== 'function') {
        failExport();
        return;
      }
      let result = null;
      try {
        result = backup.exportCareerLife();
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => handleExportResult(value),
          () => failExport()
        );
        return;
      }
      handleExportResult(result);
    }

    function failImport() {
      setArchiveStatus(IMPORT_FAILED);
      announce(IMPORT_FAILED);
    }

    function cancelImport() {
      pendingImportText = null;
      if (importConfirmBox) importConfirmBox.hidden = true;
      if (importBtn) importBtn.hidden = false;
      safelyFocus(importBtn);
    }

    function settleImport(result) {
      if (archiveConfirmBtn) archiveConfirmBtn.disabled = false;
      if (!result || (isObject(result) && result.ok === false)) {
        failImport();
        return;
      }
      if (isObject(result.state) && typeof result.state.hintsEnabled === 'boolean') {
        hintsEnabled = result.state.hintsEnabled;
        applySwitch();
      }
      const mode = isObject(result) && typeof result.mode === 'string' ? result.mode : '';
      const detail = IMPORT_MODE_TEXT[mode] || '';
      const text = detail ? '档案已导入（' + detail + '）。' : IMPORT_OK;
      setArchiveStatus(text);
      announce(text);
    }

    /* 只有「确认导入」走这里；未确认时不会调用 importCareerLife。 */
    function confirmImport() {
      const text = pendingImportText;
      if (typeof text !== 'string' || !text) return;
      pendingImportText = null;
      if (importConfirmBox) importConfirmBox.hidden = true;
      if (importBtn) importBtn.hidden = false;
      if (!backup || typeof backup.importCareerLife !== 'function') {
        failImport();
        return;
      }
      if (archiveConfirmBtn) archiveConfirmBtn.disabled = true;
      let result = null;
      try {
        result = backup.importCareerLife(text);
      } catch (err) {
        result = { ok: false };
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => settleImport(value),
          () => settleImport({ ok: false })
        );
        return;
      }
      settleImport(result);
    }

    function startImport() {
      if (!fileInput) return;
      try {
        fileInput.value = '';
        fileInput.click();
      } catch (err) {
        failImport();
      }
    }

    function onFilePicked() {
      const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      if (!file) return;
      readFileText(file, (text) => {
        const value = typeof text === 'string' ? text : '';
        if (!value.trim()) {
          failImport();
          return;
        }
        pendingImportText = value;
        const name = cleanText(file.name);
        if (importConfirmText) {
          importConfirmText.textContent = (name ? '已选：' + name + '。' : '') + IMPORT_CONFIRM_TEXT;
        }
        if (importConfirmBox) importConfirmBox.hidden = false;
        if (importBtn) importBtn.hidden = true;
        setArchiveStatus('');
        safelyFocus(archiveCancelBtn);
        announce('已选好档案，确认后导入。');
      });
    }

    switchBtn.addEventListener('click', toggleHints, false);
    resetBtn.addEventListener('click', showConfirm, false);
    cancelBtn.addEventListener('click', () => hideConfirm(true), false);
    confirmBtn.addEventListener('click', confirmReset, false);
    closeBtn.addEventListener('click', () => close(), false);

    if (backup) {
      exportBtn.addEventListener('click', startExport, false);
      importBtn.addEventListener('click', startImport, false);
      fileInput.addEventListener('change', onFilePicked, false);
      archiveCancelBtn.addEventListener('click', cancelImport, false);
      archiveConfirmBtn.addEventListener('click', confirmImport, false);
    }

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
      if (onBackdrop) close();
    }, false);

    function onKeyDown(event) {
      if (!event) return;
      const key = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.keyCode === 'number' ? event.keyCode : 0;
      if (key === 'Escape' || key === 'Esc' || code === 27) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        close();
        return;
      }
      if (key !== 'Tab' && code !== 9) return;
      const items = focusableIn(sheet);
      if (!items.length) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(sheet);
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = doc.activeElement;
      const outside = !sheet.contains(activeEl);
      if (event.shiftKey) {
        if (activeEl === first || activeEl === sheet || outside) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          safelyFocus(last);
        }
        return;
      }
      if (activeEl === last || outside) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        safelyFocus(first);
      }
    }

    doc.addEventListener('keydown', onKeyDown, true);

    /* bridge.setHintsEnabled() 完成后会调用 settings.apply(...)（可选钩子）：只同步 UI，不写存储。 */
    function applyPatch(patch) {
      const data = isObject(patch) ? patch : {};
      if (typeof data.hintsEnabled === 'boolean') {
        hintsEnabled = data.hintsEnabled;
        applySwitch();
      }
      if (data.reducedMotion === true) overlay.classList.add('is-reduced-motion');
      else if (data.reducedMotion === false) overlay.classList.remove('is-reduced-motion');
      return true;
    }

    applySwitch();
    safelyFocus(closeBtn);

    panel = {
      doc: doc,
      overlay: overlay,
      sheet: sheet,
      previousFocus: previousFocus,
      onKeyDown: onKeyDown,
      apply: applyPatch,
    };
    return sheet;
  }

  /**
   * bridge 可选同步钩子：设置面板打开时接收最新偏好（bridge.js setHintsEnabled 末尾调用）。
   * 面板未打开时返回 false —— 不创建 DOM、不写任何存储。
   * @param {{hintsEnabled?: boolean, reducedMotion?: boolean}} [patch]
   * @returns {boolean} 是否已同步到打开中的面板
   */
  function apply(patch) {
    const current = panel;
    if (!current || typeof current.apply !== 'function') return false;
    try {
      current.apply(patch);
      return true;
    } catch (err) {
      return false;
    }
  }

  const api = {
    open: open,
    close: close,
    apply: apply,
  };

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.settings = api;
})(typeof window !== 'undefined' ? window : globalThis);
