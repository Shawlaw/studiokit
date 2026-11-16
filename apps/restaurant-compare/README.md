# Venue Compare · 餐厅考察对比

把候选餐厅的费用、容量、环境与菜单资料收进一张地图和一张对比表；**离线编辑**，一键导出可转发的独立 HTML 展示页。

- Tool ID：`restaurant-compare`
- 入口：`apps/restaurant-compare/index.html`
- 当前版本：`0.1.0`
- 注册表状态：`draft`（等待 Owner 验收后再改为 `available`）

## 适合谁

- 聚餐 / 团建 / 婚礼等需要横向比较多家场地的场景。
- 资料散落在聊天记录、相册和地图截图里，需要一次性收拢并转发给决策人。
- 不希望把报价、菜单或场地照片上传到任何服务器。

## 功能

- **地图总览**：上传平面图或地图截图，选择餐厅编号后在图上点选位置；标记可拖动微调，支持缩放、平移、滚轮（Ctrl / ⌘）与全屏。
- **横向对比**：编号、名称、低消、定金、茶位费、服务费、停车、可坐人数、资料数量一表对比；窄屏自动切换为餐厅卡片。
- **双向联动**：点编号 / 名称 / 「定位」回到地图并脉冲高亮；点地图标记直接打开对应餐厅详情。
- **资料附件**：环境与菜单分别支持多份图片、视频和 PDF；图片可灯箱放大，PDF 以下载方式提供（避免浏览器拒绝渲染 `data:` PDF）。
- **自动保存**：修改后 550ms 防抖写入 IndexedDB，顶部实时显示保存状态；关闭页面前有未完成写入时会提示。
- **撤销 / 重做**：删除、移动标记、改编号、批量导入等操作均可 Ctrl+Z / Shift+Ctrl+Z。
- **导入 / 备份**：项目 JSON 双向导入导出；导入会先确认，且会过滤 `javascript:` 等非 `data:image|video|pdf` 附件。
- **独立展示页**：导出的 HTML 自包含地图、附件、样式与脚本，可离线打开；查看端没有编辑入口，也没有任何站点外链。
- **打印 / PDF**：专门的打印样式，隐藏操作区并把表格与地图排成适合归档的版式。
- **空状态**：没有数据时提供「新增第一家 / 载入示例 / 导入备份」，示例使用虚构餐厅与示意图，不会再自动写入真实存档。

## 数据与存储

- 数据库：IndexedDB `studiokit:restaurant-compare`，版本 1，object store `projects`，记录 key `current`。
- 记录结构：`{ schemaVersion: 2, savedAt, project }`；`project` 为 `{ schemaVersion: 2, title, updatedAt, restaurants, map }`。
- 字段：`restaurants[]` 为 `{ id, name, minimum, deposit, teaFee, serviceFee, parking, capacity, environment[], menu[] }`；附件为 `{ name, type, size, dataUrl }`。
- 地图：`map` 为 `{ name, type, size, dataUrl, markers[], view }`，`markers[]` 使用相对坐标 `x/y ∈ [0,1]`，因此更换同比例地图时可保留标注。
- 兼容：首次打开会尝试读取旧版 `restaurant-compare-editor` 的 `projects/current`（只读，不删除旧库），之后修改写入新库。不会在启动时自动保存示例数据。
- 所有数据只在本机浏览器；清除站点数据会丢失项目，请定期「备份项目 JSON」。

## 导入 / 导出格式

备份 JSON：

```json
{
  "app": "restaurant-compare",
  "version": "0.1.0",
  "exportedAt": "2026-11-16T01:00:00.000Z",
  "project": { "schemaVersion": 2, "restaurants": [], "map": null }
}
```

导入同时接受上述包装格式，或直接包含 `restaurants` / `map` 的项目对象。

导出的展示 HTML：

- 通过克隆当前文档、删除共享 shell / 编辑器节点、清空渲染结果后注入 `<script type="application/json" id="embeddedData">` 生成。
- 打开后 `body[data-view-only="true"]` 切换为只读模式，不加载 `shared/` 资源、不访问 IndexedDB。
- 生成前会校验外壳 / 外链是否清理干净；校验失败会明确报错，不会静默导出示例数据。

## 约束与已知限制

- 零 CDN、零远程字体、零埋点、零后端请求；导出的展示页同样自包含。
- 单个附件上限 40MB，地图图片上限 30MB；浏览器存储配额不足时保存会报错并提示先备份 / 清理附件。
- 附件以 base64 data URL 保存在 IndexedDB 与导出 HTML 中，体积约为原文件的 1.33 倍；超过 18MB 的导出会先确认。
- PDF 不内嵌渲染，只提供下载；视频可内嵌播放，但超大视频会显著增加项目体积。
- 地图双指缩放依赖浏览器的 pointer 事件与 `touch-action` 策略；在 1× 适配比例下优先保证页面可滚动，需要双指缩放时可先点「＋」或进入全屏。
- 真机（iOS / Android）触摸手感、超大项目（>100MB）和打印分页仍为 **UNVERIFIED**。

## 测试

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check tools/restaurant_compare_smoke.mjs
node tools/restaurant_compare_smoke.mjs
```

`restaurant_compare_smoke.mjs` 复用 `tools/lib/arcade_cdp.mjs`，覆盖：空状态、示例项目、详情 / 灯箱、标记放置 / 拖动、缩放、撤销 / 重做、改编号、附件上传、搜索筛选、320/375/390/430 布局、删除确认、JSON 导入与恶意附件过滤、独立 HTML 导出、只读查看端与打印样式，共 17 组检查。
