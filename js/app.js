/* ============================================================
   个人笔记管理 — 应用逻辑
   纯前端静态页面，使用 localStorage 持久化数据
   ============================================================ */

class NotesApp {
  // --- 常量 ---
  STORAGE_KEY = 'notes-app-data';
  STORAGE_VERSION = 1;

  // --- 状态 ---
  notes = [];
  currentId = null;
  viewMode = 'edit';       // 'edit' | 'preview' | 'split'
  searchQuery = '';
  categoryFilter = 'all';
  sortBy = 'updated';
  darkMode = false;
  saveTimer = null;
  sidebarOpen = false;

  /* ================================================================
     初始化
     ================================================================ */

  constructor() {
    this.cacheDom();
    this.loadFromStorage();
    this.initTheme();
    this.render();
    this.bindEvents();
    this.restoreLastSession();
  }

  /** 缓存 DOM 引用 */
  cacheDom() {
    this.els = {
      sidebar:        document.getElementById('sidebar'),
      overlay:        document.getElementById('sidebar-overlay'),
      noteList:       document.getElementById('note-list'),
      searchInput:    document.getElementById('search-input'),
      categoryFilter: document.getElementById('category-filter'),
      sortSelect:     document.getElementById('sort-select'),
      emptyState:     document.getElementById('empty-state'),
      editorContainer:document.getElementById('editor-container'),
      noteTitle:      document.getElementById('note-title'),
      noteContent:    document.getElementById('note-content'),
      noteCategory:   document.getElementById('note-category'),
      noteTags:       document.getElementById('note-tags'),
      editPane:       document.getElementById('edit-pane'),
      previewPane:    document.getElementById('preview-pane'),
      markdownPreview:document.getElementById('markdown-preview'),
      editorArea:     document.getElementById('editor-area'),
      charCount:      document.getElementById('char-count'),
      saveStatus:     document.getElementById('save-status'),
      noteCount:      document.getElementById('note-count'),
      toastContainer: document.getElementById('toast-container'),
      importFile:     document.getElementById('import-file'),
      pinBtn:         document.getElementById('btn-pin'),
      viewToggles:    document.getElementById('view-toggles'),
    };
  }

  /* ================================================================
     数据持久化
     ================================================================ */

  /** 从 localStorage 加载笔记和偏好设置 */
  loadFromStorage() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) { this.notes = []; return; }

      const data = JSON.parse(raw);
      // 兼容旧版本数据格式
      if (data.version !== this.STORAGE_VERSION) {
        this.notes = Array.isArray(data) ? data : (data.notes || []);
      } else {
        this.notes = data.notes || [];
      }

      // 加载偏好
      this.currentId = data.lastNoteId || null;
      this.sortBy = data.sortBy || 'updated';
      this.darkMode = data.darkMode;

      // 同步排序下拉框
      if (this.els.sortSelect) {
        this.els.sortSelect.value = this.sortBy;
      }
    } catch (e) {
      console.error('加载数据失败:', e);
      this.notes = [];
      this.showToast('数据加载失败，已重置', 'error');
    }
  }

  /** 保存笔记到 localStorage */
  saveToStorage() {
    try {
      const data = {
        version: this.STORAGE_VERSION,
        notes: this.notes,
        sortBy: this.sortBy,
        darkMode: this.darkMode,
        lastNoteId: this.currentId,
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('保存失败:', e);
      this.showToast('存储空间不足！请导出备份后清理旧笔记', 'error');
      return false;
    }
  }

  /* ================================================================
     主题管理
     ================================================================ */

  initTheme() {
    // 优先使用用户保存的偏好，其次使用系统偏好
    if (this.darkMode === undefined) {
      this.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    this.applyTheme();
    this.updateThemeButton();
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.darkMode ? 'dark' : 'light');
  }

  toggleTheme() {
    this.darkMode = !this.darkMode;
    this.applyTheme();
    this.updateThemeButton();
    this.saveToStorage();
  }

  updateThemeButton() {
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = this.darkMode ? '☀️' : '🌙';
  }

  /* ================================================================
     笔记 CRUD
     ================================================================ */

  /** 生成唯一 ID */
  generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
  }

  /** 创建新笔记 */
  createNote() {
    const now = new Date().toISOString();
    const note = {
      id: this.generateId(),
      title: '',
      content: '',
      category: '',
      tags: [],
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };

    this.notes.unshift(note);
    this.saveToStorage();
    this.selectNote(note.id);
    this.renderNoteList();

    // 自动聚焦标题输入
    requestAnimationFrame(() => {
      this.els.noteTitle.focus();
    });

    this.showToast('✅ 新笔记已创建', 'success');
    return note;
  }

  /** 获取当前笔记 */
  getCurrentNote() {
    return this.notes.find(n => n.id === this.currentId) || null;
  }

  /** 更新当前笔记（部分字段） */
  updateCurrentNote(changes) {
    const note = this.getCurrentNote();
    if (!note) return;

    Object.assign(note, changes);
    note.updatedAt = new Date().toISOString();

    // 如果置顶状态改变，重新排序
    if ('pinned' in changes) {
      this.sortNotesInPlace();
    }

    this.scheduleSave();
  }

  /** 删除笔记 */
  deleteNote(id) {
    const idx = this.notes.findIndex(n => n.id === id);
    if (idx === -1) return;

    const note = this.notes[idx];
    if (!confirm(`确定要删除笔记「${note.title || '无标题'}」吗？\n此操作不可恢复。`)) {
      return;
    }

    this.notes.splice(idx, 1);

    if (this.currentId === id) {
      this.currentId = null;
      this.showEmptyState();
    }

    this.saveToStorage();
    this.renderNoteList();
    this.showToast('🗑️ 笔记已删除', 'info');
  }

  /** 选中笔记 */
  selectNote(id) {
    this.currentId = id;
    this.showEditor();
    this.fillEditor();
    this.renderNoteList(); // 更新列表高亮
    this.closeSidebar();   // 移动端关闭侧边栏
    this.saveToStorage();  // 保存上次选中的笔记
  }

  /** 切换置顶 */
  togglePin() {
    const note = this.getCurrentNote();
    if (!note) return;
    this.updateCurrentNote({ pinned: !note.pinned });
    this.fillEditor(); // 更新置顶按钮状态
    this.renderNoteList();
  }

  /* ================================================================
     搜索 & 排序 & 过滤
     ================================================================ */

  /** 获取过滤并排序后的笔记列表 */
  getFilteredNotes() {
    let result = [...this.notes];

    // 搜索过滤
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      result = result.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    // 分类过滤
    if (this.categoryFilter !== 'all') {
      result = result.filter(n => n.category === this.categoryFilter);
    }

    // 排序：置顶优先，然后按所选排序方式
    result.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      switch (this.sortBy) {
        case 'created':
          return b.createdAt.localeCompare(a.createdAt);
        case 'title':
          return (a.title || '').localeCompare(b.title || '', 'zh');
        case 'updated':
        default:
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });

    return result;
  }

  /** 原地重排笔记（用于置顶状态变更） */
  sortNotesInPlace() {
    this.notes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  /* ================================================================
     渲染
     ================================================================ */

  /** 完整渲染（初始化时调用） */
  render() {
    this.renderNoteList();
    if (this.currentId && this.getCurrentNote()) {
      this.showEditor();
      this.fillEditor();
    } else {
      this.currentId = null;
      this.showEmptyState();
    }
  }

  /** 渲染侧边栏笔记列表 */
  renderNoteList() {
    const notes = this.getFilteredNotes();
    this.els.noteCount.textContent = `${notes.length} 篇笔记`;

    if (notes.length === 0) {
      const hasFilter = this.searchQuery || this.categoryFilter !== 'all';
      this.els.noteList.innerHTML = `
        <div class="note-list-empty">
          <p>${hasFilter ? '🔍 没有匹配的笔记' : '✨ 还没有笔记'}</p>
          <p class="sub">${hasFilter ? '尝试其他搜索词或分类' : '点击「+ 新建笔记」开始记录'}</p>
        </div>
      `;
      return;
    }

    this.els.noteList.innerHTML = notes.map(n => this.buildNoteItemHTML(n)).join('');
  }

  /** 构建单条笔记项的 HTML */
  buildNoteItemHTML(note) {
    const isActive = note.id === this.currentId;
    const title = note.title || '无标题';
    const preview = this.stripMarkdown(note.content).substring(0, 80) || '空笔记';
    const category = note.category || '';
    const dateStr = this.formatDate(note.updatedAt);
    const tags = (note.tags || []).slice(0, 3);

    return `
      <div class="note-item${isActive ? ' active' : ''}${note.pinned ? ' pinned' : ''}"
           data-id="${this.escapeAttr(note.id)}">
        <div class="note-item-header">
          ${note.pinned ? '<span class="pin-icon">📌</span>' : ''}
          ${category ? `<span class="category-badge cat-${this.escapeAttr(category)}">${this.escapeHtml(category)}</span>` : ''}
        </div>
        <div class="note-item-title">${this.escapeHtml(title)}</div>
        <div class="note-item-preview">${this.escapeHtml(preview)}</div>
        <div class="note-item-footer">
          <span class="note-item-date">${dateStr}</span>
          ${tags.length ? `<span class="note-item-tags">${tags.map(t =>
            `<span class="tag-badge">#${this.escapeHtml(t)}</span>`
          ).join('')}</span>` : ''}
        </div>
      </div>`;
  }

  /** 显示空状态 */
  showEmptyState() {
    this.els.emptyState.style.display = '';
    this.els.editorContainer.style.display = 'none';
  }

  /** 显示编辑器 */
  showEditor() {
    this.els.emptyState.style.display = 'none';
    this.els.editorContainer.style.display = '';
  }

  /** 用当前笔记数据填充编辑器 */
  fillEditor() {
    const note = this.getCurrentNote();
    if (!note) return;

    this.els.noteTitle.value = note.title;
    this.els.noteContent.value = note.content;
    this.els.noteCategory.value = note.category || '';
    this.els.noteTags.value = (note.tags || []).join(', ');

    // 更新置顶按钮
    this.els.pinBtn.textContent = note.pinned ? '📌' : '📍';
    this.els.pinBtn.title = note.pinned ? '取消置顶' : '置顶';

    // 更新字数统计
    this.updateCharCount();
    // 更新预览
    this.renderPreview();
  }

  /** 更新字数统计 */
  updateCharCount() {
    const len = this.els.noteContent.value.length;
    this.els.charCount.textContent = `${len.toLocaleString()} 字符`;
  }

  /** 渲染 Markdown 预览 */
  renderPreview() {
    const content = this.els.noteContent.value;
    if (typeof marked !== 'undefined' && marked.parse) {
      marked.setOptions?.({ breaks: true, gfm: true });
      this.els.markdownPreview.innerHTML = marked.parse(content);
    } else if (typeof marked !== 'undefined') {
      // 旧版 marked
      this.els.markdownPreview.innerHTML = marked(content);
    } else {
      // 降级：纯文本转义
      this.els.markdownPreview.innerHTML = this.escapeHtml(content)
        .replace(/\n/g, '<br>');
    }
  }

  /** 切换视图模式 */
  setViewMode(mode) {
    this.viewMode = mode;
    this.els.editorArea.className = `editor-area mode-${mode}`;

    // 更新按钮状态
    this.els.viewToggles.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });

    if (mode === 'preview' || mode === 'split') {
      this.renderPreview();
    }
  }

  /** 显示保存状态 */
  showSaveStatus(status) {
    const el = this.els.saveStatus;
    if (status === 'saving') {
      el.textContent = '💾 保存中...';
      el.className = 'save-status saving';
    } else if (status === 'saved') {
      el.textContent = '✅ 已保存';
      el.className = 'save-status saved';
    }
  }

  /* ================================================================
     自动保存
     ================================================================ */

  scheduleSave() {
    this.showSaveStatus('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToStorage();
      this.showSaveStatus('saved');
      // 更新列表中的预览文字和日期
      this.renderNoteList();
    }, 600);
  }

  /* ================================================================
     导出 & 导入
     ================================================================ */

  /** 导出笔记为 JSON 文件 */
  exportNotes() {
    const data = {
      version: this.STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      notes: this.notes,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast(`📤 已导出 ${this.notes.length} 篇笔记`, 'success');
  }

  /** 触发导入文件选择 */
  importNotes() {
    this.els.importFile.click();
  }

  /** 处理导入文件 */
  handleImportFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const importedNotes = this.validateImportData(data);

        if (!importedNotes) {
          throw new Error('文件格式不正确');
        }

        const action = confirm(
          `发现 ${importedNotes.length} 篇笔记。\n\n` +
          `• 点击「确定」：合并导入（保留已有笔记）\n` +
          `• 点击「取消」：放弃导入`
        );

        if (action) {
          // 合并导入：跳过 ID 重复的笔记
          const existingIds = new Set(this.notes.map(n => n.id));
          const newNotes = importedNotes.filter(n => !existingIds.has(n.id));

          if (newNotes.length === 0) {
            this.showToast('所有笔记已存在，无需导入', 'info');
            return;
          }

          this.notes.push(...newNotes);
          this.saveToStorage();
          this.renderNoteList();
          this.showToast(`📥 成功导入 ${newNotes.length} 篇笔记`, 'success');
        }
      } catch (err) {
        console.error('导入失败:', err);
        this.showToast('❌ 导入失败：文件格式不正确', 'error');
      }
    };
    reader.readAsText(file);
  }

  /** 验证导入数据的格式 */
  validateImportData(data) {
    if (!data || typeof data !== 'object') return null;
    // 支持 { version, notes } 格式或纯数组
    const notes = Array.isArray(data) ? data : data.notes;
    if (!Array.isArray(notes)) return null;

    // 确保每条笔记包含必要字段
    const valid = notes.filter(n =>
      n && typeof n === 'object' && typeof n.id === 'string'
    ).map(n => ({
      id: n.id,
      title: typeof n.title === 'string' ? n.title : '',
      content: typeof n.content === 'string' ? n.content : '',
      category: typeof n.category === 'string' ? n.category : '',
      tags: Array.isArray(n.tags) ? n.tags : [],
      pinned: !!n.pinned,
      createdAt: n.createdAt || new Date().toISOString(),
      updatedAt: n.updatedAt || new Date().toISOString(),
    }));

    return valid.length > 0 ? valid : null;
  }

  /* ================================================================
     移动端侧边栏
     ================================================================ */

  toggleSidebar() {
    if (this.sidebarOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
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

  /** 恢复上次会话：选中上次打开的笔记 */
  restoreLastSession() {
    if (this.currentId && this.getCurrentNote()) {
      this.selectNote(this.currentId);
    } else if (this.notes.length > 0) {
      this.selectNote(this.notes[0].id);
    }
  }

  /* ================================================================
     Toast 通知
     ================================================================ */

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    this.els.toastContainer.appendChild(toast);

    // 自动消失
    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, 2500);
  }

  /* ================================================================
     事件绑定
     ================================================================ */

  bindEvents() {
    // --- 侧边栏 ---
    this.els.noteList.addEventListener('click', (e) => {
      const item = e.target.closest('.note-item');
      if (item) {
        this.selectNote(item.dataset.id);
      }
    });

    this.els.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderNoteList();
    });

    this.els.categoryFilter.addEventListener('change', (e) => {
      this.categoryFilter = e.target.value;
      this.renderNoteList();
    });

    this.els.sortSelect.addEventListener('change', () => {
      this.sortBy = this.els.sortSelect.value;
      this.saveToStorage();
      this.renderNoteList();
      if (this.currentId) this.selectNote(this.currentId);
    });

    // --- 编辑器 ---
    this.els.noteTitle.addEventListener('input', () => {
      this.updateCurrentNote({ title: this.els.noteTitle.value });
    });

    this.els.noteContent.addEventListener('input', () => {
      this.updateCurrentNote({ content: this.els.noteContent.value });
      this.updateCharCount();
      // 预览模式下实时更新
      if (this.viewMode === 'preview' || this.viewMode === 'split') {
        this.renderPreview();
      }
    });

    this.els.noteCategory.addEventListener('change', () => {
      this.updateCurrentNote({ category: this.els.noteCategory.value });
      this.renderNoteList();
    });

    this.els.noteTags.addEventListener('input', () => {
      const tags = this.els.noteTags.value
        .split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean);
      this.updateCurrentNote({ tags });
    });

    // --- 按钮 ---
    document.getElementById('btn-new-note').addEventListener('click', () => this.createNote());
    document.getElementById('btn-empty-new').addEventListener('click', () => this.createNote());
    document.getElementById('btn-theme').addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-export').addEventListener('click', () => this.exportNotes());
    document.getElementById('btn-import').addEventListener('click', () => this.importNotes());
    document.getElementById('btn-pin').addEventListener('click', () => this.togglePin());
    document.getElementById('btn-menu').addEventListener('click', () => this.toggleSidebar());
    this.els.overlay.addEventListener('click', () => this.closeSidebar());

    document.getElementById('btn-delete-note').addEventListener('click', () => {
      if (this.currentId) this.deleteNote(this.currentId);
    });

    // --- 视图切换 ---
    this.els.viewToggles.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-btn');
      if (btn) {
        this.setViewMode(btn.dataset.view);
      }
    });

    // --- 导入文件 ---
    this.els.importFile.addEventListener('change', (e) => {
      this.handleImportFile(e.target.files[0]);
      e.target.value = ''; // 允许重复选择同一文件
    });

    // --- 键盘快捷键 ---
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey; // Mac 支持 Cmd

      // Ctrl+N: 新建笔记
      if (mod && e.key === 'n') {
        e.preventDefault();
        this.createNote();
      }
      // Ctrl+S: 手动保存
      if (mod && e.key === 's') {
        e.preventDefault();
        this.saveToStorage();
        this.showSaveStatus('saved');
        this.renderNoteList();
        this.showToast('✅ 笔记已保存', 'success');
      }
      // Escape: 关闭移动端侧边栏
      if (e.key === 'Escape' && this.sidebarOpen) {
        this.closeSidebar();
      }
    });

    // --- 监听系统主题变化 ---
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      // 仅当用户没有手动设置过主题时才跟随系统
      if (!this.darkMode && e.matches) {
        this.darkMode = true;
        this.applyTheme();
        this.updateThemeButton();
        this.saveToStorage();
      } else if (this.darkMode && !e.matches) {
        this.darkMode = false;
        this.applyTheme();
        this.updateThemeButton();
        this.saveToStorage();
      }
    });
  }

  /* ================================================================
     工具方法
     ================================================================ */

  /** HTML 转义（防 XSS） */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** 属性值转义 */
  escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 去除 Markdown 标记，返回纯文本预览 */
  stripMarkdown(text) {
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
      .replace(/^[*-+]\s/gm, '')
      .replace(/^\d+\.\s/gm, '')
      .replace(/>\s/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 格式化日期为相对时间 */
  formatDate(dateStr) {
    if (!dateStr) return '';

    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    if (days < 30) return `${Math.floor(days / 7)} 周前`;

    // 超过30天显示具体日期
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}

/* ================================================================
   启动应用
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  new NotesApp();
});
