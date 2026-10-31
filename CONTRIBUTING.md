# Contributing

## Development

- Python 3.10+（仅用于验证、构建和脚手架）。
- Node.js 20+ 可选（仅用于 JavaScript 语法检查）。
- 不需要 npm install。

```bash
python tools/validate_site.py
python tools/build_site.py
node --check shared/home.js
node --check shared/site-shell.js
```

## Commits

使用 Conventional Commits，例如：

- `feat(portal): add tool discovery filters`
- `feat(rounded-image): add corner radius controls`
- `fix(badge-studio): preserve legacy config import`
- `docs: clarify GitHub Pages setup`

## Pull requests

PR 应包含：目的、用户可见变化、测试证据、截图（若有 UI 变化）、数据/Schema 影响、回滚方式。不要把多个无关工具的重构混在一个 PR。
