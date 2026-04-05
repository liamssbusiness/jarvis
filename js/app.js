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

    // JARVIS engine — depends on all others being ready
    window.JarvisEngine = new JarvisEngine();

    // Wire up dock navigation
    setupDock();

    // Wire up header / panel controls
    setupHeaderButtons();

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

function setupDock() {
  const dockBtns = document.querySelectorAll('.dock-btn');

  dockBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;

      // Home — close everything and show widgets
      if (panel === 'home') {
        closeAllPanels();
        dockBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const widgetsLayer = document.getElementById('widgets-layer');
        if (widgetsLayer) widgetsLayer.classList.remove('hidden-widgets');
        return;
      }

      // Widget layer toggle
      if (panel === 'widgets') {
        const widgetsLayer = document.getElementById('widgets-layer');
        if (widgetsLayer) widgetsLayer.classList.toggle('hidden-widgets');
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
        panelEl.classList.remove('hidden');
        dockBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Trigger lazy content loads
        if (panel === 'briefing' && window.WidgetManager) {
          window.WidgetManager.loadBriefing();
        }
        if (panel === 'tasks' && window.TaskManager) {
          window.TaskManager.render();
        }
      } else {
        // Panel was open — close it and restore home state
        dockBtns.forEach(b => b.classList.remove('active'));
        const homeBtn = document.querySelector('.dock-btn[data-panel="home"]');
        if (homeBtn) homeBtn.classList.add('active');
      }
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

  // Panel close buttons (data-panel="tasks" etc.)
  document.querySelectorAll('.panel-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      const panelEl = document.getElementById(`panel-${panel}`);
      if (panelEl) panelEl.classList.add('hidden');

      // Return home state to dock
      document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
      const homeBtn = document.querySelector('.dock-btn[data-panel="home"]');
      if (homeBtn) homeBtn.classList.add('active');
    });
  });

  // Quick task add from task panel toolbar
  const addTaskBtn = document.getElementById('add-task-btn');
  const taskInput = document.getElementById('task-input');
  const taskPriority = document.getElementById('task-priority');

  if (addTaskBtn && taskInput) {
    addTaskBtn.addEventListener('click', () => {
      const title = taskInput.value.trim();
      if (!title) return;
      const priority = taskPriority ? taskPriority.value : 'medium';
      if (window.TaskManager) {
        window.TaskManager.addTask({
          id: Date.now().toString(),
          title,
          priority,
          status: 'todo',
          created: new Date().toISOString()
        });
      }
      taskInput.value = '';
      taskInput.focus();
    });

    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTaskBtn.click();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Utility: close all side panels
// ---------------------------------------------------------------------------

function closeAllPanels() {
  document.querySelectorAll('.side-panel').forEach(p => p.classList.add('hidden'));
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
