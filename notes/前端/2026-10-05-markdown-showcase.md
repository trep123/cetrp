---
title: Markdown 样式一览
date: 2026-10-05
tags:
  - 工具
  - Markdown
---

这一篇用来展示正文样式：代码高亮、表格、引用、列表。

## 代码块

```javascript
// 代码块右上角可以复制，超过 5 行可以折叠
function fib(n) {
  if (n < 2) return n;
  let [a, b] = [0, 1];
  for (let i = 1; i < n; i++) [a, b] = [b, a + b];
  return b;
}
console.log(fib(10)); // 55
```

```bash
git add notes/new-note.md && git commit -m "新笔记" && git push
```

## 表格

| 功能 | 说明 |
| --- | --- |
| 本地搜索 | 标题 + 正文 + 标签 |
| 文章目录 | 滚动高亮，可折叠 |
| 复制链接 | 自动附带版权信息 |

## 引用与列表

> 静态站点的内容保护是个尴尬的命题。

1. 第一项
2. 第二项
   - 嵌套 `inline code`
- [x] 已完成
- [ ] 待办

### 小标题

链接到另一篇笔记：[你好，Pixie 笔记](../2026-10-01-hello-pixie.md)
