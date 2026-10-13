/*
 * 思维导图（Markmap）
 * 1. 文章一键切换：把正文 h2–h6 标题生成可缩放、可折叠的导图，点节点跳回正文对应位置
 * 2. 代码块嵌入：笔记里写 ```markmap 代码块（标题 + 列表），渲染成导图
 * 依赖按需从 CDN 懒加载（d3 + markmap-view），不影响首屏。颜色跟随站点主题 CSS 变量。
 */
(function () {
  'use strict';
  const CDN = [
    'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    'https://cdn.jsdelivr.net/npm/markmap-view@0.18.12/dist/browser/index.js',
  ];
  let loading = null;
  const loadScript = src => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.async = false; s.onload = ok; s.onerror = () => fail(new Error('加载失败：' + src));
    document.head.append(s);
  });
  function load() {
    if (window.markmap && window.markmap.Markmap) return Promise.resolve(window.markmap);
    if (!loading) loading = CDN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
      .then(() => window.markmap).catch(e => { loading = null; throw e; });
    return loading;
  }

  /* ---------- 样式（带默认值，主站主题变量会覆盖） ---------- */
  const CSS = `
.mm-box{position:relative;height:min(72vh,680px);min-height:320px;margin:18px 0;border:1px solid var(--border,#ddd);border-radius:var(--radius-md,12px);background:var(--surface-2,#fafafa);overflow:hidden}
.mm-box.mm-inline{height:min(60vh,520px)}
.mm-box:fullscreen{height:100vh;border-radius:0;border:0}
.mm-box svg.markmap{display:block;width:100%;height:100%;
  --markmap-text-color:var(--text,#333);--markmap-a-color:var(--accent,#2563eb);--markmap-a-hover-color:var(--accent-3,var(--accent,#1d4ed8));
  --markmap-code-bg:var(--inline-code-bg,#f0f0f3);--markmap-code-color:var(--inline-code-text,#c7254e);
  --markmap-circle-open-bg:var(--surface-solid,#fff);--markmap-highlight-bg:var(--mark-bg,#ffeaa7);
  --markmap-font:400 15px/20px var(--font,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif)}
.mm-box .markmap-foreign{cursor:default}
.mm-box.mm-jump .markmap-foreign{cursor:pointer}
.mm-tools{position:absolute;top:10px;right:10px;z-index:2;display:flex;gap:6px}
.mm-tools button{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;font:13px/1.4 var(--font,sans-serif);color:var(--text-2,#555);background:var(--surface-solid,#fff);border:1px solid var(--border,#ddd);border-radius:8px;cursor:pointer}
.mm-tools button:hover{color:var(--accent,#2563eb);border-color:var(--accent,#2563eb)}
.mm-tip{position:absolute;left:12px;bottom:10px;z-index:2;font-size:12px;color:var(--muted,#999);pointer-events:none}
.mm-msg{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted,#999);font-size:14px}
.mm-toggle{cursor:pointer}
.mm-toggle.on{color:var(--accent,#2563eb)}
#postBody.mm-hidden{display:none}
@media (max-width:640px){.mm-box{height:62vh}.mm-tip{display:none}}`;
  function injectCss() {
    if (document.getElementById('mm-style')) return;
    const st = document.createElement('style'); st.id = 'mm-style'; st.textContent = CSS;
    document.head.append(st);
  }

  /* ---------- 解析 ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inline(md) {
    try {
      if (window.marked && marked.parseInline) {
        const html = marked.parseInline(md);
        return window.DOMPurify ? DOMPurify.sanitize(html) : html;
      }
    } catch (e) { /* 退回纯文本 */ }
    return esc(md);
  }
  // items: [{ level, content(HTML), payload? }]，level 越大越深；生成树
  function buildTree(items, rootTitle) {
    const root = { content: rootTitle ? esc(rootTitle) : '', children: [] };
    const stack = [{ level: 0, node: root }];
    for (const it of items) {
      const node = { content: it.content, children: [], payload: it.payload };
      while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level: it.level, node });
    }
    // 只有一个顶层节点且没有根标题 → 它就是根
    if (!rootTitle && root.children.length === 1) return root.children[0];
    if (!root.content) root.content = '思维导图';
    return root;
  }
  // markmap 代码块：支持 # 标题、- * + 1. 列表（按缩进分层）、续行
  function parseMarkdown(md, rootTitle) {
    const items = [];
    let base = 0, indents = [], last = null, inFence = false;
    const src = md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.replace(/\t/g, '  ');
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence || !line.trim()) continue;
      let m;
      if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/))) {
        base = m[1].length; indents = [];
        items.push(last = { level: base, content: inline(m[2]) });
      } else if ((m = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/))) {
        const ind = m[1].length;
        while (indents.length && ind < indents[indents.length - 1]) indents.pop();
        if (!indents.length || ind > indents[indents.length - 1]) indents.push(ind);
        const text = m[2].replace(/^\[( |x|X)\]\s+/, (_, c) => (c === ' ' ? '☐ ' : '☑ '));
        items.push(last = { level: base + indents.length, content: inline(text) });
      } else if (last) {
        last.content += '<br>' + inline(line.trim());
      } else {
        items.push(last = { level: base + 1, content: inline(line.trim()) });
      }
    }
    return items.length ? buildTree(items, rootTitle) : null;
  }
  // 由文章正文的 h2–h6 生成
  function fromHeadings(body, title) {
    const hs = Array.from(body.querySelectorAll('h2, h3, h4, h5, h6'));
    hs.forEach((h, i) => { if (!h.id) h.id = 'mm-h-' + i; });
    const items = hs.map(h => ({ level: +h.tagName[1] - 1, content: esc(h.dataset.text ?? h.textContent.trim()), payload: { id: h.id } }));
    return { count: hs.length, tree: buildTree(items, title || document.title) };
  }

  /* ---------- 渲染 ---------- */
  const narrow = () => (window.matchMedia ? matchMedia('(max-width: 640px)').matches : innerWidth <= 640);
  function makeBox(cls) {
    injectCss();
    const box = document.createElement('div');
    box.className = 'mm-box' + (cls ? ' ' + cls : '');
    box.innerHTML = '<div class="mm-msg">思维导图加载中…</div>';
    return box;
  }
  function render(box, tree, opt = {}) {
    return load().then(mk => {
      box.innerHTML = '';
      const tools = document.createElement('div');
      tools.className = 'mm-tools';
      const btn = (label, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.title = title; b.innerHTML = label; b.onclick = fn; tools.append(b); return b;
      };
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      box.append(svg, tools);
      const tip = document.createElement('div');
      tip.className = 'mm-tip';
      tip.textContent = opt.onJump ? '滚轮缩放 · 拖拽平移 · 点圆点折叠 · 点文字跳到正文' : '滚轮缩放 · 拖拽平移 · 点圆点折叠';
      box.append(tip);
      const mm = mk.Markmap.create(svg, {
        autoFit: true, duration: 300, maxWidth: narrow() ? 180 : 300, paddingX: 10,
        spacingHorizontal: narrow() ? 50 : 80, initialExpandLevel: opt.expandLevel ?? (narrow() ? 2 : 3),
      }, tree);
      let expanded = false;
      btn('<i class="fa-solid fa-up-right-and-down-left-from-center"></i>适应', '适应窗口', () => mm.fit());
      const allBtn = btn('<i class="fa-solid fa-sitemap"></i>全部展开', '展开 / 收起全部节点', () => {
        expanded = !expanded;
        const walk = n => { if (n.children && n.children.length && n.state && n.state.depth > 1) n.payload = { ...n.payload, fold: expanded ? 0 : 1 }; (n.children || []).forEach(walk); };
        walk(mm.state.data);
        mm.renderData().then(() => mm.fit());
        allBtn.innerHTML = expanded ? '<i class="fa-solid fa-sitemap"></i>收起' : '<i class="fa-solid fa-sitemap"></i>全部展开';
      });
      if (box.requestFullscreen) btn('<i class="fa-solid fa-expand"></i>全屏', '全屏', () => {
        if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen().then(() => setTimeout(() => mm.fit(), 120));
      });
      if (opt.onClose) btn('<i class="fa-solid fa-file-lines"></i>正文', '返回正文', opt.onClose);
      if (opt.onJump) {
        box.classList.add('mm-jump');
        svg.addEventListener('click', e => {
          const g = e.target.closest && e.target.closest('g.markmap-node');
          if (!g || e.target.closest('circle') || !window.d3) return;
          const d = d3.select(g).datum();
          if (d && d.payload && d.payload.id) opt.onJump(d.payload.id);
        });
      }
      document.addEventListener('fullscreenchange', () => setTimeout(() => mm.fit(), 120));
      return mm;
    }).catch(e => { box.innerHTML = `<div class="mm-msg">思维导图加载失败：${esc(e.message)}</div>`; });
  }

  // ```markmap 代码块 → 导图（进入视口时才加载渲染）
  function blocks(el) {
    const codes = Array.from(el.querySelectorAll('pre > code.language-markmap, pre > code.language-mindmap'));
    codes.forEach(code => {
      const tree = parseMarkdown(code.textContent);
      if (!tree) return;
      const box = makeBox('mm-inline');
      code.parentElement.replaceWith(box);
      const go = () => render(box, tree);
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' });
        io.observe(box);
      } else go();
    });
    return codes.length;
  }

  // 文章页：在 meta 栏加“思维导图”开关
  function attachToggle(body, meta, title) {
    if (!body || !meta) return;
    const { count, tree } = fromHeadings(body, title);
    if (count < 2) return;
    injectCss();
    const span = document.createElement('span');
    span.className = 'mm-toggle';
    span.innerHTML = '<i class="fa-solid fa-diagram-project"></i><a href="#" role="button">思维导图</a>';
    meta.append(span);
    let box = null, on = false;
    const toc = () => document.querySelector('.post-layout .toc');
    const set = v => {
      on = v;
      span.classList.toggle('on', on);
      span.querySelector('a').textContent = on ? '返回正文' : '思维导图';
      body.classList.toggle('mm-hidden', on);
      const t = toc(); if (t) t.style.display = on ? 'none' : '';
      if (on) {
        if (!box) {
          box = makeBox();
          body.before(box);
          render(box, tree, { onClose: () => set(false), onJump: id => { set(false); const h = document.getElementById(id); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
        } else box.style.display = '';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (box) box.style.display = 'none';
    };
    span.querySelector('a').addEventListener('click', e => { e.preventDefault(); set(!on); });
  }

  window.PixieMindmap = { load, parseMarkdown, fromHeadings, render, blocks, attachToggle };

  // 静态文章页（p/<id>/）自动初始化
  if (document.documentElement.dataset.mindmap === 'static') {
    const init = () => {
      const body = document.getElementById('postBody');
      if (!body) return;
      blocks(body);
      attachToggle(body, document.querySelector('article .meta'), (document.querySelector('article h1') || {}).textContent);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
