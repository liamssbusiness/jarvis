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
      let url = '/api/weather';
      if (this.userLocation.lat !== null && this.userLocation.lon !== null) {
        url += `?lat=${encodeURIComponent(this.userLocation.lat)}&lon=${encodeURIComponent(this.userLocation.lon)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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
    setEl('w-uv', data.uv_index != null ? `UV ${data.uv_index}` : '');

    // Update weather icon if present
    const iconEl = document.getElementById('w-icon');
    if (iconEl && data.icon) iconEl.textContent = data.icon;
  }

  updateWeatherHeader(data) {
    const el = document.getElementById('weather-header');
    if (el) el.textContent = `${data.icon || '\uD83C\uDF21'} ${data.temperature}°${data.unit}`;
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

    if (!articles.length) {
      list.innerHTML = '<div class="news-item news-empty">No news available</div>';
      return;
    }

    list.innerHTML = articles.map((a) => {
      const safeUrl = this._safeUrl(a.url);
      const safeTitle = this._escapeHtml(a.title || 'Untitled');
      const safeSource = this._escapeHtml(a.source || '');
      const pubDate = a.publishedAt ? this._formatRelativeTime(a.publishedAt) : '';
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

    const items = Object.values(prices);
    if (!items.length) {
      list.innerHTML = '<div class="stock-item stock-loading">Loading markets...</div>';
      return;
    }

    list.innerHTML = items.map((item) => {
      const change = parseFloat(item.change);
      const price = parseFloat(item.price);
      const isUp = change >= 0;
      const displayPrice = this._formatPrice(price);
      const changeAbs = Math.abs(change).toFixed(2);
      const dirArrow = isUp ? '\u25b2' : '\u25bc';
      const dirClass = isUp ? 'up' : 'down';
      return `
        <div class="stock-item">
          <span class="stock-sym">${this._escapeHtml(item.symbol)}</span>
          <span class="stock-price">${displayPrice}</span>
          <span class="stock-change ${dirClass}">${dirArrow}${changeAbs}%</span>
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
  // Widget Dragging
  // ---------------------------------------------------------------------------

  makeWidgetsDraggable() {
    // Remove any previously attached drag listeners
    this._dragCleanup.forEach((fn) => fn());
    this._dragCleanup = [];

    document.querySelectorAll('.hud-widget').forEach((widget) => {
      const header = widget.querySelector('.widget-header');
      if (!header) return;

      // Restore saved position
      const saved = this._loadWidgetPos(widget.id);
      if (saved) {
        widget.style.position = 'absolute';
        widget.style.left = saved.left;
        widget.style.top  = saved.top;
      }

      let isDragging = false;
      let startX, startY, startLeft, startTop;

      const onMouseDown = (e) => {
        // Only respond to primary mouse button
        if (e.button !== 0) return;
        isDragging = true;
        widget.style.position = 'absolute';
        startX    = e.clientX;
        startY    = e.clientY;
        startLeft = widget.offsetLeft;
        startTop  = widget.offsetTop;
        widget.style.zIndex = '1000';
        widget.classList.add('dragging');
        e.preventDefault();
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        const newLeft = startLeft + (e.clientX - startX);
        const newTop  = startTop  + (e.clientY - startY);
        // Clamp inside viewport
        const maxLeft = window.innerWidth  - widget.offsetWidth;
        const maxTop  = window.innerHeight - widget.offsetHeight;
        widget.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
        widget.style.top  = `${Math.max(0, Math.min(newTop,  maxTop))}px`;
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        widget.style.zIndex = '';
        widget.classList.remove('dragging');
        this._saveWidgetPos(widget.id, widget.style.left, widget.style.top);
      };

      header.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Register cleanup for re-initialisation
      this._dragCleanup.push(() => {
        header.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      });
    });
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
