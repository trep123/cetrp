# 📝 个人笔记管理

一个简洁、专业的个人笔记管理静态页面，纯前端实现，无需服务器。

## ✨ 功能特性

- **Markdown 编辑** — 支持完整的 Markdown 语法，实时预览
- **三种视图模式** — 编辑 / 预览 / 分屏，灵活切换
- **笔记分类** — 工作、学习、生活、项目等分类管理
- **标签系统** — 为笔记添加标签，方便检索
- **置顶笔记** — 重要笔记一键置顶
- **全文搜索** — 按标题、内容、标签搜索
- **深色模式** — 支持浅色/深色主题，跟随系统偏好
- **自动保存** — 编辑时自动保存，无需手动操作
- **导出/导入** — JSON 格式导出备份，支持合并导入
- **响应式设计** — 适配桌面端和移动端
- **键盘快捷键** — `Ctrl+N` 新建，`Ctrl+S` 保存

## 🚀 使用方式

### 本地使用

直接在浏览器中打开 `index.html` 即可。

### 部署到 GitHub Pages

1. 将本仓库推送到 GitHub
2. 在仓库 Settings → Pages 中启用 GitHub Pages
3. 选择分支（如 `main`），保存即可

### 本地开发

```bash
# 克隆仓库
git clone <repo-url>
cd cetrp

# 使用任意 HTTP 服务器启动（可选）
# Python 3
python -m http.server 8080

# 或使用 Node.js
npx serve .
```

## 📁 项目结构

```
├── index.html          # 主页面
├── css/
│   └── style.css       # 样式表（含浅色/深色主题）
├── js/
│   └── app.js          # 应用逻辑
└── README.md
```

## 🛠 技术栈

- **HTML5** — 语义化结构
- **CSS3** — 自定义属性、Flexbox、过渡动画
- **Vanilla JavaScript** — ES6 Class、localStorage 持久化
- **[marked.js](https://marked.js.org/)** — Markdown 渲染（CDN 引入）

## 📦 数据存储

所有笔记数据存储在浏览器的 `localStorage` 中，不会上传到任何服务器。建议定期导出备份。

---

Made with ❤️ for personal note-taking.
