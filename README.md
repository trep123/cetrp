# GitHub Pages 笔记

纯前端（HTML + JS + CSS）笔记博客。所有笔记、图片、附件都存在**本仓库**里，GitHub Pages 负责展示。

## 部署
1. 新建公开仓库（例如 `notes`），把本目录所有文件（含 `.nojekyll`、`notes/`）放到仓库根目录。
2. 仓库 Settings → Pages → Source 选 **Deploy from a branch**，分支 `main`，目录 `/ (root)`。
3. 生成 Token：GitHub 头像 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Repository access 只选这个仓库 → Permissions → **Contents: Read and write**。
4. 打开 `https://<用户名>.github.io/<仓库名>/` → 设置 → 粘贴 Token → 保存。

## 存储结构
```
notes/
  index.json      笔记列表（标题、路径、更新时间），每次增删改自动更新
  *.md            笔记，支持子目录
  assets/         上传的图片和附件
```

## 说明
- 访客只读：直接从 Pages 读取静态文件，不消耗 API 配额。
- 编辑：通过 GitHub Contents API 提交 commit，每次保存产生 2 个 commit（笔记 + 索引）。
- Pages 部署约 30–60 秒，访客才能看到新内容；登录状态下读取走 API，立即可见。
- Token 只保存在浏览器 localStorage，别在公共电脑上登录。
- 如果直接在 GitHub 网页上改了笔记，登录后点「重建索引」同步列表。
