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
  const docCleanups = [];        // 文档预览器离开页面时的清理函数

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
  // PDF / Word 文档：不下载内容，标题和日期取自文件名（支持 2026-10-13-标题.pdf 这种日期前缀）
  const DOC_RE = /\.(pdf|docx)$/i;
  const NOTE_RE = /\.(md|pdf|docx)$/i;
  const DOC_INFO = { pdf: { name: 'PDF', icon: 'fa-regular fa-file-pdf' }, docx: { name: 'Word', icon: 'fa-regular fa-file-word' } };
  const docIco = p => p.kind ? `<i class="${DOC_INFO[p.kind].icon} doc-ico doc-${p.kind}" title="${DOC_INFO[p.kind].name} 文档"></i>` : '';
  function buildDocPost(path) {
    const rel = path.slice(repo.dir.length + 1);
    const name = rel.split('/').pop();
    const kind = name.split('.').pop().toLowerCase();
    const file = name.replace(/\.[^.]+$/, '');
    const fm = file.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[-_](.+)$/);
    let date = fm ? new Date(`${fm[1]}/${fm[2]}/${fm[3]}`) : null;
    if (date && isNaN(date)) date = null;
    const folder = rel.split('/').slice(0, -1).join('/');
    const title = fm ? fm[4] : file;
    return { path, rel, slug: rel, title, date, tags: [], category: folder ? folder.split('/') : [], content: '', kind,
      excerpt: '', plain: title, words: 0 };
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
  // 文章链接用路径哈希生成的短 ID（#/p/xxxxxxxxxx），不暴露中文目录/文件名；config 里 urlMode: 'path' 可恢复旧格式
  const byId = new Map();
  const hashId = (str, seed) => { let h = seed >>> 0; for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
  const makeId = slug => (hashId(slug, 0x811c9dc5).toString(36).padStart(7, '0') + hashId(slug, 0x9e3779b9).toString(36).padStart(7, '0')).slice(0, 10);
  const postHref = p => C.urlMode === 'path' ? '#/post/' + encPath(p.slug) : '#/p/' + p.id;
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
    const isNote = p => p.startsWith(repo.dir + '/') && NOTE_RE.test(p) &&
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
  // 首页介绍：仓库根目录的 home.md（config.js 里 home: '' 可关闭，也可改成其他路径）
  let homeMd = null;
  async function loadHome() {
    const file = C.home === undefined ? 'home.md' : C.home;
    if (!file) return;
    try {
      const r = await fetch(encPath(file), { cache: 'no-cache' });
      if (r.ok) homeMd = { path: file, body: parseFrontMatter(await r.text()).body };
    } catch { /* 没有 home.md 就不显示 */ }
  }
  async function loadPosts() {
    const paths = await listFiles();
    const texts = await pool(paths, 8, p => (DOC_RE.test(p) ? '' : fetch(encPath(p)).then(r => (r.ok ? r.text() : null))));
    posts = paths.map((p, i) => (texts[i] == null ? null : DOC_RE.test(p) ? buildDocPost(p) : buildPost(p, texts[i]))).filter(Boolean);
    posts.sort((a, b) => (b.date || 0) - (a.date || 0) || a.title.localeCompare(b.title, 'zh'));
    bySlug.clear(); byId.clear(); tagMap.clear(); catMap.clear();
    for (const p of posts) {
      bySlug.set(p.slug, p);
      let id = makeId(p.slug), n = 1;
      while (byId.has(id)) id = makeId(p.slug + '#' + n++);
      p.id = id; byId.set(id, p);
      for (const t of p.tags) { if (!tagMap.has(t)) tagMap.set(t, []); tagMap.get(t).push(p); }
      p.category.forEach((_, i) => {
        const k = p.category.slice(0, i + 1).join('/');
        if (!catMap.has(k)) catMap.set(k, []);
        catMap.get(k).push(p);
      });
    }
  }

  /* ---------- 访问次数（第三方计数服务 Abacus，无需 Token、无需后端） ---------- */
  // config.js: views: false 关闭；views: { namespace: 'xxx' } 自定义命名空间
  const VC = C.views === false ? null : Object.assign({
    api: 'https://abacus.jasoncameron.dev',
    namespace: (location.hostname || 'local').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40),
    ttl: 10 * 60 * 1000,              // 排行数据缓存 10 分钟，避免频繁请求
  }, typeof C.views === 'object' ? C.views : {});
  const views = new Map();            // slug -> 次数
  let viewsAt = 0, viewsLoading = null;
  const viewKey = slug => {           // FNV-1a，把任意路径转成合法的短 key
    let h = 0x811c9dc5;
    for (const ch of slug) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'p-' + h.toString(36);
  };
  const viewUrl = (act, slug) => `${VC.api}/${act}/${encodeURIComponent(VC.namespace)}/${viewKey(slug)}`;
  try {
    const c = JSON.parse(localStorage.getItem('pixie-views') || 'null');
    if (c && c.ns === VC?.namespace) { viewsAt = c.t; for (const [k, v] of Object.entries(c.d)) views.set(k, v); }
  } catch { /* ignore */ }
  const saveViews = () => { try { localStorage.setItem('pixie-views', JSON.stringify({ ns: VC.namespace, t: viewsAt, d: Object.fromEntries(views) })); } catch { /* ignore */ } };
  async function viewReq(act, slug) {
    const r = await fetch(viewUrl(act, slug));
    if (r.status === 404) return 0;   // 还没有人访问过
    if (!r.ok) throw new Error('views ' + r.status);
    return (await r.json()).value | 0;
  }
  // 读取所有文章的次数（用于排行），失败时保留已有缓存
  function loadAllViews(force) {
    if (!VC) return Promise.resolve();
    if (!force && Date.now() - viewsAt < VC.ttl && posts.every(p => views.has(p.slug))) return Promise.resolve();
    return viewsLoading ||= (async () => {
      let failed = false;
      await pool(posts, 4, async p => {
        if (failed) return;
        try { views.set(p.slug, await viewReq('get', p.slug)); } catch { failed = true; }
      });
      if (!failed) viewsAt = Date.now();
      saveViews();
    })().finally(() => { viewsLoading = null; });
  }
  // 打开文章：同一会话里同一篇只计一次
  async function countView(p) {
    if (!VC) return;
    const seenKey = 'pixie-seen:' + p.slug;
    let n;
    try {
      if (sessionStorage.getItem(seenKey)) n = await viewReq('get', p.slug);
      else { n = await viewReq('hit', p.slug); sessionStorage.setItem(seenKey, '1'); }
      views.set(p.slug, n); saveViews();
    } catch { n = views.get(p.slug); }
    const el = $('#postViews');
    if (el && el.dataset.slug === p.slug) el.textContent = n == null ? '—' : n.toLocaleString();
  }
  const viewsBadge = p => VC ? `<span class="post-views" data-slug="${esc(p.slug)}"><i class="fa-regular fa-eye"></i>${views.has(p.slug) ? views.get(p.slug).toLocaleString() : '—'}</span>` : '';
  function paintViews() {
    $$('.post-views[data-slug]').forEach(el => {
      const n = views.get(el.dataset.slug);
      if (n != null) el.lastChild.textContent = n.toLocaleString();
    });
    const hot = $('#homeHot');
    if (hot) hot.innerHTML = hotList();
  }
  function hotList() {
    const list = posts.filter(p => views.get(p.slug) > 0).sort((a, b) => views.get(b.slug) - views.get(a.slug)).slice(0, C.hotSize || 5);
    if (!list.length) return `<li class="home-hot-empty">${views.size ? '还没有访问记录' : '统计加载中…'}</li>`;
    return list.map((p, i) => `<li><span class="hot-rank r${i + 1}">${i + 1}</span><a href="${postHref(p)}">${esc(p.title)}</a><span class="hot-num"><i class="fa-regular fa-eye"></i>${views.get(p.slug).toLocaleString()}</span></li>`).join('');
  }

  /* ---------- Markdown ---------- */
  function resolvePath(fromFile, rel) {
    if (!rel || /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(rel)) return null;
    try { return decodeURIComponent(new URL(rel, 'https://x.invalid/' + encPath(fromFile)).pathname.slice(1)); }
    catch { return null; }
  }
  function renderMd(el, md, post, embed) {
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
      a.href = NOTE_RE.test(p) && bySlug.has(slug) ? postHref(bySlug.get(slug)) : encPath(p);
      if (DOC_RE.test(p)) a.dataset.doc = p;
    });
    if (embed) embedDocs(el);
    // 表格外包一层，窄屏可横向滚动
    $$('table', el).forEach(t => {
      if (t.parentElement.classList.contains('table-wrap')) return;
      const w = document.createElement('div'); w.className = 'table-wrap';
      t.replaceWith(w); w.append(t);
    });
    decorateCallouts(el);
  }
  // 提示框：> **提示** xxx / > **注意：** xxx / > [!NOTE] xxx
  const CALLOUTS = [
    [/^(提示|技巧|tip|hint|success)$/i, 'tip', 'fa-lightbulb'],
    [/^(注意|警告|warning|caution|attention)$/i, 'warn', 'fa-triangle-exclamation'],
    [/^(危险|错误|重要|danger|error|important)$/i, 'danger', 'fa-circle-exclamation'],
    [/^(说明|备注|信息|笔记|note|info)$/i, 'note', 'fa-circle-info'],
  ];
  function decorateCallouts(el) {
    $$('blockquote', el).forEach(bq => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      let label = '', kind = null;
      const gh = p.firstChild?.nodeType === 3 && p.firstChild.textContent.match(/^\s*\[!(\w+)\]\s*/);
      const strong = p.firstElementChild?.tagName === 'STRONG' && !p.firstChild.textContent.trim() ? p.firstElementChild
        : (p.firstChild === p.firstElementChild && p.firstElementChild?.tagName === 'STRONG' ? p.firstElementChild : null);
      if (gh) label = gh[1];
      else if (strong) label = strong.textContent.trim().replace(/[:：\s]+$/, '');
      else return;
      for (const [re, k] of CALLOUTS) if (re.test(label)) { kind = CALLOUTS.find(c => c[1] === k); break; }
      if (!kind) return;
      const names = { tip: '提示', warn: '注意', danger: '重要', note: '说明' };
      const title = document.createElement('div');
      title.className = 'callout-title';
      if (gh) {
        p.firstChild.textContent = p.firstChild.textContent.slice(gh[0].length);
        title.innerHTML = `<i class="fa-solid ${kind[2]}"></i><strong>${names[kind[1]]}</strong>`;
      } else {
        strong.remove();
        title.innerHTML = `<i class="fa-solid ${kind[2]}"></i><strong>${esc(label)}</strong>`;
        if (p.firstChild?.nodeType === 3) p.firstChild.textContent = p.firstChild.textContent.replace(/^[\s:：]+/, '');
        if (p.firstChild?.nodeName === 'BR') p.firstChild.remove();
      }
      if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
      bq.classList.add('callout', 'callout-' + kind[1]);
      bq.prepend(title);
    });
  }
  // 标题 id + hover 显示的 # 锚点
  function anchorHeadings(body) {
    const used = new Set();
    $$('h2, h3, h4', body).forEach((h, i) => {
      h.dataset.text = h.textContent.trim();
      let id = 'h-' + (h.dataset.text.toLowerCase().replace(/[^\w\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '') || i);
      while (used.has(id)) id += '-' + i;
      used.add(id); h.id = id;
      const a = document.createElement('a');
      a.className = 'h-anchor'; a.href = '#'; a.dataset.id = id; a.textContent = '#';
      a.setAttribute('aria-label', '定位到此标题');
      h.append(a);
    });
    body.addEventListener('click', e => {
      const a = e.target.closest('.h-anchor');
      if (!a) return;
      e.preventDefault();
      document.getElementById(a.dataset.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        <h2 class="post-title"><a href="${postHref(p)}">${docIco(p)}${esc(p.title)}</a></h2>
        <div class="post-side">
          ${p.date ? `<time class="post-date"><i class="fa-solid fa-calendar-days"></i>${fmtDate(p.date)}</time>` : ''}
          ${viewsBadge(p)}
        </div>
      </div>
      ${p.kind ? `<div class="doc-card-tip"><i class="${DOC_INFO[p.kind].icon}"></i>${DOC_INFO[p.kind].name} 文档 · 点击在线预览</div>` : `<div class="post-excerpt markdown">${excerptHtml(p)}</div>`}
      <div class="post-foot">
        <div class="post-tags">${catLink(p)}${p.tags.map(t => tagChip(t)).join('')}</div>
        <a class="read-more" href="${postHref(p)}">${p.kind ? '预览文档' : '阅读全文'} &gt;&gt;</a>
      </div>
    </article>`;
  }
  function homeBlocks() {
    const cats = [...catMap.keys()].filter(k => !k.includes('/'))
      .sort((a, b) => catMap.get(b).length - catMap.get(a).length || a.localeCompare(b, 'zh'));
    const latest = posts.find(p => p.date);
    const stat = (n, label, cls = '') => `<div class="home-stat${cls}"><b>${n}</b><span>${label}</span></div>`;
    return {
      stats: `<div class="home-stats">${stat(posts.length, '文章')}${stat(cats.length, '分类')}${stat(tagMap.size, '标签')}${latest ? stat(fmtDate(latest.date), '最近更新', ' is-date') : ''}</div>`,
      categories: cats.length ? `<div class="home-cats">${cats.map(k => `<a class="cat-item" href="${catHref(k)}"><i class="fa-solid fa-folder"></i>${esc(k)}<span class="num">${catMap.get(k).length}</span></a>`).join('')}</div>` : '',
      recent: `<ul class="archive-list home-recent">${posts.slice(0, 5).map(p => `<li><time>${p.date ? fmtDate(p.date) : '--'}</time><a href="${postHref(p)}">${docIco(p)}${esc(p.title)}</a></li>`).join('')}</ul>`,
      hot: VC ? `<ul class="home-hot" id="homeHot">${hotList()}</ul>` : '',
      tags: `<div class="home-tags">${[...tagMap.keys()].sort((a, b) => tagMap.get(b).length - tagMap.get(a).length).slice(0, 20).map(t => tagChip(t)).join('')}</div>`,
    };
  }
  function homeIntro() {
    if (!homeMd || !homeMd.body.trim()) return '';
    const div = document.createElement('div');
    renderMd(div, homeMd.body, { path: homeMd.path }, true);
    enhanceCode(div);
    const blocks = homeBlocks();
    // 占位符：{{stats}} {{categories}} {{recent}} {{tags}}
    let html = div.innerHTML.replace(/<p>\s*\{\{\s*(\w+)\s*\}\}\s*<\/p>|\{\{\s*(\w+)\s*\}\}/g,
      (m, a, b) => blocks[a || b] ?? m);
    return `<article class="post-card home-intro glow-in"><div class="markdown">${html}</div></article>`;
  }
  function viewHome(page) {
    const size = Math.max(1, C.pageSize | 0);
    const total = Math.max(1, Math.ceil(posts.length / size));
    page = Math.min(Math.max(1, page || 1), total);
    if (!posts.length) {
      content().innerHTML = `<div class="post-card"><div class="empty-tip">还没有笔记。在仓库的 <code>${esc(repo.dir)}/</code> 目录里添加 .md 文件，push 后刷新即可。</div></div>`;
      return setTitle();
    }
    let html = (page === 1 ? homeIntro() : '') + posts.slice((page - 1) * size, page * size).map(card).join('');
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
      html += `<li><time>${p.date ? fmtDate(p.date).slice(5) : '--'}</time><a href="${postHref(p)}">${docIco(p)}${esc(p.title)}</a></li>`;
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
        <h1 class="post-title">${docIco(p)}${esc(p.title)}</h1>
        <div class="post-meta">
          ${p.date ? `<span><i class="fa-solid fa-calendar-days"></i>${fmtDate(p.date)}</span>` : ''}
          ${VC ? `<span><i class="fa-regular fa-eye"></i><span id="postViews" data-slug="${esc(p.slug)}">${views.has(p.slug) ? views.get(p.slug).toLocaleString() : '—'}</span> 次阅读</span>` : ''}
          ${p.kind ? `<span><i class="${DOC_INFO[p.kind].icon}"></i>${DOC_INFO[p.kind].name} 文档</span><span><i class="fa-solid fa-download"></i><a href="${encPath(p.path)}" download>下载</a></span>` : ''}
          ${C.readingTime && !p.kind ? `<span><i class="fa-solid fa-pen-nib"></i>${p.words.toLocaleString()} 字</span><span><i class="fa-regular fa-clock"></i>约 ${minutes} 分钟</span>` : ''}
          ${p.category.length ? `<span><i class="fa-solid fa-folder-open"></i>${p.category.map((c, i) => `<a href="${catHref(p.category.slice(0, i + 1).join('/'))}">${esc(c)}</a>`).join(' / ')}</span>` : ''}
          <span><i class="fa-brands fa-github"></i><a href="${repoFileUrl(p)}" target="_blank" rel="noopener">源文件</a></span>
        </div>
        ${p.tags.length ? `<div class="post-tags">${p.tags.map(t => tagChip(t)).join('')}</div>` : ''}
        <div class="post-body ${p.kind ? 'doc-body' : 'markdown'}" id="postBody"></div>
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
    if (!p.kind) renderMd(body, p.content, p, true);
    if (p.kind) renderDoc(body, encPath(p.path), p.kind, p.title);
    else {
      enhanceCode(body);
      anchorHeadings(body);
      if (C.toc) buildToc(body, $('.post-layout'));
    }
    countView(p);
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
    const toc = document.createElement('nav');
    const wide = window.matchMedia ? matchMedia('(min-width: 1280px)').matches : innerWidth >= 1280;
    toc.className = 'toc' + (wide ? '' : ' collapsed');
    toc.innerHTML = `<div class="toc-head"><span><i class="fa-solid fa-list-ul"></i> 目录</span><i class="fa-solid fa-chevron-down"></i></div>
      <ul class="toc-list">${hs.map(h => `<li class="lv${h.tagName[1]}"><a href="#" data-id="${h.id}">${esc(h.dataset.text ?? h.textContent)}</a></li>`).join('')}</ul>`;
    layout.classList.add('has-toc');
    if (wide) layout.append(toc); else layout.prepend(toc);
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
    // 屏幕宽度跨过 1280px（旋转屏幕 / 拖动窗口）时，目录在侧边与顶部之间切换
    const mq = window.matchMedia ? matchMedia('(min-width: 1280px)') : null;
    const onMq = () => {
      if (!mq) return;
      if (mq.matches) { layout.append(toc); toc.classList.remove('collapsed'); }
      else { layout.prepend(toc); toc.classList.add('collapsed'); }
    };
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
    tocCleanup = () => {
      removeEventListener('scroll', onScroll);
      if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', onMq); else if (mq.removeListener) mq.removeListener(onMq); }
    };
  }

  /* ---------- PDF / Word 预览（PDF.js + docx-preview，按需从 CDN 加载） ---------- */
  // config.js 里 docCdn: { pdfjs, jszip, docx } 可换成自己的镜像地址
  const DOC_CDN = Object.assign({
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    docx: 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/dist/docx-preview.min.js',
  }, C.docCdn || {});
  const scriptCache = {};
  const loadScript = src => scriptCache[src] || (scriptCache[src] = new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = ok;
    s.onerror = () => { delete scriptCache[src]; s.remove(); no(new Error('脚本加载失败：' + src)); };
    document.head.appendChild(s);
  }));
  let pdfjsP = null;
  const loadPdfjs = () => pdfjsP || (pdfjsP = import(DOC_CDN.pdfjs + '/legacy/build/pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = DOC_CDN.pdfjs + '/legacy/build/pdf.worker.min.mjs';
    return m;
  }).catch(e => { pdfjsP = null; throw e; }));

  function docToolbar(url, title) {
    return `<div class="doc-toolbar">
      <div class="doc-tb-group">
        <button type="button" data-act="out" aria-label="缩小" title="缩小"><i class="fa-solid fa-minus"></i></button>
        <button type="button" data-act="fit" class="doc-zoom" title="适应宽度">100%</button>
        <button type="button" data-act="in" aria-label="放大" title="放大"><i class="fa-solid fa-plus"></i></button>
      </div>
      <div class="doc-tb-group doc-pageinfo"><input type="number" class="doc-page-input" min="1" value="1" aria-label="页码"><span class="doc-page-total">/ -</span></div>
      <div class="doc-tb-group">
        <a href="${url}" download title="下载" aria-label="下载"><i class="fa-solid fa-download"></i></a>
        <a href="${url}" target="_blank" rel="noopener" title="新窗口打开" aria-label="新窗口打开"><i class="fa-solid fa-up-right-from-square"></i></a>
      </div>
    </div>`;
  }
  function docError(el, url, e) {
    console.warn('[pixie] 文档预览失败', e);
    el.querySelector('.doc-stage')?.remove();
    el.insertAdjacentHTML('beforeend', `<div class="doc-msg"><i class="fa-solid fa-triangle-exclamation"></i> 预览失败：${esc(e.message || String(e))}<br>
      <a class="btn-neon" href="${url}" download><i class="fa-solid fa-download"></i> 下载文件</a></div>`);
  }
  // 通用：缩放、页码、跳页
  function docControls(el, { onZoom, pages, scroller }) {
    let zoom = 1;
    const zEl = $('.doc-zoom', el), input = $('.doc-page-input', el), total = $('.doc-page-total', el);
    const setZoom = z => { zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100)); zEl.textContent = Math.round(zoom * 100) + '%'; onZoom(zoom); };
    $('.doc-toolbar', el).addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'in') setZoom(zoom * 1.25);
      else if (b.dataset.act === 'out') setZoom(zoom / 1.25);
      else setZoom(1);
    });
    const list = () => pages();
    const refresh = () => {
      const ps = list();
      total.textContent = '/ ' + (ps.length || '-');
      input.max = ps.length || 1;
      if (!ps.length) return;
      let cur = 1;
      const mid = innerHeight * 0.35;
      ps.forEach((pg, i) => { if (pg.getBoundingClientRect().top < mid) cur = i + 1; });
      if (document.activeElement !== input) input.value = cur;
    };
    input.addEventListener('change', () => {
      const ps = list(), n = Math.min(ps.length, Math.max(1, input.value | 0));
      ps[n - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    addEventListener('scroll', refresh, { passive: true });
    scroller?.addEventListener('scroll', refresh, { passive: true });
    docCleanups.push(() => removeEventListener('scroll', refresh));
    return { refresh, get zoom() { return zoom; } };
  }

  async function renderPdf(el, url) {
    el.innerHTML = docToolbar(url) + '<div class="doc-stage pdf-stage"><div class="doc-loading"><i class="fa-solid fa-spinner fa-spin"></i> 正在加载 PDF…</div></div>';
    const stage = $('.doc-stage', el);
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ url, cMapUrl: DOC_CDN.pdfjs + '/cmaps/', cMapPacked: true, standardFontDataUrl: DOC_CDN.pdfjs + '/standard_fonts/' });
    let alive = true;
    docCleanups.push(() => { alive = false; task.destroy(); });
    task.onProgress = ({ loaded, total }) => {
      const l = $('.doc-loading', stage);
      if (l && total) l.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 正在加载 PDF… ${Math.round(loaded / total * 100)}%`;
    };
    const doc = await task.promise;
    if (!alive) return;
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    stage.innerHTML = '';
    const nodes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const d = document.createElement('div');
      d.className = 'pdf-page'; d.dataset.n = i;
      d.style.aspectRatio = `${first.width} / ${first.height}`;
      d.innerHTML = `<span class="pdf-page-no">${i}</span>`;
      stage.appendChild(d); nodes.push(d);
    }
    let zoom = 1, gen = 0;
    const draw = async d => {
      const g = gen;
      if (d.dataset.g === String(g)) return;
      d.dataset.g = g;
      const page = await doc.getPage(+d.dataset.n);
      if (!alive || g !== gen) return;
      const base = page.getViewport({ scale: 1 });
      d.style.aspectRatio = `${base.width} / ${base.height}`;
      const cssW = d.clientWidth || stage.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp = page.getViewport({ scale: cssW / base.width * dpr });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      try { await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch (e) { d.dataset.g = ''; return; }
      if (!alive || g !== gen) return;
      d.querySelector('canvas')?.remove();
      d.prepend(c);
    };
    const clear = d => { const c = d.querySelector('canvas'); if (c) { c.width = c.height = 0; c.remove(); } d.dataset.g = ''; };
    const io = new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? draw(e.target) : clear(e.target))), { root: null, rootMargin: '1200px 0px' });
    nodes.forEach(n => io.observe(n));
    docCleanups.push(() => io.disconnect());
    const ctl = docControls(el, {
      pages: () => nodes,
      scroller: stage,
      onZoom: z => {
        zoom = z; gen++;
        stage.style.setProperty('--pdf-zoom', z);
        stage.classList.toggle('zoomed', z > 1);
        nodes.forEach(n => { n.dataset.g = ''; io.unobserve(n); io.observe(n); });
      },
    });
    // 窗口宽度变化（旋转屏幕）时按新宽度重画
    let rw = stage.clientWidth, rt;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(stage.clientWidth - rw) > 20) { rw = stage.clientWidth; gen++; nodes.forEach(n => { n.dataset.g = ''; io.unobserve(n); io.observe(n); }); } }, 250); };
    addEventListener('resize', onResize);
    docCleanups.push(() => removeEventListener('resize', onResize));
    ctl.refresh();
  }

  async function renderDocx(el, url) {
    el.innerHTML = docToolbar(url) + '<div class="doc-stage docx-stage"><div class="doc-loading"><i class="fa-solid fa-spinner fa-spin"></i> 正在加载 Word 文档…</div></div>';
    const stage = $('.doc-stage', el);
    const [buf] = await Promise.all([
      fetch(url).then(r => { if (!r.ok) throw new Error('文件下载失败 ' + r.status); return r.arrayBuffer(); }),
      loadScript(DOC_CDN.jszip).then(() => loadScript(DOC_CDN.docx)),
    ]);
    if (!window.docx?.renderAsync) throw new Error('docx-preview 未加载');
    const box = document.createElement('div');
    box.className = 'docx-box';
    stage.innerHTML = ''; stage.appendChild(box);
    await window.docx.renderAsync(buf, box, box, {
      className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
      experimental: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
    });
    $$('a[href]', box).forEach(a => { if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; } });
    const wrap = $('.docx-wrapper', box) || box;
    const pages = () => $$('section.docx', wrap);
    let zoom = 1;
    const fit = () => {
      wrap.style.zoom = 1;
      const pw = Math.max(1, ...pages().map(s => s.offsetWidth));
      const avail = stage.clientWidth - (stage.clientWidth < 600 ? 12 : 40);
      const base = Math.min(1, avail / pw);
      wrap.style.zoom = String(base * zoom);
      stage.classList.toggle('zoomed', base * zoom * pw > stage.clientWidth);
    };
    const ctl = docControls(el, { pages, scroller: stage, onZoom: z => { zoom = z; fit(); } });
    fit();
    let rt;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(fit, 200); };
    addEventListener('resize', onResize);
    docCleanups.push(() => removeEventListener('resize', onResize));
    ctl.refresh();
  }

  function renderDoc(el, url, kind) {
    el.classList.add('doc-view');
    const run = kind === 'pdf' ? renderPdf : renderDocx;
    return run(el, url).catch(e => docError(el, url, e));
  }

  // Markdown 里指向 .pdf / .docx 的链接：在所在段落后面插入可折叠的预览框
  function embedDocs(el) {
    const after = new Map();
    $$('a[data-doc]', el).forEach(a => {
      const p = a.dataset.doc, kind = p.split('.').pop().toLowerCase();
      const block = a.closest('p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6') || a;
      const name = (a.textContent || '').trim() || p.split('/').pop();
      const det = document.createElement('details');
      det.className = 'doc-embed';
      det.innerHTML = `<summary><i class="${DOC_INFO[kind].icon} doc-${kind}"></i><span class="doc-embed-name">${esc(name)}</span><span class="doc-embed-hint">${DOC_INFO[kind].name} · 点击预览</span><i class="fa-solid fa-chevron-down doc-embed-caret"></i></summary><div class="doc-embed-body"></div>`;
      det.addEventListener('toggle', () => {
        if (det.open && !det.dataset.done) { det.dataset.done = '1'; renderDoc($('.doc-embed-body', det), encPath(p), kind); }
      });
      const ref = after.get(block) || block;
      if (block.tagName === 'TD' || block.tagName === 'TH') return;   // 表格里只保留链接，不插入预览
      ref.after(det); after.set(block, det);
    });
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
    return `<ul class="tree">${dirs.map(d => `<li class="tree-dir"><details>
        <summary><i class="tree-caret fa-solid fa-chevron-right"></i><i class="fa-solid fa-folder tree-ico"></i>
          <a class="tree-name" href="${catHref(d.key)}">${esc(d.name)}</a><span class="cat-num">${d.count}</span></summary>
        ${treeHtml(d)}</details></li>`).join('')}${files.map(p => `<li class="tree-file">
        <a href="${postHref(p)}"><i class="${p.kind ? DOC_INFO[p.kind].icon + ' doc-' + p.kind : 'fa-regular fa-file-lines'} tree-ico"></i><span class="tree-title">${esc(p.title)}</span>
        <span class="tree-date">${p.date ? fmtDate(p.date) : ''}</span></a></li>`).join('')}</ul>`;
  }
  function renderTagCloud(active) {
    const tags = [...tagMap.keys()].sort((a, b) => tagMap.get(b).length - tagMap.get(a).length || a.localeCompare(b, 'zh'));
    $('#tagCloud').innerHTML = tags.length ? tags.map(t => tagChip(t, t === active)).join('') : '<span style="color:var(--muted);font-size:13px">暂无标签</span>';
    if (!tags.length && !C.projects?.length) $('#drawerBtn').style.display = 'none';
    // 抽屉内容 = 标签 + 项目
    $('#drawerBody').innerHTML = $$('#sidebar .side-block').map(b => b.outerHTML).join('') + ($('#social')?.innerHTML ? `<div class="social drawer-social">${$('#social').innerHTML}</div>` : '');
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
    if (!('IntersectionObserver' in window)) return cards.forEach(c => c.classList.add('visible', 'done'));
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.style.animationDelay = `${Math.min(cards.indexOf(e.target), 4) * 80}ms`; e.target.classList.add('visible'); io.unobserve(e.target); }
    }), { threshold: 0 });  // 用 0：超长文章的可见比例可能低于 5%，用比例阈值会一直不触发，导致整篇文章透明不显示
    cards.forEach(c => {
      io.observe(c);
      // 入场动画结束后移除动画，让 hover 阴影 / 主题过渡正常生效
      c.addEventListener('animationend', e => { if (e.target === c) c.classList.add('done'); }, { once: false });
    });
    // 兜底：1.5 秒后仍未显示的卡片直接显示，避免动画失效时页面一片空白
    setTimeout(() => cards.forEach(c => c.classList.add('visible')), 1500);
  }
  function markMenu() {
    const h = location.hash || '#/';
    $$('#menu a, #mTab a[href]').forEach(a => {
      const u = a.getAttribute('href');
      a.classList.toggle('active', u === h || (u === '#/categories' && h.startsWith('#/category/')) || (u === '#/' && /^#\/(page\/\d+)?$/.test(h)) || (u === '#/' && h === ''));
    });
  }

  /* ---------- 路由 ---------- */
  function route() {
    tocCleanup?.(); tocCleanup = null;
    docCleanups.splice(0).forEach(f => { try { f(); } catch { /* 忽略 */ } });
    closeDrawer();
    $('#searchResults').classList.remove('open');
    closeMobileSheets();
    const h = location.hash.replace(/^#/, '') || '/';
    let m, activeTag, activeCat;
    if (h === '/' || h === '') viewHome(1);
    else if ((m = h.match(/^\/page\/(\d+)$/))) viewHome(+m[1]);
    else if (h === '/archives') viewArchives();
    else if ((m = h.match(/^\/tag\/(.+)$/))) { activeTag = safeDecode(m[1]); viewTag(activeTag); }
    else if (h === '/categories') viewCategories();
    else if ((m = h.match(/^\/category\/(.+)$/))) { activeCat = m[1].split('/').map(safeDecode).join('/'); viewCategory(activeCat); }
    else if ((m = h.match(/^\/p\/([0-9a-z]+)$/))) { const p = byId.get(m[1]); p ? viewPost(p.slug) : viewNotFound(); }
    else if ((m = h.match(/^\/post\/(.+)$/))) {
      const slug = m[1].split('/').map(safeDecode).join('/'), p = bySlug.get(slug);
      if (p && C.urlMode !== 'path') { history.replaceState(null, '', postHref(p)); viewPost(slug); }  // 旧链接自动换成短链接
      else viewPost(slug);
    }
    else viewNotFound();
    renderTagCloud(activeTag);
    markMenu();
    animateCards();
    if (VC && $('.post-views, #homeHot')) loadAllViews().then(paintViews);
    document.body.classList.toggle('is-post', /^#\/(p|post)\//.test(location.hash));
    document.body.classList.toggle('has-toc', !!$('#content .toc'));
    document.body.classList.remove('bar-hidden');
    updateProgress();
    scrollTo({ top: 0, behavior: 'instant' });
  }
  const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };

  /* ---------- 主题 ---------- */
  // 4 套主题 + 跟随系统；选择存 localStorage('pixie-theme')；首屏主题由 index.html <head> 内联脚本提前设置（防闪烁）
  const THEMES = [
    { id: 'neon', name: '霓虹暗夜', sw: ['#2b2b2d', '#1fd1b5'], meta: '#2b2b2d' },
    { id: 'light', name: '纸白', sw: ['#ffffff', '#0b7a6c'], meta: '#f3f4f6' },
    { id: 'ocean', name: '深海', sw: ['#0b1724', '#38bdf8'], meta: '#0b1724' },
    { id: 'sakura', name: '樱粉', sw: ['#fbf3f1', '#c2185b'], meta: '#fbf3f1' },
  ];
  const THEME_KEY = 'pixie-theme';
  const themeCfg = Object.assign({ default: 'auto', switcher: true }, typeof C.theme === 'string' ? { default: C.theme } : (C.theme || {}));
  const isTheme = t => THEMES.some(x => x.id === t);
  const sysLight = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  function themeMode() {
    let m = null;
    if (themeCfg.switcher !== false) { try { m = localStorage.getItem(THEME_KEY); } catch { /* ignore */ } }
    if (m !== 'auto' && !isTheme(m)) m = isTheme(themeCfg.default) ? themeCfg.default : 'auto';
    return m;
  }
  const resolveTheme = m => (m === 'auto' ? (sysLight && sysLight.matches ? 'light' : 'neon') : m);
  function applyTheme(mode, save) {
    if (mode !== 'auto' && !isTheme(mode)) mode = 'auto';
    if (save) { try { localStorage.setItem(THEME_KEY, mode); } catch { /* ignore */ } }
    const t = resolveTheme(mode), root = document.documentElement, prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', t);
    root.setAttribute('data-theme-mode', mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEMES.find(x => x.id === t).meta;
    $$('#themePanel .theme-opt').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    if (prev !== t) window.dispatchEvent(new CustomEvent('pixie:themechange', { detail: { theme: t, mode } }));
  }
  function initTheme() {
    applyTheme(themeMode(), false);
    sysLight?.addEventListener?.('change', () => { if (themeMode() === 'auto') applyTheme('auto', false); });
    const wrap = $('#themeSwitch'), btn = $('#themeBtn'), panel = $('#themePanel');
    if (!wrap || !btn || !panel) return;
    if (themeCfg.switcher === false) { wrap.remove(); return; }
    panel.innerHTML = '<div class="theme-panel-title">主题</div>' +
      THEMES.map(t => `<button type="button" class="theme-opt" role="menuitemradio" data-mode="${t.id}">
        <span class="sw" style="--sw-a:${t.sw[0]};--sw-b:${t.sw[1]}"></span><span class="name">${t.name}</span><i class="fa-solid fa-check check"></i></button>`).join('') +
      `<div class="theme-sep"></div><button type="button" class="theme-opt" role="menuitemradio" data-mode="auto">
        <span class="sw auto"><i class="fa-solid fa-circle-half-stroke"></i></span><span class="name">跟随系统 <span class="sub">浅色→纸白 · 深色→霓虹</span></span><i class="fa-solid fa-check check"></i></button>
      <div class="theme-hint">按 <kbd>T</kbd> 快速切换</div>`;
    applyTheme(themeMode(), false);
    const open = v => { panel.classList.toggle('open', v); btn.setAttribute('aria-expanded', String(v)); };
    btn.addEventListener('click', e => { e.stopPropagation(); open(!panel.classList.contains('open')); });
    panel.addEventListener('click', e => {
      const o = e.target.closest('.theme-opt');
      if (!o) return;
      applyTheme(o.dataset.mode, true);
      open(false);
    });
    document.addEventListener('click', e => { if (!e.target.closest('#themeSwitch')) open(false); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') return open(false);
      const ae = document.activeElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName) || ae?.isContentEditable;
      if (typing || e.ctrlKey || e.metaKey || e.altKey || e.repeat || (e.key !== 't' && e.key !== 'T')) return;
      const cur = THEMES.findIndex(x => x.id === document.documentElement.getAttribute('data-theme'));
      const next = THEMES[(cur + 1) % THEMES.length];
      applyTheme(next.id, true);
      toast(`主题：${next.name}`);
    });
  }

  /* ---------- 移动端专属排版（≤900px）：顶部应用栏 + 底部标签栏 + 目录抽屉 + 全屏搜索 ---------- */
  const mobileMq = window.matchMedia ? matchMedia('(max-width: 900px)') : { matches: innerWidth <= 900 };
  function closeMobileSheets() { document.body.classList.remove('m-search', 'toc-open'); }
  function updateProgress() {
    const bar = $('#mProgress');
    if (!bar) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${document.body.classList.contains('is-post') && max > 0 ? Math.min(1, scrollY / max) : 0})`;
  }
  function initMobileLayout() {
    const icon = u => ({ '#/': 'fa-house', '#/archives': 'fa-box-archive', '#/categories': 'fa-folder-tree' })[u] || (/^https?:/.test(u) ? 'fa-up-right-from-square' : 'fa-bookmark');
    const avatar = $('#avatar').getAttribute('src');
    // 顶部应用栏
    const bar = document.createElement('header');
    bar.id = 'mBar'; bar.className = 'm-bar';
    bar.innerHTML = `<a href="#/" class="m-brand">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}<span>${esc(C.title || C.author || repo.owner || 'Notes')}</span></a>
      <button type="button" class="m-icon" id="mSearchBtn" aria-label="搜索"><i class="fa-solid fa-magnifying-glass"></i></button>
      <div class="m-theme-slot"></div><div class="m-progress" id="mProgress"></div>`;
    document.body.prepend(bar);
    // 底部标签栏：config.menu 前 4 项 + 标签
    const tab = document.createElement('nav');
    tab.id = 'mTab'; tab.className = 'm-tab';
    const items = (C.menu || []).slice(0, 4).map(m => `<a href="${esc(m.url)}"${/^https?:/.test(m.url) ? ' target="_blank" rel="noopener"' : ''}><i class="fa-solid ${icon(m.url)}"></i><span>${esc(m.name)}</span></a>`);
    if (tagMap.size || C.projects?.length) items.push('<button type="button" id="mTagBtn"><i class="fa-solid fa-tags"></i><span>标签</span></button>');
    tab.innerHTML = items.join('');
    tab.style.setProperty('--n', items.length);
    document.body.appendChild(tab);
    $('#mTagBtn')?.addEventListener('click', openDrawer);
    // 目录按钮 + 遮罩
    const tocBtn = document.createElement('button');
    tocBtn.id = 'mTocBtn'; tocBtn.className = 'm-toc-btn'; tocBtn.type = 'button'; tocBtn.setAttribute('aria-label', '目录');
    tocBtn.innerHTML = '<i class="fa-solid fa-list-ul"></i>';
    const mask = document.createElement('div'); mask.className = 'm-mask'; mask.id = 'mMask';
    document.body.append(tocBtn, mask);
    tocBtn.onclick = () => document.body.classList.toggle('toc-open');
    mask.onclick = closeMobileSheets;
    document.addEventListener('click', e => { if (e.target.closest('.toc a[data-id]') && mobileMq.matches) document.body.classList.remove('toc-open'); });
    // 全屏搜索
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'm-search-cancel'; cancel.textContent = '取消';
    $('#searchBar').after(cancel);
    $('#mSearchBtn').onclick = () => { document.body.classList.add('m-search'); setTimeout(() => $('#searchInput').focus(), 50); };
    cancel.onclick = () => { closeMobileSheets(); $('#searchInput').blur(); };
    // 主题按钮：手机上移到应用栏，电脑上放回搜索栏旁
    const sw = $('#themeSwitch'), home = $('.top-bar');
    const place = () => {
      if (!sw) return;
      if (mobileMq.matches) $('.m-theme-slot', bar).appendChild(sw); else home.appendChild(sw);
      if (!mobileMq.matches) closeMobileSheets();
    };
    place();
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', place); else if (mobileMq.addListener) mobileMq.addListener(place);
    // 下滑隐藏应用栏，上滑显示；阅读进度条
    let lastY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY, b = document.body;
      if (mobileMq.matches && !b.classList.contains('m-search') && !b.classList.contains('toc-open')) {
        if (y > lastY + 6 && y > 120) b.classList.add('bar-hidden');
        else if (y < lastY - 6 || y < 60) b.classList.remove('bar-hidden');
      }
      lastY = y;
      updateProgress();
    }, { passive: true });
    addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileSheets(); });
  }

  /* ---------- 启动 ---------- */
  /* ---------- 移动端：禁止缩放 + 图片查看 + 溢出调试 ---------- */
  // config 里 zoom: true 可恢复手势缩放
  function initMobile() {
    if (C.zoom !== true) {
      // iOS Safari 会忽略 user-scalable=no，这里用手势事件拦截双指缩放和双击放大
      ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
      document.addEventListener('touchmove', e => { if (e.touches.length > 1 && !e.target.closest('.img-viewer')) e.preventDefault(); }, { passive: false });
      // 双击放大由 CSS touch-action: manipulation 关闭，不拦截 touchend，以免吞掉快速连点
      // Ctrl + 滚轮 / Ctrl + +/- 是电脑端的主动缩放，保留不拦截（属于浏览器无障碍功能）
    } else {
      const vp = document.querySelector('meta[name=viewport]');
      if (vp) vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    }
    // 点击正文图片查看大图；大图再点一次切换原始尺寸，点空白处关闭
    const viewer = document.createElement('div');
    viewer.className = 'img-viewer'; viewer.innerHTML = '<img alt="">';
    document.body.appendChild(viewer);
    const vImg = viewer.firstChild;
    const closeViewer = () => { viewer.classList.remove('open', 'zoom'); document.body.style.overflow = ''; };
    document.addEventListener('click', e => {
      const img = e.target.closest('.markdown img');
      if (!img || img.closest('a')) return;
      vImg.src = img.currentSrc || img.src; vImg.alt = img.alt || '';
      viewer.classList.add('open'); document.body.style.overflow = 'hidden';
    });
    viewer.addEventListener('click', e => {
      if (e.target === vImg && (vImg.naturalWidth > viewer.clientWidth || vImg.naturalHeight > viewer.clientHeight)) viewer.classList.toggle('zoom');
      else closeViewer();
    });
    addEventListener('keydown', e => { if (e.key === 'Escape' && viewer.classList.contains('open')) closeViewer(); });
    addEventListener('hashchange', closeViewer);
    // 地址带 ?overflow 时，把宽度超出屏幕的元素描红并在控制台列出
    if (/[?&]overflow\b/.test(location.search)) {
      const check = () => {
        const W = document.documentElement.clientWidth, bad = [];
        $$('body *').forEach(el => {
          el.classList.remove('overflow-debug');
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > W + 1 || r.left < -1) && !el.closest('.drawer, .img-viewer, .ce-word, .ce-particle, #particles, .llm-prompt')) bad.push(el);
        });
        bad.forEach(el => el.classList.add('overflow-debug'));
        console.log('[overflow] 视口宽度', W, '超出元素', bad);
        toast(bad.length ? `有 ${bad.length} 个元素超出屏幕（已描红）` : '没有元素超出屏幕');
      };
      addEventListener('hashchange', () => setTimeout(check, 800));
      setTimeout(check, 1500);
    }
  }

  async function init() {
    try { initMobile(); } catch (e) { console.warn('mobile', e); }
    try { initTheme(); } catch (e) { console.warn('theme', e); }
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
      await Promise.all([loadPosts(), loadHome()]);
    } catch (e) {
      content().innerHTML = `<div class="post-card"><div class="empty-tip"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message)}<br>
        <small>请检查 config.js 里的 repo 配置；本地预览时需填写 owner 和 name。</small></div></div>`;
      return;
    }
    try { initMobileLayout(); } catch (e) { console.warn('mobile layout', e); }
    route();
    addEventListener('hashchange', route);
  }
  init();
})();
