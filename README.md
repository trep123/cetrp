# Pixie Notes

仿 [Pixie](https://github.com/wangshengithub/pixie) 深色霓虹风格的**纯静态** GitHub Pages 笔记博客。

- 只有 HTML + CSS + JS：不用构建，没有后端，也没有在线编辑
- 笔记就是仓库 `notes/` 目录里的 Markdown 文件，push 后刷新页面就能看到
- 不需要 Token，也不用改 GitHub 权限（仓库要公开）

在线访问：<https://0x-z.cn>

---

## 目录结构

```text
.
├── index.html                       页面入口
├── config.js                        站点配置（只需要改这个文件）
├── CNAME                            自定义域名
├── .nojekyll                        关闭 Jekyll，保证 _ 开头的文件能正常访问
├── css/style.css                    样式
├── js/
│   ├── app.js                       主程序：读取笔记、渲染、路由、搜索
│   ├── particles.js                 粒子背景
│   └── utils.js
├── img/                             头像等图片
├── notes/                           笔记目录（目录 = 分类）
│   ├── index.json                   笔记列表兜底文件（自动生成，不用手动改）
│   ├── Linux/Debian/xxx.md
│   └── WinodwsServer/AD/xxx.md
├── scripts/build-index.mjs          生成 notes/index.json 的脚本
└── .github/workflows/build-index.yml  push 时自动运行上面的脚本
```

## 部署

1. 把全部文件（包括 `.nojekyll` 和 `.github/`）放到仓库根目录。
2. **Settings → Pages → Source** 选 **Deploy from a branch**，分支选 `main`，目录选 `/(root)`。
3. 修改 `config.js`：

   ```js
   repo: { owner: 'trep123', name: 'cetrp', branch: '', dir: 'notes' },
   ```

   > 使用 `用户名.github.io/仓库名` 访问时可以留空，程序会自动识别。
   > **使用自定义域名（CNAME）时必须手动填写**，否则读不到 GitHub 的文件列表。
   > `branch` 留空表示使用仓库的默认分支。

4. 自定义域名：在 `CNAME` 写入域名，并在 DNS 中添加 CNAME 记录指向 `trep123.github.io`。

## 写笔记

### 1. 放置文件

```text
notes/
├── 2026-10-01-hello.md            根目录：没有分类
├── Linux/
│   └── Debian/
│       └── 2026-10-10-postfix.md  分类：Linux / Debian
├── assets/                        图片，正文里用相对路径引用
└── _draft.md                      以 _ 开头：草稿，不显示
```

- **所在目录就是分类**，多级目录会自动变成多级分类，分类页显示为可折叠的目录树。
- 文件名带 `YYYY-MM-DD-` 前缀时，会自动识别为发布日期。
- 以 `_` 或 `.` 开头的文件和目录不会显示。

### 2. Front matter（可选）

```yaml
---
title: 文章标题
date: 2026-10-10
tags: [Linux, 邮件服务]
description: 首页显示的摘要
---
```

| 字段 | 说明 | 不写时 |
| --- | --- | --- |
| `title` | 标题 | 使用正文第一个 `# 标题`，再没有就用文件名 |
| `date` | 日期 | 使用文件名前缀的日期 |
| `tags` | 标签，列表或逗号分隔 | 没有标签 |
| `description` | 首页摘要 | 自动截取正文开头 |

在正文中写 `<!-- more -->`，可以手动指定首页摘要到哪里结束。

### 3. 发布

```bash
git add .
git commit -m "新增笔记"
git push
```

等 Pages 部署完成（约 30–60 秒）后刷新页面。

## 笔记列表是怎么读取的

GitHub Pages 不能列出目录，所以程序按下面的顺序获取 `notes/` 下有哪些文件，前一个失败才会用下一个：

1. **GitHub API**：最及时；每位访客每小时最多 60 次，结果缓存 5 分钟
2. **jsDelivr**：没有频率限制，但可能有几分钟到 12 小时的缓存延迟
3. **`notes/index.json`**：兜底文件
4. **浏览器本地缓存**：上次成功获取的列表

文章内容始终从 Pages 直接读取。

### 关于 notes/index.json

- 由 `.github/workflows/build-index.yml` 在 push 时自动生成并提交，**不需要手动维护**。
- 只有改动了 `notes/` 下的文件才会触发。第一次添加 workflow 后，可以在 **Actions → 更新笔记索引 → Run workflow** 手动运行一次。
- 也可以在本地生成：

  ```bash
  node scripts/build-index.mjs
  ```

- 不想用 Actions 可以删掉 workflow 文件，网站照样能用。

## 功能

| 类别 | 功能 |
| --- | --- |
| 外观 | 深色霓虹风格、粒子背景（移动端自动减少）、发光卡片、头像翻转 |
| 导航 | 主页、所有文章（归档）、分类（目录树）、标签云、分页、移动端抽屉菜单 |
| 阅读 | 文章目录（滚动高亮、可折叠）、字数与阅读时长、返回顶部 |
| 代码 | Dracula 风格高亮、一键复制、超过 5 行自动折叠 |
| 搜索 | 本地全文搜索标题、正文、标签和分类，按 `/` 或 `Ctrl/⌘ + K` 快速聚焦 |
| 其他 | 版权信息卡片、一键复制链接、404 页面 |
