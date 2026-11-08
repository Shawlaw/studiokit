(() => {
  'use strict';
  const body = document.body;
  if (!body || !body.dataset.studiokitApp) return;
  if (body.dataset.studiokitShell === 'off') return;

  const bar = document.createElement('nav');
  bar.className = 'studiokit-shellbar';
  bar.setAttribute('aria-label', 'StudioKit 工具导航');

  const home = document.createElement('a');
  home.className = 'studiokit-shell-home';
  // 从脚本自身 URL 推导站点根，兼容任意深度的工具子页面（如 apps/<id>/games/*.html）。
  const scriptUrl = document.currentScript && document.currentScript.src;
  home.href = scriptUrl ? new URL('../../index.html', scriptUrl).href : '../../index.html';
  home.textContent = 'StudioKit';

  const separator = document.createElement('span');
  separator.className = 'studiokit-shell-separator';
  separator.textContent = '/';
  separator.setAttribute('aria-hidden', 'true');

  const current = document.createElement('span');
  current.className = 'studiokit-shell-current';
  current.textContent = body.dataset.studiokitAppTitle || body.dataset.studiokitApp;
  current.setAttribute('aria-current', 'page');

  const note = document.createElement('span');
  note.className = 'studiokit-shell-note';
  note.textContent = 'LOCAL-FIRST TOOLS';

  bar.append(home, separator, current, note);
  body.insertBefore(bar, body.firstChild);
  document.documentElement.style.setProperty(
    '--studiokit-shellbar-h',
    `${Math.round(bar.getBoundingClientRect().height)}px`
  );
})();
