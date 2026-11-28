/*!
 * StudioKit Arcade Life — exact prototype harbor SVG (0.23 T11).
 * Source contract: prototype/reference.js:4 and ADR-0.23-ui.md §5.4.
 * Ordinary browser script; no data access, network requests or external assets.
 */
(function (root) {
  'use strict';

  /* Keep this template identical to prototype/reference.js:4. */
  const harbor = (dock = false) => `<svg class="harbor" viewBox="0 0 320 ${dock ? 112 : 100}" aria-hidden="true"><rect width="320" height="112" fill="#122331"/><circle cx="${dock ? 250 : 228}" cy="25" r="16" fill="#d7bd8c"/><path d="M0 57 L50 29 100 57 150 34 211 55 260 41 320 61 V112 H0Z" fill="#243d4c"/>${[8, 45, 84, 126, 167, 217, 266].map((x, i) => {
    const y = 47 + i % 3 * 6;
    return `<rect x="${x}" y="${y}" width="${30 + i % 2 * 7}" height="30" fill="#37474e"/><path d="M${x - 2} ${y} l17 -12 l20 12Z" fill="#1c303e"/><rect x="${x + 8}" y="${y + 9}" width="7" height="8" fill="#d7bd8c" opacity=".7"/>`;
  }).join('')}${dock ? '<path d="M44 81 V24 H100 M65 24 L44 43 M92 24 V49 M199 82 V17 H235 M225 17 V43" fill="none" stroke="#52616a" stroke-width="3"/>' : ''}<rect y="77" width="320" height="35" fill="#142d3d"/>${[20, 62, 135, 180, 234, 273].map((x, i) => `<path d="M${x} ${86 + i % 2 * 7} h25" stroke="#d7bd8c" stroke-width="1.5" opacity=".25"/>`).join('')}${dock ? '<text x="12" y="16" font-size="9" fill="#e6d4ac" letter-spacing="2">REFRACTION HARBOR</text>' : ''}</svg>`;

  /* DOM convenience for adapters. The returned SVG remains decorative. */
  function renderHarbor(dock = false) {
    const doc = typeof document !== 'undefined' && document ? document : null;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const template = doc.createElement('template');
    template.innerHTML = harbor(dock);
    return template.content && template.content.firstChild ? template.content.firstChild : null;
  }

  harbor.render = renderHarbor;
  harbor.markup = harbor;

  root.ArcadeCareerUI = root.ArcadeCareerUI && typeof root.ArcadeCareerUI === 'object' ? root.ArcadeCareerUI : {};
  root.ArcadeCareerUI.harbor = harbor;
  root.ArcadeCareerUI.renderHarbor = renderHarbor;

  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = { harbor, renderHarbor };
  }
})(typeof window !== 'undefined' ? window : globalThis);
