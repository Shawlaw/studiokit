#!/usr/bin/env node
/**
 * Venue Compare（餐厅考察对比）无头浏览器冒烟测试。
 * 零 npm 依赖：复用 tools/lib/arcade_cdp.mjs 的静态服务器 / Chrome / CDP / 断言记录器。
 * 运行：node tools/restaurant_compare_smoke.mjs
 * 端口可用环境变量覆盖：RC_SMOKE_PORT（默认 8784）/ RC_CDP_PORT（默认 9344）。
 * 需要本机 Chrome（可用 CHROME_PATH 覆盖路径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecorder, envPort, launchChrome, openPage, sleep, startServer, stopChrome } from './lib/arcade_cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'test-artifacts', 'restaurant-compare');
const SERVER_PORT = envPort('RC_SMOKE_PORT', 8784);
const CDP_PORT = envPort('RC_CDP_PORT', 9344);
const { results, record, assert, summary } = createRecorder();
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const keydown = (key, extra = '') => `document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)}${extra},bubbles:true,cancelable:true}))`;

async function mouseClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function mouseDrag(cdp, x1, y1, x2, y2) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left', buttons: 1 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  let server = null;
  let launched = null;
  let cdp = null;
  try {
    server = await startServer({ root: ROOT, port: SERVER_PORT });
    launched = await launchChrome({ port: CDP_PORT, profilePrefix: 'studiokit-rc-smoke-', windowSize: '1440,1000' });
    cdp = await openPage({ port: CDP_PORT, width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, artifactsDir: ARTIFACTS });
    const base = `http://127.0.0.1:${SERVER_PORT}`;

    /* ---------- 1. 门户与初始空状态 ---------- */
    await cdp.navigate(base + '/');
    const homepage = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.tool-card')];
      const card = cards.find((node) => node.textContent.includes('Venue Compare'));
      return { cards: cards.length, found: !!card, status: card ? card.querySelector('.tool-status').textContent : '', href: card ? (card.getAttribute('href') || '') : '' };
    })()`);
    assert(homepage.found, 'home card missing for Venue Compare');
    record('门户显示 Venue Compare 草稿卡片', homepage.status === '开发中', JSON.stringify(homepage));

    await cdp.navigate(base + '/apps/restaurant-compare/');
    await sleep(450);
    const initial = await cdp.evaluate(`({
      shell: !!document.querySelector('.studiokit-shellbar'),
      empty: !document.getElementById('listEmpty').hidden,
      placeholder: !!document.querySelector('.map-placeholder'),
      rows: document.querySelectorAll('#rows tr').length,
      stats: document.querySelectorAll('.stat').length,
      save: document.getElementById('saveText').textContent,
      placeDisabled: document.getElementById('placeBtn').disabled
    })`);
    assert(initial.shell, 'shared shell missing');
    assert(initial.empty && initial.placeholder, 'empty states missing: ' + JSON.stringify(initial));
    assert(initial.rows === 0 && initial.stats === 4, 'unexpected initial rows/stats');
    record('工具页共享导航与空状态正确', initial.save === '尚未修改' && initial.placeDisabled, JSON.stringify(initial));
    await cdp.screenshot('01-empty.png');

    /* ---------- 2. 载入示例项目 ---------- */
    await cdp.evaluate(`document.querySelector('[data-empty="sample"]').click()`);
    await sleep(750);
    const sample = await cdp.evaluate(`({
      rows: document.querySelectorAll('#rows tr').length,
      cards: document.querySelectorAll('.rc-card').length,
      markers: document.querySelectorAll('.map-marker').length,
      map: !!document.getElementById('mapImage'),
      stats: [...document.querySelectorAll('.stat-value')].map((node) => node.textContent),
      select: document.getElementById('markerSelect').value,
      placeDisabled: document.getElementById('placeBtn').disabled,
      caption: document.getElementById('mapCaption').textContent,
      saved: document.getElementById('saveText').textContent
    })`);
    assert(sample.rows === 5 && sample.cards === 5 && sample.markers === 5 && sample.map, 'sample render failed: ' + JSON.stringify(sample));
    assert(sample.select === 'A' && !sample.placeDisabled, 'marker select default wrong');
    record('示例项目：5 家餐厅、5 个标记与地图', sample.stats[0] === '5' && /已标注/.test(sample.caption), JSON.stringify(sample));
    await cdp.screenshot('02-sample.png');

    /* ---------- 3. 详情、媒体与灯箱 ---------- */
    await cdp.evaluate(`document.querySelector('#rows tr[data-id="A"]').click()`);
    await sleep(250);
    const detail = await cdp.evaluate(`({
      open: document.getElementById('detailDialog').open,
      title: document.getElementById('detailTitle').textContent,
      kv: document.querySelectorAll('#detailContent .detail-kv div').length,
      media: document.querySelectorAll('#detailContent .media-card').length
    })`);
    assert(detail.open && detail.kv === 6 && detail.media === 2, 'detail mismatch: ' + JSON.stringify(detail));
    await cdp.evaluate(`document.querySelector('#detailContent [data-action="zoom"]').click()`);
    await sleep(250);
    const lightbox = await cdp.evaluate(`({ open: document.getElementById('lightboxDialog').open, img: !!document.querySelector('#lightboxStage img') })`);
    assert(lightbox.open && lightbox.img, 'lightbox failed');
    record('详情 6 项费用 + 2 份媒体，图片可放大', true);
    await cdp.evaluate(`document.querySelector('#lightboxDialog [data-close="lightbox"]').click()`);
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(200);

    /* ---------- 4. 外部链接：展示、编辑、分享文案提取与校验 ---------- */
    await cdp.evaluate(`document.querySelector('#rows tr[data-id="A"]').click()`);
    await sleep(250);
    const linkDetail = await cdp.evaluate(`({
      links: document.querySelectorAll('#detailContent .link-card').length,
      href: (document.querySelector('#detailContent .link-card') || {}).href || '',
      target: (document.querySelector('#detailContent .link-card') || {}).target || '',
      rel: (document.querySelector('#detailContent .link-card') || {}).rel || '',
      label: (document.querySelector('#detailContent .link-card strong') || {}).textContent || ''
    })`);
    assert(linkDetail.links === 2 && linkDetail.href.startsWith('https://') && linkDetail.target === '_blank' && /noopener/.test(linkDetail.rel) && linkDetail.label === '大众点评', 'detail links wrong: ' + JSON.stringify(linkDetail));
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(150);
    const linkCells = await cdp.evaluate(`({
      cells: document.querySelectorAll('#rows tr[data-id="A"] td').length,
      tableCount: (document.querySelector('#rows tr[data-id="A"] .link-count') || {}).textContent || '',
      cardLinks: document.querySelectorAll('.rc-card[data-id="A"] .rc-link').length
    })`);
    assert(linkCells.cells === 11 && linkCells.tableCount.includes('2') && linkCells.cardLinks === 2, 'link cells wrong: ' + JSON.stringify(linkCells));

    await cdp.evaluate(`document.querySelector('#rows tr[data-id="A"] [data-action="edit"]').click()`);
    await sleep(200);
    let linkEdit = await cdp.evaluate(`({ rows: document.querySelectorAll('#linkList .link-row').length, notes: document.querySelectorAll('#linkList [data-link-field="note"]').length, presets: document.querySelectorAll('#linkPresets [data-preset]').length })`);
    assert(linkEdit.rows === 2 && linkEdit.notes === 2 && linkEdit.presets === 5, 'edit links initial wrong: ' + JSON.stringify(linkEdit));
    await cdp.evaluate(`document.querySelector('#linkPresets [data-preset="小红书"]').click()`);
    await sleep(100);
    await cdp.evaluate(`(() => {
      const row = document.querySelectorAll('#linkList .link-row')[2];
      const url = row.querySelector('[data-link-field="url"]');
      url.value = '【分享】这家店环境不错 https://www.xiaohongshu.com/discovery/item/abc?x=1 复制打开';
      url.dispatchEvent(new Event('input', { bubbles: true }));
      url.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    })()`);
    const extracted = await cdp.evaluate(`document.querySelectorAll('#linkList .link-row')[2].querySelector('[data-link-field="url"]').value`);
    assert(extracted === 'https://www.xiaohongshu.com/discovery/item/abc?x=1', 'share text extraction failed: ' + extracted);
    await cdp.evaluate(`document.querySelector('#linkPresets [data-preset="其他"]').click()`);
    await sleep(100);
    const pasted = await cdp.evaluate(`(() => {
      const row = document.querySelectorAll('#linkList .link-row')[3];
      const url = row.querySelector('[data-link-field="url"]');
      const note = row.querySelector('[data-link-field="note"]');
      const transfer = new DataTransfer();
      transfer.setData('text/plain', '看看这家 https://m.dianping.com/shop/123456?utm=abc 环境不错，包间可坐 12 人');
      url.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      return { value: url.value, label: row.querySelector('[data-link-field="label"]').value, note: note.value };
    })()`);
    assert(pasted.value === 'https://m.dianping.com/shop/123456?utm=abc' && pasted.label === '大众点评' && pasted.note.includes('环境不错'), 'paste extraction/note failed: ' + JSON.stringify(pasted));
    await cdp.screenshot('06-links-edit.png');
    await cdp.evaluate(`document.querySelectorAll('#linkList .link-row')[2].querySelector('[data-action="remove-link"]').click()`);
    await sleep(100);
    linkEdit = await cdp.evaluate(`({ rows: document.querySelectorAll('#linkList .link-row').length })`);
    assert(linkEdit.rows === 3, 'remove link failed: ' + JSON.stringify(linkEdit));

    await cdp.evaluate(`(() => {
      const url = document.querySelectorAll('#linkList .link-row')[0].querySelector('[data-link-field="url"]');
      url.value = 'javascript:alert(1)';
      url.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('editForm').requestSubmit();
    })()`);
    await sleep(250);
    const invalidLink = await cdp.evaluate(`({
      open: document.getElementById('editDialog').open,
      invalid: document.querySelectorAll('#linkList .link-row')[0].querySelector('[data-link-field="url"]').getAttribute('aria-invalid'),
      toast: document.getElementById('toastText').textContent
    })`);
    assert(invalidLink.open && invalidLink.invalid === 'true', 'invalid link not blocked: ' + JSON.stringify(invalidLink));
    await cdp.evaluate(`(() => {
      const url = document.querySelectorAll('#linkList .link-row')[0].querySelector('[data-link-field="url"]');
      url.value = 'https://www.dianping.com/';
      url.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('editForm').requestSubmit();
    })()`);
    await sleep(600);
    assert(!(await cdp.evaluate(`document.getElementById('editDialog').open`)), 'edit dialog stayed open after valid links');

    await cdp.evaluate(`document.querySelector('#rows tr[data-id="A"]').click()`);
    await sleep(250);
    const savedLinks = await cdp.evaluate(`({
      links: document.querySelectorAll('#detailContent .link-card').length,
      tableCount: (document.querySelector('#rows tr[data-id="A"] .link-count') || {}).textContent || '',
      cardLinks: document.querySelectorAll('.rc-card[data-id="A"] .rc-link').length,
      hosts: [...document.querySelectorAll('#detailContent .link-card small')].map(node => node.textContent),
      notes: [...document.querySelectorAll('#detailContent .link-card-note')].map(node => node.textContent)
    })`);
    assert(savedLinks.links === 3 && savedLinks.tableCount.includes('3') && savedLinks.cardLinks === 3 && savedLinks.hosts.includes('dianping.com') && savedLinks.hosts.includes('example.com'), 'saved links wrong: ' + JSON.stringify(savedLinks));
    assert(savedLinks.notes.length === 1 && savedLinks.notes[0].includes('环境不错'), 'saved link note wrong: ' + JSON.stringify(savedLinks));
    record('外部链接：详情/表格/卡片展示，分享文案提取与 javascript: 拦截', true, JSON.stringify({ linkDetail, extracted, pasted, savedLinks }));
    await cdp.screenshot('07-links-detail.png');
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(150);
    await cdp.evaluate(`document.getElementById('listPanel').scrollIntoView({ block: 'start' })`);
    await sleep(200);
    await cdp.screenshot('08-table-links.png');
    await cdp.evaluate(`document.getElementById('mapPanel').scrollIntoView({ block: 'start' })`);
    await sleep(250);

    /* ---------- 5. 地图标记点击与缩放 ---------- */
    const markerRect = await cdp.evaluate(`(() => { const r=document.querySelector('.map-marker').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await mouseClick(cdp, markerRect.x, markerRect.y);
    await sleep(250);
    const markerDetail = await cdp.evaluate(`({ open: document.getElementById('detailDialog').open, title: document.getElementById('detailTitle').textContent })`);
    assert(markerDetail.open && markerDetail.title.indexOf('云顶中餐厅') >= 0, 'marker click did not open detail: ' + JSON.stringify(markerDetail));
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await cdp.evaluate(`document.querySelector('[data-map="reset"]').click()`);
    await sleep(150);
    await cdp.evaluate(`document.querySelector('[data-map="in"]').click()`);
    await sleep(150);
    let zoom = await cdp.evaluate(`document.getElementById('mapZoomLevel').textContent`);
    assert(zoom === '125%', 'zoom in expected 125%, got ' + zoom);
    await cdp.evaluate(`document.querySelector('[data-map="out"]').click()`);
    await sleep(100);
    zoom = await cdp.evaluate(`document.getElementById('mapZoomLevel').textContent`);
    assert(zoom === '100%', 'zoom out expected 100%, got ' + zoom);
    record('标记点击联动详情，地图缩放按钮生效', true);

    /* ---------- 5. 新增餐厅并放置标记 ---------- */
    await cdp.evaluate(`document.getElementById('addBtn').click()`);
    await sleep(200);
    const defaultId = await cdp.evaluate(`document.getElementById('f-id').value`);
    await cdp.evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true}));}; set('f-name','测试新餐厅'); set('f-minimum','每桌 ¥999 起'); })()`);
    await cdp.evaluate(`document.getElementById('editForm').requestSubmit()`);
    await sleep(550);
    const added = await cdp.evaluate(`({
      rows: document.querySelectorAll('#rows tr').length,
      select: document.getElementById('markerSelect').value,
      placeDisabled: document.getElementById('placeBtn').disabled,
      active: document.querySelector('#rows tr.is-active') ? document.querySelector('#rows tr.is-active').dataset.id : null,
      text: document.getElementById('placeBtn').textContent
    })`);
    assert(added.rows === 6 && added.select === defaultId && !added.placeDisabled, 'add restaurant failed: ' + JSON.stringify(added));
    await cdp.evaluate(`document.getElementById('placeBtn').click()`);
    await sleep(150);
    const banner = await cdp.evaluate(`({ shown: !document.getElementById('mapBanner').hidden, text: document.getElementById('mapBannerText').textContent, crosshair: document.getElementById('mapStage').classList.contains('is-placing') })`);
    assert(banner.shown && banner.crosshair, 'placement banner missing: ' + JSON.stringify(banner));
    const stage = await cdp.evaluate(`(() => { const r=document.getElementById('mapStage').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
    await mouseClick(cdp, stage.x + stage.w * 0.42, stage.y + stage.h * 0.5);
    await sleep(450);
    const placed = await cdp.evaluate(`({
      markers: [...document.querySelectorAll('.map-marker')].map((node) => node.dataset.marker),
      banner: !document.getElementById('mapBanner').hidden,
      select: document.getElementById('markerSelect').value
    })`);
    assert(placed.markers.includes(defaultId) && !placed.banner, 'place marker failed: ' + JSON.stringify(placed));
    record('新增餐厅后可在图上点击放置标记', placed.markers.length === 6, JSON.stringify(placed));

    /* ---------- 6. 标记拖动与撤销 / 重做 ---------- */
    const dragStart = await cdp.evaluate(`(() => { const el=[...document.querySelectorAll('.map-marker')].find((node)=>node.dataset.marker===${JSON.stringify(defaultId)}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,left:el.style.left,top:el.style.top}; })()`);
    await mouseDrag(cdp, dragStart.x, dragStart.y, dragStart.x + 46, dragStart.y + 28);
    await sleep(400);
    const dragEnd = await cdp.evaluate(`(() => { const el=[...document.querySelectorAll('.map-marker')].find((node)=>node.dataset.marker===${JSON.stringify(defaultId)}); return {left:el.style.left,top:el.style.top,toast:document.getElementById('toastText').textContent}; })()`);
    assert(dragEnd.left !== dragStart.left || dragEnd.top !== dragStart.top, 'marker drag did not move: ' + JSON.stringify({ dragStart, dragEnd }));
    await cdp.evaluate(keydown('z', ',ctrlKey:true'));
    await sleep(350);
    const afterUndoDrag = await cdp.evaluate(`(() => { const el=[...document.querySelectorAll('.map-marker')].find((node)=>node.dataset.marker===${JSON.stringify(defaultId)}); return el ? {left:el.style.left,top:el.style.top} : null; })()`);
    assert(afterUndoDrag && afterUndoDrag.left === dragStart.left, 'undo drag failed: ' + JSON.stringify({ dragStart, afterUndoDrag }));
    await cdp.evaluate(keydown('z', ',ctrlKey:true,shiftKey:true'));
    await sleep(350);
    const afterRedoDrag = await cdp.evaluate(`(() => { const el=[...document.querySelectorAll('.map-marker')].find((node)=>node.dataset.marker===${JSON.stringify(defaultId)}); return el ? el.style.left : null; })()`);
    assert(afterRedoDrag === dragEnd.left, 'redo drag failed');
    record('标记拖动、Ctrl+Z 撤销与 Shift+Ctrl+Z 重做', true);

    /* ---------- 7. 修改编号并同步标记 ---------- */
    await cdp.evaluate(`document.querySelector('#rows tr[data-id="A"] [data-action="edit"]').click()`);
    await sleep(200);
    await cdp.evaluate(`(() => { const el=document.getElementById('f-id'); el.value='A1'; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await cdp.evaluate(`document.getElementById('editForm').requestSubmit()`);
    await sleep(500);
    const renamed = await cdp.evaluate(`({
      hasRow: !!document.querySelector('#rows tr[data-id="A1"]'),
      markers: [...document.querySelectorAll('.map-marker')].map((node) => node.dataset.marker),
      select: document.getElementById('markerSelect').value
    })`);
    assert(renamed.hasRow && renamed.markers.includes('A1') && renamed.select === 'A1', 'rename did not move marker: ' + JSON.stringify(renamed));
    await cdp.evaluate(keydown('z', ',ctrlKey:true'));
    await sleep(400);
    const renameUndo = await cdp.evaluate(`({ hasA: !!document.querySelector('#rows tr[data-id="A"]'), hasA1: !!document.querySelector('#rows tr[data-id="A1"]'), markers: [...document.querySelectorAll('.map-marker')].map((node) => node.dataset.marker) })`);
    assert(renameUndo.hasA && !renameUndo.hasA1 && renameUndo.markers.includes('A'), 'rename undo failed: ' + JSON.stringify(renameUndo));
    record('修改餐厅编号会同步地图标记，撤销可回退', true);

    /* ---------- 8. 附件上传与保存 ---------- */
    await cdp.evaluate(`document.querySelector('#rows tr[data-id=${JSON.stringify(defaultId)}] [data-action="edit"]').click()`);
    await sleep(200);
    await cdp.evaluate(`(() => {
      const binary = atob(${JSON.stringify(TINY_PNG)});
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], '测试图片.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.getElementById('environmentFiles');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    const fileCount = await cdp.evaluate(`document.querySelectorAll('#environmentFileList .file-row').length`);
    assert(fileCount === 1, 'file upload list expected 1, got ' + fileCount);
    await cdp.evaluate(`document.querySelector('#environmentFileList [data-action="remove-asset"]').click()`);
    await sleep(120);
    const removedCount = await cdp.evaluate(`document.querySelectorAll('#environmentFileList .file-row').length`);
    assert(removedCount === 0, 'remove asset failed, got ' + removedCount);
    await cdp.evaluate(`(() => {
      const binary = atob(${JSON.stringify(TINY_PNG)});
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], '测试图片.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.getElementById('environmentFiles');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(500);
    const reAddedCount = await cdp.evaluate(`document.querySelectorAll('#environmentFileList .file-row').length`);
    assert(reAddedCount === 1, 're-add asset failed, got ' + reAddedCount);
    await cdp.evaluate(`document.getElementById('editForm').requestSubmit()`);
    await sleep(550);
    await cdp.evaluate(`document.querySelector('#rows tr[data-id=${JSON.stringify(defaultId)}]').click()`);
    await sleep(250);
    const attachment = await cdp.evaluate(`({ media: document.querySelectorAll('#detailContent .media-card').length, img: document.querySelectorAll('#detailContent .media-preview img').length })`);
    assert(attachment.media === 1 && attachment.img === 1, 'attachment detail failed: ' + JSON.stringify(attachment));
    record('图片附件读取、保存并在详情中预览', true);
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(150);

    /* ---------- 9. 搜索、筛选与移动端布局 ---------- */
    await cdp.evaluate(`(() => { const input=document.getElementById('searchInput'); input.value='云顶'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(150);
    let filtered = await cdp.evaluate(`({ rows: document.querySelectorAll('#rows tr').length, cards: document.querySelectorAll('.rc-card').length })`);
    assert(filtered.rows === 1 && filtered.cards === 1, 'search filter failed: ' + JSON.stringify(filtered));
    await cdp.evaluate(`(() => { const input=document.getElementById('searchInput'); input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await cdp.evaluate(`document.querySelector('[data-filter="unmarked"]').click()`);
    await sleep(150);
    filtered = await cdp.evaluate(`({ rows: document.querySelectorAll('#rows tr').length, empty: !document.getElementById('tableEmpty').hidden, cardsEmpty: !document.getElementById('cardsEmpty').hidden })`);
    assert(filtered.rows === 0 && filtered.empty && filtered.cardsEmpty, 'unmarked filter failed: ' + JSON.stringify(filtered));
    await cdp.evaluate(`document.querySelector('[data-filter="all"]').click()`);
    await sleep(100);

    for (const width of [430, 390, 375, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await sleep(220);
      const layout = await cdp.evaluate(`({
        width: innerWidth,
        docW: document.documentElement.scrollWidth,
        table: getComputedStyle(document.querySelector('.table-wrap')).display,
        cards: getComputedStyle(document.querySelector('.rc-cards')).display,
        cardCount: document.querySelectorAll('.rc-card').length,
        links: document.querySelectorAll('.rc-card[data-id="A"] .rc-link').length,
        actionRight: Math.max(...[...document.querySelectorAll('.hero-actions > *')].map((node) => node.getBoundingClientRect().right)),
        control: Math.round(document.querySelector('.map-control-btn').getBoundingClientRect().width)
      })`);
      assert(layout.docW <= width && layout.table === 'none' && layout.cards === 'flex' && layout.cardCount === 6, width + 'px layout failed: ' + JSON.stringify(layout));
      assert(layout.actionRight <= width - 8, width + 'px hero actions overflow: ' + layout.actionRight);
      assert(layout.control >= 40, width + 'px map control too small');
      assert(layout.links === 3, width + 'px card links missing');
      if (width === 390) await cdp.screenshot('03-mobile-390.png');
      if (width === 390) {
        await cdp.evaluate(`document.querySelector('.rc-card[data-id="A"]').scrollIntoView({ block: 'center' })`);
        await sleep(200);
        await cdp.screenshot('09-mobile-links.png');
      }
    }
    record('320 / 375 / 390 / 430px 无横向溢出，表格切换为卡片', true);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(250);

    /* ---------- 10. 删除确认与撤销 ---------- */
    await cdp.evaluate(`document.querySelector('#rows tr[data-id=${JSON.stringify(defaultId)}] [data-action="delete"]').click()`);
    await sleep(200);
    const confirm = await cdp.evaluate(`({ open: document.getElementById('confirmDialog').open, focus: document.activeElement ? document.activeElement.textContent.trim() : '' })`);
    assert(confirm.open && confirm.focus === '取消', 'confirm focus should be cancel: ' + JSON.stringify(confirm));
    await cdp.evaluate(`document.querySelector('#confirmDialog [data-close="confirm"]').click()`);
    await sleep(150);
    let deleteState = await cdp.evaluate(`({ rows: document.querySelectorAll('#rows tr').length, markers: document.querySelectorAll('.map-marker').length })`);
    assert(deleteState.rows === 6, 'cancel delete changed rows');
    await cdp.evaluate(`document.querySelector('#rows tr[data-id=${JSON.stringify(defaultId)}] [data-action="delete"]').click()`);
    await sleep(150);
    await cdp.evaluate(`document.getElementById('confirmOk').click()`);
    await sleep(400);
    deleteState = await cdp.evaluate(`({ rows: document.querySelectorAll('#rows tr').length, markers: document.querySelectorAll('.map-marker').length, select: document.getElementById('markerSelect').value })`);
    assert(deleteState.rows === 5 && deleteState.markers === 5, 'delete failed: ' + JSON.stringify(deleteState));
    await cdp.evaluate(keydown('z', ',ctrlKey:true'));
    await sleep(400);
    deleteState = await cdp.evaluate(`({ rows: document.querySelectorAll('#rows tr').length, markers: document.querySelectorAll('.map-marker').length })`);
    assert(deleteState.rows === 6 && deleteState.markers === 6, 'delete undo failed: ' + JSON.stringify(deleteState));
    record('删除需确认（默认聚焦取消），删除后撤销可恢复', true);

    /* ---------- 11. 导入（替换）与恶意附件过滤 ---------- */
    await cdp.evaluate(`(() => {
      const payload = { restaurants: [
        { id: 'X', name: '导入一号', minimum: '¥100', environment: [{ name: 'bad', type: 'image/png', dataUrl: 'javascript:alert(1)', size: 10 }], links: [{ label: '官网', url: 'https://example.com/x', note: '导入备注：官网首页' }, { label: '坏链接', url: 'javascript:alert(1)' }] },
        { id: 'Y', name: '导入二号', parking: '免费' }
      ], map: null };
      const file = new File([JSON.stringify(payload)], 'import.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.getElementById('projectInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(350);
    await cdp.evaluate(`document.getElementById('confirmOk').click()`);
    await sleep(500);
    const imported = await cdp.evaluate(`({
      rows: document.querySelectorAll('#rows tr').length,
      names: [...document.querySelectorAll('.rest-name')].map((node) => node.textContent),
      markers: document.querySelectorAll('.map-marker').length,
      placeholder: !!document.querySelector('.map-placeholder'),
      save: document.getElementById('saveText').textContent
    })`);
    assert(imported.rows === 2 && imported.names.includes('导入一号') && imported.markers === 0 && imported.placeholder, 'import failed: ' + JSON.stringify(imported));
    await cdp.evaluate(`document.querySelector('#rows tr[data-id="X"]').click()`);
    await sleep(250);
    const malicious = await cdp.evaluate(`({ media: document.querySelectorAll('#detailContent .media-card').length, links: document.querySelectorAll('#detailContent .link-card').length, empty: !!document.querySelector('#detailContent .detail-empty') })`);
    assert(malicious.media === 0 && malicious.links === 1, 'malicious dataUrl/link was not filtered');
    record('导入替换项目并丢弃 javascript: 附件', true, JSON.stringify({ imported, malicious }));
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(150);

    /* ---------- 12. 导出独立 HTML 与只读查看 ---------- */
    const exportResult = await cdp.evaluate(`(async () => {
      window.__rcBlobs = [];
      const original = URL.createObjectURL;
      URL.createObjectURL = (blob) => { window.__rcBlobs.push(blob); return original(blob); };
      document.getElementById('exportMenu').open = true;
      document.querySelector('[data-menu="html"]').click();
      for (let i = 0; i < 80 && !window.__rcBlobs.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      const blob = window.__rcBlobs[0];
      if (!blob) return { ok: false };
      const text = await blob.text();
      return {
        ok: true,
        size: blob.size,
        shellNode: text.includes('class="studiokit-shellbar"'),
        editorDialog: text.includes('id="editDialog"'),
        help: text.includes('怎么用 · 三步就够'),
        footerLink: text.includes('返回 StudioKit'),
        allActive: text.includes('data-filter="all" class="is-active"'),
        embedded: text.includes('id="embeddedData"'),
        viewOnly: text.includes('data-view-only="true"'),
        external: (text.match(/<script[^>]+src=/g) || []).length,
        goodLink: text.includes('example.com/x'),
        note: text.includes('导入备注：官网首页'),
        badLink: text.includes('javascript:alert')
      };
    })()`);
    assert(exportResult.ok, 'export produced no blob');
    assert(!exportResult.shellNode && !exportResult.editorDialog && !exportResult.help && !exportResult.footerLink, 'export leaked editor/shell content: ' + JSON.stringify(exportResult));
    assert(exportResult.allActive && exportResult.embedded && exportResult.viewOnly && exportResult.external === 0 && exportResult.goodLink && exportResult.note && !exportResult.badLink, 'export validation failed: ' + JSON.stringify(exportResult));
    record('导出独立 HTML：无站点外壳 / 编辑器 / 外链，筛选状态重置', true, exportResult.size + ' bytes');

    const blobUrl = await cdp.evaluate(`URL.createObjectURL(window.__rcBlobs[0])`);
    await cdp.navigate(blobUrl);
    await sleep(900);
    const viewer = await cdp.evaluate(`({
      viewOnly: document.body.dataset.viewOnly,
      rows: document.querySelectorAll('#rows tr').length,
      cards: document.querySelectorAll('.rc-card').length,
      markers: document.querySelectorAll('.map-marker').length,
      placeholder: !!document.querySelector('.map-placeholder'),
      shell: !!document.querySelector('.studiokit-shellbar'),
      editDialog: !!document.getElementById('editDialog'),
      print: !!document.getElementById('printBtnViewer'),
      lede: document.querySelector('.lede').textContent.trim(),
      help: !!document.querySelector('.help'),
      footerLink: !!document.querySelector('.foot a'),
      mapDesc: document.querySelector('#mapPanel .panel-head p').textContent.trim(),
      links: document.querySelectorAll('.rc-link').length
    })`);
    assert(viewer.viewOnly === 'true' && viewer.rows === 2 && viewer.cards === 2 && viewer.markers === 0 && viewer.placeholder, 'viewer render failed: ' + JSON.stringify(viewer));
    assert(viewer.links === 1, 'viewer external link missing: ' + JSON.stringify(viewer));
    assert(!viewer.shell && !viewer.editDialog && viewer.print && !viewer.help && !viewer.footerLink, 'viewer still exposes editor: ' + JSON.stringify(viewer));
    assert(/只读展示页/.test(viewer.lede) && /标记与下方表格双向联动/.test(viewer.mapDesc), 'viewer copy not switched');
    record('导出页只读渲染、无编辑入口且文案切换', true);
    await cdp.screenshot('04-viewer.png');

    await cdp.evaluate(`document.querySelector('#rows tr[data-id="Y"]').click()`);
    await sleep(250);
    const viewerDetail = await cdp.evaluate(`({ open: document.getElementById('detailDialog').open, edit: !!document.getElementById('detailEditBtn'), delete: !!document.getElementById('detailDeleteBtn'), locate: !!document.getElementById('detailLocateBtn') })`);
    assert(viewerDetail.open && !viewerDetail.edit && !viewerDetail.delete && viewerDetail.locate, 'viewer detail actions wrong: ' + JSON.stringify(viewerDetail));
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(120);

    await cdp.evaluate(`document.querySelector('#rows tr[data-id="X"]').click()`);
    await sleep(250);
    const viewerLink = await cdp.evaluate(`({
      open: document.getElementById('detailDialog').open,
      links: document.querySelectorAll('#detailContent .link-card').length,
      href: (document.querySelector('#detailContent .link-card') || {}).href || '',
      target: (document.querySelector('#detailContent .link-card') || {}).target || '',
      note: (document.querySelector('#detailContent .link-card-note') || {}).textContent || ''
    })`);
    assert(viewerLink.open && viewerLink.links === 1 && viewerLink.href === 'https://example.com/x' && viewerLink.target === '_blank' && viewerLink.note.includes('导入备注'), 'viewer link wrong: ' + JSON.stringify(viewerLink));
    record('导出页保留外部链接且以新标签打开', true);
    await cdp.evaluate(`document.querySelector('#detailDialog [data-close="detail"]').click()`);
    await sleep(120);

    /* ---------- 13. 导出页移动端与打印样式 ---------- */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    const viewerMobile = await cdp.evaluate(`({
      width: innerWidth,
      docW: document.documentElement.scrollWidth,
      table: getComputedStyle(document.querySelector('.table-wrap')).display,
      cards: getComputedStyle(document.querySelector('.rc-cards')).display,
      cardsCount: document.querySelectorAll('.rc-card').length,
      actionRight: Math.max(...[...document.querySelectorAll('.hero-actions > *')].map((node) => node.getBoundingClientRect().right))
    })`);
    assert(viewerMobile.docW <= 375 && viewerMobile.table === 'none' && viewerMobile.cards === 'flex' && viewerMobile.cardsCount === 2, 'viewer mobile failed: ' + JSON.stringify(viewerMobile));
    assert(viewerMobile.actionRight <= 367, 'viewer print button overflow');
    record('导出页 375px 使用卡片布局且无横向溢出', true);
    await cdp.screenshot('05-viewer-375.png');

    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(150);
    const printState = await cdp.evaluate(`({
      actions: getComputedStyle(document.querySelector('.hero-actions')).display,
      toast: getComputedStyle(document.getElementById('toast')).display,
      mapCanvas: document.getElementById('mapCanvas') ? getComputedStyle(document.getElementById('mapCanvas')).position : 'none',
      table: getComputedStyle(document.querySelector('.table-wrap')).display
    })`);
    assert(printState.actions === 'none' && printState.toast === 'none' && printState.table !== 'none', 'print styles failed: ' + JSON.stringify(printState));
    record('打印样式隐藏操作区与提示条', true);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });

    assert((cdp.errors || []).length === 0, 'console errors: ' + JSON.stringify(cdp.errors));
    record('全流程无 console / page error', true);

    const totals = summary('checks');
    if (totals.failed) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (launched) await stopChrome(launched);
    if (server) server.close();
  }
}

main().catch((error) => {
  console.error('\nSMOKE ABORTED:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
