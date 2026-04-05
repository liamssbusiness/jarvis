// ── Expand Modal ───────────────────────────────────────────────────────────────
class ExpandModal {
  constructor() {
    this.modal = null;
    this.title = null;
    this.body  = null;
    // Bind escape key always
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  }
  _init() {
    if (this.modal) return;
    this.modal = document.getElementById('expand-modal');
    this.title = document.getElementById('expand-modal-title');
    this.body  = document.getElementById('expand-modal-body');
    document.getElementById('expand-modal-close')?.addEventListener('click', () => this.close());
    document.querySelector('.expand-modal-backdrop')?.addEventListener('click', () => this.close());
  }
  open(title, html) {
    this._init();
    if (!this.modal) return;
    this.title.textContent = title;
    this.body.innerHTML = html;
    this.modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }
  close() {
    this._init();
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
}
window.ExpandModal = new ExpandModal();

// JARVIS App Initialization

document.addEventListener('DOMContentLoaded', async () => {
  const loadingScreen = document.getElementById('loading-screen');
  const app = document.getElementById('app');

  try {
    // Notifications (no async dependencies)
    window.NotifManager = new NotificationManager();

    // Voice
    window.VoiceManager = new VoiceManager();

    // Widgets — may fetch initial data
    window.WidgetManager = new WidgetManager();
    await window.WidgetManager.initialize();

    // Tasks
    window.TaskManager = new TaskManager();

    // Kick off an initial server sync + periodic polling every 30s
    startServerSync();

    // JARVIS engine — depends on all others being ready
    window.JarvisEngine = new JarvisEngine();

    // Wire up dock navigation
    setupDock();

    // Subtle arc reactor parallax on mouse movement
    setupArcReactorParallax();

    // Wire up header / panel controls
    setupHeaderButtons();

    // Chat resize handle
    setupChatResize();

    // Attempt local agent connection (optional feature)
    connectLocalAgent();

    // Request push notification permission
    if ('Notification' in window) {
      Notification.requestPermission().catch(() => {});
    }

    // Register service worker for offline / push notifications
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Let the loading animation play for a moment, then fade out
    await sleep(1500);

    if (loadingScreen) {
      loadingScreen.style.transition = 'opacity 0.5s';
      loadingScreen.style.opacity = '0';
      await sleep(500);
      loadingScreen.classList.add('hidden');
    }

    if (app) {
      app.classList.remove('hidden');
      app.style.opacity = '0';
      app.style.transition = 'opacity 0.5s';
      // Force a reflow so the transition actually fires
      void app.offsetHeight;
      app.style.opacity = '1';
    }

    // Runtime UI updates
    updateGreeting();
    startClock();
    startUptime();
    initJarvisCharacter();

  } catch (error) {
    console.error('JARVIS initialization error:', error);
    // Always show the app even if something failed
    if (loadingScreen) loadingScreen.classList.add('hidden');
    if (app) app.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------------
// Dock navigation
// ---------------------------------------------------------------------------

// Full panels that replace the main content area
const FULL_PANELS = ['tasks', 'briefing'];

function showHomeView() {
  const main = document.getElementById('main');
  if (main) main.classList.remove('full-panel-active');
  const widgetsLayer = document.getElementById('widgets-layer');
  const arcContainer = document.getElementById('arc-reactor-container');
  const chatContainer = document.getElementById('chat-container');
  if (widgetsLayer)  widgetsLayer.style.display  = '';
  if (arcContainer)  arcContainer.style.display  = '';
  if (chatContainer) chatContainer.style.display = '';
}

function showFullPanel(panelEl) {
  const main = document.getElementById('main');
  if (main) main.classList.add('full-panel-active');
  const widgetsLayer = document.getElementById('widgets-layer');
  const arcContainer = document.getElementById('arc-reactor-container');
  const chatContainer = document.getElementById('chat-container');
  if (widgetsLayer)  widgetsLayer.style.display  = 'none';
  if (arcContainer)  arcContainer.style.display  = 'none';
  if (chatContainer) chatContainer.style.display = 'none';
  panelEl.classList.remove('hidden');
}

function setupArcReactorParallax() {
  const reactor = document.getElementById('arc-reactor');
  const sphere = document.querySelector('.arc-sphere');
  const core = document.querySelector('.arc-core');
  if (!reactor || !sphere) return;

  let rafId = null;
  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;

  const onMove = (e) => {
    const rect = reactor.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Distance from center, normalized to [-1, 1], subtle
    targetX = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
    targetY = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
    if (!rafId) rafId = requestAnimationFrame(tick);
  };

  const tick = () => {
    // Ease toward target
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;
    // Apply parallax to arc-core (sphere's parent) to avoid conflict with breathe scale
    const tx = currentX * 5;
    const ty = currentY * 5;
    if (core) core.style.transform = `translate(${tx}px, ${ty}px)`;
    if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  };

  window.addEventListener('mousemove', onMove, { passive: true });
}

// ---------------------------------------------------------------------------
// Chat resize — drag left edge to resize chat panel
// ---------------------------------------------------------------------------
function setupChatResize() {
  const handle = document.getElementById('chat-resize-handle');
  const main = document.getElementById('main');
  if (!handle || !main) return;

  const MIN_WIDTH = 320;
  const MAX_WIDTH = 900;
  const WIDGET_WIDTH = 272; // matches --widget-width

  // Restore saved width
  const savedWidth = parseInt(localStorage.getItem('chat-width') || '0', 10);
  if (savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
    main.style.gridTemplateColumns = `${WIDGET_WIDTH}px 1fr ${savedWidth}px`;
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    isResizing = true;
    startX = e.clientX;
    const chatEl = document.getElementById('chat-container');
    startWidth = chatEl ? chatEl.offsetWidth : 380;
    handle.classList.add('resizing');
    document.body.classList.add('resizing-chat');
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isResizing) return;
    const dx = startX - e.clientX; // dragging left increases width
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + dx));
    main.style.gridTemplateColumns = `${WIDGET_WIDTH}px 1fr ${newWidth}px`;
  };

  const onMouseUp = () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('resizing');
    document.body.classList.remove('resizing-chat');
    const chatEl = document.getElementById('chat-container');
    if (chatEl) {
      localStorage.setItem('chat-width', String(chatEl.offsetWidth));
    }
  };

  handle.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Touch support
  handle.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    onMouseDown({ button: 0, clientX: t.clientX, preventDefault: () => {} });
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!isResizing) return;
    const t = e.touches[0];
    onMouseMove({ clientX: t.clientX });
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', onMouseUp);
}

function setupDock() {
  const dockBtns = document.querySelectorAll('.dock-btn');

  dockBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;

      // Home — close everything and show widgets
      if (panel === 'home') {
        closeAllPanels();
        showHomeView();
        dockBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }

      // Widget layer toggle
      if (panel === 'widgets') {
        const widgetsLayer = document.getElementById('widgets-layer');
        if (widgetsLayer) widgetsLayer.classList.toggle('widgets-hidden');
        btn.classList.toggle('active');
        return;
      }

      // Voice mode toggle
      if (btn.id === 'voice-mode-btn') {
        if (window.VoiceManager) window.VoiceManager.toggleVoiceMode();
        btn.classList.toggle('active');
        return;
      }

      // Generic panel toggle
      const panelEl = document.getElementById(`panel-${panel}`);
      if (!panelEl) return;

      const isOpen = !panelEl.classList.contains('hidden');
      closeAllPanels();

      if (!isOpen) {
        dockBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (FULL_PANELS.includes(panel)) {
          showFullPanel(panelEl);
        } else {
          showHomeView();
          panelEl.classList.remove('hidden');
        }

        // Trigger lazy content loads
        if (panel === 'briefing' && window.WidgetManager) {
          // Update subtitle date
          const subtitle = document.getElementById('briefing-date-subtitle');
          if (subtitle) subtitle.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          window.WidgetManager.loadBriefing();
        }
        if (panel === 'tasks' && window.TaskManager) {
          window.TaskManager.render();
        }
      } else {
        // Panel was open — close it and restore home state
        closeAllPanels();
        showHomeView();
        dockBtns.forEach(b => b.classList.remove('active'));
        const homeBtn = document.querySelector('.dock-btn[data-panel="home"]');
        if (homeBtn) homeBtn.classList.add('active');
      }
    });
  });

  // Wire up panel close buttons (.panel-close-btn)
  document.querySelectorAll('.panel-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      const panelEl = panel ? document.getElementById(`panel-${panel}`) : null;
      if (panelEl) panelEl.classList.add('hidden');
      closeAllPanels();
      showHomeView();
      dockBtns.forEach(b => b.classList.remove('active'));
      const homeBtn = document.querySelector('.dock-btn[data-panel="home"]');
      if (homeBtn) homeBtn.classList.add('active');
    });
  });
}

// ---------------------------------------------------------------------------
// Header & panel controls
// ---------------------------------------------------------------------------

function setupHeaderButtons() {
  // Briefing shortcut in header
  const briefingBtn = document.getElementById('briefing-btn');
  if (briefingBtn) {
    briefingBtn.addEventListener('click', () => {
      const dockBriefing = document.querySelector('.dock-btn[data-panel="briefing"]');
      if (dockBriefing) dockBriefing.click();
    });
  }

  // Old-style .panel-close buttons (fallback)
  document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      const panelEl = document.getElementById(`panel-${panel}`);
      if (panelEl) panelEl.classList.add('hidden');
      showHomeView();
      document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
      const homeBtn = document.querySelector('.dock-btn[data-panel="home"]');
      if (homeBtn) homeBtn.classList.add('active');
    });
  });

  // New Task button (shows task form)
  const newTaskBtn = document.getElementById('new-task-btn');
  const taskForm   = document.getElementById('task-form');
  const tfCancel   = document.getElementById('tf-cancel');
  const tfSubmit   = document.getElementById('tf-submit');
  const tfTitle    = document.getElementById('tf-title');

  if (newTaskBtn && taskForm) {
    newTaskBtn.addEventListener('click', () => {
      taskForm.classList.toggle('task-form-open');
      if (taskForm.classList.contains('task-form-open')) {
        tfTitle?.focus();
      }
    });
  }

  if (tfCancel && taskForm) {
    tfCancel.addEventListener('click', () => {
      taskForm.classList.remove('task-form-open');
      _clearTaskForm();
    });
  }

  if (tfSubmit) {
    tfSubmit.addEventListener('click', () => {
      const title = tfTitle?.value.trim();
      if (!title) {
        tfTitle?.focus();
        return;
      }
      const priority = document.getElementById('tf-priority')?.value || 'medium';
      const due_date = document.getElementById('tf-due')?.value || null;
      const labelVal = document.getElementById('tf-label')?.value.trim();
      const tags     = labelVal ? [labelVal] : [];
      const desc     = document.getElementById('tf-desc')?.value.trim() || '';

      if (window.TaskManager) {
        window.TaskManager.addTask({
          title,
          description: desc,
          priority,
          status: 'todo',
          due_date,
          tags,
          created: new Date().toISOString()
        });
      }
      taskForm?.classList.remove('task-form-open');
      _clearTaskForm();
    });
  }

  // Enter key on title field submits
  tfTitle?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); tfSubmit?.click(); }
  });

  // Refresh briefing button
  const refreshBriefingBtn = document.getElementById('refresh-briefing-btn');
  if (refreshBriefingBtn) {
    refreshBriefingBtn.addEventListener('click', () => {
      if (window.WidgetManager) window.WidgetManager.loadBriefing();
    });
  }
}

function _clearTaskForm() {
  const ids = ['tf-title', 'tf-desc', 'tf-due', 'tf-label'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sel = document.getElementById('tf-priority');
  if (sel) sel.value = 'medium';
}

// ---------------------------------------------------------------------------
// Utility: close all side panels and full panels
// ---------------------------------------------------------------------------

function closeAllPanels() {
  document.querySelectorAll('.side-panel, .full-panel').forEach(p => p.classList.add('hidden'));
}

// ---------------------------------------------------------------------------
// Local agent WebSocket connection
// ---------------------------------------------------------------------------

function connectLocalAgent() {
  if (!JARVIS_CONFIG.LOCAL_AGENT.ENABLED) return;

  let ws;
  try {
    ws = new WebSocket(JARVIS_CONFIG.LOCAL_AGENT.URL);
  } catch (err) {
    console.log('Local agent WebSocket could not be created:', err.message);
    return;
  }

  ws.addEventListener('open', () => {
    window.localAgent = ws;
    if (window.NotifManager) {
      window.NotifManager.toast('Local Agent connected', 'success');
    }
    const statusDot = document.getElementById('status-dot');
    if (statusDot) statusDot.classList.add('local-agent-active');
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleLocalAgentMessage(data);
    } catch (_) {}
  });

  ws.addEventListener('error', () => {
    console.log('Local agent not running — file system features disabled.');
  });

  ws.addEventListener('close', () => {
    window.localAgent = null;
    const statusDot = document.getElementById('status-dot');
    if (statusDot) statusDot.classList.remove('local-agent-active');
  });
}

function handleLocalAgentMessage(data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case 'file_result':
      if (window.JarvisEngine && data.content) {
        window.JarvisEngine.addMessage('assistant', `File content:\n\`\`\`\n${data.content}\n\`\`\``);
      }
      break;
    case 'command_result':
      if (window.JarvisEngine && data.output) {
        window.JarvisEngine.addMessage('assistant', `Command output:\n\`\`\`\n${data.output}\n\`\`\``);
      }
      break;
    case 'notification':
      if (window.NotifManager && data.message) {
        window.NotifManager.toast(data.message, data.level || 'info');
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

function updateGreeting() {
  const greeting = document.getElementById('jarvis-greeting');
  if (!greeting) return;

  const hour = new Date().getHours();
  let g;
  if (hour < 6)       g = 'Working late, Liam?';
  else if (hour < 12) g = 'Good morning, Liam.';
  else if (hour < 17) g = 'Good afternoon, Liam.';
  else if (hour < 21) g = 'Good evening, Liam.';
  else                g = 'Working late, Liam?';

  greeting.textContent = g;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function startClock() {
  const timeEl = document.getElementById('time-display');
  const dateEl = document.getElementById('date-display');

  function update() {
    const now = new Date();
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });
    }
  }

  update();
  setInterval(update, JARVIS_CONFIG.REFRESH.CLOCK);
}

// ---------------------------------------------------------------------------
// Uptime counter
// ---------------------------------------------------------------------------

function startUptime() {
  const uptimeEl = document.getElementById('w-uptime');
  if (!uptimeEl) return;

  const start = Date.now();

  function update() {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed / 3_600_000).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3_600_000) / 60_000).toString().padStart(2, '0');
    const s = Math.floor((elapsed % 60_000) / 1_000).toString().padStart(2, '0');
    uptimeEl.textContent = `${h}:${m}:${s}`;
  }

  update();
  setInterval(update, 1000);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Server sync — pulls remote task/alert state so Telegram-created tasks
// appear on the dashboard. Silent on failure (server may be cold, /tmp wiped).
// ---------------------------------------------------------------------------
function startServerSync() {
  const SYNC_INTERVAL_MS = 30000;

  const tick = async () => {
    try {
      if (window.TaskManager && typeof window.TaskManager.pullFromServer === 'function') {
        await window.TaskManager.pullFromServer();
      }
    } catch { /* silent */ }
  };

  // Initial pull shortly after boot
  setTimeout(tick, 2000);
  // Then every 30s
  setInterval(tick, SYNC_INTERVAL_MS);

  // Also sync when tab regains focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}

// ---------------------------------------------------------------------------
// JARVIS Daily Character — changes outfit based on day of week
// ---------------------------------------------------------------------------
function initJarvisCharacter() {
  const outfitEl = document.getElementById('jarvis-outfit');
  const labelEl = document.getElementById('jarvis-style-label');
  if (!outfitEl) return;

  // 7 modes — one per day of week (Sun=0 through Sat=6)
  // The orb is now a pure CSS hologram; labels change per mode
  const modes = [
    { label: 'SUNDAY MODE', title: 'Relaxed Sunday' },
    { label: 'BOARDROOM', title: 'Monday Executive' },
    { label: 'DEEP WORK', title: 'Tuesday Focus Mode' },
    { label: 'STRATEGY', title: 'Wednesday Architect' },
    { label: 'EXECUTE', title: 'Thursday Operator' },
    { label: 'CASUAL FRI', title: 'Friday Vibes' },
    { label: 'GYM MODE', title: 'Saturday Hustle' },
  ];

  const hour = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  let mode = modes[dayOfWeek];

  // Time-based overrides
  if (hour >= 22 || hour < 6) {
    mode = { label: 'NIGHT OWL', title: 'Late Night Mode' };
  } else if (hour >= 6 && hour < 9) {
    mode = { label: 'MORNING', title: 'Morning Startup' };
  }

  // Clear any emoji text — orb is CSS-only now
  outfitEl.textContent = '';
  outfitEl.title = mode.title;
  if (labelEl) labelEl.textContent = mode.label;

  // Click to cycle through modes
  let currentIdx = dayOfWeek;
  outfitEl.style.cursor = 'pointer';
  outfitEl.addEventListener('click', () => {
    currentIdx = (currentIdx + 1) % modes.length;
    outfitEl.title = modes[currentIdx].title;
    if (labelEl) labelEl.textContent = modes[currentIdx].label;
    // Pulse animation on click
    outfitEl.style.animation = 'none';
    setTimeout(() => outfitEl.style.animation = '', 50);
    window.NotifManager?.toast(`JARVIS: ${modes[currentIdx].title}`, 'info', 2000);
  });
}
