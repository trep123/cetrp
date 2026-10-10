/*
 * GitHub Pages 笔记 —— 纯前端，笔记直接存放在 GitHub 仓库中
 * 读取：访客通过 Pages 静态地址读取 notes/index.json 和 .md 文件（无 API 限流）
 * 写入：登录（填 Token）后通过 GitHub REST API 的 Contents 接口提交到仓库
 */
'use strict';

const $ = s => document.querySelector(s);
const CFG_KEY = 'ghnotes.cfg.v1';

/* ---------- 配置：自动识别 <owner>.github.io/<repo> ---------- */
function detectRepo() {
  const cfg = { title: '我的笔记', owner: '', repo: '', branch: 'main', dir: 'notes', token: '' };
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    cfg.owner = m[1];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    cfg.repo = seg && !seg.includes('.') ? seg : `${m[1]}.github.io`;
  }
  return cfg;
}
let cfg = Object.assign(detectRepo(), JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
cfg.dir = (cfg.dir || 'notes').replace(/^\/+|\/+$/g, '');

let index = [];          // [{ path, title, updated }]
let indexSha = null;
let current = null;      // { path, sha, text, fresh }
let editing = null;      // { original: path | null }
let busy = false;
const blobCache = {};    // 本次会话刚上传的附件 -> 本地预览地址（Pages 部署前也能看到图）

const authed = () => !!cfg.token;
const indexPath = () => `${cfg.dir}/index.json`;
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

/* ---------- 编码工具（UTF-8 安全的 Base64） ---------- */
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const textToB64 = t => bytesToB64(new TextEncoder().encode(t));
const b64ToText = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));

/* ---------- GitHub API ---------- */
async function gh(path, opts = {}) {
  if (!cfg.owner || !cfg.repo) throw new Error('请先在「设置」里填写仓库');
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let msg = `GitHub ${res.status}`;
    try { msg += '：' + (await res.json()).message; } catch { /* ignore */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}
const refQ = () => `?ref=${encodeURIComponent(cfg.branch)}`;

async function getFile(path) {
  try {
    const d = await gh(`/contents/${encPath(path)}${refQ()}`);
    if (Array.isArray(d)) throw new Error(`${path} 是目录`);
    // >1MB 的文件 content 为空，改用 blob 接口
    const b64 = d.content || (await gh(`/git/blobs/${d.sha}`)).content;
    return { sha: d.sha, text: b64ToText(b64) };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
async function shaOf(path) {
  try { return (await gh(`/contents/${encPath(path)}${refQ()}`)).sha; }
  catch (e) { if (e.status === 404) return null; throw e; }
}
function putFile(path, b64, message, sha) {
  const body = { message, content: b64, branch: cfg.branch };
  if (sha) body.sha = sha;
  return gh(`/contents/${encPath(path)}`, { method: 'PUT', body: JSON.stringify(body) });
}
function deleteFile(path, sha, message) {
  return gh(`/contents/${encPath(path)}`, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: cfg.branch }) });
}

/* ---------- 索引 notes/index.json ---------- */
function extractTitle(text, path) {
  const m = text.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1] : path.split('/').pop().replace(/\.md$/i, '');
}
async function scanRepo() {
  const t = await gh(`/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
  const prefix = cfg.dir + '/';
  return t.tree
    .filter(x => x.type === 'blob' && x.path.startsWith(prefix) && /\.md$/i.test(x.path) && !x.path.startsWith(prefix + 'assets/'))
    .map(x => ({ path: x.path, title: extractTitle('', x.path), updated: '' }));
}
async function loadIndex() {
  try {
    if (authed()) {
      const f = await getFile(indexPath());
      index = f ? JSON.parse(f.text) : [];
      indexSha = f ? f.sha : null;
    } else {
      const r = await fetch(`${encPath(indexPath())}?t=${Date.now()}`);
      if (!r.ok) throw new Error(`index.json ${r.status}`);
      index = await r.json();
    }
  } catch (e) {
    console.warn('读取索引失败，改为扫描仓库', e);
    try { index = await scanRepo(); }
    catch (e2) { index = []; toast('读取笔记列表失败：' + e2.message, true); }
  }
  renderList();
}
function upsertIndex(path, title) {
  const updated = new Date().toISOString();
  const n = index.find(x => x.path === path);
  if (n) Object.assign(n, { title, updated }); else index.push({ path, title, updated });
}
async function saveIndex(message) {
  index.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  const b64 = textToB64(JSON.stringify(index, null, 2) + '\n');
  for (let i = 0; i < 2; i++) {
    try {
      const r = await putFile(indexPath(), b64, message, indexSha);
      indexSha = r.content.sha;
      return;
    } catch (e) {
      if (i === 0 && (e.status === 409 || e.status === 422)) { indexSha = await shaOf(indexPath()); continue; }
      throw e;
    }
  }
}
async function rebuildIndex() {
  await withBusy('正在扫描仓库…', async () => {
    const old = Object.fromEntries(index.map(n => [n.path, n]));
    index = (await scanRepo()).map(n => old[n.path] || n);
    if (!indexSha) indexSha = await shaOf(indexPath());
    await saveIndex('重建笔记索引');
    renderList();
    toast(`索引已重建，共 ${index.length} 篇`);
  });
}

/* ---------- 路径工具 ---------- */
function resolvePath(fromFile, rel) {
  if (!rel || /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(rel)) return null; // 外链、绝对路径、锚点不处理
  const u = new URL(rel, 'https://x.invalid/' + encPath(fromFile));
  return decodeURIComponent(u.pathname.slice(1));
}
function relPath(fromFile, to) {
  const a = fromFile.split('/').slice(0, -1), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}
const safeName = n => n.replace(/[\\/:*?"<>|#%\s]+/g, '_');
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }); };

/* ---------- 渲染 ---------- */
function renderMarkdown(el, md, notePath) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(md));
  el.querySelectorAll('img').forEach(img => {
    const p = resolvePath(notePath, img.getAttribute('src'));
    if (p != null) img.src = blobCache[p] || encPath(p);
  });
  el.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    const p = resolvePath(notePath, href);
    if (p == null) { if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return; }
    a.href = /\.md$/i.test(p) ? '#/n/' + encodeURIComponent(p) : (blobCache[p] || encPath(p));
  });
}
function renderList() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const ul = $('#noteList');
  ul.innerHTML = '';
  const items = index.filter(n => !q || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
  if (!items.length) {
    ul.innerHTML = `<li class="empty">${index.length ? '没有匹配的笔记' : '还没有笔记'}</li>`;
    return;
  }
  for (const n of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#/n/' + encodeURIComponent(n.path);
    a.dataset.path = n.path;
    const folder = n.path.slice(cfg.dir.length + 1).split('/').slice(0, -1).join('/');
    a.innerHTML = '<span class="t"></span><span class="s"></span>';
    a.querySelector('.t').textContent = n.title;
    a.querySelector('.s').textContent = [folder, n.updated ? fmtDate(n.updated) : ''].filter(Boolean).join(' · ');
    li.append(a);
    ul.append(li);
  }
  markActive();
}
function markActive() {
  document.querySelectorAll('#noteList a').forEach(a => a.classList.toggle('active', a.dataset.path === current?.path));
}
function showViewer() { $('#viewer').classList.remove('hidden'); $('#editor').classList.add('hidden'); }
function displayNote() {
  showViewer();
  const { path, text } = current;
  const meta = index.find(n => n.path === path);
  const title = extractTitle(text, path);
  $('#noteTitle').textContent = title;
  $('#noteMeta').textContent = path + (meta?.updated ? ' · 更新于 ' + fmtDate(meta.updated) : '');
  renderMarkdown($('#noteBody'), text, path);
  const first = $('#noteBody').firstElementChild;
  if (first && first.tagName === 'H1') first.remove(); // 标题已显示在顶部
  $('#noteActions').classList.remove('hidden');
  document.title = `${title} · ${cfg.title}`;
  markActive();
}
async function openNote(path) {
  showViewer();
  $('#noteTitle').textContent = '加载中…';
  $('#noteMeta').textContent = '';
  $('#noteBody').innerHTML = '';
  $('#noteActions').classList.add('hidden');
  try {
    let text, sha = null;
    if (authed()) {
      const f = await getFile(path);
      if (!f) throw new Error('笔记不存在：' + path);
      ({ text, sha } = f);
    } else {
      const r = await fetch(`${encPath(path)}?t=${Date.now()}`);
      if (!r.ok) throw new Error(`笔记加载失败（${r.status}），可能 Pages 还在部署，稍后刷新`);
      text = await r.text();
    }
    current = { path, sha, text };
    displayNote();
  } catch (e) {
    current = null;
    $('#noteTitle').textContent = '出错了';
    $('#noteBody').textContent = e.message;
  }
}
function showWelcome() {
  current = null;
  showViewer();
  $('#noteActions').classList.add('hidden');
  $('#noteTitle').textContent = cfg.title;
  $('#noteMeta').textContent = cfg.owner ? `仓库：${cfg.owner}/${cfg.repo} · 分支 ${cfg.branch} · 目录 ${cfg.dir}/` : '';
  const md = !cfg.owner
    ? '还没有配置仓库。点右上角 **设置** 填写 GitHub 用户名和仓库名。'
    : `共 **${index.length}** 篇笔记，从左侧选择一篇开始阅读。\n\n` +
      (authed() ? '已登录：可以 **新建**、**编辑**、**删除** 和 **上传** 笔记，所有改动都会直接提交到仓库。'
                : '当前是只读模式。仓库主人可在 **设置** 中填写 Token 开启编辑。');
  renderMarkdown($('#noteBody'), md, cfg.dir + '/index.md');
  document.title = cfg.title;
  markActive();
}

/* ---------- 编辑 ---------- */
function startEdit(isNew) {
  if (!isNew && !current) return;
  editing = { original: isNew ? null : current.path };
  $('#dirPrefix').textContent = cfg.dir + '/';
  $('#pathInput').value = isNew ? '' : current.path.slice(cfg.dir.length + 1);
  $('#contentInput').value = isNew ? '# 新笔记\n\n' : current.text;
  $('#previewBody').classList.add('hidden');
  $('#contentInput').classList.remove('hidden');
  $('#previewToggle').textContent = '预览';
  $('#viewer').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  (isNew ? $('#pathInput') : $('#contentInput')).focus();
}
function editorPath() {
  let rel = $('#pathInput').value.trim().replace(/^\/+/, '');
  if (!rel) return null;
  if (rel.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('文件名不合法');
  if (!/\.md$/i.test(rel)) rel += '.md';
  return `${cfg.dir}/${rel}`;
}
async function saveNote() {
  let path;
  try { path = editorPath(); } catch (e) { return toast(e.message, true); }
  if (!path) return toast('请填写文件名', true);
  const text = $('#contentInput').value;
  const orig = editing.original;
  const rel = path.slice(cfg.dir.length + 1);
  await withBusy('正在提交到仓库…', async () => {
    const sha = (orig === path && current?.sha) ? current.sha : await shaOf(path);
    if (sha && orig !== path && !confirm(`${path} 已存在，要覆盖吗？`)) return;
    const r = await putFile(path, textToB64(text), `${orig ? '更新' : '新增'}笔记：${rel}`, sha);
    if (orig && orig !== path) { // 重命名：删除旧文件
      const osha = await shaOf(orig);
      if (osha) await deleteFile(orig, osha, `重命名笔记：${orig} → ${path}`);
      index = index.filter(n => n.path !== orig);
    }
    upsertIndex(path, extractTitle(text, path));
    await saveIndex(`更新索引：${rel}`);
    editing = null;
    current = { path, sha: r.content.sha, text, fresh: true };
    renderList();
    const hash = '#/n/' + encodeURIComponent(path);
    if (location.hash === hash) displayNote(); else location.hash = hash;
    toast('已保存到仓库，Pages 约 1 分钟后对访客更新');
  });
}
function cancelEdit() {
  if (!confirm('放弃未保存的修改？')) return;
  editing = null;
  current ? displayNote() : showWelcome();
}
async function deleteNote() {
  if (!current || !confirm(`确定删除 ${current.path}？\n这会在仓库里提交一次删除。`)) return;
  const { path } = current;
  await withBusy('正在删除…', async () => {
    const sha = current.sha || await shaOf(path);
    if (sha) await deleteFile(path, sha, `删除笔记：${path}`);
    index = index.filter(n => n.path !== path);
    await saveIndex(`更新索引：删除 ${path}`);
    renderList();
    history.replaceState(null, '', location.pathname + location.search);
    showWelcome();
    toast('已删除');
  });
}

/* ---------- 上传 ---------- */
const MAX_SIZE = 50 * 1024 * 1024;
async function uploadFiles(files, asAttachments) {
  return withBusy(`正在上传 ${files.length} 个文件…`, async () => {
    const links = [];
    let notesChanged = false;
    for (const f of files) {
      if (f.size > MAX_SIZE) { toast(`${f.name} 超过 50MB，已跳过`, true); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!asAttachments && /\.(md|markdown|txt)$/i.test(f.name)) {
        const name = safeName(f.name.replace(/\.(markdown|txt)$/i, '.md'));
        const path = `${cfg.dir}/${name}`;
        const sha = await shaOf(path);
        if (sha && !confirm(`${path} 已存在，要覆盖吗？`)) continue;
        await putFile(path, bytesToB64(bytes), `上传笔记：${name}`, sha);
        upsertIndex(path, extractTitle(new TextDecoder().decode(bytes), path));
        notesChanged = true;
      } else {
        const name = `${Date.now().toString(36)}-${safeName(f.name)}`;
        const path = `${cfg.dir}/assets/${name}`;
        await putFile(path, bytesToB64(bytes), `上传附件：${name}`, null);
        blobCache[path] = URL.createObjectURL(f);
        links.push({ path, name: f.name, image: f.type.startsWith('image/') });
      }
    }
    if (notesChanged) { await saveIndex('更新索引：上传笔记'); renderList(); }
    return links;
  });
}
const mdLink = (l, fromFile) => `${l.image ? '!' : ''}[${l.name}](${encodeURI(relPath(fromFile, l.path))})`;

async function onTopUpload(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const links = await uploadFiles(files, false);
  if (!links) return;
  if (links.length) {
    const text = links.map(l => mdLink(l, `${cfg.dir}/x.md`)).join('\n');
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    toast(`附件已上传到 ${cfg.dir}/assets/，Markdown 链接已复制`);
  } else toast('上传完成');
}
async function onAttach(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const links = await uploadFiles(files, true);
  if (!links?.length) return;
  let notePath;
  try { notePath = editorPath() || `${cfg.dir}/untitled.md`; } catch { notePath = `${cfg.dir}/untitled.md`; }
  insertAtCursor($('#contentInput'), links.map(l => mdLink(l, notePath)).join('\n'));
  toast('附件已上传并插入');
}
function insertAtCursor(ta, text) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  ta.value = v.slice(0, s) + text + v.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus();
}

/* ---------- 设置 ---------- */
function openSettings() {
  const f = $('#settingsForm');
  for (const k of ['title', 'owner', 'repo', 'branch', 'dir', 'token']) f.elements[k].value = cfg[k] || '';
  $('#settingsDlg').showModal();
}
async function saveSettings(ev) {
  if (ev.submitter?.value !== 'save') return;
  ev.preventDefault();
  const f = $('#settingsForm');
  const next = { ...cfg };
  for (const k of ['title', 'owner', 'repo', 'branch', 'dir', 'token']) next[k] = f.elements[k].value.trim();
  next.title ||= '我的笔记'; next.branch ||= 'main';
  next.dir = (next.dir || 'notes').replace(/^\/+|\/+$/g, '');
  const prev = cfg;
  cfg = next;
  if (cfg.token) {
    try {
      const repo = await gh('');
      if (!repo.permissions?.push) throw new Error('这个 Token 没有该仓库的写权限');
    } catch (e) { cfg = prev; return toast('验证失败：' + e.message, true); }
  }
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  $('#settingsDlg').close();
  applyConfig();
  toast(cfg.token ? '已登录，可以编辑了' : '已保存（只读模式）');
  await loadIndex();
  route();
}
function logout() {
  cfg.token = '';
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  $('#settingsDlg').close();
  applyConfig();
  toast('已清除 Token');
  route();
}
function applyConfig() {
  document.body.classList.toggle('authed', authed());
  $('#modeBadge').textContent = authed() ? '编辑模式' : '只读';
  $('#siteTitle a').textContent = cfg.title;
}

/* ---------- 杂项 ---------- */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isError ? 5000 : 2800);
}
async function withBusy(label, fn) {
  if (busy) { toast('上一个操作还没完成', true); return; }
  busy = true;
  document.querySelectorAll('button, label.btn').forEach(b => b.toggleAttribute('disabled', true));
  toast(label);
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message, true); }
  finally {
    busy = false;
    document.querySelectorAll('button, label.btn').forEach(b => b.removeAttribute('disabled'));
  }
}
function route() {
  document.body.classList.remove('sidebar-open');
  const m = location.hash.match(/^#\/n\/(.+)$/);
  if (editing) {
    if (!confirm('放弃未保存的修改？')) return;
    editing = null;
  }
  if (!m) return showWelcome();
  const path = decodeURIComponent(m[1]);
  if (current?.fresh && current.path === path) { current.fresh = false; return displayNote(); }
  openNote(path);
}

/* ---------- 启动 ---------- */
marked.setOptions({ gfm: true, breaks: true });
applyConfig();
$('#menuBtn').onclick = () => document.body.classList.toggle('sidebar-open');
$('#searchInput').oninput = renderList;
$('#newBtn').onclick = () => startEdit(true);
$('#editBtn').onclick = () => startEdit(false);
$('#deleteBtn').onclick = deleteNote;
$('#saveBtn').onclick = saveNote;
$('#cancelBtn').onclick = cancelEdit;
$('#rebuildBtn').onclick = rebuildIndex;
$('#uploadInput').onchange = onTopUpload;
$('#attachInput').onchange = onAttach;
$('#settingsBtn').onclick = openSettings;
$('#logoutBtn').onclick = logout;
$('#settingsForm').addEventListener('submit', saveSettings);
$('#previewToggle').onclick = () => {
  const showing = $('#previewBody').classList.toggle('hidden') === false;
  $('#contentInput').classList.toggle('hidden', showing);
  $('#previewToggle').textContent = showing ? '继续编辑' : '预览';
  if (showing) {
    let p; try { p = editorPath(); } catch { p = null; }
    renderMarkdown($('#previewBody'), $('#contentInput').value, p || `${cfg.dir}/untitled.md`);
  }
};
$('#contentInput').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveNote(); }
  if (e.key === 'Tab') { e.preventDefault(); insertAtCursor(e.target, '  '); }
});
window.addEventListener('beforeunload', e => { if (editing) e.preventDefault(); });
window.addEventListener('hashchange', route);
if (!cfg.owner) openSettings();
loadIndex().then(route);
