/* ============================================================
   个人笔记管理 — 应用层
   目录树视图 + Markdown 编辑器
   ============================================================ */

class NotesApp {
  constructor() {
    // 状态
    this.store = null;        // FileSystemStore | LocalStore
    this.storeMode = 'local'; // 'fs' | 'local'
    this.currentPath = null;  // 当前选中笔记的路径
    this.currentData = null;  // 当前笔记的完整数据
    this.viewMode = 'edit';   // 'edit' | 'preview' | 'split'
    this.searchQuery = '';
    this.searchResults = null; // 搜索结果（扁平数组，非 null 表示搜索模式）
    this.darkMode = false;
    this.saveTimer = null;
    this.sidebarOpen = false;
    this.ctxTarget = null;    // 右键菜单目标节点
    this.ctxTargetPath = null;

    // 目录树展开状态
    this.expandedDirs = new Set();

    this.cacheDom();
    this.initTheme();
    this.bindEvents();
    this.init();
  }

  /* ================================================================
     DOM 缓存
     ================================================================ */

  cacheDom() {
    this.els = {
      sidebar:        document.getElementById('sidebar'),
      overlay:        document.getElementById('sidebar-overlay'),
      treeContainer:  document.getElementById('tree-container'),
      searchInput:    document.getElementById('search-input'),
      emptyState:     document.getElementById('empty-state'),
      editorContainer:document.getElementById('editor-container'),
      noteTitle:      document.getElementById('note-title'),
      noteContent:    document.getElementById('note-content'),
      noteTags:       document.getElementById('note-tags'),
      editorArea:     document.getElementById('editor-area'),
      markdownPreview:document.getElementById('markdown-preview'),
      charCount:      document.getElementById('char-count'),
      saveStatus:     document.getElementById('save-status'),
      noteCount:      document.getElementById('note-count'),
      toastContainer: document.getElementById('toast-container'),
      importFile:     document.getElementById('import-file'),
      pinBtn:         document.getElementById('btn-pin'),
      viewToggles:    document.getElementById('view-toggles'),
      contextMenu:    document.getElementById('context-menu'),
      modeIndicator:  document.getElementById('mode-indicator'),
      btnOpenFolder:  document.getElementById('btn-open-folder'),
      noteLocation:   document.getElementById('note-location'),
    };
  }

  /* ================================================================
     初始化
     ================================================================ */

  async init() {
    // 加载主题偏好
    const saved = this._loadPrefs();
    this.darkMode = saved.darkMode ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.applyTheme();

    // 尝试文件系统模式
    const fsStore = new FileSystemStore();
    if (fsStore.isSupported) {
      const restored = await fsStore.tryRestore();
      if (restored) {
        this.store = fsStore;
        this.storeMode = 'fs';
        this.expandedDirs = new Set(saved.expandedDirs || []);
      }
    }

    // 降级到本地存储
    if (!this.store) {
      this.store = new LocalStore();
      this.storeMode = 'local';
      this.expandedDirs = new Set(saved.expandedDirs || []);
      // 展开所有一级目录
      for (const n of this.store.tree) {
        if (n.type === 'directory') this.expandedDirs.add(n.path);
      }
    }

    this.updateModeUI();
    this.render();

    // 恢复上次选中
    if (saved.lastPath) {
      const node = this.store.findNode(saved.lastPath);
      if (node && node.type === 'note') {
        await this.selectNote(node);
        return;
      }
    }

    // 选中第一篇笔记
    const allNotes = this.store.collectAllNotes();
    if (allNotes.length > 0) {
      const pinned = allNotes.filter(n => {
        if (n._ref) return n._ref.pinned;
        return false; // FS模式下延迟加载，先不判断置顶
      });
      await this.selectNote(pinned[0] || allNotes[0]);
    }
  }

  /* ================================================================
     主题
     ================================================================ */

  initTheme() {
    this.applyTheme();
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = this.darkMode ? '☀️' : '🌙';
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.darkMode ? 'dark' : 'light');
  }

  toggleTheme() {
    this.darkMode = !this.darkMode;
    this.applyTheme();
    document.getElementById('btn-theme').textContent = this.darkMode ? '☀️' : '🌙';
    this._savePrefs();
  }

  /* ================================================================
     存储模式切换
     ================================================================ */

  updateModeUI() {
    const ind = this.els.modeIndicator;
    const btn = this.els.btnOpenFolder;

    if (this.storeMode === 'fs') {
      ind.textContent = '📂 文件模式';
      ind.title = '笔记以 .md 文件存储在磁盘上';
      if (btn) btn.textContent = '📂 切换文件夹';
    } else {
      ind.textContent = '💾 本地存储';
      ind.title = '笔记存储在浏览器中（点击打开文件夹切换到文件模式）';
      if (btn) btn.textContent = '📂 打开文件夹';
    }
  }

  async switchToFS() {
    if (this.storeMode === 'fs') {
      // 重新选择目录
      try {
        await this.store.pickDirectory();
        this.expandedDirs.clear();
        for (const n of this.store.tree) {
          if (n.type === 'directory') this.expandedDirs.add(n.path);
        }
        this.currentPath = null;
        this.currentData = null;
        this.render();
        const notes = this.store.collectAllNotes();
        if (notes.length > 0) await this.selectNote(notes[0]);
        this.showToast('✅ 已切换到新文件夹', 'success');
      } catch (e) {
        if (e.name !== 'AbortError') {
          this.showToast('❌ 无法打开文件夹', 'error');
        }
      }
      return;
    }

    // 从本地存储切换到文件系统
    const fsStore = new FileSystemStore();
    if (!fsStore.isSupported) {
      this.showToast('❌ 当前浏览器不支持文件系统访问，请使用 Chrome/Edge', 'error');
      return;
    }

    try {
      await fsStore.pickDirectory();
      this.store = fsStore;
      this.storeMode = 'fs';
      this.expandedDirs.clear();
      for (const n of this.store.tree) {
        if (n.type === 'directory') this.expandedDirs.add(n.path);
      }
      this.currentPath = null;
      this.currentData = null;
      this.updateModeUI();
      this.render();
      const notes = this.store.collectAllNotes();
      if (notes.length > 0) await this.selectNote(notes[0]);
      this.showToast('✅ 已切换到文件模式', 'success');
      this._savePrefs();
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.showToast('❌ 无法打开文件夹', 'error');
      }
    }
  }

  /* ================================================================
     渲染
     ================================================================ */

  render() {
    this.renderTree();
    if (this.currentPath) {
      this.showEditor();
    } else {
      this.showEmptyState();
    }
    this._savePrefs();
  }

  /** 渲染目录树 */
  renderTree() {
    const container = this.els.treeContainer;

    // 搜索模式：显示扁平结果
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.trim().toLowerCase();
      const allNotes = this.store.collectAllNotes();
      const results = allNotes.filter(n => {
        const title = n.title || '';
        if (title.toLowerCase().includes(query)) return true;
        // 对于本地存储模式，可以搜索内容
        if (this.storeMode === 'local' && n._ref) {
          return (n._ref.content || '').toLowerCase().includes(query) ||
                 (n._ref.tags || []).some(t => t.toLowerCase().includes(query));
        }
        return false;
      });

      this.searchResults = results;
      const count = results.length;
      this.els.noteCount.textContent = `🔍 ${count} 篇`;

      if (count === 0) {
        container.innerHTML = `<div class="tree-empty">未找到匹配「${escapeHtml(query)}」的笔记</div>`;
        return;
      }

      container.innerHTML = results.map(n => this._buildFlatItem(n)).join('');
      return;
    }

    // 正常树模式
    this.searchResults = null;
    const total = this.store.collectAllNotes().length;
    this.els.noteCount.textContent = `${total} 篇笔记`;

    if (this.store.tree.length === 0) {
      container.innerHTML = `
        <div class="tree-empty">
          <p>📭 暂无笔记</p>
          <p class="sub">右键点击空白处新建笔记或文件夹</p>
        </div>`;
      return;
    }

    container.innerHTML = this.store.tree.map(n => this._buildTreeNode(n, 0)).join('');
  }

  /** 构建树节点 HTML */
  _buildTreeNode(node, depth) {
    const isDir = node.type === 'directory';
    const isExpanded = this.expandedDirs.has(node.path);
    const isActive = node.path === this.currentPath;
    const indent = depth * 20;

    // 加载置顶状态（仅本地模式）
    let isPinned = false;
    if (node._ref) isPinned = node._ref.pinned;

    let html = '';
    html += `<div class="tree-node ${isDir ? 'tree-dir' : 'tree-note'} ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}"
                  data-path="${escapeHtml(node.path)}" data-type="${node.type}"
                  style="padding-left:${indent + 8}px">`;

    if (isDir) {
      html += `<span class="tree-toggle">${isExpanded ? '▼' : '▶'}</span>`;
      html += `<span class="tree-icon">${isExpanded ? '📂' : '📁'}</span>`;
    } else {
      html += `<span class="tree-toggle" style="visibility:hidden">▶</span>`;
      html += `<span class="tree-icon">${isPinned ? '📌' : '📄'}</span>`;
    }

    html += `<span class="tree-name">${escapeHtml(isDir ? node.name : (node.title || node.name))}</span>`;
    html += `</div>`;

    // 渲染子节点
    if (isDir && isExpanded && node.children && node.children.length > 0) {
      html += `<div class="tree-children">`;
      for (const child of node.children) {
        html += this._buildTreeNode(child, depth + 1);
      }
      html += `</div>`;
    }

    return html;
  }

  /** 构建搜索结果的扁平项 */
  _buildFlatItem(node) {
    const isActive = node.path === this.currentPath;
    const dirPath = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
    let isPinned = false;
    if (node._ref) isPinned = node._ref.pinned;

    return `
      <div class="tree-node tree-note ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}"
           data-path="${escapeHtml(node.path)}" data-type="note"
           style="padding-left:8px">
        <span class="tree-toggle" style="visibility:hidden">▶</span>
        <span class="tree-icon">${isPinned ? '📌' : '📄'}</span>
        <span class="tree-name">${escapeHtml(node.title || node.name)}</span>
        ${dirPath ? `<span class="tree-path-hint">${escapeHtml(dirPath)}</span>` : ''}
      </div>`;
  }

  /** 展开/折叠目录 */
  toggleDir(path) {
    if (this.expandedDirs.has(path)) {
      this.expandedDirs.delete(path);
    } else {
      this.expandedDirs.add(path);
    }
    this.renderTree();
    this._savePrefs();
  }

  /* ================================================================
     笔记操作
     ================================================================ */

  /** 选中笔记 */
  async selectNote(node) {
    if (!node || node.type !== 'note') return;

    this.currentPath = node.path;

    // 加载笔记数据
    try {
      this.currentData = await this.store.readNote(node);
    } catch (e) {
      console.error('读取笔记失败:', e);
      this.showToast('❌ 读取笔记失败', 'error');
      return;
    }

    this.showEditor();
    this.fillEditor();
    this.renderTree();
    this.closeSidebar();
    this._savePrefs();
  }

  /** 新建笔记 */
  async createNote(parentPath = '') {
    try {
      const node = await this.store.createNote(parentPath, '未命名笔记');
      if (node) {
        // 确保父目录展开
        if (parentPath) {
          // 展开所有祖先目录
          const parts = parentPath.split('/');
          let cur = '';
          for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            this.expandedDirs.add(cur);
          }
        }
        this.renderTree();
        await this.selectNote(node);
        this.els.noteTitle.focus();
        this.els.noteTitle.select();
      }
    } catch (e) {
      console.error('创建笔记失败:', e);
      this.showToast('❌ 创建笔记失败', 'error');
    }
  }

  /** 新建文件夹 */
  async createDirectory(parentPath = '') {
    const name = prompt('请输入文件夹名称：', '新建文件夹');
    if (!name || !name.trim()) return;

    try {
      await this.store.createDirectory(parentPath, name.trim());
      this.expandedDirs.add(parentPath ? `${parentPath}/${sanitizeFilename(name.trim())}` : sanitizeFilename(name.trim()));
      this.renderTree();
      this.showToast('📁 文件夹已创建', 'success');
      this._savePrefs();
    } catch (e) {
      console.error('创建文件夹失败:', e);
      this.showToast('❌ 创建文件夹失败', 'error');
    }
  }

  /** 删除条目 */
  async deleteEntry(path) {
    const node = this.store.findNode(path);
    if (!node) return;

    const label = node.type === 'directory'
      ? `目录「${node.name}」及其所有笔记`
      : `笔记「${node.title || node.name}」`;

    if (!confirm(`确定要删除 ${label} 吗？\n此操作不可恢复。`)) return;

    try {
      await this.store.deleteEntry(node);

      // 如果删除的是当前笔记，清除选择
      if (this.currentPath && (this.currentPath === path || this.currentPath.startsWith(path + '/'))) {
        this.currentPath = null;
        this.currentData = null;
      }

      this.expandedDirs.delete(path);
      this.render();
      this.showToast('🗑️ 已删除', 'info');
    } catch (e) {
      console.error('删除失败:', e);
      this.showToast('❌ 删除失败', 'error');
    }
  }

  /** 重命名 */
  async renameEntry(path) {
    const node = this.store.findNode(path);
    if (!node) return;

    if (node.type === 'directory') {
      const newName = prompt('请输入新文件夹名称：', node.name);
      if (!newName || !newName.trim() || newName.trim() === node.name) return;
      // 目录重命名：不支持直接在 FS API 中重命名目录
      // 创建新目录 + 移动所有内容 + 删除旧目录
      try {
        const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
        await this.store.createDirectory(parentPath, newName.trim());
        const newPath = parentPath ? `${parentPath}/${sanitizeFilename(newName.trim())}` : sanitizeFilename(newName.trim());
        // 移动子节点到新目录
        for (const child of [...node.children]) {
          await this.store.moveNote(child, newPath);
        }
        await this.store.deleteEntry(node);
        this.expandedDirs.delete(path);
        this.expandedDirs.add(newPath);
        this.render();
        this.showToast('✅ 文件夹已重命名', 'success');
      } catch (e) {
        console.error('重命名失败:', e);
        this.showToast('❌ 重命名失败', 'error');
      }
      return;
    }

    // 重命名笔记
    const newTitle = prompt('请输入新笔记名称：', node.title || node.name.replace(/\.md$/, ''));
    if (!newTitle || !newTitle.trim() || newTitle.trim() === (node.title || node.name.replace(/\.md$/, ''))) return;

    try {
      await this.store.renameNote(node, newTitle.trim());
      // 更新路径引用
      const oldPath = node.path;
      const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
      const newPath = parentPath ? `${parentPath}/${sanitizeFilename(newTitle.trim())}.md` : `${sanitizeFilename(newTitle.trim())}.md`;
      if (this.currentPath === oldPath) {
        this.currentPath = newPath;
        if (this.currentData) this.currentData.title = newTitle.trim();
      }
      this.render();
      this.showToast('✅ 已重命名', 'success');
    } catch (e) {
      console.error('重命名失败:', e);
      this.showToast(`❌ ${e.message || '重命名失败'}`, 'error');
    }
  }

  /** 切換置顶 */
  async togglePin() {
    if (!this.currentData || !this.currentPath) return;
    this.currentData.pinned = !this.currentData.pinned;

    const node = this.store.findNode(this.currentPath);
    if (node) {
      try {
        await this.store.writeNote(node, this.currentData);
      } catch (e) {
        console.error('保存置顶状态失败:', e);
      }
    }

    this.els.pinBtn.textContent = this.currentData.pinned ? '📌' : '📍';
    this.els.pinBtn.title = this.currentData.pinned ? '取消置顶' : '置顶';
    this.renderTree();
  }

  /* ================================================================
     编辑器
     ================================================================ */

  showEmptyState() {
    this.els.emptyState.style.display = '';
    this.els.editorContainer.style.display = 'none';
  }

  showEditor() {
    this.els.emptyState.style.display = 'none';
    this.els.editorContainer.style.display = '';
  }

  fillEditor() {
    if (!this.currentData) return;
    this.els.noteTitle.value = this.currentData.title || '';
    this.els.noteContent.value = this.currentData.content || '';
    this.els.noteTags.value = (this.currentData.tags || []).join(', ');
    this.els.pinBtn.textContent = this.currentData.pinned ? '📌' : '📍';
    this.els.pinBtn.title = this.currentData.pinned ? '取消置顶' : '置顶';

    // 显示笔记所在目录路径
    const dirPath = this.currentPath && this.currentPath.includes('/')
      ? this.currentPath.substring(0, this.currentPath.lastIndexOf('/'))
      : '';
    const locEl = this.els.noteLocation;
    if (locEl) {
      if (dirPath) {
        locEl.innerHTML = `📁 ${escapeHtml(dirPath.split('/').join(' › '))}`;
        locEl.style.display = '';
      } else {
        locEl.textContent = '📁 根目录';
        locEl.style.display = '';
      }
    }

    this.updateCharCount();
    this.renderPreview();
  }

  updateCharCount() {
    this.els.charCount.textContent = `${this.els.noteContent.value.length.toLocaleString()} 字符`;
  }

  renderPreview() {
    const content = this.els.noteContent.value;
    try {
      if (typeof marked !== 'undefined') {
        if (marked.parse) {
          marked.setOptions?.({ breaks: true, gfm: true });
          this.els.markdownPreview.innerHTML = marked.parse(content);
        } else {
          this.els.markdownPreview.innerHTML = marked(content);
        }
      } else {
        this.els.markdownPreview.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
      }
    } catch (e) {
      this.els.markdownPreview.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.els.editorArea.className = `editor-area mode-${mode}`;
    this.els.viewToggles.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === mode);
    });
    if (mode === 'preview' || mode === 'split') {
      this.renderPreview();
    }
  }

  /** 自动保存 */
  scheduleSave() {
    if (!this.currentPath || !this.currentData) return;
    this.els.saveStatus.textContent = '💾 保存中...';
    this.els.saveStatus.className = 'save-status saving';

    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        const node = this.store.findNode(this.currentPath);
        if (node) {
          this.currentData.title = this.els.noteTitle.value;
          this.currentData.content = this.els.noteContent.value;
          this.currentData.tags = this.els.noteTags.value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
          this.currentData.updatedAt = new Date().toISOString();
          await this.store.writeNote(node, this.currentData);

          // 标题变更 → 重命名文件
          const newFilename = sanitizeFilename(this.currentData.title) + '.md';
          if (newFilename !== node.name && this.currentData.title.trim()) {
            try {
              const parentPath = this.currentPath.includes('/')
                ? this.currentPath.substring(0, this.currentPath.lastIndexOf('/'))
                : '';
              await this.store.renameNote(node, this.currentData.title.trim());
              // renameNote 内部 refresh() 后旧 node 引用失效，手动计算新路径
              this.currentPath = parentPath
                ? `${parentPath}/${newFilename}`
                : newFilename;
            } catch { /* 重命名失败不阻塞保存 */ }
          }
        }

        this.els.saveStatus.textContent = '✅ 已保存';
        this.els.saveStatus.className = 'save-status saved';
        this.renderTree();
      } catch (e) {
        console.error('保存失败:', e);
        this.els.saveStatus.textContent = '❌ 保存失败';
        this.els.saveStatus.className = 'save-status error';
      }
    }, 600);
  }

  /* ================================================================
     搜索
     ================================================================ */

  handleSearch() {
    this.searchQuery = this.els.searchInput.value;
    this.renderTree();
  }

  /* ================================================================
     右键菜单
     ================================================================ */

  showContextMenu(e, path, type) {
    e.preventDefault();
    this.ctxTargetPath = path;
    this.ctxTarget = type;

    const menu = this.els.contextMenu;

    // 根据类型显示/隐藏菜单项
    const isDir = type === 'directory';
    const isNote = type === 'note';
    const isRoot = type === 'root';

    menu.querySelector('[data-action="new-note"]').style.display = (isDir || isRoot) ? '' : 'none';
    menu.querySelector('[data-action="new-folder"]').style.display = (isDir || isRoot) ? '' : 'none';
    menu.querySelector('[data-action="rename"]').style.display = (isDir || isNote) ? '' : 'none';
    menu.querySelector('[data-action="delete"]').style.display = (isDir || isNote) ? '' : 'none';
    menu.querySelector('[data-action="move"]').style.display = isNote ? '' : 'none';
    menu.querySelector('[data-action="export-json"]').style.display = (isRoot && this.storeMode === 'local') ? '' : 'none';
    menu.querySelector('[data-action="import-json"]').style.display = (isRoot && this.storeMode === 'local') ? '' : 'none';

    // 定位
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 280);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
  }

  hideContextMenu() {
    this.els.contextMenu.style.display = 'none';
    this.ctxTargetPath = null;
    this.ctxTarget = null;
  }

  async handleContextAction(action) {
    const path = this.ctxTargetPath;
    this.hideContextMenu();

    switch (action) {
      case 'new-note':
        await this.createNote(this.ctxTarget === 'directory' ? path : '');
        break;
      case 'new-folder':
        await this.createDirectory(this.ctxTarget === 'directory' ? path : '');
        break;
      case 'rename':
        await this.renameEntry(path);
        break;
      case 'delete':
        await this.deleteEntry(path);
        break;
      case 'move': {
        // 收集所有目录作为移动目标
        const dirs = this._collectAllDirs();
        if (dirs.length === 0) {
          this.showToast('暂无目标文件夹', 'info');
          break;
        }
        const target = prompt(
          '移动到哪个文件夹？\n（输入路径，留空移到根目录）\n\n可用文件夹：\n' +
          dirs.map(d => `  📁 ${d}`).join('\n'),
          ''
        );
        if (target === null) break;
        try {
          const node = this.store.findNode(path);
          if (node) {
            await this.store.moveNote(node, target.trim());
            this.renderTree();
            this.showToast('✅ 已移动', 'success');
          }
        } catch (e) {
          this.showToast(`❌ ${e.message || '移动失败'}`, 'error');
        }
        break;
      }
      case 'export-json':
        if (this.storeMode === 'local') {
          this._exportLocal();
        }
        break;
      case 'import-json':
        if (this.storeMode === 'local') {
          this.els.importFile.click();
        }
        break;
    }
  }

  _collectAllDirs(nodes = this.store.tree) {
    const result = [''];
    for (const n of nodes) {
      if (n.type === 'directory') {
        result.push(n.path);
        if (n.children) result.push(...this._collectAllDirs(n.children));
      }
    }
    return result.filter(Boolean);
  }

  /* ================================================================
     导出/导入（仅本地存储模式）
     ================================================================ */

  _exportLocal() {
    const data = this.store.exportJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`📤 已导出 ${data.notes.length} 篇笔记`, 'success');
  }

  _importLocal(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const count = this.store.importJSON(data);
        if (count > 0) {
          this.render();
          this.showToast(`📥 成功导入 ${count} 篇笔记`, 'success');
        } else {
          this.showToast('所有笔记已存在，无需导入', 'info');
        }
      } catch {
        this.showToast('❌ 文件格式不正确', 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ================================================================
     移动端侧边栏
     ================================================================ */

  toggleSidebar() {
    this.sidebarOpen ? this.closeSidebar() : this.openSidebar();
  }

  openSidebar() {
    this.sidebarOpen = true;
    this.els.sidebar.classList.add('open');
    this.els.overlay.classList.add('show');
  }

  closeSidebar() {
    this.sidebarOpen = false;
    this.els.sidebar.classList.remove('open');
    this.els.overlay.classList.remove('show');
  }

  /* ================================================================
     Toast 通知
     ================================================================ */

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    this.els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
  }

  /* ================================================================
     偏好持久化
     ================================================================ */

  _loadPrefs() {
    try {
      const raw = localStorage.getItem('notes-app-prefs');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _savePrefs() {
    try {
      localStorage.setItem('notes-app-prefs', JSON.stringify({
        darkMode: this.darkMode,
        lastPath: this.currentPath,
        storeMode: this.storeMode,
        expandedDirs: [...this.expandedDirs],
      }));
    } catch { /* ignore */ }
  }

  /* ================================================================
     事件绑定
     ================================================================ */

  bindEvents() {
    // 树容器 — 单击选中 & 展开/折叠
    this.els.treeContainer.addEventListener('click', async (e) => {
      // 展开/折叠箭头
      const toggle = e.target.closest('.tree-toggle');
      if (toggle && !toggle.style.visibility.includes('hidden')) {
        const node = e.target.closest('.tree-node');
        if (node) {
          this.toggleDir(node.dataset.path);
        }
        return;
      }

      // 选中笔记
      const treeNode = e.target.closest('.tree-node');
      if (!treeNode) return;
      if (treeNode.dataset.type === 'note') {
        await this.selectNote(treeNode);
      } else if (treeNode.dataset.type === 'directory') {
        this.toggleDir(treeNode.dataset.path);
      }
    });

    // 树容器 — 右键菜单
    this.els.treeContainer.addEventListener('contextmenu', (e) => {
      const treeNode = e.target.closest('.tree-node');
      if (treeNode) {
        this.showContextMenu(e, treeNode.dataset.path, treeNode.dataset.type);
      } else {
        this.showContextMenu(e, '', 'root');
      }
    });

    // 右键菜单项
    this.els.contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      this.handleContextAction(item.dataset.action);
    });

    // 点击空白关闭右键菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) {
        this.hideContextMenu();
      }
    });

    // 搜索
    this.els.searchInput.addEventListener('input', () => this.handleSearch());

    // 编辑器
    this.els.noteTitle.addEventListener('input', () => this.scheduleSave());
    this.els.noteContent.addEventListener('input', () => {
      this.scheduleSave();
      this.updateCharCount();
      if (this.viewMode === 'preview' || this.viewMode === 'split') {
        this.renderPreview();
      }
    });
    this.els.noteTags.addEventListener('input', () => this.scheduleSave());

    // 按钮
    document.getElementById('btn-new-note').addEventListener('click', () => this.createNote(''));
    document.getElementById('btn-empty-new').addEventListener('click', () => this.createNote(''));
    document.getElementById('btn-new-folder').addEventListener('click', () => this.createDirectory(''));
    document.getElementById('btn-theme').addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-pin').addEventListener('click', () => this.togglePin());
    document.getElementById('btn-menu').addEventListener('click', () => this.toggleSidebar());
    this.els.overlay.addEventListener('click', () => this.closeSidebar());
    if (this.els.btnOpenFolder) {
      this.els.btnOpenFolder.addEventListener('click', () => this.switchToFS());
    }

    document.getElementById('btn-delete-note').addEventListener('click', () => {
      if (this.currentPath) this.deleteEntry(this.currentPath);
    });

    // 视图切换
    this.els.viewToggles.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-btn');
      if (btn) this.setViewMode(btn.dataset.view);
    });

    // 导入文件
    this.els.importFile.addEventListener('change', (e) => {
      this._importLocal(e.target.files[0]);
      e.target.value = '';
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'n') {
        e.preventDefault();
        // 在当前选中笔记的目录中创建
        let parentPath = '';
        if (this.currentPath && this.currentPath.includes('/')) {
          parentPath = this.currentPath.substring(0, this.currentPath.lastIndexOf('/'));
        }
        this.createNote(parentPath);
      }
      if (mod && e.key === 's') {
        e.preventDefault();
        if (this.currentPath && this.currentData) {
          const node = this.store.findNode(this.currentPath);
          if (node) {
            this.store.writeNote(node, this.currentData);
            this.els.saveStatus.textContent = '✅ 已保存';
            this.els.saveStatus.className = 'save-status saved';
            this.showToast('✅ 笔记已保存', 'success');
          }
        }
      }
      if (e.key === 'Escape') {
        if (this.sidebarOpen) this.closeSidebar();
        this.hideContextMenu();
      }
    });

    // 系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const saved = this._loadPrefs();
      if (!saved.darkMode && e.matches) {
        this.darkMode = true;
        this.applyTheme();
        document.getElementById('btn-theme').textContent = '☀️';
        this._savePrefs();
      } else if (saved.darkMode && !e.matches) {
        this.darkMode = false;
        this.applyTheme();
        document.getElementById('btn-theme').textContent = '🌙';
        this._savePrefs();
      }
    });
  }
}

// ==========================================================
// 启动
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  new NotesApp();
});
