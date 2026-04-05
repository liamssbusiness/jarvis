/**
 * NotificationManager — in-app toast notifications and native browser notifications
 * for the JARVIS dashboard.
 */
class NotificationManager {
  constructor() {
    this.container  = document.getElementById('toast-container');
    this.permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
    this._queue     = [];
    this._active    = 0;
    this._maxActive = 5; // prevent toast flooding
  }

  // ---------------------------------------------------------------------------
  // Native notification permission
  // ---------------------------------------------------------------------------

  async requestPermission() {
    if (typeof Notification === 'undefined') return;
    try {
      this.permission = await Notification.requestPermission();
    } catch (e) {
      console.warn('NotificationManager: permission request failed', e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Native OS notification + toast combo
  // ---------------------------------------------------------------------------

  sendNotification(title, body, options = {}) {
    this.toast(body, options.type || 'info');

    if (this.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body,
          icon:  options.icon  || '/favicon.ico',
          badge: options.badge || '/favicon.ico',
          tag:   options.tag   || 'jarvis',
          silent: options.silent ?? false,
          ...options
        });
        notif.onclick = () => {
          window.focus();
          if (options.onClick) options.onClick();
          notif.close();
        };
      } catch (e) {
        console.warn('NotificationManager.sendNotification:', e.message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  /**
   * Show an in-app toast message.
   * @param {string}  message   - Text to display.
   * @param {string}  type      - 'info' | 'success' | 'warning' | 'error'
   * @param {number}  duration  - Display time in ms (default 4000).
   * @param {object}  opts      - { dismissible: bool, onClick: fn }
   */
  toast(message, type = 'info', duration = 4000, opts = {}) {
    if (!this.container) return;

    // Queue if too many are visible
    if (this._active >= this._maxActive) {
      this._queue.push({ message, type, duration, opts });
      return;
    }

    this._active++;
    const el = this._createToastEl(message, type, duration, opts);
    this.container.appendChild(el);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('toast-show'));
    });

    const dismiss = () => {
      if (el._dismissed) return;
      el._dismissed = true;
      el.classList.remove('toast-show');
      el.classList.add('toast-hide');
      setTimeout(() => {
        el.remove();
        this._active--;
        this._flushQueue();
      }, 320);
    };

    const timer = setTimeout(dismiss, duration);

    if (opts.dismissible !== false) {
      el.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss();
        if (opts.onClick) opts.onClick();
      });
    }
  }

  _createToastEl(message, type, duration, opts) {
    const VALID_TYPES = new Set(['info', 'success', 'warning', 'error']);
    const safeType    = VALID_TYPES.has(type) ? type : 'info';

    const icons = { success: '\u2713', error: '\u2715', warning: '\u26a0', info: '\u2139' };

    const el = document.createElement('div');
    el.className   = `toast toast-${safeType}`;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', safeType === 'error' ? 'assertive' : 'polite');

    // Escape message to prevent XSS (message may come from external sources)
    const safeMsg = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    el.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icons[safeType]}</span>
      <span class="toast-msg">${safeMsg}</span>
      <div class="toast-drain" style="animation-duration:${duration}ms"></div>
    `;

    return el;
  }

  _flushQueue() {
    if (!this._queue.length) return;
    if (this._active >= this._maxActive) return;
    const { message, type, duration, opts } = this._queue.shift();
    this.toast(message, type, duration, opts);
  }

  // ---------------------------------------------------------------------------
  // Convenience shortcuts
  // ---------------------------------------------------------------------------

  success(message, duration)  { this.toast(message, 'success', duration); }
  error(message, duration)    { this.toast(message, 'error',   duration ?? 6000); }
  warning(message, duration)  { this.toast(message, 'warning', duration); }
  info(message, duration)     { this.toast(message, 'info',    duration); }

  // ---------------------------------------------------------------------------
  // Clear all visible toasts
  // ---------------------------------------------------------------------------

  clearAll() {
    this._queue = [];
    this.container?.querySelectorAll('.toast').forEach((el) => {
      el.classList.remove('toast-show');
      el.classList.add('toast-hide');
      setTimeout(() => el.remove(), 320);
    });
    this._active = 0;
  }
}
