/**
 * VoiceManager — speech recognition and synthesis for the JARVIS dashboard.
 * Wraps the Web Speech API with voice-mode auto-restart and TTS preferences.
 */
class VoiceManager {
  constructor() {
    this.recognition        = null;
    this.synthesis          = window.speechSynthesis || null;
    this.isListening        = false;
    this.isVoiceMode        = false;
    this._voiceRestartTimer = null;
    this._voicesLoaded      = false;
    this._preferredVoice    = null;

    this.voiceBtn     = document.getElementById('voice-btn');
    this.voiceOverlay = document.getElementById('voice-overlay');
    this.arcLabel     = document.getElementById('arc-label');

    this._init();
    this._preloadVoices();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  _init() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('VoiceManager: SpeechRecognition not supported in this browser.');
      if (this.voiceBtn) {
        this.voiceBtn.title    = 'Voice recognition not supported in this browser';
        this.voiceBtn.disabled = true;
        this.voiceBtn.classList.add('disabled');
      }
      return;
    }

    this.recognition = new SpeechRecognition();
    this._configureRecognition();
    this._attachRecognitionEvents();
    this._attachButtonEvents();
  }

  _configureRecognition() {
    const cfg = (typeof JARVIS_CONFIG !== 'undefined' && JARVIS_CONFIG.JARVIS) || {};
    this.recognition.lang            = cfg.VOICE_LANG || 'en-GB';
    this.recognition.continuous      = false;
    this.recognition.interimResults  = false;
    this.recognition.maxAlternatives = 1;
  }

  _attachRecognitionEvents() {
    this.recognition.onstart = () => {
      this.isListening = true;
      this._setUiListening(true);
    };

    this.recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join('')
        .trim();
      if (transcript) this._onVoiceResult(transcript);
    };

    this.recognition.onerror = (e) => {
      this._setUiListening(false);
      this.isListening = false;
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        window.NotifManager?.toast(`Voice error: ${e.error}`, 'warning');
        console.warn('VoiceManager recognition error:', e.error);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this._setUiListening(false);
    };
  }

  _attachButtonEvents() {
    if (this.voiceBtn) {
      this.voiceBtn.addEventListener('click', () => this.toggleListening());
    }

    const modeBtnEl = document.getElementById('voice-mode-btn');
    if (modeBtnEl) {
      modeBtnEl.addEventListener('click', () => this.toggleVoiceMode());
    }

    // Close overlay button
    const closeOverlay = document.getElementById('voice-overlay-close');
    if (closeOverlay) {
      closeOverlay.addEventListener('click', () => this.stopListening());
    }

    // Keyboard shortcut: Alt+V
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'v') {
        e.preventDefault();
        this.toggleListening();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Voice List Pre-loading
  // ---------------------------------------------------------------------------

  _preloadVoices() {
    if (!this.synthesis) return;
    const load = () => {
      const voices = this.synthesis.getVoices();
      if (voices.length) {
        this._voicesLoaded   = true;
        this._preferredVoice = this._pickPreferredVoice(voices);
      }
    };
    load();
    if ('onvoiceschanged' in this.synthesis) {
      this.synthesis.onvoiceschanged = load;
    }
  }

  _pickPreferredVoice(voices) {
    return (
      voices.find((v) => v.lang === 'en-GB' && /male/i.test(v.name))     ||
      voices.find((v) => v.lang === 'en-GB' && /daniel|oliver/i.test(v.name)) ||
      voices.find((v) => v.lang === 'en-GB')                              ||
      voices.find((v) => v.lang === 'en-US' && /male/i.test(v.name))     ||
      voices.find((v) => v.lang.startsWith('en'))                         ||
      voices[0]                                                            ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // Listen Control
  // ---------------------------------------------------------------------------

  toggleListening() {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  startListening() {
    if (!this.recognition) {
      window.NotifManager?.toast('Voice recognition is not supported in this browser', 'warning');
      return;
    }
    if (this.isListening) return;
    clearTimeout(this._voiceRestartTimer);
    try {
      this.recognition.start();
    } catch (e) {
      if (e.name !== 'InvalidStateError') {
        console.warn('VoiceManager.startListening:', e.message);
      }
    }
  }

  stopListening() {
    clearTimeout(this._voiceRestartTimer);
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
    this.isListening = false;
    this._setUiListening(false);
  }

  _onVoiceResult(transcript) {
    this.stopListening();
    window.NotifManager?.toast(`Heard: \u201c${transcript}\u201d`, 'info', 2000);
    console.log('VoiceManager transcript:', transcript);

    if (window.JarvisEngine) {
      window.JarvisEngine.processVoiceCommand(transcript);
    }

    if (this.isVoiceMode) {
      const cfg   = (typeof JARVIS_CONFIG !== 'undefined' && JARVIS_CONFIG.JARVIS) || {};
      const delay = cfg.VOICE_RESTART_DELAY ?? 3500;
      this._voiceRestartTimer = setTimeout(() => {
        if (this.isVoiceMode) this.startListening();
      }, delay);
    }
  }

  // ---------------------------------------------------------------------------
  // Continuous Voice Mode
  // ---------------------------------------------------------------------------

  toggleVoiceMode() {
    this.isVoiceMode = !this.isVoiceMode;
    const modeBtnEl = document.getElementById('voice-mode-btn');
    if (this.isVoiceMode) {
      window.NotifManager?.toast('Voice mode ON \u2014 JARVIS is listening', 'success');
      if (modeBtnEl) modeBtnEl.classList.add('active');
      this.startListening();
    } else {
      window.NotifManager?.toast('Voice mode OFF', 'info');
      if (modeBtnEl) modeBtnEl.classList.remove('active');
      this.stopListening();
    }
  }

  // ---------------------------------------------------------------------------
  // Text-to-Speech
  // ---------------------------------------------------------------------------

  speak(text) {
    if (!this.synthesis || !text) return;
    const clean = this._cleanForSpeech(text);
    if (!clean) return;

    this.synthesis.cancel();

    if (!this._voicesLoaded) {
      this._preferredVoice = this._pickPreferredVoice(this.synthesis.getVoices());
    }

    const cfg       = (typeof JARVIS_CONFIG !== 'undefined' && JARVIS_CONFIG.JARVIS) || {};
    const utterance = new SpeechSynthesisUtterance(clean);
    if (this._preferredVoice) utterance.voice = this._preferredVoice;
    utterance.rate   = cfg.VOICE_RATE  ?? 0.95;
    utterance.pitch  = cfg.VOICE_PITCH ?? 0.85;
    utterance.volume = 0.9;

    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        console.warn('VoiceManager TTS error:', e.error);
      }
    };

    this.synthesis.speak(utterance);
  }

  stopSpeaking() {
    if (this.synthesis) this.synthesis.cancel();
  }

  _cleanForSpeech(text) {
    return text
      .replace(/```[\s\S]*?```/g, 'code block.')
      .replace(/`[^`]+`/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_#`\[\]>|]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 600);
  }

  // ---------------------------------------------------------------------------
  // UI State
  // ---------------------------------------------------------------------------

  _setUiListening(active) {
    if (this.voiceBtn) {
      this.voiceBtn.classList.toggle('active',    active);
      this.voiceBtn.classList.toggle('listening', active);
      this.voiceBtn.setAttribute('aria-pressed', String(active));
    }
    if (this.voiceOverlay) {
      this.voiceOverlay.classList.toggle('hidden', !active);
    }
    if (this.arcLabel) {
      this.arcLabel.textContent = active
        ? 'LISTENING'
        : (window.JarvisEngine?.isThinking ? 'PROCESSING' : 'READY');
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  get supported() {
    return this.recognition !== null;
  }

  get ttsSupported() {
    return this.synthesis !== null;
  }

  // ---------------------------------------------------------------------------
  // Destroy / Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    this.stopListening();
    this.stopSpeaking();
    clearTimeout(this._voiceRestartTimer);
  }
}
