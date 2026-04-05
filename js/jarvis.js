// JARVIS Chat Engine
class JarvisEngine {
  constructor() {
    this.messages = [];        // Chat history
    this.isThinking = false;   // Processing state
    this.sessionStart = Date.now();
    this.messageCount = 0;
    this.attachedFiles = [];   // Pending file attachments
    this.init();
  }

  init() {
    this.setupElements();
    this.setupEventListeners();
    this.loadHistory();
    this.displayWelcome();
    this.updateTokenCounter();
  }

  setupElements() {
    this.chatMessages = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('send-btn');
    this.voiceBtn = document.getElementById('voice-btn');
    this.imageUpload = document.getElementById('image-upload');
    this.imageUploadBtn = document.getElementById('image-upload-btn');
    this.chatAttachments = document.getElementById('chat-attachments');
    this.arcLabel = document.getElementById('arc-label');
    this.sessionCounter = document.getElementById('w-session');
    this.tokenCountEl = document.getElementById('token-count');
    this.chatSearchEl = document.getElementById('chat-search');
  }

  // Approximate token count: ~4 characters per token
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
  }

  updateTokenCounter() {
    if (!this.tokenCountEl) return;
    const total = this.messages.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );
    this.tokenCountEl.textContent = total.toLocaleString();
  }

  filterMessages(query) {
    const q = (query || '').trim().toLowerCase();
    const msgEls = this.chatMessages.querySelectorAll('.msg');
    msgEls.forEach((el) => {
      // Clear any previous highlights
      const textEl = el.querySelector('.msg-text, .msg-bubble');
      if (!textEl) return;
      // Restore original text if we stored it
      if (textEl.dataset.originalHtml) {
        textEl.innerHTML = textEl.dataset.originalHtml;
        delete textEl.dataset.originalHtml;
      }
      if (!q) {
        el.classList.remove('msg-search-hidden');
        return;
      }
      const plain = textEl.textContent.toLowerCase();
      if (plain.includes(q)) {
        el.classList.remove('msg-search-hidden');
        // Highlight matches in text nodes only
        textEl.dataset.originalHtml = textEl.innerHTML;
        this._highlightInElement(textEl, q);
      } else {
        el.classList.add('msg-search-hidden');
      }
    });
  }

  _highlightInElement(root, query) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    const qLen = query.length;
    textNodes.forEach((textNode) => {
      const text = textNode.nodeValue;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(query);
      if (idx === -1) return;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      while (idx !== -1) {
        if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
        const mark = document.createElement('span');
        mark.className = 'search-highlight';
        mark.textContent = text.slice(idx, idx + qLen);
        frag.appendChild(mark);
        cursor = idx + qLen;
        idx = lower.indexOf(query, cursor);
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  setupEventListeners() {
    // Send on Enter (Shift+Enter for newline)
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    this.chatInput.addEventListener('input', () => {
      this.chatInput.style.height = 'auto';
      this.chatInput.style.height = Math.min(this.chatInput.scrollHeight, 120) + 'px';
    });

    this.sendBtn.addEventListener('click', () => this.sendMessage());

    if (this.imageUploadBtn) {
      this.imageUploadBtn.addEventListener('click', () => this.imageUpload.click());
    }

    if (this.imageUpload) {
      this.imageUpload.addEventListener('change', (e) => this.handleFileAttach(e));
    }

    // Chat search: filter messages by substring
    if (this.chatSearchEl) {
      this.chatSearchEl.addEventListener('input', (e) => {
        this.filterMessages(e.target.value);
      });
    }

    const clearBtn = document.getElementById('clear-chat-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearChat());
    }

    // Handle drag and drop on chat
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      chatContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        chatContainer.classList.add('drag-over');
      });
      chatContainer.addEventListener('dragleave', () => {
        chatContainer.classList.remove('drag-over');
      });
      chatContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        chatContainer.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        files.forEach(f => this.processFile(f));
      });
    }
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('jarvis_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.messages = parsed.slice(-20); // Keep last 20 messages
      }
    } catch (e) {
      this.messages = [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem('jarvis_chat_history', JSON.stringify(this.messages.slice(-20)));
    } catch (e) {
      // Storage quota exceeded or unavailable — silently fail
    }
  }

  displayWelcome() {
    if (this.messages.length === 0) {
      const hour = new Date().getHours();
      let timeKey = 'morning';
      if (hour >= 12 && hour < 17) timeKey = 'afternoon';
      else if (hour >= 17 && hour < 21) timeKey = 'evening';
      else if (hour >= 21 || hour < 6) timeKey = 'night';

      const greetings = JARVIS_CONFIG.GREETINGS[timeKey];
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];

      this.addMessage(
        'assistant',
        greeting +
        "\n\nI'm fully operational and ready to assist with:\n" +
        '- **Tasks & Projects** — say "create a task" or "show my board"\n' +
        '- **Research** — "search for..." or "what is..."\n' +
        '- **Market Data** — "BTC price" or "how is NVDA doing?"\n' +
        '- **News** — "latest tech news" or "briefing"\n' +
        '- **Documents** — "write a report on..." or "draft an email"\n' +
        '- **Voice** — click the mic button or use VOICE in the dock\n\n' +
        'What shall we tackle first?'
      );
    } else {
      // Reload history into UI
      this.messages.forEach(msg => this.renderMessage(msg.role, msg.content, false));
    }
  }

  async sendMessage(textOverride = null) {
    const text = textOverride !== null ? textOverride : this.chatInput.value.trim();
    if (!text && this.attachedFiles.length === 0) return;
    if (this.isThinking) return;

    // Clear input
    if (textOverride === null) {
      this.chatInput.value = '';
      this.chatInput.style.height = 'auto';
    }

    // Build message content
    let messageContent = text;
    let displayContent = text;
    const filesAttached = [...this.attachedFiles];
    this.attachedFiles = [];
    this.updateAttachmentsUI();

    // Add file context to message
    if (filesAttached.length > 0) {
      const fileDescriptions = filesAttached
        .map(f => `[Attached: ${f.name} (${f.type})]`)
        .join('\n');
      const fileContents = filesAttached
        .map(f => `File content of ${f.name}:\n${f.content}`)
        .join('\n\n');
      messageContent = `${text}\n\n${fileDescriptions}\n\n${fileContents}`;
      displayContent = text + `\n\n📎 ${filesAttached.map(f => f.name).join(', ')}`;
    }

    // Display user message
    this.addMessage('user', displayContent);

    // Set thinking state
    this.setThinking(true);
    const thinkingEl = this.showThinking();

    try {
      // Prepare messages for API — last 10 for context window
      const apiMessages = this.messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }));

      // Replace last user entry with the full message content (may include file data)
      apiMessages[apiMessages.length - 1] = { role: 'user', content: messageContent };

      // Get current tasks for context
      const currentTasks = window.TaskManager ? window.TaskManager.getTasks() : [];

      const response = await fetch(JARVIS_CONFIG.API.CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          currentTasks,
          systemAddendum: `User's location preference: ${JARVIS_CONFIG.JARVIS.DEFAULT_LOCATION}`
        })
      });

      if (!response.ok) {
        let errData = {};
        try { errData = await response.json(); } catch (_) {}
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // Remove thinking indicator
      thinkingEl.remove();

      // Process client-side actions
      if (data.actions && data.actions.length > 0) {
        data.actions.forEach(action => this.handleClientAction(action));
      }

      // Display response
      if (data.response) {
        this.addMessage('assistant', data.response);

        // Speak response if voice mode is active
        if (window.VoiceManager && window.VoiceManager.isVoiceMode) {
          window.VoiceManager.speak(data.response);
        }
      }

    } catch (error) {
      thinkingEl.remove();
      const errorMsg = error.message === 'Failed to fetch'
        ? 'Unable to connect to server. Make sure you are running in development mode (`vercel dev`) or have deployed to Vercel.'
        : `Error: ${error.message}`;
      this.addMessage('assistant', `⚠️ ${errorMsg}`);
    } finally {
      this.setThinking(false);
    }
  }

  handleClientAction(action) {
    switch (action.__action) {
      case 'create_task':
        if (window.TaskManager) {
          window.TaskManager.addTask({
            id: action.id || Date.now().toString(),
            title: action.title,
            description: action.description || '',
            priority: action.priority || 'medium',
            status: 'todo',
            created: new Date().toISOString(),
            due_date: action.due_date || null
          });
          if (window.NotifManager) {
            window.NotifManager.toast(`Task created: ${action.title}`, 'success');
          }
        }
        break;

      case 'update_task':
        if (window.TaskManager) {
          window.TaskManager.updateTask(action.task_id, action.updates);
        }
        break;

      case 'generate_document':
        this.downloadDocument(action.title, action.content, action.format || 'markdown');
        if (window.NotifManager) {
          window.NotifManager.toast(`Document ready: ${action.title}`, 'success');
        }
        break;

      case 'send_notification':
        if (window.NotifManager) {
          window.NotifManager.sendNotification(action.title, action.body);
          window.NotifManager.toast(
            action.body,
            action.urgency === 'high' ? 'error' : 'info'
          );
        }
        break;

      default:
        console.warn('Unknown client action:', action.__action);
    }
  }

  downloadDocument(title, content, format) {
    const ext = format === 'html' ? 'html' : format === 'text' ? 'txt' : 'md';
    const mimeType = format === 'html' ? 'text/html' : 'text/plain';

    let finalContent = content;
    if (format === 'html') {
      finalContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1, h2, h3 { color: #1a1a2e; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
    code { font-family: monospace; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  ${content}
</body>
</html>`;
    }

    const blob = new Blob([finalContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  addMessage(role, content) {
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString()
    };
    this.messages.push(msg);
    this.renderMessage(role, content, true);
    this.saveHistory();
    if (role === 'user') {
      this.messageCount++;
      if (this.sessionCounter) {
        this.sessionCounter.textContent = `${this.messageCount} msgs`;
      }
    }
    this.updateTokenCounter();
  }

  renderMessage(role, content, animate) {
    const div = document.createElement('div');
    div.className = `msg msg-${role}${animate ? ' msg-animate' : ''}`;

    const timestamp = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });

    if (role === 'assistant') {
      div.innerHTML = `
        <div class="msg-avatar">&#x2B21;</div>
        <div class="msg-content">
          <div class="msg-text">${this.renderMarkdown(content)}</div>
          <div class="msg-meta">${JARVIS_CONFIG.JARVIS.NAME} &middot; ${timestamp}</div>
        </div>
      `;
    } else {
      div.innerHTML = `
        <div class="msg-content">
          <div class="msg-text">${this.renderMarkdown(content)}</div>
          <div class="msg-meta">${JARVIS_CONFIG.JARVIS.USER_NAME} &middot; ${timestamp}</div>
        </div>
      `;
    }

    this.chatMessages.appendChild(div);
    this.scrollToBottom();
  }

  renderMarkdown(text) {
    // Escape HTML first to prevent XSS
    let html = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks (must run before inline code)
    html = html.replace(
      /```(\w+)?\n?([\s\S]*?)```/g,
      (_, lang, code) => `<pre><code class="code-block${lang ? ' lang-' + lang : ''}">${code.trim()}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Unordered list items
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

    // Ordered list items
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> elements in <ul>
    html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, match => `<ul>${match}</ul>`);

    // Links
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Paragraphs — double newlines
    html = html.replace(/\n\n/g, '</p><p>');

    // Single newlines
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph if not already a block element
    if (!/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|p)/.test(html)) {
      html = `<p>${html}</p>`;
    }

    return html;
  }

  showThinking() {
    const div = document.createElement('div');
    div.className = 'msg msg-assistant msg-thinking';
    div.innerHTML = `
      <div class="msg-avatar">&#x2B21;</div>
      <div class="msg-content">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    this.chatMessages.appendChild(div);
    this.scrollToBottom();
    return div;
  }

  setThinking(state) {
    this.isThinking = state;
    this.sendBtn.disabled = state;
    this.chatInput.disabled = state;
    if (this.arcLabel) {
      this.arcLabel.textContent = state ? 'PROCESSING' : 'READY';
    }
    document.body.classList.toggle('jarvis-thinking', state);
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  clearChat() {
    if (!confirm('Clear conversation history?')) return;
    this.messages = [];
    this.chatMessages.innerHTML = '';
    this.messageCount = 0;
    if (this.sessionCounter) {
      this.sessionCounter.textContent = '0 msgs';
    }
    localStorage.removeItem('jarvis_chat_history');
    this.updateTokenCounter();
    if (this.chatSearchEl) this.chatSearchEl.value = '';
    this.displayWelcome();
  }

  async handleFileAttach(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await this.processFile(file);
    }
    e.target.value = ''; // Reset input so same file can be re-attached
  }

  async processFile(file) {
    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxSize) {
      if (window.NotifManager) {
        window.NotifManager.toast(`File too large: ${file.name} (max 10 MB)`, 'error');
      }
      return;
    }

    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const result = e.target.result;

        if (file.type.startsWith('image/')) {
          // Store base64 for Claude vision; truncate preview in display
          this.attachedFiles.push({
            name: file.name,
            type: file.type,
            content: `[Image data: ${result.substring(0, 80)}...]`,
            isImage: true,
            base64: result
          });
        } else {
          // Text or binary file
          this.attachedFiles.push({
            name: file.name,
            type: file.type,
            content: typeof result === 'string' ? result : '[Binary file — cannot display]',
            isImage: false
          });
        }

        this.updateAttachmentsUI();
        resolve();
      };

      reader.onerror = () => {
        if (window.NotifManager) {
          window.NotifManager.toast(`Failed to read: ${file.name}`, 'error');
        }
        resolve();
      };

      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  updateAttachmentsUI() {
    if (!this.chatAttachments) return;

    this.chatAttachments.innerHTML = '';

    this.attachedFiles.forEach((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      chip.innerHTML = `
        <span class="attachment-name">${this.escapeHtml(f.name)}</span>
        <button class="attachment-remove" aria-label="Remove ${this.escapeHtml(f.name)}"
          onclick="window.JarvisEngine && window.JarvisEngine.removeAttachment(${i})">&#x2715;</button>
      `;
      this.chatAttachments.appendChild(chip);
    });

    this.chatAttachments.style.display = this.attachedFiles.length > 0 ? 'flex' : 'none';
  }

  removeAttachment(index) {
    this.attachedFiles.splice(index, 1);
    this.updateAttachmentsUI();
  }

  // Public API for voice and other modules
  processVoiceCommand(text) {
    if (!text || !text.trim()) return;
    this.chatInput.value = text;
    this.sendMessage();
  }

  // Return current session stats for widgets
  getSessionStats() {
    return {
      messageCount: this.messageCount,
      sessionStart: this.sessionStart,
      uptime: Date.now() - this.sessionStart
    };
  }
}
