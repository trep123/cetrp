# Pixie Notes

仿 [Pixie](https://github.com/wangshengithub/pixie) 深色霓虹风格的**纯静态** GitHub Pages 笔记博客（HTML + CSS + JS，无构建、无后端、无在线编辑）。
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
  前端/xxx.md               子目录名会作为默认标签
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
粒子背景（移动端降配）· 双栏布局 · 发光卡片进场 · 头像翻转 · 标签云（带数量）· 本地全文搜索（`/` 或 `Ctrl/⌘+K`）·
文章目录（滚动高亮、可折叠）· Dracula 代码高亮 + 复制 + 折叠 · 字数 / 阅读时长 · 版权卡片 + 一键复制链接 ·
隐式 LLM 版权提示 · 归档 / 标签页 / 分页 · 404 · 返回顶部 · 移动端抽屉导航

## 说明
- 笔记列表通过 GitHub API 获取（每位访客每次打开 1 次请求，5 分钟内缓存）；API 不可用时回退到 `notes/index.json`（可选，手动维护的路径数组）。
- 笔记内容从 Pages 直接读取。Pages 部署约 30–60 秒，push 后稍等再刷新。
- 本地预览：`python3 -m http.server`，并在 `config.js` 填 `repo.owner` / `repo.name`，或维护 `notes/index.json`。
