# __TOOL_NAME__

__TOOL_DESCRIPTION__

| | |
| --- | --- |
| Tool ID | `__TOOL_ID__` |
| 初始版本 | `__TOOL_VERSION__` |
| 注册表状态 | `draft`（完成验收后才改为 `available`） |
| 页面文件 | `apps/__TOOL_ID__/index.html` |
| 数据 | 仅在本机浏览器；命名空间 `studiokit:__TOOL_ID__:` |

## 功能

<!-- 用一句话说明这个工具解决什么问题，再逐条列出用户可用的能力。 -->

- 待实现。

## 数据与存储

- 存储键格式：`studiokit:__TOOL_ID__:<purpose>:v<version>`；一经发布不得擅自改名（改名需双读旧键并提供迁移）。
- 配置 Schema 与应用版本独立演进；本工具的 `CHANGELOG.md` 记录每一版的 Schema 变化。
- 提供 JSON 导入 / 导出，明确旧版本数据的兼容与升级路径。

## 在 StudioKit 中的位置

- 注册表条目：`shared/tool-registry.json` → `id: "__TOOL_ID__"`，入口 `./apps/__TOOL_ID__/`。
- 共享外壳：页面引用 `../../shared/site.css` 与 `../../shared/site-shell.js`，并在 `<body>` 上声明 `data-studiokit-app="__TOOL_ID__"` 与 `data-studiokit-app-title="__TOOL_NAME__"`。
- 不依赖 CDN、远程字体或后端服务，除非 Owner 明确批准；不引入 npm 或打包器。
- 子页面按实际深度调整相对路径（如 `apps/<id>/games/x.html` 用 `../../../shared/...`），并同样声明 `data-studiokit-app`。

## 本地运行

在仓库根目录执行（Windows 上若 `python` 指向 2.x 请用 `py -3`）：

```powershell
py -3 -m http.server 8000
```

访问 <http://localhost:8000/apps/__TOOL_ID__/>。

## 测试

```powershell
py -3 tools/validate_site.py
py -3 tools/build_site.py
```

有交互逻辑时补充无头浏览器测试（参考 `tools/arcade_smoke.mjs` 与 `tools/restaurant_compare_smoke.mjs` 的写法，复用 `tools/lib/arcade_cdp.mjs`），并覆盖 320 / 375 / 390 / 430px 四档窄屏。

## 已知边界

<!-- 如实写出未验证项（标 UNVERIFIED）、性能上限、浏览器限制与降级路径。 -->

- 待补充。

## 接入检查清单

- [ ] 门户卡片能打开工具，工具页能返回 StudioKit 首页。
- [ ] GitHub Pages 子路径与 Cloudflare Pages 根路径下资源都能加载（只用相对路径）。
- [ ] 桌面与 320 / 375 / 390 / 430px 窄屏布局均可用；有移动端特殊能力时说明降级路径。
- [ ] 核心功能、导入 / 导出、自动保存与旧数据兼容通过。
- [ ] 无未经批准的网络请求、埋点或第三方依赖。
- [ ] `py -3 tools/validate_site.py` 与 `py -3 tools/build_site.py` 通过。
- [ ] 本 README、`CHANGELOG.md`、注册表 `version` 与页面内版本常量一致。
- [ ] 完成以上验收后，才把注册表状态从 `draft` 改为 `available`。
