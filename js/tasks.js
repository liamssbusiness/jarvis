/**
 * TaskManager — persistent Kanban board with drag-and-drop support.
 * Tasks are stored in localStorage under 'jarvis_tasks'.
 * Exposes window.TaskManager for cross-module access.
 */
class TaskManager {
  constructor() {
    this.tasks = [];
    this._dropCleanup = [];
    this.load();
    this.render();
    this.updateBadge();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  load() {
    try {
      const saved = localStorage.getItem('jarvis_tasks');
      this.tasks = saved ? JSON.parse(saved) : [];
      // Validate structure — remove any malformed entries
      this.tasks = this.tasks.filter(
        (t) => t && typeof t.id === 'string' && typeof t.title === 'string'
      );
    } catch {
      this.tasks = [];
    }
  }

  save() {
    try {
      localStorage.setItem('jarvis_tasks', JSON.stringify(this.tasks));
    } catch (e) {
      console.warn('TaskManager: could not save tasks', e.message);
    }
    this.updateBadge();
    // Fire-and-forget sync to server (never blocks UI, silent on failure)
    this._syncToServer();
  }

  /**
   * Push the current local task list to the server's shared sync store so
   * the Telegram bot (and any other clients) can see the latest state.
   * Uses full replacement semantics so local deletions propagate.
   */
  _syncToServer() {
    // Debounce — collapse rapid saves into one network call
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      try {
        fetch('/api/alerts?action=sync-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks_replace: this.tasks })
        }).catch(() => { /* silent */ });
      } catch { /* silent */ }
    }, 500);
  }

  /**
   * Pull the server snapshot and merge any remote changes into local state.
   * Server tasks with newer `updated` timestamps overwrite local ones; tasks
   * present locally but missing from the server (just created offline) are
   * preserved. Called periodically by app.js.
   */
  async pullFromServer() {
    try {
      const res = await fetch('/api/alerts?action=sync-snapshot');
      if (!res.ok) return false;
      const data = await res.json();
      const serverTasks = data?.state?.tasks;
      if (!Array.isArray(serverTasks)) return false;

      const byId = new Map();
      this.tasks.forEach(t => byId.set(t.id, t));

      let changed = false;
      for (const sTask of serverTasks) {
        if (!sTask || !sTask.id) continue;
        const local = byId.get(sTask.id);
        if (!local) {
          byId.set(sTask.id, sTask);
          changed = true;
          continue;
        }
        const sT = new Date(sTask.updated || sTask.created || 0).getTime();
        const lT = new Date(local.updated || local.created || 0).getTime();
        if (sT > lT) {
          byId.set(sTask.id, { ...local, ...sTask });
          changed = true;
        }
      }

      if (changed) {
        this.tasks = Array.from(byId.values())
          .filter(t => t && typeof t.id === 'string' && typeof t.title === 'string');
        // Persist locally WITHOUT re-syncing (avoid feedback loop)
        try {
          localStorage.setItem('jarvis_tasks', JSON.stringify(this.tasks));
        } catch {}
        this.updateBadge();
        this.render();
      }
      return changed;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getTasks() {
    return [...this.tasks];
  }

  getTask(id) {
    return this.tasks.find((t) => t.id === id) || null;
  }

  addTask(task) {
    if (!task || !task.title?.trim()) {
      console.warn('TaskManager.addTask: title is required');
      return null;
    }

    const newTask = {
      id:          task.id          || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title:       task.title.trim(),
      description: (task.description || '').trim(),
      priority:    this._validPriority(task.priority),
      status:      this._validStatus(task.status),
      created:     task.created     || new Date().toISOString(),
      due_date:    task.due_date    || null,
      tags:        Array.isArray(task.tags) ? task.tags : []
    };

    this.tasks.push(newTask);
    this.save();
    this.render();
    window.NotifManager?.toast(`Task added: ${newTask.title}`, 'success');
    return newTask;
  }

  updateTask(id, updates) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;

    const sanitised = {};
    if (updates.title       !== undefined) sanitised.title       = updates.title.trim();
    if (updates.description !== undefined) sanitised.description = updates.description.trim();
    if (updates.priority    !== undefined) sanitised.priority    = this._validPriority(updates.priority);
    if (updates.status      !== undefined) sanitised.status      = this._validStatus(updates.status);
    if (updates.due_date    !== undefined) sanitised.due_date    = updates.due_date;
    if (updates.tags        !== undefined) sanitised.tags        = Array.isArray(updates.tags) ? updates.tags : [];

    this.tasks[idx] = { ...this.tasks[idx], ...sanitised, updated: new Date().toISOString() };
    this.save();
    this.render();
    return true;
  }

  deleteTask(id) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length !== before) {
      this.save();
      this.render();
      return true;
    }
    return false;
  }

  moveTask(id, newStatus) {
    return this.updateTask(id, { status: newStatus });
  }

  clearCompleted() {
    this.tasks = this.tasks.filter((t) => t.status !== 'done');
    this.save();
    this.render();
  }

  importTasks(taskArray) {
    if (!Array.isArray(taskArray)) return 0;
    let added = 0;
    taskArray.forEach((t) => {
      if (t && t.title) {
        this.addTask(t);
        added++;
      }
    });
    return added;
  }

  exportTasks() {
    return JSON.stringify(this.tasks, null, 2);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render() {
    // Tear down old drop-zone listeners before re-rendering
    this._dropCleanup.forEach((fn) => fn());
    this._dropCleanup = [];

    const statusOrder = ['todo', 'inprogress', 'done'];
    const cols = { todo: [], inprogress: [], done: [] };

    this.tasks.forEach((t) => {
      if (cols[t.status] !== undefined) {
        cols[t.status].push(t);
      } else {
        cols.todo.push(t);
      }
    });

    // Sort within each column: high > medium > low, then by creation date
    const priorityRank = { high: 0, medium: 1, low: 2 };
    statusOrder.forEach((status) => {
      cols[status].sort((a, b) => {
        const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
        if (pDiff !== 0) return pDiff;
        return new Date(b.created) - new Date(a.created);
      });
    });

    statusOrder.forEach((status) => {
      const col   = document.getElementById(`col-${status}`);
      const count = document.getElementById(`count-${status}`);
      if (!col) return;

      const tasks = cols[status];
      if (count) count.textContent = tasks.length;

      if (!tasks.length) {
        col.innerHTML = `<div class="task-empty">No tasks here</div>`;
      } else {
        col.innerHTML = tasks.map((task) => this._renderCard(task)).join('');
      }

      // Wire up drag events on the new card elements
      col.querySelectorAll('.task-card').forEach((card) => {
        const onDragStart = (e) => {
          e.dataTransfer.setData('taskId', card.dataset.id);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
        };
        const onDragEnd = () => card.classList.remove('dragging');
        card.addEventListener('dragstart', onDragStart);
        card.addEventListener('dragend', onDragEnd);
        this._dropCleanup.push(() => {
          card.removeEventListener('dragstart', onDragStart);
          card.removeEventListener('dragend', onDragEnd);
        });
      });
    });

    // Wire up drop zones
    document.querySelectorAll('.kanban-cards').forEach((zone) => {
      const onDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
      };
      const onDragLeave = (e) => {
        // Only remove class if leaving the zone entirely (not entering a child)
        if (!zone.contains(e.relatedTarget)) {
          zone.classList.remove('drag-over');
        }
      };
      const onDrop = (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const taskId   = e.dataTransfer.getData('taskId');
        const colEl    = zone.closest('.kanban-col');
        const newStatus = colEl?.dataset.status;
        if (taskId && newStatus) this.moveTask(taskId, newStatus);
      };
      zone.addEventListener('dragover', onDragOver);
      zone.addEventListener('dragleave', onDragLeave);
      zone.addEventListener('drop', onDrop);
      this._dropCleanup.push(() => {
        zone.removeEventListener('dragover', onDragOver);
        zone.removeEventListener('dragleave', onDragLeave);
        zone.removeEventListener('drop', onDrop);
      });
    });
  }

  _renderCard(task) {
    const status   = task.status;
    const shortId  = task.id.slice(-4).toUpperCase();
    const isOverdueFlag = this._isOverdue(task);

    const dueDateHtml = task.due_date
      ? `<span class="task-due-chip${isOverdueFlag ? ' overdue' : ''}">${this._formatDue(task.due_date)}</span>`
      : '';

    const statusBtns = [
      status !== 'inprogress' ? `<button class="task-status-btn" onclick="window.TaskManager.moveTask('${task.id}','inprogress')" title="Move to In Progress">&#9654;</button>` : '',
      status !== 'done'       ? `<button class="task-status-btn done" onclick="window.TaskManager.moveTask('${task.id}','done')" title="Mark Done">&#10003;</button>` : ''
    ].filter(Boolean).join('');

    const descHtml = task.description
      ? `<div class="task-card-desc">${this.escapeHtml(task.description.substring(0, 80))}${task.description.length > 80 ? '...' : ''}</div>`
      : '';

    return `
      <div class="task-card priority-${task.priority}" draggable="true" data-id="${task.id}" data-status="${task.status}">
        <div class="task-card-top">
          <span class="task-card-id">#${shortId}</span>
          <div class="task-card-actions">
            <button class="task-action-btn" onclick="window.ExpandModal && window.ExpandModal.open('Task Detail', window.TaskManager.getTaskDetailHTML('${task.id}'))" title="View detail">&#8857;</button>
            <button class="task-action-btn danger" onclick="window.TaskManager.deleteTask('${task.id}')" title="Delete">&#x2715;</button>
          </div>
        </div>
        <div class="task-card-title">${this.escapeHtml(task.title)}</div>
        ${descHtml}
        <div class="task-card-footer">
          <span class="priority-pip pip-${task.priority}"></span>
          ${dueDateHtml}
          <div class="task-status-btns">${statusBtns}</div>
        </div>
      </div>
    `;
  }

  getTaskDetailHTML(id) {
    const task = this.getTask(id);
    if (!task) return '<p style="color:var(--text-muted);font-size:13px;">Task not found.</p>';

    const statusLabels = { todo: 'TO DO', inprogress: 'IN PROGRESS', done: 'DONE' };
    const priorityLabel = task.priority.toUpperCase();
    const createdStr    = task.created ? new Date(task.created).toLocaleString() : '—';
    const updatedStr    = task.updated ? new Date(task.updated).toLocaleString() : '—';
    const dueDateStr    = task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : null;
    const overdueFlag   = this._isOverdue(task);

    const tagsHtml = task.tags?.length
      ? task.tags.map(t => `<span style="padding:2px 8px;border-radius:10px;border:1px solid var(--glass-border);font-size:11px;font-family:var(--font-mono);color:var(--text-muted);">${this.escapeHtml(t)}</span>`).join('')
      : '';

    return `
      <div class="task-detail-header">
        <div class="task-detail-title">${this.escapeHtml(task.title)}</div>
        <div class="task-detail-meta">
          <span class="task-detail-badge ${task.priority}">${priorityLabel}</span>
          <span class="task-detail-status">${statusLabels[task.status] || task.status}</span>
          ${dueDateStr ? `<span class="task-detail-status${overdueFlag ? '" style="color:var(--red);border-color:rgba(255,51,102,0.3)' : ''}">${overdueFlag ? 'OVERDUE — ' : ''}Due ${dueDateStr}</span>` : ''}
        </div>
      </div>
      ${task.description ? `<div class="task-detail-desc">${this.escapeHtml(task.description)}</div>` : ''}
      ${tagsHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">${tagsHtml}</div>` : ''}
      <div class="modal-detail-grid" style="margin-top:16px;">
        <div class="task-detail-field">
          <div class="task-detail-field-label">Created</div>
          <div class="task-detail-field-val" style="font-family:var(--font-mono);font-size:12px;">${createdStr}</div>
        </div>
        ${task.updated ? `<div class="task-detail-field"><div class="task-detail-field-label">Last Updated</div><div class="task-detail-field-val" style="font-family:var(--font-mono);font-size:12px;">${updatedStr}</div></div>` : ''}
        <div class="task-detail-field">
          <div class="task-detail-field-label">Task ID</div>
          <div class="task-detail-field-val" style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${this.escapeHtml(task.id)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;">
        ${task.status !== 'todo'       ? `<button class="btn-ghost" onclick="window.TaskManager.moveTask('${task.id}','todo');window.ExpandModal.close()">&#8592; To Do</button>` : ''}
        ${task.status !== 'inprogress' ? `<button class="btn-primary" onclick="window.TaskManager.moveTask('${task.id}','inprogress');window.ExpandModal.close()">&#9654; In Progress</button>` : ''}
        ${task.status !== 'done'       ? `<button class="btn-primary" onclick="window.TaskManager.moveTask('${task.id}','done');window.ExpandModal.close()">&#10003; Mark Done</button>` : ''}
        <button class="btn-danger" onclick="window.TaskManager.deleteTask('${task.id}');window.ExpandModal.close()" style="margin-left:auto;">&#x2715; Delete</button>
      </div>
    `;
  }

  _formatDue(dueDateStr) {
    try {
      const d    = new Date(dueDateStr);
      const now  = new Date();
      const diff = Math.ceil((d - now) / 86400000);
      if (diff < 0)   return `${Math.abs(diff)}d overdue`;
      if (diff === 0) return 'Due today';
      if (diff === 1) return 'Due tomorrow';
      if (diff <= 7)  return `Due in ${diff}d`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dueDateStr;
    }
  }

  // ---------------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------------

  updateBadge() {
    const pending = this.tasks.filter((t) => t.status !== 'done').length;
    const badge   = document.getElementById('task-badge');
    if (!badge) return;
    if (pending > 0) {
      badge.textContent = pending > 99 ? '99+' : String(pending);
      badge.classList.remove('hidden');
      badge.setAttribute('aria-label', `${pending} pending tasks`);
    } else {
      badge.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Filtering / Searching
  // ---------------------------------------------------------------------------

  filterByPriority(priority) {
    return this.tasks.filter((t) => t.priority === priority);
  }

  filterByStatus(status) {
    return this.tasks.filter((t) => t.status === status);
  }

  search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return this.getTasks();
    return this.tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  getStats() {
    return {
      total:      this.tasks.length,
      todo:       this.tasks.filter((t) => t.status === 'todo').length,
      inprogress: this.tasks.filter((t) => t.status === 'inprogress').length,
      done:       this.tasks.filter((t) => t.status === 'done').length,
      high:       this.tasks.filter((t) => t.priority === 'high').length,
      overdue:    this.tasks.filter((t) => this._isOverdue(t)).length
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  _validPriority(p) {
    return ['high', 'medium', 'low'].includes(p) ? p : 'medium';
  }

  _validStatus(s) {
    return ['todo', 'inprogress', 'done'].includes(s) ? s : 'todo';
  }

  _isDueSoon(dueDateStr) {
    if (!dueDateStr) return false;
    const diff = new Date(dueDateStr) - Date.now();
    return diff > 0 && diff < 48 * 60 * 60 * 1000; // within 48 hours
  }

  _isOverdue(task) {
    if (!task.due_date || task.status === 'done') return false;
    return new Date(task.due_date) < new Date();
  }

  // ---------------------------------------------------------------------------
  // Destroy / Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    this._dropCleanup.forEach((fn) => fn());
    this._dropCleanup = [];
  }
}
