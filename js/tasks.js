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
    const dueDateHtml = task.due_date
      ? `<span class="task-due ${this._isDueSoon(task.due_date) ? 'due-soon' : ''}">Due: ${new Date(task.due_date).toLocaleDateString()}</span>`
      : '';

    const tagsHtml = task.tags?.length
      ? `<div class="task-tags">${task.tags.map((tag) => `<span class="task-tag">${this.escapeHtml(tag)}</span>`).join('')}</div>`
      : '';

    const moveBtns = [
      task.status !== 'todo'       ? `<button class="task-move-btn" onclick="window.TaskManager.moveTask('${task.id}','todo')" title="Move to Todo">\u2190 Todo</button>` : '',
      task.status !== 'inprogress' ? `<button class="task-move-btn" onclick="window.TaskManager.moveTask('${task.id}','inprogress')" title="In Progress">\u26a1 In Progress</button>` : '',
      task.status !== 'done'       ? `<button class="task-move-btn" onclick="window.TaskManager.moveTask('${task.id}','done')" title="Mark Done">\u2713 Done</button>` : ''
    ].filter(Boolean).join('');

    return `
      <div class="task-card priority-${task.priority}" draggable="true" data-id="${task.id}" data-status="${task.status}">
        <div class="task-card-header">
          <span class="task-title">${this.escapeHtml(task.title)}</span>
          <button class="task-delete" onclick="window.TaskManager.deleteTask('${task.id}')" title="Delete task" aria-label="Delete task">&#x2715;</button>
        </div>
        ${task.description ? `<div class="task-desc">${this.escapeHtml(task.description)}</div>` : ''}
        ${tagsHtml}
        <div class="task-footer">
          <span class="task-priority-badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
          ${dueDateHtml}
          <div class="task-move-btns">${moveBtns}</div>
        </div>
      </div>
    `;
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
