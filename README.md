# Pixie Notes

仿 [Pixie](https://github.com/wangshengithub/pixie) 风格的**纯静态** GitHub Pages 笔记博客（HTML + CSS + JS，无构建、无后端、无在线编辑）。
笔记就是仓库 `notes/` 目录里的 Markdown 文件：在仓库里新增 / 修改 / 删除，push 后刷新页面即生效。

## 部署
1. 新建公开仓库（如 `notes`），把本目录全部文件（含 `.nojekyll`）放到仓库根目录。
2. Settings → Pages → Source：**Deploy from a branch**，`main` / `(root)`。
3. 改 `config.js`：作者名、副标题、项目列表、许可协议等。仓库名在 `用户名.github.io` 上自动识别。
4. 访问 `https://用户名.github.io/仓库名/`。

## 手动添加笔记：文件放置与格式

### 目录结构（本仓库实际用法）
```
cetrp/
├── notes/                         ← 所有笔记都放这里（config.js 的 repo.dir）
│   ├── Linux/
│   │   ├── RedHat/2024-03-27-02-文件与目录管理.md
│   │   ├── Debian/…   Rocky/…
│   ├── Network/Huawei/02-ACL原理及应用.md
│   ├── WindowsServer/AD/2026-10-10-dsadd-user.md
│   ├── HCIA-AI/2026-10-13-HCIA-AI题库（含解析）.docx
│   └── index.json                 ← 自动生成，勿手改
├── img/                           ← 图片，按分类建子目录
│   ├── Cetrp.png                  ← 头像
│   └── network/1791719563615.png
├── home.md                        ← 首页介绍
└── p/  sitemap.xml  robots.txt    ← 自动生成，勿手改
```

### 放哪里 = 显示在哪里
| 规则 | 说明 |
| --- | --- |
| 所在目录 = 分类 | `notes/Linux/RedHat/x.md` 归到「Linux / RedHat」，多级目录 = 多级分类。直接放 `notes/` 根目录则无分类 |
| 新分类 | 新建文件夹即可，无需登记 |
| 支持的类型 | `.md` 笔记；`.pdf`、`.docx` 作为文档直接在线预览并可下载（标题取文件名） |
| 草稿 / 隐藏 | 文件名或文件夹以 `_` 或 `.` 开头不显示；各目录的 `README.md` 也不显示 |
| 生效 | push 到 `main` 后约 1–3 分钟（Actions 生成索引和静态页 → Pages 部署），刷新即可 |

### 文件命名
- 推荐 `YYYY-MM-DD-标题.md`，例如 `2026-10-13-Nginx反向代理.md`：日期自动识别，用于排序和显示。
- 也可以不带日期（如 `02-ACL原理及应用.md`），这时请在 front matter 写 `date`，否则文章没有日期、排在最后。
- 文件名可以用中文；同一分类内按序号开头（`01-`、`02-`）便于在仓库里排序。
- **文章链接由「目录 + 文件名」计算得出**：发布后改名或移动目录，旧链接会失效（变成另一篇的新链接），尽量一次定好。

### Markdown 笔记格式
```markdown
---
title: 分解实验02：ACL原理及应用
date: 2026-10-11 11:57
tags: [网络工程师, 华为, ACL]
description: 一句话摘要，显示在首页卡片和搜索引擎结果里。
---

# 02：ACL原理及应用

开头一两段作为摘要……

<!-- more -->

## 小标题一
正文……
```
| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 否 | 不写时依次取正文第一个 `# 标题` → 文件名 |
| `date` | 否 | `2026-10-11` 或 `2026-10-11 11:57`；不写时取文件名里的日期 |
| `tags` | 否 | `[a, b]` 或多行 `- a`；也可写成 `tag: a, b` |
| `description` | 否 | 首页摘要；不写时取 `<!-- more -->` 之前的内容，再不行取正文开头 |

- 文件用 **UTF-8** 编码。正文第一个 `#` 标题与 `title` 相同时会自动去重。
- 小标题用 `##`～`####`：会生成右侧目录；有 2 个以上小标题时可一键切换「思维导图」。

### 图片与附件
- 图片放 `img/<分类>/`（如 `img/network/`），正文里用**相对当前 md 文件的路径**引用。
  - 例：`notes/Network/Huawei/02-xx.md` 引用 `img/network/a.png` → `![](../../../img/network/a.png)`
  - 也可以在笔记同目录建 `assets/` 放图：`![](assets/a.png)`（`assets` 里的 md 以外文件不会被当成笔记）
- 文件名建议用英文或数字，避免空格。
- 在正文里链接仓库内的 `.pdf` / `.docx`，会以内嵌预览形式显示；链接其他 `.md` 笔记会自动变成站内链接。

### 首页 `home.md`
普通 Markdown，可用占位符：`{{stats}}` 统计、`{{categories}}` 分类、`{{recent}}` 最新 5 篇、`{{hot}}` 访问排行、`{{tags}}` 标签。

### 不要手动修改的文件
`notes/index.json`、`p/` 目录、`sitemap.xml`、`robots.txt`、`index.html` 里 `<!-- SEO:… -->` 之间的内容都由 `.github/workflows/build-index.yml` 在 push 后自动生成，手改会被覆盖。

### 添加一篇笔记的步骤
1. 在 `notes/<分类>/` 下新建 `YYYY-MM-DD-标题.md`（GitHub 网页上 Add file → Create new file，路径里输入 `Linux/Nginx/` 会自动建文件夹）。
2. 写 front matter 和正文；有图片的先把图片传到 `img/<分类>/`，再按相对路径引用。
3. Commit 到 `main`，等 1–3 分钟刷新站点。

## 功能
4 套主题 + 跟随系统（右上角切换，快捷键 `T`）· 粒子背景（移动端降配，随主题变色）· 双栏布局 · 发光卡片进场 · 头像翻转 · 标签云（带数量）· 目录树分类 · 本地全文搜索（`/` 或 `Ctrl/⌘+K`）·
文章目录（滚动高亮、可折叠）· 按主题配色的代码高亮 + 复制 + 折叠 · 提示框引用 · 标题锚点 · 字数 / 阅读时长 · 版权卡片 + 一键复制链接 ·
隐式 LLM 版权提示 · 归档 / 标签页 / 分页 · 404 · 返回顶部 · 移动端抽屉导航

## 思维导图
- **文章一键切换**：文章有 2 个以上小标题（h2–h6）时，信息栏会出现「思维导图」按钮，把标题层级变成可缩放、可折叠的导图；点节点文字跳回正文对应位置，支持全屏 / 全部展开。
- **代码块嵌入**：在笔记里写 `markmap` 代码块（用 `#` 标题和 `-` 列表按缩进分层），会直接渲染成导图：

````markdown
```markmap
# Linux 常用命令
## 文件
- ls
  - -l 详细信息
- cp / mv
## 进程
- ps
- top
```
````
- 依赖（d3 + markmap-view）只在用到时从 CDN 懒加载，颜色跟随当前主题；静态页 `p/<id>/` 同样支持。
- 不想要可在 `config.js` 加 `mindmap: false`。

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
