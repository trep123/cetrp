/* ============================================================
   个人笔记管理 — 存储层
   - 文件系统模式：File System Access API 读写 .md 文件
   - 本地存储模式：localStorage（降级方案）
   ============================================================ */

// ==========================================================
// 1. 工具函数
// ==========================================================

/** 净化文件名（移除非法字符） */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\.+$/, '')
    .replace(/^\.+/, '')
    .trim()
    .substring(0, 200)
    || 'untitled';
}

/** HTML 转义 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** 去除 Markdown 标记，返回纯文本 */
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

/** 相对时间格式化 */
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
//    格式: ---\nkey: value\n---\n\nbody
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

async function clearDirectoryHandle() {
  try {
    const db = await idbOpen();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('root');
    await new Promise(r => { tx.oncomplete = r; });
  } catch { /* ignore */ }
}

// ==========================================================
// 4. 文件系统存储 (FileSystemStore)
// ==========================================================

class FileSystemStore {
  constructor() {
    this.rootHandle = null;
    this.tree = [];            // TreeNode[]
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
    if (!this.isSupported) throw new Error('浏览器不支持 File System Access API');
    this.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveDirectoryHandle(this.rootHandle);
    await this.refresh();
  }

  /** 重新扫描整个目录树 */
  async refresh() {
    this.tree = await this._scanDir(this.rootHandle, '');
  }

  /** 递归扫描目录 */
  async _scanDir(handle, parentPath) {
    const entries = [];
    for await (const [name, child] of handle.entries()) {
      if (name.startsWith('.')) continue;
      const childPath = parentPath ? `${parentPath}/${name}` : name;

      if (child.kind === 'directory') {
        const children = await this._scanDir(child, childPath);
        children.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh') : (a.type === 'directory' ? -1 : 1));
        entries.push({ type: 'directory', name, path: childPath, handle: child, children });
      } else if (name.endsWith('.md')) {
        entries.push({
          type: 'note',
          name,
          title: name.replace(/\.md$/, ''),
          path: childPath,
          handle: child,
          children: [],
        });
      }
    }
    entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh') : (a.type === 'directory' ? -1 : 1));
    return entries;
  }

  /** 在树中查找节点 */
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

  /** 根据路径获取目录句柄 */
  async _getDirHandle(dirPath) {
    if (!dirPath) return this.rootHandle;
    const parts = dirPath.split('/');
    let h = this.rootHandle;
    for (const p of parts) {
      h = await h.getDirectoryHandle(p);
    }
    return h;
  }

  /** 读取笔记完整数据 */
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

  /** 写入笔记 */
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

  /** 新建笔记文件 */
  async createNote(parentPath, title) {
    const safeName = sanitizeFilename(title || '未命名笔记');
    const dirHandle = await this._getDirHandle(parentPath);

    // 处理同名文件
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
    const content = stringifyFrontmatter({
      tags: [], pinned: false, created_at: new Date().toISOString()
    }, '');
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    await this.refresh();

    const filePath = parentPath ? `${parentPath}/${finalName}` : finalName;
    return this.findNode(filePath);
  }

  /** 新建目录 */
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

  /** 重命名笔记（= 移动/重命名文件） */
  async renameNote(node, newTitle) {
    const safeName = sanitizeFilename(newTitle) + '.md';
    if (safeName === node.name) return;

    const parentPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/'))
      : '';
    const dirHandle = await this._getDirHandle(parentPath);

    // 检查目标是否已存在
    try {
      await dirHandle.getFileHandle(safeName, { create: false });
      throw new Error('同名文件已存在');
    } catch (e) {
      if (e.message === '同名文件已存在') throw e;
    }

    if (typeof node.handle.move === 'function') {
      await node.handle.move(dirHandle, safeName);
    } else {
      // 降级：复制内容 + 删除
      const file = await node.handle.getFile();
      const text = await file.text();
      const nh = await dirHandle.getFileHandle(safeName, { create: true });
      const w = await nh.createWritable();
      await w.write(text);
      await w.close();
      // 删除旧文件
      const oldParentPath = node.path.includes('/')
        ? node.path.substring(0, node.path.lastIndexOf('/'))
        : '';
      const oldDir = await this._getDirHandle(oldParentPath);
      await oldDir.removeEntry(node.name);
    }

    await this.refresh();
  }

  /** 移动笔记到另一个目录 */
  async moveNote(node, targetDirPath) {
    const srcDirPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/'))
      : '';
    if (srcDirPath === targetDirPath) return;

    const targetDir = await this._getDirHandle(targetDirPath);

    // 检查目标是否有同名文件
    try {
      await targetDir.getFileHandle(node.name, { create: false });
      throw new Error('目标目录已存在同名文件');
    } catch (e) {
      if (e.message === '目标目录已存在同名文件') throw e;
    }

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

  /** 删除条目（文件或目录） */
  async deleteEntry(node) {
    const parentPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/'))
      : '';
    const dirHandle = await this._getDirHandle(parentPath);
    await dirHandle.removeEntry(node.name, { recursive: node.type === 'directory' });
    await this.refresh();
  }

  /** 递归收集所有笔记节点（用于搜索） */
  collectAllNotes(nodes = this.tree) {
    const result = [];
    for (const n of nodes) {
      if (n.type === 'note') result.push(n);
      if (n.children) result.push(...this.collectAllNotes(n.children));
    }
    return result;
  }
}

// ==========================================================
// 5. 本地存储 (LocalStore) — 降级方案
// ==========================================================

class LocalStore {
  KEY = 'notes-app-v2';
  OLD_KEY = 'notes-app-data';

  constructor() {
    this.tree = [];   // TreeNode[]（模拟目录树）
    this._notes = []; // 扁平笔记数据
    this._load();
  }

  _load() {
    try {
      // 优先读取新格式
      let raw = localStorage.getItem(this.KEY);
      if (raw) {
        const data = JSON.parse(raw);
        this._notes = data.notes || [];
      } else {
        // 尝试迁移旧版数据
        raw = localStorage.getItem(this.OLD_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          const oldNotes = data.notes || [];
          this._notes = oldNotes.map(n => ({
            id: n.id,
            path: n.category ? `${n.category}/${sanitizeFilename(n.title || '无标题')}.md` : `${sanitizeFilename(n.title || '无标题')}.md`,
            title: n.title || '无标题',
            content: n.content || '',
            tags: n.tags || [],
            pinned: n.pinned || false,
            createdAt: n.createdAt || new Date().toISOString(),
            updatedAt: n.updatedAt || new Date().toISOString(),
          }));
          this._save(); // 迁移后保存
        }
      }
    } catch (e) {
      console.error('加载本地数据失败:', e);
      this._notes = [];
    }
    this._buildTree();
  }

  _save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify({ version: 2, notes: this._notes }));
    } catch (e) {
      console.error('保存失败:', e);
    }
  }

  /** 从扁平笔记列表构建目录树 */
  _buildTree() {
    const dirMap = { '': { type: 'directory', name: '', path: '', children: [], handle: null } };

    for (const note of this._notes) {
      const fullPath = note.path || '';
      const slashIdx = fullPath.lastIndexOf('/');
      const dirPath = slashIdx >= 0 ? fullPath.substring(0, slashIdx) : '';
      const fileName = slashIdx >= 0 ? fullPath.substring(slashIdx + 1) : fullPath;

      // 确保所有父目录存在（包含占位符以确保空目录显示在树中）
      if (dirPath) {
        const parts = dirPath.split('/');
        let cur = '';
        for (const p of parts) {
          const dp = cur ? `${cur}/${p}` : p;
          if (!dirMap[dp]) {
            const dn = { type: 'directory', name: p, path: dp, children: [], handle: null };
            dirMap[dp] = dn;
            const pp = cur || '';
            dirMap[pp].children.push(dn);
          }
          cur = dp;
        }
      }

      // 跳过占位符：不创建笔记节点
      if (note._isPlaceholder) continue;

      const title = fileName.replace(/\.md$/, '') || note.title || '无标题';
      const noteNode = {
        type: 'note',
        name: fileName,
        title,
        path: fullPath,
        handle: null,
        children: [],
        _ref: note,
      };

      dirMap[dirPath].children.push(noteNode);
    }

    // 排序：目录在前，然后按名称
    const sortNodes = (nodes) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh');
      });
      nodes.forEach(n => { if (n.children) sortNodes(n.children); });
    };
    sortNodes(dirMap[''].children);

    this.tree = dirMap[''].children;
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

  readNote(node) {
    if (node._ref) {
      return {
        title: node._ref.title,
        content: node._ref.content,
        tags: node._ref.tags || [],
        pinned: node._ref.pinned || false,
        createdAt: node._ref.createdAt,
        updatedAt: node._ref.updatedAt,
      };
    }
    return { title: node.title, content: '', tags: [], pinned: false, createdAt: '', updatedAt: '' };
  }

  writeNote(node, data) {
    if (node._ref) {
      node._ref.title = data.title;
      node._ref.content = data.content;
      node._ref.tags = data.tags || [];
      node._ref.pinned = data.pinned || false;
      node._ref.updatedAt = new Date().toISOString();
    }
    this._save();
  }

  createNote(parentPath, title) {
    const safeName = sanitizeFilename(title || '未命名笔记');
    const filePath = parentPath ? `${parentPath}/${safeName}.md` : `${safeName}.md`;

    // 处理同名
    let finalPath = filePath;
    let counter = 1;
    while (this._notes.some(n => n.path === finalPath)) {
      finalPath = parentPath
        ? `${parentPath}/${safeName} (${counter}).md`
        : `${safeName} (${counter}).md`;
      counter++;
    }

    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      path: finalPath,
      title: title || '未命名笔记',
      content: '',
      tags: [],
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._notes.push(note);
    this._save();
    this._buildTree();
    return this.findNode(finalPath);
  }

  createDirectory(parentPath, name) {
    const safeName = sanitizeFilename(name || '新建文件夹');
    const dirPath = parentPath ? `${parentPath}/${safeName}` : safeName;

    // 确保目录存在：创建一个占位笔记（目录在树中自动出现）
    // 这里只需确保 buildTree 会识别此路径
    // 实际上目录在 _buildTree 中是由笔记路径推断的
    // 为创建空目录，我们添加一个特殊的占位标记
    const placeholder = {
      id: '_dir_' + Date.now().toString(36),
      path: dirPath + '/.placeholder',
      title: '',
      content: '',
      tags: [],
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _isPlaceholder: true,
    };
    this._notes.push(placeholder);
    this._save();
    this._buildTree();
  }

  deleteEntry(node) {
    if (node.type === 'directory') {
      // 删除目录下所有笔记
      this._notes = this._notes.filter(n => !n.path.startsWith(node.path + '/') && n.path !== node.path);
    } else {
      this._notes = this._notes.filter(n => n.path !== node.path);
    }
    // 清除占位符
    this._notes = this._notes.filter(n => !n._isPlaceholder);
    this._save();
    this._buildTree();
  }

  renameNote(node, newTitle) {
    const safeName = sanitizeFilename(newTitle) + '.md';
    const parentPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/'))
      : '';
    const newPath = parentPath ? `${parentPath}/${safeName}` : safeName;

    if (this._notes.some(n => n.path === newPath && n !== node._ref)) {
      throw new Error('同名笔记已存在');
    }

    if (node._ref) {
      node._ref.path = newPath;
      node._ref.title = newTitle;
    }
    this._save();
    this._buildTree();
  }

  moveNote(node, targetDirPath) {
    const newPath = targetDirPath
      ? `${targetDirPath}/${node.name}`
      : node.name;

    if (this._notes.some(n => n.path === newPath && n !== node._ref)) {
      throw new Error('目标目录已存在同名笔记');
    }

    if (node._ref) {
      node._ref.path = newPath;
    }
    this._save();
    this._buildTree();
  }

  collectAllNotes(nodes = this.tree) {
    const result = [];
    for (const n of nodes) {
      if (n.type === 'note') result.push(n);
      if (n.children) result.push(...this.collectAllNotes(n.children));
    }
    return result;
  }

  /** 导出所有笔记为 JSON（用于备份） */
  exportJSON() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      notes: this._notes.filter(n => !n._isPlaceholder),
    };
  }

  /** 导入 JSON 笔记 */
  importJSON(data) {
    let notes;
    if (Array.isArray(data)) {
      notes = data;
    } else if (data && data.notes) {
      notes = data.notes;
    } else {
      return 0;
    }

    const existing = new Set(this._notes.map(n => n.path));
    const incoming = notes.filter(n => n && n.path && !existing.has(n.path));
    if (incoming.length === 0) return 0;

    this._notes.push(...incoming.map(n => ({
      id: n.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      path: n.path,
      title: n.title || '',
      content: n.content || '',
      tags: n.tags || [],
      pinned: !!n.pinned,
      createdAt: n.createdAt || new Date().toISOString(),
      updatedAt: n.updatedAt || new Date().toISOString(),
    })));

    this._save();
    this._buildTree();
    return incoming.length;
  }
}
