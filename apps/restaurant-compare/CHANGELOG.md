# Changelog · Venue Compare

## 0.1.0 — 2026-11-16

首个 StudioKit 接入版本（`draft`）。

- 将原 `restaurant_compare_editor_v3_map_interaction.html` 重做为 StudioKit 单页工具：共享 shell、响应式布局、空状态与示例项目。
- 修复原版的导出可靠性：不再依赖源码字面量替换，改为克隆文档 + JSON 注入 + 导出前校验；展示页彻底移除 shell、编辑器、外链与筛选残留。
- 修复原版恢复存档时可能用示例数据覆盖真实项目的问题：启动不自动落库，示例仅在明确操作时载入。
- 存储迁移到 `studiokit:restaurant-compare`，并提供旧库只读兼容读取。
- 重做交互：标注模式有明确横幅与 Esc 退出、地图标记点击进详情、表格 / 卡片与地图双向定位、删除与更换地图前确认、Ctrl+Z / Shift+Ctrl+Z 撤销重做、自动保存状态可见。
- 改善移动端：≤760px 使用餐厅卡片，触控目标 ≥40px，320/375/390/430px 无横向溢出；地图支持全屏。
- 资料处理：图片灯箱、视频内嵌播放、PDF 改为下载；过滤 `javascript:` 等非白名单附件；单文件 40MB / 地图 30MB 上限。
- 附带 `tools/restaurant_compare_smoke.mjs`，17 组无头 Chrome 检查覆盖编辑、导出与窄屏布局。
