/* ============================================================
   个人笔记管理 — 应用层
   目录树视图 + Markdown 编辑器
   直接读写 Git 仓库中的 .md 文件
   ============================================================ */

class NotesApp {
  constructor() {
    this.store = new FileSystemStore();
    this.currentPath = null;
    this.currentData = null;
    this.viewMode = 'edit';
    this.searchQuery = '';
    this.searchResults = null;
    this.darkMode = false;
    this.saveTimer = null;
    this.sidebarOpen = false;
    this.ctxTarget = null;
    this.ctxTargetPath = null;
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
      sidebar:         document.getElementById('sidebar'),
      overlay:         document.getElementById('sidebar-overlay'),
      treeContainer:   document.getElementById('tree-container'),
      searchInput:     document.getElementById('search-input'),
      emptyState:      document.getElementById('empty-state'),
      editorContainer: document.getElementById('editor-container'),
      noteTitle:       document.getElementById('note-title'),
      noteContent:     document.getElementById('note-content'),
      noteTags:        document.getElementById('note-tags'),
      editorArea:      document.getElementById('editor-area'),
      markdownPreview: document.getElementById('markdown-preview'),
      charCount:       document.getElementById('char-count'),
      saveStatus:      document.getElementById('save-status'),
      noteCount:       document.getElementById('note-count'),
      toastContainer:  document.getElementById('toast-container'),
      pinBtn:          document.getElementById('btn-pin'),
      viewToggles:     document.getElementById('view-toggles'),
      contextMenu:     document.getElementById('context-menu'),
      noteLocation:    document.getElementById('note-location'),
      appTitle:        document.querySelector('.app-title'),
      btnPickDir:      document.getElementById('btn-pick-dir'),
    };
  }

  /* ================================================================
     初始化
     ================================================================ */

  async init() {
    const saved = this._loadPrefs();
    this.darkMode = saved.darkMode ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.applyTheme();

    if (!this.store.isSupported) {
      this._showUnsupported();
      return;
    }

    const restored = await this.store.tryRestore();
    if (restored) {
      this.expandedDirs = new Set(saved.expandedDirs || []);
      this._onDirectoryReady();
      if (saved.lastPath) {
        const node = this.store.findNode(saved.lastPath);
        if (node && node.type === 'note') await this.selectNote(node);
      }
    } else {
      this._showPickDirectory();
    }
  }

  /** 目录就绪后的统一初始化 */
  _onDirectoryReady() {
    this.els.appTitle.textContent = `📝 ${this.store.rootName}`;
    this.els.btnPickDir.textContent = '📂 切换目录';
    this.render();
    // 自动展开一级目录
    if (this.expandedDirs.size === 0) {
      for (const n of this.store.tree) {
        if (n.type === 'directory') this.expandedDirs.add(n.path);
      }
    }
    // 如果没有已保存的选中笔记，选第一篇
    if (!this.currentPath) {
      const notes = this.store.collectAllNotes();
      if (notes.length > 0) this.selectNote(notes[0]);
    }
  }

  /** 显示"选择目录"引导页 */
  _showPickDirectory() {
    this.els.emptyState.innerHTML = `
      <div class="empty-state-icon">📂</div>
      <h2>选择笔记目录</h2>
      <p>选择一个文件夹来管理 Markdown 笔记<br>目录结构即分类，笔记直接保存为 .md 文件</p>
      <button id="btn-pick-dir-main" class="btn btn-primary btn-lg">📂 选择笔记目录</button>
      <div class="shortcut-hints">
        <span>需要 Chrome / Edge 浏览器</span>
      </div>`;
    // 重新绑定（因为 innerHTML 替换了按钮，且与侧边栏按钮 ID 不同）
    document.getElementById('btn-pick-dir-main')?.addEventListener('click', () => this.pickDirectory());
    this.els.emptyState.style.display = '';
    this.els.editorContainer.style.display = 'none';
    this.els.treeContainer.innerHTML = `
      <div class="tree-empty">
        <p>📂 请先选择笔记目录</p>
        <p class="sub">点击上方 📂 按钮选择文件夹</p>
      </div>`;
  }

  /** 显示"浏览器不支持" */
  _showUnsupported() {
    this.els.emptyState.innerHTML = `
      <div class="empty-state-icon">⚠️</div>
      <h2>浏览器不支持</h2>
      <p>此应用需要使用 File System Access API<br>请使用 <strong>Chrome</strong> 或 <strong>Edge</strong> 浏览器打开</p>`;
    this.els.treeContainer.innerHTML = `
      <div class="tree-empty">
        <p>⚠️ 当前浏览器不支持文件系统访问</p>
        <p class="sub">请使用 Chrome 或 Edge 浏览器</p>
      </div>`;
  }

  /** 切换/选择目录 */
  async pickDirectory() {
    try {
      await this.store.pickDirectory();
      this.expandedDirs.clear();
      this.currentPath = null;
      this.currentData = null;
      this._onDirectoryReady();
      this._savePrefs();
      this.showToast('✅ 已加载笔记目录', 'success');
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        this.showToast('❌ 无法打开目录', 'error');
      }
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

  renderTree() {
    const container = this.els.treeContainer;

    if (this.searchQuery.trim()) {
      const query = this.searchQuery.trim().toLowerCase();
      const allNotes = this.store.collectAllNotes();
      const results = allNotes.filter(n =>
        (n.title || '').toLowerCase().includes(query)
      );
      this.searchResults = results;
      this.els.noteCount.textContent = `🔍 ${results.length} 篇`;

      if (results.length === 0) {
        container.innerHTML = `<div class="tree-empty">未找到匹配「${escapeHtml(query)}」的笔记</div>`;
        return;
      }
      container.innerHTML = results.map(n => this._buildFlatItem(n)).join('');
      return;
    }

    this.searchResults = null;
    const total = this.store.collectAllNotes().length;
    this.els.noteCount.textContent = `${total} 篇笔记`;

    if (this.store.tree.length === 0) {
      container.innerHTML = `
        <div class="tree-empty">
          <p>📭 目录为空</p>
          <p class="sub">右键点击空白处新建笔记或文件夹</p>
        </div>`;
      return;
    }

    container.innerHTML = this.store.tree.map(n => this._buildTreeNode(n, 0)).join('');
  }

  _buildTreeNode(node, depth) {
    const isDir = node.type === 'directory';
    const isExpanded = this.expandedDirs.has(node.path);
    const isActive = node.path === this.currentPath;
    const indent = depth * 20;

    let html = `<div class="tree-node ${isDir ? 'tree-dir' : 'tree-note'} ${isActive ? 'active' : ''}"
                  data-path="${escapeHtml(node.path)}" data-type="${node.type}"
                  style="padding-left:${indent + 8}px">`;

    if (isDir) {
      html += `<span class="tree-toggle">${isExpanded ? '▼' : '▶'}</span>`;
      html += `<span class="tree-icon">${isExpanded ? '📂' : '📁'}</span>`;
    } else {
      html += `<span class="tree-toggle" style="visibility:hidden">▶</span>`;
      html += `<span class="tree-icon">📄</span>`;
    }
    html += `<span class="tree-name">${escapeHtml(isDir ? node.name : (node.title || node.name))}</span>`;
    html += `</div>`;

    if (isDir && isExpanded && node.children && node.children.length > 0) {
      html += `<div class="tree-children">`;
      for (const child of node.children) {
        html += this._buildTreeNode(child, depth + 1);
      }
      html += `</div>`;
    }
    return html;
  }

  _buildFlatItem(node) {
    const isActive = node.path === this.currentPath;
    const dirPath = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
    return `
      <div class="tree-node tree-note ${isActive ? 'active' : ''}"
           data-path="${escapeHtml(node.path)}" data-type="note"
           style="padding-left:8px">
        <span class="tree-toggle" style="visibility:hidden">▶</span>
        <span class="tree-icon">📄</span>
        <span class="tree-name">${escapeHtml(node.title || node.name)}</span>
        ${dirPath ? `<span class="tree-path-hint">${escapeHtml(dirPath)}</span>` : ''}
      </div>`;
  }

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

  async selectNote(node) {
    if (!node || node.type !== 'note') return;
    this.currentPath = node.path;
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

  async createNote(parentPath = '') {
    if (!this.store.rootHandle) {
      this.showToast('⚠️ 请先选择笔记目录', 'info');
      return;
    }
    try {
      const node = await this.store.createNote(parentPath, '未命名笔记');
      if (node) {
        if (parentPath) {
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

  async createDirectory(parentPath = '') {
    if (!this.store.rootHandle) {
      this.showToast('⚠️ 请先选择笔记目录', 'info');
      return;
    }
    const name = prompt('请输入文件夹名称：', '新建文件夹');
    if (!name || !name.trim()) return;
    try {
      await this.store.createDirectory(parentPath, name.trim());
      const dirPath = parentPath
        ? `${parentPath}/${sanitizeFilename(name.trim())}`
        : sanitizeFilename(name.trim());
      this.expandedDirs.add(dirPath);
      this.renderTree();
      this.showToast('📁 文件夹已创建', 'success');
      this._savePrefs();
    } catch (e) {
      console.error('创建文件夹失败:', e);
      this.showToast('❌ 创建文件夹失败', 'error');
    }
  }

  async deleteEntry(path) {
    const node = this.store.findNode(path);
    if (!node) return;
    const label = node.type === 'directory'
      ? `目录「${node.name}」及其所有内容`
      : `笔记「${node.title || node.name}」`;
    if (!confirm(`确定要删除 ${label} 吗？\n此操作不可恢复。`)) return;
    try {
      await this.store.deleteEntry(node);
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

  async renameEntry(path) {
    const node = this.store.findNode(path);
    if (!node) return;

    if (node.type === 'directory') {
      const newName = prompt('请输入新文件夹名称：', node.name);
      if (!newName || !newName.trim() || newName.trim() === node.name) return;
      try {
        const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
        await this.store.createDirectory(parentPath, newName.trim());
        const newPath = parentPath
          ? `${parentPath}/${sanitizeFilename(newName.trim())}`
          : sanitizeFilename(newName.trim());
        for (const child of [...node.children]) {
          await this.store.moveNote(child, newPath);
        }
        await this.store.deleteEntry(node);
        this.expandedDirs.delete(path);
        this.expandedDirs.add(newPath);
        this.render();
        this.showToast('✅ 已重命名', 'success');
      } catch (e) {
        console.error('重命名失败:', e);
        this.showToast('❌ 重命名失败', 'error');
      }
      return;
    }

    const curTitle = node.title || node.name.replace(/\.md$/, '');
    const newTitle = prompt('请输入新笔记名称：', curTitle);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === curTitle) return;

    try {
      const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
      const newName = sanitizeFilename(newTitle.trim()) + '.md';
      await this.store.renameNote(node, newTitle.trim());
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;
      if (this.currentPath === path) {
        this.currentPath = newPath;
        if (this.currentData) this.currentData.title = newTitle.trim();
      }
      this.render();
      this.showToast('✅ 已重命名', 'success');
    } catch (e) {
      this.showToast(`❌ ${e.message || '重命名失败'}`, 'error');
    }
  }

  async moveNote(path) {
    const node = this.store.findNode(path);
    if (!node) return;
    const dirs = this._collectAllDirs();
    if (dirs.length === 0) {
      this.showToast('暂无目标文件夹', 'info');
      return;
    }
    const target = prompt(
      '移动到哪个文件夹？\n（输入路径，留空移到根目录）\n\n可用文件夹：\n' +
      dirs.map(d => `  📁 ${d || '根目录'}`).join('\n'), ''
    );
    if (target === null) return;
    try {
      await this.store.moveNote(node, target.trim());
      this.render();
      this.showToast('✅ 已移动', 'success');
    } catch (e) {
      this.showToast(`❌ ${e.message || '移动失败'}`, 'error');
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
    return result;
  }

  /* ================================================================
     编辑器
     ================================================================ */

  showEmptyState() {
    if (this.store.rootHandle) {
      this.els.emptyState.innerHTML = `
        <div class="empty-state-icon">📝</div>
        <h2>选择一篇笔记</h2>
        <p>在左侧目录树中点击笔记开始编辑<br>或右键目录树 / Ctrl+N 新建笔记</p>
        <div class="shortcut-hints">
          <span><kbd>Ctrl</kbd> + <kbd>N</kbd> 新建笔记</span>
        </div>`;
    }
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

    const dirPath = this.currentPath && this.currentPath.includes('/')
      ? this.currentPath.substring(0, this.currentPath.lastIndexOf('/'))
      : '';
    if (this.els.noteLocation) {
      this.els.noteLocation.innerHTML = dirPath
        ? `📁 ${escapeHtml(dirPath.split('/').join(' › '))}`
        : '📁 根目录';
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
    if (mode === 'preview' || mode === 'split') this.renderPreview();
  }

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

          const newFilename = sanitizeFilename(this.currentData.title) + '.md';
          if (newFilename !== node.name && this.currentData.title.trim()) {
            try {
              const parentPath = this.currentPath.includes('/')
                ? this.currentPath.substring(0, this.currentPath.lastIndexOf('/')) : '';
              await this.store.renameNote(node, this.currentData.title.trim());
              this.currentPath = parentPath ? `${parentPath}/${newFilename}` : newFilename;
            } catch { /* ignore */ }
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
    const isDir = type === 'directory';
    const isNote = type === 'note';
    const isRoot = type === 'root';

    menu.querySelector('[data-action="new-note"]').style.display = (isDir || isRoot) ? '' : 'none';
    menu.querySelector('[data-action="new-folder"]').style.display = (isDir || isRoot) ? '' : 'none';
    menu.querySelector('[data-action="rename"]').style.display = (isDir || isNote) ? '' : 'none';
    menu.querySelector('[data-action="delete"]').style.display = (isDir || isNote) ? '' : 'none';
    menu.querySelector('[data-action="move"]').style.display = isNote ? '' : 'none';

    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 240);
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
      case 'move':
        await this.moveNote(path);
        break;
    }
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
     Toast
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
      return JSON.parse(localStorage.getItem('notes-app-prefs')) || {};
    } catch { return {}; }
  }

  _savePrefs() {
    try {
      localStorage.setItem('notes-app-prefs', JSON.stringify({
        darkMode: this.darkMode,
        lastPath: this.currentPath,
        expandedDirs: [...this.expandedDirs],
      }));
    } catch { /* ignore */ }
  }

  /* ================================================================
     事件绑定
     ================================================================ */

  bindEvents() {
    this.els.treeContainer.addEventListener('click', async (e) => {
      const toggle = e.target.closest('.tree-toggle');
      if (toggle && toggle.style.visibility !== 'hidden') {
        const nodeEl = e.target.closest('.tree-node');
        if (nodeEl) { this.toggleDir(nodeEl.dataset.path); }
        return;
      }
      const treeNode = e.target.closest('.tree-node');
      if (!treeNode) return;
      if (treeNode.dataset.type === 'note') {
        await this.selectNote(treeNode);
      } else if (treeNode.dataset.type === 'directory') {
        this.toggleDir(treeNode.dataset.path);
      }
    });

    this.els.treeContainer.addEventListener('contextmenu', (e) => {
      const treeNode = e.target.closest('.tree-node');
      if (treeNode) {
        this.showContextMenu(e, treeNode.dataset.path, treeNode.dataset.type);
      } else {
        this.showContextMenu(e, '', 'root');
      }
    });

    this.els.contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (item) this.handleContextAction(item.dataset.action);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) this.hideContextMenu();
    });

    this.els.searchInput.addEventListener('input', () => this.handleSearch());

    this.els.noteTitle.addEventListener('input', () => this.scheduleSave());
    this.els.noteContent.addEventListener('input', () => {
      this.scheduleSave();
      this.updateCharCount();
      if (this.viewMode === 'preview' || this.viewMode === 'split') this.renderPreview();
    });
    this.els.noteTags.addEventListener('input', () => this.scheduleSave());

    document.getElementById('btn-new-note').addEventListener('click', () => this.createNote(''));
    document.getElementById('btn-new-folder').addEventListener('click', () => this.createDirectory(''));
    document.getElementById('btn-theme').addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-menu').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('btn-delete-note').addEventListener('click', () => {
      if (this.currentPath) this.deleteEntry(this.currentPath);
    });
    this.els.overlay.addEventListener('click', () => this.closeSidebar());

    if (this.els.btnPickDir) {
      this.els.btnPickDir.addEventListener('click', () => this.pickDirectory());
    }
    // 初始状态下的按钮可能通过 innerHTML 重建，在 _showPickDirectory 里重新绑定

    this.els.viewToggles.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-btn');
      if (btn) this.setViewMode(btn.dataset.view);
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'n') {
        e.preventDefault();
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

document.addEventListener('DOMContentLoaded', () => {
  new NotesApp();
});
