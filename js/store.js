/* ============================================================
   个人笔记管理 — 存储层
   使用 File System Access API 直接读写仓库中的 .md 文件
   ============================================================ */

// ==========================================================
// 1. 工具函数
// ==========================================================

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\.+$/, '')
    .replace(/^\.+/, '')
    .trim()
    .substring(0, 200)
    || 'untitled';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/!\[.*?\]\(.+?\)/g, '')
    .replace(/^[-*+]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/>\s/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diff = now - date;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  if (day < 30) return `${Math.floor(day / 7)} 周前`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ==========================================================
// 2. Frontmatter 解析器
// ==========================================================

function parseFrontmatter(text) {
  const meta = { tags: [], pinned: false, created_at: '', updated_at: '', body: text };
  if (!text.startsWith('---')) return meta;

  const endIdx = text.indexOf('\n---', 3);
  if (endIdx === -1) return meta;

  const fm = text.substring(3, endIdx).trim();
  meta.body = text.substring(endIdx + 4).replace(/^\n+/, '');

  for (const line of fm.split('\n')) {
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const key = line.substring(0, ci).trim();
    const val = line.substring(ci + 1).trim();

    switch (key) {
      case 'tags':
        meta.tags = val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
        break;
      case 'pinned':
        meta.pinned = val === 'true';
        break;
      default:
        meta[key] = val;
    }
  }
  return meta;
}

function stringifyFrontmatter(meta, body) {
  const lines = ['---'];
  if (meta.tags && meta.tags.length) lines.push(`tags: ${meta.tags.join(', ')}`);
  lines.push(`pinned: ${meta.pinned || false}`);
  if (meta.created_at) lines.push(`created_at: ${meta.created_at}`);
  lines.push(`updated_at: ${new Date().toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(body || '');
  return lines.join('\n');
}

// ==========================================================
// 3. IndexedDB — 持久化文件目录句柄
// ==========================================================

const IDB_NAME = 'notes-fs-handles';
const IDB_VER = 1;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = () => { req.result.createObjectStore('handles'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirectoryHandle(handle) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'root');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDirectoryHandle() {
  try {
    const db = await idbOpen();
    return new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('root');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

// ==========================================================
// 4. 文件系统存储
// ==========================================================

class FileSystemStore {
  constructor() {
    this.rootHandle = null;
    this.tree = [];
    this.isSupported = typeof window.showDirectoryPicker === 'function';
  }

  /** 尝试恢复上次的目录句柄 */
  async tryRestore() {
    if (!this.isSupported) return false;
    const handle = await loadDirectoryHandle();
    if (!handle) return false;

    const opts = { mode: 'readwrite' };
    let perm = await handle.queryPermission(opts);
    if (perm !== 'granted') {
      try { perm = await handle.requestPermission(opts); } catch { perm = 'denied'; }
    }
    if (perm !== 'granted') return false;

    this.rootHandle = handle;
    await this.refresh();
    return true;
  }

  /** 弹出目录选择器 */
  async pickDirectory() {
    if (!this.isSupported) throw new Error('浏览器不支持 File System Access API，请使用 Chrome 或 Edge');
    this.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveDirectoryHandle(this.rootHandle);
    await this.refresh();
  }

  /** 重新扫描整个目录树 */
  async refresh() {
    this.tree = await this._scanDir(this.rootHandle, '');
  }

  get rootName() {
    return this.rootHandle ? this.rootHandle.name : '';
  }

  /** 递归扫描目录 */
  async _scanDir(handle, parentPath) {
    const entries = [];
    for await (const [name, child] of handle.entries()) {
      if (name.startsWith('.')) continue;
      const childPath = parentPath ? `${parentPath}/${name}` : name;

      if (child.kind === 'directory') {
        const children = await this._scanDir(child, childPath);
        children.sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name, 'zh') : (a.type === 'directory' ? -1 : 1));
        entries.push({ type: 'directory', name, path: childPath, handle: child, children });
      } else if (name.endsWith('.md')) {
        entries.push({
          type: 'note', name, title: name.replace(/\.md$/, ''),
          path: childPath, handle: child, children: [],
        });
      }
    }
    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name, 'zh') : (a.type === 'directory' ? -1 : 1));
    return entries;
  }

  findNode(path) {
    const search = (nodes) => {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.children) { const f = search(n.children); if (f) return f; }
      }
      return null;
    };
    return search(this.tree);
  }

  async _getDirHandle(dirPath) {
    if (!dirPath) return this.rootHandle;
    let h = this.rootHandle;
    for (const p of dirPath.split('/')) {
      h = await h.getDirectoryHandle(p);
    }
    return h;
  }

  async readNote(node) {
    const file = await node.handle.getFile();
    const text = await file.text();
    const meta = parseFrontmatter(text);
    return {
      title: node.title,
      content: meta.body,
      tags: meta.tags,
      pinned: meta.pinned,
      createdAt: meta.created_at || new Date(file.lastModified).toISOString(),
      updatedAt: meta.updated_at || new Date(file.lastModified).toISOString(),
    };
  }

  async writeNote(node, data) {
    const content = stringifyFrontmatter({
      tags: data.tags || [],
      pinned: data.pinned || false,
      created_at: data.createdAt,
    }, data.content);
    const writable = await node.handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async createNote(parentPath, title) {
    const safeName = sanitizeFilename(title || '未命名笔记');
    const dirHandle = await this._getDirHandle(parentPath);

    let finalName = safeName + '.md';
    let counter = 1;
    while (true) {
      try {
        await dirHandle.getFileHandle(finalName, { create: false });
        finalName = `${safeName} (${counter}).md`;
        counter++;
      } catch { break; }
    }

    const fh = await dirHandle.getFileHandle(finalName, { create: true });
    const content = stringifyFrontmatter(
      { tags: [], pinned: false, created_at: new Date().toISOString() }, '');
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    await this.refresh();

    const filePath = parentPath ? `${parentPath}/${finalName}` : finalName;
    return this.findNode(filePath);
  }

  async createDirectory(parentPath, name) {
    const dirHandle = await this._getDirHandle(parentPath);
    const safeName = sanitizeFilename(name || '新建文件夹');

    let finalName = safeName;
    let counter = 1;
    while (true) {
      try {
        await dirHandle.getDirectoryHandle(finalName, { create: false });
        finalName = `${safeName} (${counter})`;
        counter++;
      } catch { break; }
    }

    await dirHandle.getDirectoryHandle(finalName, { create: true });
    await this.refresh();
  }

  async renameNote(node, newTitle) {
    const safeName = sanitizeFilename(newTitle) + '.md';
    if (safeName === node.name) return;

    const parentPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
    const dirHandle = await this._getDirHandle(parentPath);

    try { await dirHandle.getFileHandle(safeName, { create: false }); throw new Error('同名文件已存在'); }
    catch (e) { if (e.message === '同名文件已存在') throw e; }

    if (typeof node.handle.move === 'function') {
      await node.handle.move(dirHandle, safeName);
    } else {
      const file = await node.handle.getFile();
      const text = await file.text();
      const nh = await dirHandle.getFileHandle(safeName, { create: true });
      const w = await nh.createWritable();
      await w.write(text);
      await w.close();
      const oldParentPath = node.path.includes('/')
        ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
      const oldDir = await this._getDirHandle(oldParentPath);
      await oldDir.removeEntry(node.name);
    }
    await this.refresh();
  }

  async moveNote(node, targetDirPath) {
    const srcDirPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
    if (srcDirPath === targetDirPath) return;

    const targetDir = await this._getDirHandle(targetDirPath);
    try { await targetDir.getFileHandle(node.name, { create: false }); throw new Error('目标目录已存在同名文件'); }
    catch (e) { if (e.message === '目标目录已存在同名文件') throw e; }

    if (typeof node.handle.move === 'function') {
      await node.handle.move(targetDir, node.name);
    } else {
      const file = await node.handle.getFile();
      const text = await file.text();
      const nh = await targetDir.getFileHandle(node.name, { create: true });
      const w = await nh.createWritable();
      await w.write(text);
      await w.close();
      const srcDir = await this._getDirHandle(srcDirPath);
      await srcDir.removeEntry(node.name);
    }
    await this.refresh();
  }

  async deleteEntry(node) {
    const parentPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
    const dirHandle = await this._getDirHandle(parentPath);
    await dirHandle.removeEntry(node.name, { recursive: node.type === 'directory' });
    await this.refresh();
  }

  collectAllNotes(nodes = this.tree) {
    const result = [];
    for (const n of nodes) {
      if (n.type === 'note') result.push(n);
      if (n.children) result.push(...this.collectAllNotes(n.children));
    }
    return result;
  }
}
