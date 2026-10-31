# Flash Agent Prompt — Add a New Single-page Tool

目标：把一个现有单页 HTML 工具接入 StudioKit，不重写其业务功能。

1. 先阅读 `AGENTS.md`、`docs/ADD-A-TOOL.md` 和目标 HTML。
2. 先运行 `python tools/new_tool.py --id <slug> --name "<name>" --description "<description>"` 创建骨架。
3. 把原 HTML 的完整功能迁入 `apps/<slug>/index.html`。尽量保持原 CSS/JS、默认值、配置格式、导入导出和本地数据行为不变。
4. 只增加 StudioKit 共享 CSS/导航引用与 `body` 元数据；不得把工具改造成 iframe，也不得将其业务代码塞进门户。
5. 盘点外部依赖、网络请求、localStorage key、文件读取/下载、移动端交互和浏览器权限。
6. 新工具 localStorage 必须使用 `studiokit:<slug>:` 前缀；若接入工具已有用户数据，先制定兼容迁移，不要直接换 key。
7. 补充 README、CHANGELOG、必要测试；更新注册表版本和状态。
8. 在桌面和窄屏下验证；执行 `python tools/validate_site.py`、`python tools/build_site.py` 和可用的语法检查。
9. 输出功能对照表、兼容性结论、测试证据、剩余风险。未经 Owner 授权不得发布。
