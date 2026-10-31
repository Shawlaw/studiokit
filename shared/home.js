(() => {
  'use strict';

  const grid = document.querySelector('[data-tool-grid]');
  const status = document.querySelector('[data-registry-status]');
  if (!grid) return;

  const labels = {
    available: '可用',
    draft: '开发中',
    planned: '规划中'
  };

  function makeText(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function renderTool(tool) {
    const isAvailable = tool.status === 'available' && typeof tool.href === 'string';
    const card = document.createElement(isAvailable ? 'a' : 'article');
    card.className = `tool-card${isAvailable ? '' : ' is-unavailable'}`;
    if (isAvailable) {
      card.href = tool.href;
      card.setAttribute('aria-label', `打开 ${tool.name}`);
    }

    const top = document.createElement('div');
    top.className = 'tool-card-top';
    top.append(makeText('span', 'tool-icon', tool.icon || '◇'));
    top.append(makeText('span', `tool-status status-${tool.status}`, labels[tool.status] || '未分类'));

    const body = document.createElement('div');
    body.className = 'tool-card-body';
    body.append(makeText('p', 'tool-subtitle', tool.subtitle || ''));
    body.append(makeText('h2', 'tool-name', tool.name || tool.id));
    body.append(makeText('p', 'tool-description', tool.description || ''));

    const bottom = document.createElement('div');
    bottom.className = 'tool-card-bottom';
    const tags = document.createElement('div');
    tags.className = 'tool-tags';
    (Array.isArray(tool.tags) ? tool.tags : []).slice(0, 3).forEach((tag) => {
      tags.append(makeText('span', 'tool-tag', tag));
    });
    bottom.append(tags);
    bottom.append(makeText('span', 'tool-version', tool.version ? `v${tool.version}` : ''));

    card.append(top, body, bottom);
    if (isAvailable) card.append(makeText('span', 'tool-open-hint', '打开工具 ↗'));
    return card;
  }

  async function loadRegistry() {
    try {
      const response = await fetch('./shared/tool-registry.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const registry = await response.json();
      if (!registry || !Array.isArray(registry.tools)) throw new Error('工具注册表格式无效');
      grid.replaceChildren(...registry.tools.map(renderTool));
      if (status) status.textContent = `${registry.tools.filter((tool) => tool.status === 'available').length} 个工具可用`;
    } catch (error) {
      if (status) status.textContent = '工具列表加载失败';
      grid.replaceChildren(makeText('p', 'registry-error', `无法读取工具注册表：${error.message}。请通过本地 HTTP 服务或 GitHub Pages 访问。`));
    }
  }

  loadRegistry();
})();
