# Pixie Notes

仿 [Pixie](https://github.com/wangshengithub/pixie) 风格的**纯静态** GitHub Pages 笔记博客（HTML + CSS + JS，无构建、无后端、无在线编辑）。
笔记就是仓库 `notes/` 目录里的 Markdown 文件：在仓库里新增 / 修改 / 删除，push 后刷新页面即生效。

## 部署
1. 新建公开仓库（如 `notes`），把本目录全部文件（含 `.nojekyll`）放到仓库根目录。
2. Settings → Pages → Source：**Deploy from a branch**，`main` / `(root)`。
3. 改 `config.js`：作者名、副标题、项目列表、许可协议等。仓库名在 `用户名.github.io` 上自动识别。
4. 访问 `https://用户名.github.io/仓库名/`。

## 写笔记
```
notes/
  2026-10-01-hello.md      文件名带日期会自动识别日期
  前端/Vue/xxx.md           所在目录 = 分类（自动识别，多级目录 = 多级分类，分类页显示为目录树）
  assets/                  图片，正文里用相对路径 ![](assets/a.png)
  _draft.md                以 _ 开头 = 草稿，不显示
```
可选 front matter：
```yaml
---
title: 标题
date: 2026-10-01
tags: [标签1, 标签2]
description: 首页摘要
---
```
正文里写 `<!-- more -->` 可手动指定首页摘要。

## 功能
4 套主题 + 跟随系统（右上角切换，快捷键 `T`）· 粒子背景（移动端降配，随主题变色）· 双栏布局 · 发光卡片进场 · 头像翻转 · 标签云（带数量）· 目录树分类 · 本地全文搜索（`/` 或 `Ctrl/⌘+K`）·
文章目录（滚动高亮、可折叠）· 按主题配色的代码高亮 + 复制 + 折叠 · 提示框引用 · 标题锚点 · 字数 / 阅读时长 · 版权卡片 + 一键复制链接 ·
隐式 LLM 版权提示 · 归档 / 标签页 / 分页 · 404 · 返回顶部 · 移动端抽屉导航

## 主题
页面右上角（搜索栏右侧）的调色板按钮可切换主题，快捷键 `T` 依次切换（输入框中不触发）。选择保存在浏览器 localStorage（`pixie-theme`）。

| 主题 | id | 说明 |
| --- | --- | --- |
| 霓虹暗夜 | `neon` | 默认深色，深灰底 + 青 / 橙 |
| 纸白 | `light` | 浅色、高对比，无发光，适合长文 |
| 深海 | `ocean` | 深蓝底 + 青蓝 |
| 樱粉 | `sakura` | 米白 / 浅粉底 + 玫红 |
| 跟随系统 | `auto` | 系统浅色用 `light`，深色用 `neon` |

在 `config.js` 里可选配置（不写 = `auto` + 显示切换按钮，旧版 config.js 无需修改）：
```js
theme: {
  default: 'auto',   // 'auto' | 'neon' | 'light' | 'ocean' | 'sakura'：访客第一次打开时的主题
  switcher: true,    // false = 隐藏切换按钮，并始终使用 default
},
```
访客自己选过主题后以其选择为准；想让所有人强制看到某个主题，把 `switcher` 设为 `false`。
配色全部是 `css/style.css` 顶部各主题块里的 CSS 变量，改一处即可。

## 写作小技巧
- 提示框：`> **提示**：内容`、`> **注意**`、`> **重要**`、`> **说明**`，或 GitHub 写法 `> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!IMPORTANT]`。
- 表格在窄屏下可横向滚动；文章 h2–h4 悬停显示 `#` 锚点。

## 说明
- 不需要 Token，也不需要改任何 GitHub 权限（仓库需公开）。文件列表按顺序尝试：GitHub API（每位访客每小时 60 次，5 分钟内缓存）→ jsDelivr（无频率限制，但可能有几分钟到 12 小时的缓存延迟）→ `notes/index.json` → 浏览器本地缓存。
- `notes/index.json` 是可选的兜底：可在本地运行 `node scripts/build-index.mjs` 生成；`.github/workflows/build-index.yml` 也会在 push 时自动生成（不想用可直接删掉这个文件，不影响网站）。
- 笔记内容从 Pages 直接读取。Pages 部署约 30–60 秒，push 后稍等再刷新。
- 本地预览：`python3 -m http.server`，并在 `config.js` 填 `repo.owner` / `repo.name`，或维护 `notes/index.json`。
