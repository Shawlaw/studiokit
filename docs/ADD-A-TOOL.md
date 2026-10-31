# Add a Tool

## 方式 A：从模板新建

```powershell
python tools/new_tool.py --id my-tool --name "My Tool" --description "一句话说明" --icon "◇"
```

规则：

- `id` 必须是小写 kebab-case，例如 `rounded-image`。
- ID 同时决定 URL 和存储命名空间，发布后不要随意改名。
- 新建后注册表状态为 `draft`，不会被当成可用工具链接。

## 方式 B：接入现有单页 HTML

1. 先用脚手架创建目标目录，或手动建立 `apps/<id>/`。
2. 把完整单页 HTML 放到 `apps/<id>/index.html`。
3. 在 `<head>` 引入共享样式和导航脚本：

   ```html
   <link rel="stylesheet" href="../../shared/site.css" />
   <script src="../../shared/site-shell.js" defer></script>
   ```

4. 在 `<body>` 声明工具 ID 和标题：

   ```html
   <body data-studiokit-app="my-tool" data-studiokit-app-title="My Tool">
   ```

5. 检查相对资源路径。图片、字体、脚本和样式应放在该工具目录内或共享目录内；不要使用依赖当前工作目录的路径。
6. 检查原工具的本地存储键、配置格式和导入/导出行为；新工具必须使用 `studiokit:<tool-id>:` 命名空间。
7. 创建 `README.md` 和 `CHANGELOG.md`。
8. 在 `shared/tool-registry.json` 中把状态从 `draft` 改为 `available`，并设置 `href` 为 `./apps/<id>/`。

## 验收

- [ ] 门户卡片能打开工具。
- [ ] 工具页能返回 StudioKit 首页。
- [ ] GitHub Pages 子路径资源可加载。
- [ ] 桌面端与移动端布局可用。
- [ ] 核心功能、导入/导出、自动保存通过。
- [ ] 无未经批准的网络请求、埋点或第三方依赖。
- [ ] `python tools/validate_site.py` 通过。
- [ ] `python tools/build_site.py` 通过。
- [ ] 注册表状态、版本、文档一致。
