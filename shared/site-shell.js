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
  // 脚本位于站点根下的 shared/，上升一级即站点根；兼容任意深度的工具子页面。
  const scriptUrl = document.currentScript && document.currentScript.src;
  function fallbackHome() {
    const marker = location.pathname.indexOf('/apps/');
    if (marker >= 0) return location.pathname.slice(0, marker + 1) + 'index.html';
    return './index.html';
  }
  home.href = scriptUrl ? new URL('../index.html', scriptUrl).href : fallbackHome();
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
