# 街机厅 Arcade

- Tool ID：`arcade`
- 初始版本：`0.1.0`
- 初始状态：`draft`

## 接入约定

- 保持单页 HTML，可独立加载。
- 使用 `../../shared/site.css` 与 `../../shared/site-shell.js` 获得 StudioKit 返回导航。
- 不依赖 CDN、远程字体或后端服务，除非 Owner 明确批准。
- 本地存储使用 `studiokit:arcade:...` 命名空间。
- 独立维护版本号、配置 Schema、README 与 CHANGELOG。
- 完成桌面/移动端检查、数据导入导出检查和 `python tools/validate_site.py` 后，才可将注册表状态改为 `available`。
