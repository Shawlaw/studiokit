(() => {
  'use strict';
  const body = document.body;
  if (!body || !body.dataset.studiokitApp) return;
  if (body.dataset.studiokitShell === 'off') return;

  // 独立窗口（安装到桌面/主屏幕）里页面会铺到状态栏下面，导航条需要让出顶部安全区；
  // 普通标签页不这么做：浏览器 UI 已占住顶部，部分 Android 浏览器仍会返回非零
  // safe-area-inset-top，照单全收会让导航条上方多出一条空白。
  const standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  if (standalone) document.documentElement.classList.add('studiokit-shell-standalone');

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
  const gameTopbar = body.dataset.studiokitApp === 'arcade' ? body.querySelector('.game-page > .game-topbar') : null;
  const gameBack = gameTopbar?.querySelector('.ac-back[href]');
  if (gameBack) {
    home.href = gameBack.href;
    home.textContent = '‹ 街机厅';
    home.setAttribute('aria-label', '返回街机厅');
    bar.setAttribute('aria-label', '街机厅游戏导航');
    body.classList.add('has-arcade-game-shell');
  }

  const separator = document.createElement('span');
  separator.className = 'studiokit-shell-separator';
  separator.textContent = '/';
  separator.setAttribute('aria-hidden', 'true');

  const current = document.createElement('span');
  current.className = 'studiokit-shell-current';
  current.textContent = (gameBack && gameTopbar.querySelector('.game-title')?.textContent.trim())
    || body.dataset.studiokitAppTitle || body.dataset.studiokitApp;
  current.setAttribute('aria-current', 'page');

  const actions = document.createElement('span');
  actions.className = 'studiokit-shell-actions';

  const note = document.createElement('span');
  note.className = 'studiokit-shell-note';
  note.textContent = 'LOCAL-FIRST TOOLS';

  // 源码入口：与门户页脚保持同一个地址，validate_site.py 会校验两处一致。
  const source = document.createElement('a');
  source.className = 'studiokit-shell-source';
  source.href = 'https://github.com/Shawlaw/studiokit';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.textContent = '源码 ↗';
  source.title = '在 GitHub 查看 StudioKit 源码';
  source.setAttribute('aria-label', '在 GitHub 查看 StudioKit 源码（新窗口打开）');

  actions.append(note, source);
  bar.append(home, separator, current, actions);
  body.insertBefore(bar, body.firstChild);
  function syncBarHeight() {
    document.documentElement.style.setProperty(
      '--studiokit-shellbar-h',
      `${Math.round(bar.getBoundingClientRect().height)}px`
    );
  }
  syncBarHeight();
  // 旋转或进出独立窗口时顶部安全区会变，游戏页按该变量扣减高度，需要同步刷新。
  window.addEventListener('resize', syncBarHeight, { passive: true });
})();
