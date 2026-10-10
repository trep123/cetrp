/*
 * Pixie Notes —— 纯静态 GitHub Pages 笔记博客（只读）
 * 笔记 = 仓库 notes/ 目录下的 .md 文件。新增/修改/删除笔记：直接在仓库里提交，刷新即生效。
 * 文件列表：GitHub API（git trees，一次请求）→ 失败时回退 notes/index.json → 再回退本地缓存
 * 文件内容：直接从 Pages 静态地址读取，不消耗 API 配额
 */
(() => {
  'use strict';
  const C = Object.assign({ pageSize: 8, toc: true, readingTime: true, backToTop: true, copyLink: true, particles: true }, window.PIXIE_CONFIG || {});
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const encPath = p => p.split('/').map(encodeURIComponent).join('/');
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* ---------- 仓库识别 ---------- */
  const repo = Object.assign({ owner: '', name: '', branch: 'main', dir: 'notes' }, C.repo || {});
  (function detect() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return;
    repo.owner ||= m[1];
    if (!repo.name) {
      const seg = location.pathname.split('/').filter(Boolean)[0];
      repo.name = seg && !seg.includes('.') ? seg : `${m[1]}.github.io`;
    }
  })();
  repo.dir = (repo.dir || 'notes').replace(/^\/+|\/+$/g, '');
  const CACHE_KEY = `pixie.tree.${repo.owner}/${repo.name}/${repo.branch}/${repo.dir}`;

  let posts = [];               // 按日期倒序
  const bySlug = new Map();
  const tagMap = new Map();     // tag -> posts[]
  const catMap = new Map();     // '前端/Vue' -> posts[]（父分类包含子分类文章）
  let tocCleanup = null;

  /* ---------- 工具 ---------- */
  const unq = s => s.trim().replace(/^(['"])(.*)\1$/, '$2');
  function parseFrontMatter(raw) {
    const m = raw.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!m) return { meta: {}, body: raw.replace(/^\uFEFF/, '') };
    const meta = {};
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const li = line.match(/^\s*-\s+(.*)$/);
      if (li && key) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(unq(li[1])); continue; }
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      key = kv[1].toLowerCase();
      const v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) meta[key] = v.slice(1, -1).split(',').map(unq).filter(Boolean);
      else meta[key] = v === '' ? [] : unq(v);
    }
    return { meta, body: raw.slice(m[0].length) };
  }
  function toPlain(md) {
    return md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/[*_~`|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function countWords(plain) {
    const cjk = (plain.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = (plain.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length;
    return cjk + latin;
  }
  function fmtDate(d) {
    if (!d) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function makeExcerpt(body) {
    const more = body.split(/<!--\s*more\s*-->/i);
    if (more.length > 1) return more[0];
    const blocks = body.split(/\n\s*\n/);
    const out = [];
    let len = 0, inCode = false;
    for (const b of blocks) {
      const t = b.trim();
      if (!t) continue;
      const fences = (t.match(/^```/gm) || []).length;
      if (inCode || /^```/.test(t)) { if (fences % 2) inCode = !inCode; continue; }
      if (/^#{1,6}\s/.test(t) && out.length) break;
      if (/^(#{1,6}\s|!\[|\||<)/.test(t)) continue;
      out.push(t);
      len += toPlain(t).length;
      if (len > 160 || out.length >= 3) break;
    }
    return out.join('\n\n');
  }
  function buildPost(path, raw) {
    const { meta, body } = parseFrontMatter(raw);
    const rel = path.slice(repo.dir.length + 1);
    const file = rel.split('/').pop().replace(/\.md$/i, '');
    const fm = file.match(/^(\d{4}-\d{1,2}-\d{1,2})[-_](.+)$/);
    const h1 = body.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
    const title = (typeof meta.title === 'string' && meta.title) || (h1 && h1[1]) || (fm ? fm[2] : file);
    const dateStr = (typeof meta.date === 'string' && meta.date) || (fm && fm[1]) || '';
    let date = dateStr ? new Date(dateStr.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, mo, d) => `${y}/${mo}/${d}`)) : null;
    if (date && isNaN(date)) date = null;
    let tags = meta.tags ?? meta.tag ?? [];
    if (typeof tags === 'string') tags = tags.split(/[,，\s]+/);
    tags = [...new Set(tags.map(t => String(t).trim()).filter(Boolean))];
    const folder = rel.split('/').slice(0, -1).join('/');
    // 分类 = 所在目录（自动识别），notes/ 根目录下的文章不属于任何分类
    const category = folder ? folder.split('/') : [];
    // 正文首个 H1 与标题重复时去掉
    let content = body;
    if (h1 && h1[1] === title && body.trimStart().startsWith('#')) content = body.replace(h1[0], '');
    const plain = toPlain(content);
    return {
      path, rel, slug: rel.replace(/\.md$/i, ''), title, date, tags, category, content,
      excerpt: (typeof meta.description === 'string' && meta.description) || makeExcerpt(content),
      plain, words: countWords(plain),
    };
  }
  const postHref = p => '#/post/' + encPath(p.slug);
  const tagHref = t => '#/tag/' + encodeURIComponent(t);
  const catHref = k => '#/category/' + encPath(k);
  const catLink = p => p.category.length
    ? `<a class="post-cat" href="${catHref(p.category.join('/'))}"><i class="fa-solid fa-folder-open"></i>${p.category.map(esc).join(' / ')}</a>` : '';

  /* ---------- 加载 ---------- */
  // 公开仓库无需 Token：GitHub API（每 IP 每小时 60 次）→ jsDelivr（无频率限制）
  async function listViaGitHub() {
    const ref = repo.branch || 'HEAD';   // HEAD = 默认分支，main / master 都能识别
    const r = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (!r.ok) throw new Error('GitHub API ' + r.status);
    return (await r.json()).tree.filter(x => x.type === 'blob').map(x => x.path);
  }
  async function listViaJsDelivr() {
    for (const ref of repo.branch ? [repo.branch] : ['main', 'master']) {
      const r = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${repo.owner}/${repo.name}@${encodeURIComponent(ref)}?structure=flat`);
      if (r.ok) return (await r.json()).files.map(f => f.name.replace(/^\//, ''));
    }
    throw new Error('jsDelivr 失败');
  }
  async function listFiles() {
    const isNote = p => p.startsWith(repo.dir + '/') && /\.md$/i.test(p) &&
      !p.split('/').some(s => s.startsWith('_') || s.startsWith('.')) && !/\/readme\.md$/i.test(p);
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.t < 5 * 60 * 1000) return cached.paths;
    try {
      if (!repo.owner || !repo.name) throw new Error('未配置仓库');
      const paths = await listViaGitHub().catch(e => {
        console.warn('[pixie] GitHub API 失败，改用 jsDelivr', e);
        return listViaJsDelivr();
      }).then(list => list.filter(isNote));
      const v = JSON.stringify({ t: Date.now(), paths });
      sessionStorage.setItem(CACHE_KEY, v);
      localStorage.setItem(CACHE_KEY, v);
      return paths;
    } catch (e) {
      console.warn('[pixie] 在线列表失败，尝试 index.json', e);
      try {
        const r = await fetch(`${encPath(repo.dir)}/index.json?t=${Date.now()}`);
        if (!r.ok) throw new Error('index.json ' + r.status);
        const list = await r.json();
        return list.map(x => (typeof x === 'string' ? x : x.path)).map(p => (p.startsWith(repo.dir + '/') ? p : `${repo.dir}/${p}`)).filter(isNote);
      } catch (e2) {
        const old = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (old) return old.paths;
        throw new Error('无法获取笔记列表：' + e.message);
      }
    }
  }
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
    }));
    return out;
  }
  async function loadPosts() {
    const paths = await listFiles();
    const texts = await pool(paths, 8, p => fetch(encPath(p)).then(r => (r.ok ? r.text() : null)));
    posts = paths.map((p, i) => (texts[i] == null ? null : buildPost(p, texts[i]))).filter(Boolean);
    posts.sort((a, b) => (b.date || 0) - (a.date || 0) || a.title.localeCompare(b.title, 'zh'));
    bySlug.clear(); tagMap.clear(); catMap.clear();
    for (const p of posts) {
      bySlug.set(p.slug, p);
      for (const t of p.tags) { if (!tagMap.has(t)) tagMap.set(t, []); tagMap.get(t).push(p); }
      p.category.forEach((_, i) => {
        const k = p.category.slice(0, i + 1).join('/');
        if (!catMap.has(k)) catMap.set(k, []);
        catMap.get(k).push(p);
      });
    }
  }

  /* ---------- Markdown ---------- */
  function resolvePath(fromFile, rel) {
    if (!rel || /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(rel)) return null;
    try { return decodeURIComponent(new URL(rel, 'https://x.invalid/' + encPath(fromFile)).pathname.slice(1)); }
    catch { return null; }
  }
  function renderMd(el, md, post) {
    el.innerHTML = DOMPurify.sanitize(marked.parse(md));
    $$('img', el).forEach(img => {
      const p = resolvePath(post.path, img.getAttribute('src'));
      if (p != null) img.src = encPath(p);
      img.loading = 'lazy';
    });
    $$('a[href]', el).forEach(a => {
      const href = a.getAttribute('href');
      if (href.startsWith('#')) return;
      const p = resolvePath(post.path, href);
      if (p == null) { if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return; }
      const slug = p.slice(repo.dir.length + 1).replace(/\.md$/i, '');
      a.href = /\.md$/i.test(p) && bySlug.has(slug) ? postHref(bySlug.get(slug)) : encPath(p);
    });
  }
  function enhanceCode(el) {
    $$('pre > code', el).forEach(code => {
      const pre = code.parentElement;
      const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || '';
      if (window.hljs) {
        try {
          if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
          else if (!lang) { const r = hljs.highlightAuto(code.textContent); code.innerHTML = r.value; }
        } catch { /* ignore */ }
      }
      const lines = code.textContent.replace(/\n$/, '').split('\n').length;
      const box = document.createElement('div');
      box.className = 'code-block';
      box.innerHTML = `<div class="code-bar"><span class="dots"><span></span><span></span><span></span></span>
        <span class="lang">${esc(lang || 'code')}</span>
        ${lines >= 5 ? '<button class="fold-btn" type="button">折叠</button>' : ''}
        <button class="copy-btn" type="button">复制</button></div>`;
      pre.replaceWith(box);
      box.append(pre);
      $('.copy-btn', box).onclick = async e => {
        await copyText(code.textContent);
        e.target.textContent = '已复制';
        setTimeout(() => (e.target.textContent = '复制'), 1500);
      };
      const fold = $('.fold-btn', box);
      if (fold) fold.onclick = () => { fold.textContent = box.classList.toggle('folded') ? `展开 (${lines} 行)` : '折叠'; };
    });
  }

  /* ---------- 视图 ---------- */
  const content = () => $('#content');
  function tagChip(t, active) {
    const n = tagMap.get(t)?.length || 0;
    const ci = 1 + ([...t].reduce((s, c) => s + c.charCodeAt(0), 0) % 5);
    return `<a class="tag-chip c${ci}${active ? ' active' : ''}" href="${tagHref(t)}">${esc(t)}${n ? `<span class="num">${n}</span>` : ''}</a>`;
  }
  function excerptHtml(p) {
    const div = document.createElement('div');
    renderMd(div, p.excerpt || '', p);
    $$('pre', div).forEach(x => x.remove());
    return div.innerHTML;
  }
  function card(p) {
    return `<article class="post-card glow-in">
      <div class="post-head">
        <h2 class="post-title"><a href="${postHref(p)}">${esc(p.title)}</a></h2>
        ${p.date ? `<time class="post-date"><i class="fa-solid fa-calendar-days"></i>${fmtDate(p.date)}</time>` : ''}
      </div>
      <div class="post-excerpt markdown">${excerptHtml(p)}</div>
      <div class="post-foot">
        <div class="post-tags">${catLink(p)}${p.tags.map(t => tagChip(t)).join('')}</div>
        <a class="read-more" href="${postHref(p)}">阅读全文 &gt;&gt;</a>
      </div>
    </article>`;
  }
  function viewHome(page) {
    const size = Math.max(1, C.pageSize | 0);
    const total = Math.max(1, Math.ceil(posts.length / size));
    page = Math.min(Math.max(1, page || 1), total);
    if (!posts.length) {
      content().innerHTML = `<div class="post-card"><div class="empty-tip">还没有笔记。在仓库的 <code>${esc(repo.dir)}/</code> 目录里添加 .md 文件，push 后刷新即可。</div></div>`;
      return setTitle();
    }
    let html = posts.slice((page - 1) * size, page * size).map(card).join('');
    if (total > 1) {
      html += '<nav class="pager">';
      if (page > 1) html += `<a href="#/page/${page - 1}"><i class="fa-solid fa-angle-left"></i></a>`;
      for (let i = 1; i <= total; i++) html += i === page ? `<span class="cur">${i}</span>` : `<a href="#/page/${i}">${i}</a>`;
      if (page < total) html += `<a href="#/page/${page + 1}"><i class="fa-solid fa-angle-right"></i></a>`;
      html += '</nav>';
    }
    content().innerHTML = html;
    setTitle(page > 1 ? `第 ${page} 页` : '');
  }
  function archiveList(list) {
    let html = '', year = null;
    for (const p of list) {
      const y = p.date ? p.date.getFullYear() : '未注明日期';
      if (y !== year) { html += `${year !== null ? '</ul>' : ''}<h3 class="archive-year">${y}</h3><ul class="archive-list">`; year = y; }
      html += `<li><time>${p.date ? fmtDate(p.date).slice(5) : '--'}</time><a href="${postHref(p)}">${esc(p.title)}</a></li>`;
    }
    return html + (year !== null ? '</ul>' : '');
  }
  function viewArchives() {
    content().innerHTML = `<article class="post-card glow-in">
      <h2 class="page-title">所有文章</h2><p class="page-sub">共 ${posts.length} 篇</p>${archiveList(posts)}</article>`;
    setTitle('所有文章');
  }
  function viewTag(tag) {
    const list = tagMap.get(tag);
    if (!list) return viewNotFound();
    content().innerHTML = `<article class="post-card glow-in">
      <h2 class="page-title"><i class="fa-solid fa-tag"></i> ${esc(tag)}</h2><p class="page-sub">共 ${list.length} 篇</p>${archiveList(list)}</article>`;
    setTitle('标签：' + tag);
  }
  function viewCategories() {
    const root = buildTree();
    content().innerHTML = `<article class="post-card glow-in">
      <h2 class="page-title">分类</h2><p class="page-sub">${root.dirs.size} 个分类 · ${root.count} 篇文章</p>
      <div class="tree-box">${treeHtml(root) || '<p class="cat-empty">还没有文章</p>'}</div></article>`;
    setTitle('分类');
  }
  function viewCategory(key) {
    const list = catMap.get(key);
    if (!list) return viewNotFound();
    const parts = key.split('/');
    const crumbs = parts.map((c, i) => i === parts.length - 1 ? esc(c) : `<a href="${catHref(parts.slice(0, i + 1).join('/'))}">${esc(c)}</a>`).join(' / ');
    content().innerHTML = `<article class="post-card glow-in">
      <h2 class="page-title"><a href="#/categories">分类</a> / ${crumbs}</h2><p class="page-sub">共 ${list.length} 篇</p>
      <div class="tree-box">${treeHtml(findNode(buildTree(), key))}</div></article>`;
    setTitle('分类：' + parts.join(' / '));
  }
  function viewPost(slug) {
    const p = bySlug.get(slug);
    if (!p) return viewNotFound();
    const idx = posts.indexOf(p), newer = posts[idx - 1], older = posts[idx + 1];
    const minutes = Math.max(1, Math.round(p.words / 300));
    const url = location.href;
    content().innerHTML = `<div class="post-layout">
      <article class="post-card post-full glow-in">
        <h1 class="post-title">${esc(p.title)}</h1>
        <div class="post-meta">
          ${p.date ? `<span><i class="fa-solid fa-calendar-days"></i>${fmtDate(p.date)}</span>` : ''}
          ${C.readingTime ? `<span><i class="fa-solid fa-pen-nib"></i>${p.words.toLocaleString()} 字</span><span><i class="fa-regular fa-clock"></i>约 ${minutes} 分钟</span>` : ''}
          ${p.category.length ? `<span><i class="fa-solid fa-folder-open"></i>${p.category.map((c, i) => `<a href="${catHref(p.category.slice(0, i + 1).join('/'))}">${esc(c)}</a>`).join(' / ')}</span>` : ''}
          <span><i class="fa-brands fa-github"></i><a href="${repoFileUrl(p)}" target="_blank" rel="noopener">源文件</a></span>
        </div>
        ${p.tags.length ? `<div class="post-tags">${p.tags.map(t => tagChip(t)).join('')}</div>` : ''}
        <div class="post-body markdown" id="postBody"></div>
        <div class="copyright-card">
          <div><b>作者</b>${esc(C.author || repo.owner)}</div>
          <div><b>链接</b><a href="${esc(url)}">${esc(decodeURI(url))}</a></div>
          <div><b>许可</b>本文采用 ${esc(C.license || 'CC BY-NC-SA 4.0')} 许可协议，转载请注明出处。</div>
          ${C.copyLink ? '<button class="copy-link-btn" id="copyLink"><i class="fa-solid fa-link"></i> 复制链接</button>' : ''}
        </div>
        <nav class="post-nav">
          ${newer ? `<a href="${postHref(newer)}"><i class="fa-solid fa-angle-left"></i> ${esc(newer.title)}</a>` : '<span></span>'}
          ${older ? `<a href="${postHref(older)}">${esc(older.title)} <i class="fa-solid fa-angle-right"></i></a>` : '<span></span>'}
        </nav>
      </article>
    </div>`;
    const body = $('#postBody');
    renderMd(body, p.content, p);
    enhanceCode(body);
    if (C.toc) buildToc(body, $('.post-layout'));
    const btn = $('#copyLink');
    if (btn) btn.onclick = async () => {
      await copyText(fill(C.copyTemplate || '{title}\n{url}', { title: p.title, url: location.href }));
      toast('链接已复制（含版权信息）');
    };
    setTitle(p.title);
  }
  function viewNotFound() {
    content().innerHTML = `<div class="post-card nf glow-in"><h1>404</h1><p>这个页面迷失在粒子之间了…</p><a class="btn-neon" href="#/"><i class="fa-solid fa-house"></i> 返回首页</a></div>`;
    setTitle('404');
  }
  const repoFileUrl = p => `https://github.com/${repo.owner}/${repo.name}/blob/${encodeURIComponent(repo.branch)}/${encPath(p.path)}`;

  /* ---------- 目录 ---------- */
  function buildToc(body, layout) {
    const hs = $$('h2, h3, h4', body);
    if (hs.length < 2) return;
    const used = new Set();
    hs.forEach((h, i) => {
      let id = 'h-' + (h.textContent.trim().toLowerCase().replace(/[^\w\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '') || i);
      while (used.has(id)) id += '-' + i;
      used.add(id); h.id = id;
    });
    const toc = document.createElement('nav');
    toc.className = 'toc' + (innerWidth < 1280 ? ' collapsed' : '');
    toc.innerHTML = `<div class="toc-head"><span><i class="fa-solid fa-list-ul"></i> 目录</span><i class="fa-solid fa-chevron-down"></i></div>
      <ul class="toc-list">${hs.map(h => `<li class="lv${h.tagName[1]}"><a href="#" data-id="${h.id}">${esc(h.textContent)}</a></li>`).join('')}</ul>`;
    layout.classList.add('has-toc');
    if (innerWidth >= 1280) layout.append(toc); else layout.prepend(toc);
    $('.toc-head', toc).onclick = () => toc.classList.toggle('collapsed');
    toc.addEventListener('click', e => {
      const a = e.target.closest('a[data-id]');
      if (!a) return;
      e.preventDefault();
      document.getElementById(a.dataset.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const links = $$('a[data-id]', toc);
    const onScroll = () => {
      let cur = hs[0];
      for (const h of hs) { if (h.getBoundingClientRect().top < 120) cur = h; else break; }
      links.forEach(a => a.classList.toggle('active', a.dataset.id === cur.id));
      const act = links.find(a => a.classList.contains('active'));
      const list = $('.toc-list', toc);
      if (act && list.scrollHeight > list.clientHeight) list.scrollTop = act.offsetTop - list.clientHeight / 2;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    tocCleanup = () => removeEventListener('scroll', onScroll);
  }

  /* ---------- 搜索 ---------- */
  let sel = -1;
  function highlight(text, kws) {
    let h = esc(text);
    for (const k of kws) h = h.replace(new RegExp(reEsc(esc(k)), 'gi'), m => `<mark>${m}</mark>`);
    return h;
  }
  function doSearch() {
    const q = $('#searchInput').value.trim();
    const box = $('#searchResults');
    $('#searchBar').classList.toggle('has-text', !!q);
    sel = -1;
    if (!q) { box.classList.remove('open'); box.innerHTML = ''; return; }
    const kws = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const p of posts) {
      const title = p.title.toLowerCase(), text = p.plain.toLowerCase(), tags = p.tags.concat(p.category).join(' ').toLowerCase();
      if (!kws.every(k => title.includes(k) || text.includes(k) || tags.includes(k))) continue;
      const score = kws.reduce((s, k) => s + (title.includes(k) ? 10 : 0) + (tags.includes(k) ? 5 : 0) + (text.includes(k) ? 1 : 0), 0);
      const pos = Math.max(0, ...kws.map(k => text.indexOf(k)).filter(i => i >= 0).slice(0, 1));
      const start = Math.max(0, pos - 30);
      const snippet = (start > 0 ? '…' : '') + p.plain.slice(start, start + 110) + (p.plain.length > start + 110 ? '…' : '');
      hits.push({ p, score, snippet });
    }
    hits.sort((a, b) => b.score - a.score);
    box.innerHTML = hits.length
      ? hits.slice(0, 10).map(({ p, snippet }) => `<a class="sr-item" href="${postHref(p)}">
          <div class="sr-title">${highlight(p.title, kws)}</div>
          <div class="sr-excerpt">${highlight(snippet, kws)}</div>
          ${p.tags.length ? `<div class="sr-tags">/ ${p.tags.map(t => highlight(t, kws)).join(' / ')} /</div>` : ''}
        </a>`).join('')
      : '<div class="sr-empty">没有找到相关文章</div>';
    box.classList.add('open');
  }
  function clearSearch() {
    $('#searchInput').value = '';
    doSearch();
  }
  function initSearch() {
    const input = $('#searchInput');
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 120); });
    input.addEventListener('focus', () => { if (input.value.trim()) doSearch(); });
    input.addEventListener('keydown', e => {
      const items = $$('.sr-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((x, i) => x.classList.toggle('sel', i === sel));
        items[sel].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        const t = items[sel >= 0 ? sel : 0];
        if (t) { location.hash = t.getAttribute('href'); input.blur(); }
      } else if (e.key === 'Escape') { clearSearch(); input.blur(); }
    });
    $('#searchClear').onclick = () => { clearSearch(); input.focus(); };
    $('#searchResults').addEventListener('click', e => { if (e.target.closest('.sr-item')) { $('#searchResults').classList.remove('open'); input.blur(); } });
    document.addEventListener('click', e => { if (!e.target.closest('#searchBar')) $('#searchResults').classList.remove('open'); });
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); input.focus(); input.select();
      }
      if (e.key === 'Escape') closeDrawer();
    });
  }

  /* ---------- 侧栏 / 抽屉 ---------- */
  function renderSidebar() {
    const avatar = C.avatar || (repo.owner ? `https://github.com/${repo.owner}.png?size=280` : '');
    if (avatar) { $('#avatar').src = avatar; $('#favicon').href = avatar; }
    else $('.avatar').style.display = 'none';
    $('#authorName').textContent = C.author || repo.owner || 'Pixie';
    $('#subtitle').textContent = C.subtitle || '';
    $('#menu').innerHTML = (C.menu || []).map(m => `<a href="${esc(m.url)}">${esc(m.name)}</a>`).join('');
    renderTagCloud();
    const projects = C.projects || [];
    $('#projectsTitle').textContent = C.projectsTitle || '一些小玩意儿';
    $('#projects').innerHTML = projects.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a></li>`).join('');
    if (!projects.length) $('.projects-block').remove();
    const social = Object.assign({}, C.social);
    if (!social.github && repo.owner) social.github = `https://github.com/${repo.owner}`;
    const icons = { github: 'fa-brands fa-github', email: 'fa-solid fa-envelope', rss: 'fa-solid fa-rss', twitter: 'fa-brands fa-x-twitter',
      weibo: 'fa-brands fa-weibo', zhihu: 'fa-brands fa-zhihu', bilibili: 'fa-brands fa-bilibili', telegram: 'fa-brands fa-telegram' };
    $('#social').innerHTML = Object.entries(social).filter(([, u]) => u)
      .map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(k)}"><i class="${icons[k] || 'fa-solid fa-link'}"></i></a>`).join('');
    $('#footer').innerHTML = `© ${new Date().getFullYear()} ${esc(C.author || repo.owner)} · Theme inspired by <a href="https://github.com/wangshengithub/pixie" target="_blank" rel="noopener">Pixie</a>`;
    $('#llmPrompt').textContent = fill(C.llmPrompt || '', { url: location.origin + location.pathname });
  }
  // 目录树：按 notes/ 的真实目录结构生成，文件夹在前、文章在后
  function buildTree() {
    const root = { name: '', key: '', dirs: new Map(), files: [], count: 0 };
    for (const p of posts) {
      let node = root; root.count++;
      p.category.forEach((seg, i) => {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { name: seg, key: p.category.slice(0, i + 1).join('/'), dirs: new Map(), files: [], count: 0 });
        node = node.dirs.get(seg); node.count++;
      });
      node.files.push(p);
    }
    return root;
  }
  function findNode(root, key) {
    let node = root;
    for (const seg of key ? key.split('/') : []) { node = node.dirs.get(seg); if (!node) return null; }
    return node;
  }
  function treeHtml(node) {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const files = [...node.files].sort((a, b) => (b.date || 0) - (a.date || 0) || a.title.localeCompare(b.title, 'zh'));
    if (!dirs.length && !files.length) return '';
    return `<ul class="tree">${dirs.map(d => `<li class="tree-dir"><details open>
        <summary><i class="tree-caret fa-solid fa-chevron-right"></i><i class="fa-solid fa-folder tree-ico"></i>
          <a class="tree-name" href="${catHref(d.key)}">${esc(d.name)}</a><span class="cat-num">${d.count}</span></summary>
        ${treeHtml(d)}</details></li>`).join('')}${files.map(p => `<li class="tree-file">
        <a href="${postHref(p)}"><i class="fa-regular fa-file-lines tree-ico"></i><span class="tree-title">${esc(p.title)}</span>
        <span class="tree-date">${p.date ? fmtDate(p.date) : ''}</span></a></li>`).join('')}</ul>`;
  }
  function renderTagCloud(active) {
    const tags = [...tagMap.keys()].sort((a, b) => tagMap.get(b).length - tagMap.get(a).length || a.localeCompare(b, 'zh'));
    $('#tagCloud').innerHTML = tags.length ? tags.map(t => tagChip(t, t === active)).join('') : '<span style="color:#888;font-size:13px">暂无标签</span>';
    if (!tags.length && !C.projects?.length) $('#drawerBtn').style.display = 'none';
    // 抽屉内容 = 标签 + 项目
    $('#drawerBody').innerHTML = $$('#sidebar .side-block').map(b => b.outerHTML).join('');
  }
  function openDrawer() { document.body.classList.add('drawer-open'); $('#drawer').setAttribute('aria-hidden', 'false'); }
  function closeDrawer() { document.body.classList.remove('drawer-open'); $('#drawer').setAttribute('aria-hidden', 'true'); }

  /* ---------- 杂项 ---------- */
  function fill(tpl, vars) {
    const all = { author: C.author || repo.owner, site: C.title || '', license: C.license || '', ...vars };
    return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in all ? all[k] : m));
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function setTitle(sub) { document.title = sub ? `${sub} | ${C.title || C.author}` : (C.title || C.author || 'Notes'); }
  function animateCards() {
    const cards = $$('.glow-in');
    if (!('IntersectionObserver' in window)) return cards.forEach(c => c.classList.add('visible'));
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.style.animationDelay = `${Math.min(cards.indexOf(e.target), 4) * 80}ms`; e.target.classList.add('visible'); io.unobserve(e.target); }
    }), { threshold: 0.05 });
    cards.forEach(c => io.observe(c));
  }
  function markMenu() {
    const h = location.hash || '#/';
    $$('#menu a').forEach(a => {
      const u = a.getAttribute('href');
      a.classList.toggle('active', u === h || (u === '#/categories' && h.startsWith('#/category/')) || (u === '#/' && /^#\/(page\/\d+)?$/.test(h)) || (u === '#/' && h === ''));
    });
  }

  /* ---------- 路由 ---------- */
  function route() {
    tocCleanup?.(); tocCleanup = null;
    closeDrawer();
    $('#searchResults').classList.remove('open');
    const h = location.hash.replace(/^#/, '') || '/';
    let m, activeTag, activeCat;
    if (h === '/' || h === '') viewHome(1);
    else if ((m = h.match(/^\/page\/(\d+)$/))) viewHome(+m[1]);
    else if (h === '/archives') viewArchives();
    else if ((m = h.match(/^\/tag\/(.+)$/))) { activeTag = safeDecode(m[1]); viewTag(activeTag); }
    else if (h === '/categories') viewCategories();
    else if ((m = h.match(/^\/category\/(.+)$/))) { activeCat = m[1].split('/').map(safeDecode).join('/'); viewCategory(activeCat); }
    else if ((m = h.match(/^\/post\/(.+)$/))) viewPost(m[1].split('/').map(safeDecode).join('/'));
    else viewNotFound();
    renderTagCloud(activeTag);
    markMenu();
    animateCards();
    scrollTo({ top: 0, behavior: 'instant' });
  }
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

  /* ---------- 启动 ---------- */
  async function init() {
    marked.setOptions({ gfm: true, breaks: false });
    if (C.particles !== false && window.startParticles) startParticles($('#particles'));
    initSearch();
    $('#drawerBtn').onclick = openDrawer;
    $('#drawerClose').onclick = closeDrawer;
    $('#drawerMask').onclick = closeDrawer;
    $('#drawerBody').addEventListener('click', e => { if (e.target.closest('a')) closeDrawer(); });
    if (C.backToTop) {
      const bt = $('#backTop');
      addEventListener('scroll', () => bt.classList.toggle('show', scrollY > innerHeight), { passive: true });
      bt.onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
    } else $('#backTop').remove();
    renderSidebar();
    try {
      await loadPosts();
    } catch (e) {
      content().innerHTML = `<div class="post-card"><div class="empty-tip"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}<br>
        <small>请检查 config.js 里的 repo 配置；本地预览时需填写 owner 和 name。</small></div></div>`;
      return;
    }
    route();
    addEventListener('hashchange', route);
  }
  init();
})();
