# Venue Compare · 餐厅考察对比

把候选餐厅的费用、容量、环境与菜单资料收进**一张地图 + 一张对比表**；离线编辑，一键导出可转发的独立 HTML 展示页。

| | |
| --- | --- |
| Tool ID | `restaurant-compare` |
| 应用版本 | `0.2.0` |
| 注册表状态 | `available`（Owner 已验收，2026-11-16 双端发布） |
| 入口 | `apps/restaurant-compare/index.html` |
| 线上 | <https://shawlaw.github.io/studiokit/apps/restaurant-compare/> · <https://studiokit.pages.dev/apps/restaurant-compare/> |
| 数据 | IndexedDB `studiokit:restaurant-compare`（本项目 Schema `v3`）；无后端、无账号、无埋点 |

## 目录

- [适合谁](#适合谁)
- [功能](#功能)
- [数据模型与存储](#数据模型与存储)
- [导入 / 导出格式](#导入--导出格式)
- [操作与上限](#操作与上限)
- [测试](#测试)
- [约束与已知限制](#约束与已知限制)

## 适合谁

- 聚餐 / 团建 / 婚礼等需要横向比较多家场地的场景。
- 资料散落在聊天记录、相册与地图截图里，需要一次性收拢并转发给决策人。
- 不希望把报价、菜单或场地照片上传到任何服务器。

## 功能

- **地图总览**：上传平面图或地图截图，选中餐厅编号后在图上点选位置；标记可拖动微调，支持缩放（1×–8×，双击放大 1.6×）、平移（仅在放大或全屏时可平移，1× 下优先保证页面可滚动）与全屏；标记可用 `Enter` / `Space` 打开详情。
- **横向对比**：编号、名称、低消、定金、茶位费、服务费、停车、可坐人数、链接与资料数量一表对比；窄屏自动切换为餐厅卡片。
- **外部链接**：每家餐厅最多 12 个 `http(s)` 链接（大众点评、官网、小红书、地图等），每个链接可带 300 字以内的备注 / 分享文案；粘贴整段文案时自动提取链接并把原文留在备注里。详情面板、移动端卡片与导出页可直接点开；桌面表格的「链接」列显示数量，点开详情后跳转。
- **双向联动**：点编号 / 名称 /「定位」回到地图并脉冲高亮；点地图标记直接打开对应餐厅详情。
- **资料附件**：环境与菜单分别支持多份图片、视频和 PDF；图片可灯箱放大，PDF 以下载方式提供（避免浏览器拒绝渲染 `data:` PDF）。
- **搜索与筛选**：按名称 / 备注搜索，并按标注状态筛选（全部 / 已标注 / 未标注）。
- **进度与概览**：四步进度条（上传地图 → 录入餐厅 → 标注 → 导出）与概览卡片（候选餐厅数、地图标记数、资料附件数、项目体积）。
- **自动保存**：修改后 550ms 防抖写入 IndexedDB，顶部实时显示保存状态；关闭页面前有未完成写入时会提示。
- **撤销 / 重做**：删除、移动标记、改编号、批量导入、清空项目等操作均可 `Ctrl+Z` / `Shift+Ctrl+Z`；撤销栈默认 20 步，项目体积超过 24MB 时降为 3 步以控制内存。
- **导入 / 备份**：项目 JSON 双向导入导出；导入会先确认，并过滤 `javascript:` 等非 `data:image|video|pdf` 附件与非 `http(s)` 链接。
- **清空当前项目**：危险操作，二次确认后清空，并可在 toast 中撤销。
- **独立展示页**：导出的 HTML 自包含地图、附件、样式与脚本，可离线打开；查看端没有编辑入口，也没有任何站点脚本外链。餐厅外部链接仍指向原网站，点击时需要联网。
- **打印 / PDF**：专门的打印样式，隐藏操作区并把表格与地图排成适合归档的版式。
- **空状态**：没有数据时提供「新增第一家 / 载入示例 / 导入备份」。示例使用虚构餐厅与示意图；载入示例会先确认，并**立即写入当前存档**（可用撤销回退），启动时不会用示例覆盖已有存档。

## 数据模型与存储

- 数据库：IndexedDB `studiokit:restaurant-compare`，版本 1，object store `projects`，记录 key `current`。
- 记录结构：`{ schemaVersion: 3, savedAt, project }`；`project` 为 `{ schemaVersion: 3, title, updatedAt, restaurants, map }`。
- 餐厅：`{ id, name, minimum, deposit, teaFee, serviceFee, parking, capacity, environment[], menu[], links[] }`。
- 附件：`{ name, type, size, dataUrl }`，类型只接受 `data:image/*`、`data:video/*`、`application/pdf`；附件名截断到 180 字符。
- 链接：`{ label, url, note? }`，label ≤ 30 字符、note ≤ 300 字符，url 仅 `http(s)`（含凭据的 URL 会被拒绝）。
- 地图：`{ name, type, size, dataUrl, markers[], view }`；`markers[]` 用相对坐标表示，实际存储时夹取到 `0.005–0.995`，因此更换同比例地图时可保留标注；`view` 的缩放范围 1–8。
- 兼容：当新库为空时会尝试读取旧版 `restaurant-compare-editor` 的 `projects/current`（只读，不删除旧库，`indexedDB.databases()` 不可用时静默跳过），之后修改写入新库。0.1.0 的 Schema v2 项目读取后 `links` 默认为空数组，保存时升级为 v3。
- 所有数据只在本机浏览器；清除站点数据会丢失项目，请定期「备份项目 JSON」。

## 导入 / 导出格式

备份 JSON：

```json
{
  "app": "restaurant-compare",
  "version": "0.2.0",
  "exportedAt": "2026-11-16T01:00:00.000Z",
  "project": {
    "schemaVersion": 3,
    "title": "团建场地候选",
    "updatedAt": "2026-11-16T00:55:00.000Z",
    "restaurants": [],
    "map": null
  }
}
```

导入同时接受上述包装格式，或直接包含 `restaurants` / `map` 的项目对象。

导出的展示 HTML：

- 通过克隆当前文档、删除共享 shell 与编辑器节点、清空渲染结果后注入 `<script type="application/json" id="embeddedData">` 生成。
- 生成后会**校验**外壳与外链确实清理干净，校验失败会明确报错，不会静默导出示例数据。
- 打开后 `body[data-view-only="true"]` 切换为只读模式，不加载 `shared/` 资源、不访问 IndexedDB。

## 操作与上限

| 项 | 上限 / 规则 |
| --- | --- |
| 餐厅编号 | ≤ 12 字符、不允许空格、大小写不敏感唯一；导入时超长会被截断 |
| 外部链接 | 每餐厅 ≤ 12 个；label ≤ 30、url ≤ 1000、note ≤ 300 字符；仅 `http` / `https` |
| 单个附件 | ≤ 40 MB |
| 地图图片 | ≤ 30 MB |
| 单组资料份数 | ≤ 80 |
| 撤销栈 | 20 步（项目 > 24 MB 时 3 步） |
| 导出体积确认 | 预估体积（含 base64 换算与外壳开销）超过 18 MB 时先确认 |
| 地图缩放 | 1×–8×；双击放大 1.6× |

## 测试

需要本机 Chrome（可用 `CHROME_PATH` 覆盖路径）。脚本自带临时静态服务器与无头 Chrome，端口可用 `RC_SMOKE_PORT`（默认 8784）/ `RC_CDP_PORT`（默认 9344）覆盖，截图输出到 `test-artifacts/restaurant-compare/`。

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
node --check tools/restaurant_compare_smoke.mjs
node tools/restaurant_compare_smoke.mjs
```

`restaurant_compare_smoke.mjs` 复用 `tools/lib/arcade_cdp.mjs`，共 **19 组记录**（脚本内 `record()` 计数，summary 输出 `19/19 checks passed`；搜索与筛选是组内断言）。覆盖：门户可用卡片、空状态、示例项目、详情与灯箱、外部链接展示与编辑、分享文案提取与备注留存、`javascript:` 拦截、标记放置与拖动、缩放、撤销 / 重做、改编号、附件上传与移除、搜索筛选、320/375/390/430 布局、删除确认、JSON 导入与恶意附件 / 链接过滤、独立 HTML 导出、导出页外链新标签与窄屏卡片、只读查看端与打印样式、0 console error。

## 约束与已知限制

- 零 CDN、零远程字体、零埋点、零后端请求；打开项目不会请求任何外部链接，导出的展示页同样自包含。
- 附件以 base64 data URL 保存在 IndexedDB 与导出 HTML 中，体积约为原文件的 1.33 倍；浏览器存储配额不足时保存会报错并提示先备份 / 清理附件。
- PDF 不内嵌渲染，只提供下载；视频可内嵌播放，但超大视频会显著增加项目体积并压缩撤销栈。
- 外部链接只是保存的字符串：打开链接会离开当前页面并需要联网。
- 地图双指缩放依赖浏览器的 pointer 事件与 `touch-action` 策略；在 1× 适配比例下优先保证页面可滚动，需要双指缩放时可先点「＋」或进入全屏。
- 真机（iOS / Android）触摸手感、超大项目（> 100 MB）与打印分页仍为 **UNVERIFIED**。
