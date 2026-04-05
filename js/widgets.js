/**
 * WidgetManager — handles weather, news, stocks, drag positioning, and daily briefing
 * for the JARVIS AI dashboard.
 */
class WidgetManager {
  constructor() {
    this.refreshTimers = {};
    this.userLocation = { lat: null, lon: null };
    this.defaultLocation = 'London';
    this._dragCleanup = [];
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize() {
    await this.detectLocation();
    await Promise.all([
      this.loadWeather(),
      this.loadNews(),
      this.loadStocks()
    ]);
    this.setupRefreshTimers();
    this.makeWidgetsDraggable();
  }

  // ---------------------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------------------

  async detectLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve();
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.userLocation.lat = pos.coords.latitude;
          this.userLocation.lon = pos.coords.longitude;
          resolve();
        },
        () => resolve(),
        { timeout: 5000 }
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Weather
  // ---------------------------------------------------------------------------

  async loadWeather() {
    try {
      let url = '/api/weather?units=fahrenheit';
      if (this.userLocation.lat !== null && this.userLocation.lon !== null) {
        url += `&lat=${encodeURIComponent(this.userLocation.lat)}&lon=${encodeURIComponent(this.userLocation.lon)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._lastWeatherData = data;
      this.updateWeatherWidget(data);
      this.updateWeatherHeader(data);
    } catch (e) {
      console.warn('Weather load error:', e.message);
      this._showWidgetError('weather-widget', 'Weather unavailable');
    }
  }

  updateWeatherWidget(data) {
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setEl('w-temp', `${data.temperature}°${data.unit}`);
    setEl('w-condition', data.condition);
    setEl('w-humidity', `${data.humidity}% humidity`);
    setEl('w-wind', `${data.wind_speed} km/h wind`);
    setEl('w-location', data.location || this.defaultLocation);
    setEl('w-feels-like', data.feels_like != null ? `Feels like ${data.feels_like}°${data.unit}` : '');
    // High/Low for the day — use the same unit as the API returns
    if (data.high != null && data.low != null) {
      const unit = data.unit || 'F';
      setEl('w-high-low', `↑${data.high}°${unit} ↓${data.low}°${unit}`);
    }
    const iconEl = document.getElementById('w-icon');
    if (iconEl && data.icon) iconEl.textContent = data.icon;
  }

  updateWeatherHeader(data) {
    const el = document.getElementById('weather-header');
    if (el) {
      const unit = data.unit || 'F';
      const highLow = (data.high != null && data.low != null) ? ` ↑${data.high}°${unit} ↓${data.low}°${unit}` : '';
      el.textContent = `${data.icon || '🌡'} ${data.temperature}°${unit}${highLow}`;
    }
  }

  // ---------------------------------------------------------------------------
  // News
  // ---------------------------------------------------------------------------

  async loadNews() {
    try {
      const res = await fetch('/api/news?category=general&pageSize=5');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.updateNewsWidget(data.articles || []);
    } catch (e) {
      console.warn('News load error:', e.message);
      this._showWidgetError('news-widget', 'News unavailable');
    }
  }

  updateNewsWidget(articles) {
    const list = document.getElementById('news-list');
    if (!list) return;
    this._lastNewsArticles = articles;

    if (!articles.length) {
      list.innerHTML = '<div class="news-item news-empty">No news available</div>';
      return;
    }

    list.innerHTML = articles.slice(0, 5).map((a) => {
      const safeUrl   = this._safeUrl(a.url);
      const safeTitle = this._escapeHtml(a.title || 'Untitled');
      const safeSource= this._escapeHtml(a.source || '');
      const pubDate   = a.publishedAt ? this._formatRelativeTime(a.publishedAt) : '';
      return `
        <div class="news-item" role="button" tabindex="0"
             onclick="window.open(${safeUrl}, '_blank', 'noopener,noreferrer')"
             onkeydown="if(event.key==='Enter')window.open(${safeUrl},'_blank','noopener,noreferrer')">
          <div class="news-title">${safeTitle}</div>
          <div class="news-meta">
            <span class="news-source">${safeSource}</span>
            ${pubDate ? `<span class="news-time">${pubDate}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Stocks / Markets
  // ---------------------------------------------------------------------------

  async loadStocks() {
    try {
      const symbols = (
        (typeof JARVIS_CONFIG !== 'undefined' && JARVIS_CONFIG.DEFAULT_SYMBOLS) ||
        ['BTC', 'ETH', 'AAPL', 'NVDA']
      ).join(',');
      const res = await fetch(`/api/stocks?symbols=${encodeURIComponent(symbols)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.updateStocksWidget(data.prices || {});
    } catch (e) {
      console.warn('Stocks load error:', e.message);
      this._showWidgetError('stocks-widget', 'Markets unavailable');
    }
  }

  updateStocksWidget(prices) {
    const list = document.getElementById('stocks-list');
    if (!list) return;
    this._lastStockPrices = prices;

    const items = Object.values(prices);
    if (!items.length) {
      list.innerHTML = '<div class="stock-item stock-loading">Loading markets...</div>';
      return;
    }

    list.innerHTML = items.map((item) => {
      const change = parseFloat(item.change);
      const price  = parseFloat(item.price);
      const isUp   = change >= 0;
      const displayPrice = this._formatPrice(price);
      const changeAbs    = Math.abs(change).toFixed(2);
      const dirArrow = isUp ? '\u25b2' : '\u25bc';
      const dirClass = isUp ? 'up' : 'down';
      return `
        <div class="stock-item">
          <span class="stock-sym">${this._escapeHtml(item.symbol)}</span>
          <span class="stock-price">${displayPrice}</span>
          <span class="stock-chg ${dirClass}">${dirArrow}${changeAbs}%</span>
        </div>
      `;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Refresh Timers
  // ---------------------------------------------------------------------------

  setupRefreshTimers() {
    this._clearRefreshTimers();
    this.refreshTimers.weather  = setInterval(() => this.loadWeather(),  10 * 60 * 1000);
    this.refreshTimers.news     = setInterval(() => this.loadNews(),     15 * 60 * 1000);
    this.refreshTimers.stocks   = setInterval(() => this.loadStocks(),    2 * 60 * 1000);
  }

  _clearRefreshTimers() {
    Object.values(this.refreshTimers).forEach((id) => clearInterval(id));
    this.refreshTimers = {};
  }

  // ---------------------------------------------------------------------------
  // Widget Dragging — free-drag with lock/unlock
  // ---------------------------------------------------------------------------

  makeWidgetsDraggable() {
    // Remove any previously attached drag listeners
    this._dragCleanup.forEach((fn) => fn());
    this._dragCleanup = [];

    this._widgetsLocked = this._loadLockState();
    this._createLockToggle();

    const layer = document.getElementById('widgets-layer');

    document.querySelectorAll('.hud-widget').forEach((widget) => {
      const header = widget.querySelector('.widget-header');
      if (!header) return;
      header.style.cursor = this._widgetsLocked ? 'default' : 'grab';

      // Restore saved position for free-drag mode
      const saved = this._loadWidgetPos(widget.id);
      if (saved && !this._widgetsLocked) {
        if (layer) layer.classList.add('free-drag');
        widget.style.position = 'absolute';
        widget.style.left = saved.left;
        widget.style.top  = saved.top;
      }
      if (this._widgetsLocked) {
        widget.classList.add('widget-locked');
      }

      let isDragging = false;
      let hasDragged = false;
      let startX, startY, startLeft, startTop;

      const startDrag = (clientX, clientY) => {
        if (this._widgetsLocked) return;
        isDragging = true;
        hasDragged = false;

        // Switch layer to free-drag mode
        if (layer && !layer.classList.contains('free-drag')) {
          // Snapshot current viewport positions before switching (free-drag layer is inset:0)
          document.querySelectorAll('.hud-widget').forEach((w) => {
            const rect = w.getBoundingClientRect();
            w.style.position = 'absolute';
            w.style.left = `${rect.left}px`;
            w.style.top = `${rect.top}px`;
          });
          layer.classList.add('free-drag');
        }

        startX    = clientX;
        startY    = clientY;
        startLeft = widget.offsetLeft;
        startTop  = widget.offsetTop;
        widget.style.zIndex = '1000';
        widget.classList.add('dragging');
        header.style.cursor = 'grabbing';
      };

      const moveDrag = (clientX, clientY) => {
        if (!isDragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
        const newLeft = startLeft + dx;
        const newTop  = startTop  + dy;
        // Clamp within viewport — allow dragging anywhere on screen
        const maxLeft = window.innerWidth  - widget.offsetWidth;
        const maxTop  = window.innerHeight - widget.offsetHeight;
        widget.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
        widget.style.top  = `${Math.max(0, Math.min(newTop,  maxTop))}px`;
      };

      const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        widget.style.zIndex = '';
        widget.classList.remove('dragging');
        header.style.cursor = 'grab';
        this._saveWidgetPos(widget.id, widget.style.left, widget.style.top);
      };

      // Mouse events
      const onMouseDown = (e) => {
        if (e.button !== 0 || this._widgetsLocked) return;
        startDrag(e.clientX, e.clientY);
        e.preventDefault();
      };
      const onMouseMove = (e) => moveDrag(e.clientX, e.clientY);
      const onMouseUp   = () => endDrag();

      // Touch events
      const onTouchStart = (e) => {
        if (this._widgetsLocked) return;
        const t = e.touches[0];
        startDrag(t.clientX, t.clientY);
      };
      const onTouchMove = (e) => {
        const t = e.touches[0];
        moveDrag(t.clientX, t.clientY);
        if (hasDragged) e.preventDefault();
      };
      const onTouchEnd = () => endDrag();

      header.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      header.addEventListener('touchstart', onTouchStart, { passive: true });
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);

      // Click-to-expand — fires only if not dragged
      const onWidgetClick = () => {
        if (hasDragged) return;
        this._expandWidget(widget);
      };
      widget.addEventListener('click', onWidgetClick);

      widget.setAttribute('data-clickable', 'true');

      this._dragCleanup.push(() => {
        header.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        header.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        widget.removeEventListener('click', onWidgetClick);
      });
    });
  }

  _createLockToggle() {
    // Remove existing toggle if any
    const existing = document.querySelector('.widget-lock-toggle');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.className = 'widget-lock-toggle' + (this._widgetsLocked ? ' locked' : '');
    this._updateLockBtn(btn);

    btn.addEventListener('click', () => {
      this._widgetsLocked = !this._widgetsLocked;
      this._saveLockState(this._widgetsLocked);
      btn.classList.toggle('locked', this._widgetsLocked);
      this._updateLockBtn(btn);

      document.querySelectorAll('.hud-widget').forEach((w) => {
        const hdr = w.querySelector('.widget-header');
        if (this._widgetsLocked) {
          w.classList.add('widget-locked');
          if (hdr) hdr.style.cursor = 'default';
        } else {
          w.classList.remove('widget-locked');
          if (hdr) hdr.style.cursor = 'grab';
        }
      });

      const msg = this._widgetsLocked ? 'Widgets locked in place' : 'Widgets unlocked — drag to reposition';
      window.NotifManager?.toast(msg, 'info', 2000);
    });

    document.getElementById('app')?.appendChild(btn);
  }

  _updateLockBtn(btn) {
    if (this._widgetsLocked) {
      btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg> LOCKED`;
    } else {
      btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0" /><line x1="11" y1="5" x2="13" y2="3"/></svg> UNLOCKED`;
    }
  }

  _saveLockState(locked) {
    try { localStorage.setItem('widgets-locked', JSON.stringify(locked)); } catch {}
  }

  _loadLockState() {
    try {
      const v = localStorage.getItem('widgets-locked');
      return v ? JSON.parse(v) : true; // Default: locked
    } catch { return true; }
  }

  _expandWidget(widget) {
    const type = widget.dataset.widget;
    if (!type || !window.ExpandModal) return;

    switch (type) {
      case 'weather': return this._expandWeather();
      case 'stocks':  return this._expandStocks();
      case 'news':    return this._expandNews();
      default: break;
    }
  }

  _expandWeather() {
    const d = this._lastWeatherData;
    if (!d) {
      window.ExpandModal.open('Weather', '<p style="color:var(--text-muted);font-size:13px;">Weather data not yet loaded.</p>');
      return;
    }
    const unit = d.unit || 'F';
    const icon = d.icon || '';
    const highLow = (d.high != null && d.low != null)
      ? `<div class="weather-exp-stat"><div class="weather-exp-stat-label">HIGH / LOW</div><div class="weather-exp-stat-val">${d.high}° / ${d.low}°</div></div>`
      : '';

    const html = `
      <div class="weather-expanded">
        <div class="weather-exp-main">
          <div class="weather-exp-temp">${icon} ${d.temperature}°${unit}</div>
          <div class="weather-exp-cond">${this._escapeHtml(d.condition || '')}</div>
        </div>
        <div class="weather-exp-grid">
          <div class="weather-exp-stat">
            <div class="weather-exp-stat-label">FEELS LIKE</div>
            <div class="weather-exp-stat-val">${d.feels_like != null ? d.feels_like + '°' : '--'}</div>
          </div>
          <div class="weather-exp-stat">
            <div class="weather-exp-stat-label">HUMIDITY</div>
            <div class="weather-exp-stat-val">${d.humidity != null ? d.humidity + '%' : '--'}</div>
          </div>
          <div class="weather-exp-stat">
            <div class="weather-exp-stat-label">WIND</div>
            <div class="weather-exp-stat-val">${d.wind_speed != null ? d.wind_speed + ' km/h' : '--'}</div>
          </div>
          ${highLow}
          ${d.location ? `<div class="weather-exp-stat" style="grid-column:1/-1"><div class="weather-exp-stat-label">LOCATION</div><div class="weather-exp-stat-val">${this._escapeHtml(d.location)}</div></div>` : ''}
        </div>
      </div>
    `;
    window.ExpandModal.open('Weather — Current Conditions', html);
  }

  _expandStocks() {
    const prices = this._lastStockPrices;
    if (!prices || !Object.keys(prices).length) {
      window.ExpandModal.open('Markets', '<p style="color:var(--text-muted);font-size:13px;">Market data not yet loaded.</p>');
      return;
    }

    const rows = Object.values(prices).map(item => {
      const change   = parseFloat(item.change);
      const price    = parseFloat(item.price);
      const isUp     = change >= 0;
      const dirArrow = isUp ? '▲' : '▼';
      const dirClass = isUp ? 'up' : 'down';
      const displayPrice = this._formatPrice(price);
      const changeAbs = Math.abs(change).toFixed(2);
      // ASCII sparkline approximation based on change
      const sparkLen = 8;
      const mid = Math.floor(sparkLen / 2);
      const fill = Math.round((Math.min(Math.abs(change), 5) / 5) * mid);
      const spark = isUp
        ? '▁'.repeat(mid) + '▄'.repeat(fill) + '█'.repeat(sparkLen - mid - fill)
        : '█'.repeat(sparkLen - mid - fill) + '▄'.repeat(fill) + '▁'.repeat(mid);

      return `
        <div class="modal-stock-row">
          <span class="modal-stock-sym">${this._escapeHtml(item.symbol)}</span>
          <span class="modal-stock-type">${this._escapeHtml(item.type || 'EQUITY')}</span>
          <span class="modal-stock-sparkline">${spark}</span>
          <span class="modal-stock-price">${displayPrice}</span>
          <span class="modal-stock-chg ${dirClass}">${dirArrow}${changeAbs}%</span>
        </div>
      `;
    }).join('');

    window.ExpandModal.open('Markets — Live Prices', `<div class="modal-stock-list">${rows}</div>`);
  }

  _expandNews() {
    const articles = this._lastNewsArticles || [];
    if (!articles.length) {
      window.ExpandModal.open('Intel Feed', '<p style="color:var(--text-muted);font-size:13px;">No articles loaded yet.</p>');
      return;
    }

    const rows = articles.map(a => {
      const safeUrl   = this._safeUrl(a.url);
      const safeTitle = this._escapeHtml(a.title || 'Untitled');
      const safeDesc  = this._escapeHtml((a.description || '').substring(0, 160));
      const safeSource= this._escapeHtml(a.source || '');
      const pubDate   = a.publishedAt ? this._formatRelativeTime(a.publishedAt) : '';
      return `
        <div class="modal-news-item">
          <div class="modal-news-title">${safeTitle}</div>
          ${safeDesc ? `<div style="font-size:12px;color:var(--text-muted);margin:5px 0;line-height:1.5;">${safeDesc}${a.description && a.description.length > 160 ? '...' : ''}</div>` : ''}
          <div class="modal-news-meta">
            <span class="modal-news-source">${safeSource}</span>
            ${pubDate ? `<span class="modal-news-time">${pubDate}</span>` : ''}
            ${safeUrl !== `'#'` ? `<a class="modal-news-link" href=${safeUrl} target="_blank" rel="noopener noreferrer">Read →</a>` : ''}
          </div>
        </div>
      `;
    }).join('');

    window.ExpandModal.open('Intel Feed — All Articles', `<div class="modal-news-list">${rows}</div>`);
  }

  // ---------------------------------------------------------------------------
  // Daily Briefing
  // ---------------------------------------------------------------------------

  async loadBriefing() {
    const content = document.getElementById('briefing-content');
    if (!content) return;
    content.innerHTML = '<div class="briefing-loading">Generating briefing...</div>';

    try {
      const res = await fetch('/api/briefing');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const tasks   = window.TaskManager?.getTasks() || [];
      const pending = tasks.filter((t) => t.status !== 'done');
      const high    = pending.filter((t) => t.priority === 'high');
      const medium  = pending.filter((t) => t.priority === 'medium');
      const low     = pending.filter((t) => t.priority === 'low');

      const weatherIcon = data.weather?.icon || '';
      const temp        = data.weather?.temperature ?? '--';
      const condition   = data.weather?.condition   || '';
      const humidity    = data.weather?.humidity    ?? '--';

      const headlines = (data.headlines || []).slice(0, 5);

      content.innerHTML = `
        <div class="briefing-section briefing-datetime">
          <h3 class="briefing-title">Today — ${this._escapeHtml(data.date)}</h3>
          <p class="briefing-time">${this._escapeHtml(data.time)}</p>
        </div>

        <div class="briefing-section briefing-weather">
          <h3 class="briefing-title">Weather</h3>
          <p class="briefing-weather-main">${weatherIcon} ${temp}°C — ${this._escapeHtml(condition)}</p>
          <p class="briefing-sub">${humidity}% humidity</p>
        </div>

        <div class="briefing-section briefing-tasks">
          <h3 class="briefing-title">Tasks (${pending.length} pending)</h3>
          ${high.length   ? `<p class="briefing-sub priority-label">High priority (${high.length})</p>` : ''}
          ${high.slice(0,3).map((t) => `<div class="briefing-task priority-high">\u2022 ${this._escapeHtml(t.title)}</div>`).join('')}
          ${medium.slice(0,2).map((t) => `<div class="briefing-task priority-medium">\u2022 ${this._escapeHtml(t.title)}</div>`).join('')}
          ${!pending.length ? '<p class="briefing-sub">No pending tasks \u2014 all clear!</p>' : ''}
          ${pending.length > 5 ? `<p class="briefing-sub">+${pending.length - 5} more tasks</p>` : ''}
        </div>

        <div class="briefing-section briefing-news">
          <h3 class="briefing-title">Top Headlines</h3>
          ${headlines.map((h) => `
            <div class="briefing-news">
              \u2022 ${this._escapeHtml(h.title)}
              <span class="briefing-source">(${this._escapeHtml(h.source)})</span>
            </div>
          `).join('') || '<p class="briefing-sub">No headlines available</p>'}
        </div>

        <div class="briefing-section briefing-actions">
          <button class="briefing-ask-btn"
            onclick="window.JarvisEngine?.processVoiceCommand('Give me a comprehensive daily briefing for today')">
            Ask JARVIS for Full Briefing
          </button>
        </div>
      `;
    } catch (e) {
      content.innerHTML = `<div class="briefing-error">Unable to load briefing: ${this._escapeHtml(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Manual Refresh Helpers
  // ---------------------------------------------------------------------------

  async refreshAll() {
    await Promise.all([
      this.loadWeather(),
      this.loadNews(),
      this.loadStocks()
    ]);
  }

  refreshWidget(name) {
    switch (name) {
      case 'weather': return this.loadWeather();
      case 'news':    return this.loadNews();
      case 'stocks':  return this.loadStocks();
      default:        console.warn(`Unknown widget: ${name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Layout Persistence
  // ---------------------------------------------------------------------------

  resetWidgetPositions() {
    document.querySelectorAll('.hud-widget').forEach((widget) => {
      localStorage.removeItem(`widget-pos-${widget.id}`);
      widget.style.left     = '';
      widget.style.top      = '';
      widget.style.position = '';
    });
  }

  _saveWidgetPos(id, left, top) {
    try {
      localStorage.setItem(`widget-pos-${id}`, JSON.stringify({ left, top }));
    } catch {}
  }

  _loadWidgetPos(id) {
    try {
      const raw = localStorage.getItem(`widget-pos-${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Utilities
  // ---------------------------------------------------------------------------

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  _safeUrl(url) {
    if (!url || typeof url !== 'string') return `'#'`;
    if (!/^https?:\/\//i.test(url)) return `'#'`;
    return `'${url.replace(/'/g, '%27')}'`;
  }

  _formatPrice(price) {
    if (isNaN(price)) return 'N/A';
    if (price >= 1000) return `$${parseInt(price).toLocaleString()}`;
    if (price >= 1)    return `$${price.toFixed(2)}`;
    return `$${price.toFixed(4)}`;
  }

  _formatRelativeTime(isoString) {
    try {
      const diffMs   = Date.now() - new Date(isoString).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1)   return 'just now';
      if (diffMins < 60)  return `${diffMins}m ago`;
      const diffHrs = Math.floor(diffMins / 60);
      if (diffHrs < 24)   return `${diffHrs}h ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch {
      return '';
    }
  }

  _showWidgetError(widgetId, message) {
    const el = document.getElementById(widgetId);
    if (!el) return;
    const errEl = el.querySelector('.widget-error');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.remove('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Destroy / Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    this._clearRefreshTimers();
    this._dragCleanup.forEach((fn) => fn());
    this._dragCleanup = [];
  }
}
