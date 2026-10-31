# Changelog

## [0.1.0] - 2026-10-31

### Added
- 建立 StudioKit 静态多工具 Monorepo。
- 增加统一门户、工具注册表和工具页共享导航。
- 纳入 Badge Studio v2.2.0；发布前默认示例改为中性内容并升到 v2.2.1。
- 增加单页工具模板、新工具脚手架、站点校验与静态构建脚本。
- 增加 GitHub Pages Actions 部署流程与 Flash Agent 工作约定。

### Fixed
- 共享导航条注入后把实测高度写入 `--studiokit-shellbar-h` CSS 变量；Badge Studio 桌面端视口高度计算扣除该变量，消除 38px 垂直溢出。
- 工具注册表 planned 项版本号改为空字符串，避免门户卡片渲染出 "v—" 徽标。

### Notes
- Rounded Image 仅列入规划，当前版本不包含该工具实现。
