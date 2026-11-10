# Badge Studio · 同心圆徽章工作台

> 来源说明：本文件保留上游 v2.2.0 说明原文。本仓库当前集成版本为 **2.2.1**，基线事实以 [`BASELINE.md`](BASELINE.md) 为准。

一个不依赖构建工具或第三方 CDN 的纯前端单页网页工具。打开 `index.html` 即可编辑同心圆徽章；可部署在 GitHub Pages、任意静态 Web 服务器，也可本地使用。

**应用版本：2.2.0（上游）｜配置 Schema：v3**

## 功能

- 上半圆、下半圆、左侧 9 点、右侧 3 点、中心文字五区独立设置。
- 根据字符实际字宽计算弧长；上下弧线分别调节间距、字号、字体、粗细、颜色、半径与 X/Y 偏移。
- 下半圆朝向圆心时自动反序；文字环旋转与朝向模式可调。
- 支持控制点拖拽、语义磁吸、辅助线、撤销/重做。
- 每个方案独立设置阴影、金属感明暗渐变；新建、复制、重命名、删除多个方案。
- 并排对比、Overlay 叠加预览与透明度控制。
- 导出**透明背景 PNG**、SVG、可内嵌上传字体的 SVG；选中方案批量 ZIP 导出。
- 版本化 JSON 配置导入/导出（包括上传字体的备份），浏览器本地自动保存。

## 发布到 GitHub Pages（无需安装 Node.js）

1. 新建一个 GitHub 仓库，例如 `badge-studio`。
2. 把本目录的 `index.html`、`README.md`、`.nojekyll` 上传到仓库**根目录**。
3. 打开该仓库的 **Settings → Pages**。
4. 在 **Build and deployment → Source** 中选择 **Deploy from a branch**。
5. 选择 **main** 分支、**/(root)** 文件夹，点击 **Save**。
6. 等待 GitHub Pages 部署完成后，用 GitHub 提供的 Pages 地址访问，通常为：

   ```text
   https://<你的用户名>.github.io/badge-studio/
   ```

> 如果你的仓库名不同，请替换 URL 中的 `badge-studio`；如果仓库就是 `<用户名>.github.io`，则网页位于该域名根路径。GitHub Pages 站点可以公开访问，勿把私有配置、字体、隐私数据直接提交到公开仓库中。

GitHub 官方说明：[Configuring a publishing source for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 本地运行

直接双击 `index.html` 即可尝试使用。为了得到和 GitHub Pages 相同的浏览器存储行为，更推荐用本地 HTTP 服务：

```bash
python -m http.server 8000
```

然后在浏览器访问 `http://localhost:8000/`。

## 配置、备份与隐私

- 所有编辑计算与 PNG/SVG 导出都在浏览器内完成；没有项目自己的服务器端接口或账号系统，也不需要外部 CDN。
- 自动保存使用当前网站来源（origin）的浏览器本地存储。**本机 `file://`、`localhost` 和 GitHub Pages 的存储彼此独立**，不能自动同步。
- 准备换电脑、换浏览器或迁移网址时，先使用 **导出配置 JSON**，再到新网址使用 **导入配置 JSON**。
- JSON 备份可能包括你上传字体的 Base64 数据。请妥善保存，并确认有权使用和分发该字体。
- 浏览器本地存储有容量上限。大字体或大量方案可能导致自动保存失败；此时页面会提示，请优先导出 JSON。
- 配置 `schemaVersion: 3` 与 `appVersion: 2.2.0` 彼此独立。可导入历史 v1/v2/v3 配置；对于未来版本，工具尽量保留未知字段，但**不保证能够理解或完全呈现未来格式的新功能**。

## 编辑提示

- 左侧参数面板有内容 / 圆环 / 样式 / 吸附 / 效果 / 导出快捷导航，右侧是编辑预览、并排对比、Overlay 三种工作视图。
- 按下 `Ctrl/⌘ + Z` / `Ctrl + Y` 或 `Ctrl/⌘ + Shift + Z` 可以在非文本输入区域撤销/重做；输入框获得焦点时保留浏览器原生文字撤销。
- 控制点、辅助线和棋盘格**不会**进入正式导出文件。
- 为获得可比较的 Overlay 效果，建议使用相同画布尺寸和同样的导出基准。

## 已知边界

- SVG 中的文字默认仍是文本，并非真正的字体轮廓（`<path>`）。**内嵌字体 SVG** 仅尝试兼容你上传的字体，具体是否能在第三方 SVG 查看器/编辑器中正常使用，取决于该软件对嵌入字体的支持。
- 系统字体只有在运行设备上已安装时才能完全还原。跨设备一致性优先使用上传的自定义字体，或使用透明 PNG。
- PNG 的最大设定尺寸为 8000×8000；较大图片、批量导出和复杂投影会消耗更多内存，实际限制取决于浏览器及设备。
- 页面不提供云端账号、跨设备实时同步、多人协同。GitHub Pages 仅托管页面文件，**不会托管或自动收集你的编辑结果**。

## 文件结构

```text
badge-studio/
├── index.html    # 完整运行文件，CSS/JS 已内嵌
├── README.md     # 部署及使用说明
└── .nojekyll     # 让 GitHub Pages 跳过 Jekyll 处理
```

无需 npm、构建步骤、环境变量或后端服务。
