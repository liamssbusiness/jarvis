// JARVIS Configuration
const JARVIS_CONFIG = {
  // API endpoints (relative for Vercel deployment)
  API: {
    CHAT: '/api/chat',
    WEATHER: '/api/weather',
    NEWS: '/api/news',
    STOCKS: '/api/stocks',
    SEARCH: '/api/search',
    BRIEFING: '/api/briefing'
  },

  // Local agent WebSocket (runs on user's PC)
  LOCAL_AGENT: {
    URL: 'ws://localhost:3001',
    ENABLED: false  // Set to true when local-agent is running
  },

  // JARVIS settings
  JARVIS: {
    NAME: 'J.A.R.V.I.S',
    USER_NAME: 'Liam',
    VERSION: '2.0',
    DEFAULT_LOCATION: 'London',  // Used for weather
    VOICE_ENABLED: true,
    VOICE_LANG: 'en-GB',         // British English for JARVIS feel
    VOICE_RATE: 0.95,
    VOICE_PITCH: 0.85,
  },

  // Widget refresh intervals (ms)
  REFRESH: {
    WEATHER: 10 * 60 * 1000,    // 10 minutes
    NEWS: 15 * 60 * 1000,        // 15 minutes
    STOCKS: 2 * 60 * 1000,       // 2 minutes
    CLOCK: 1000                   // 1 second
  },

  // Default stocks/crypto to track
  DEFAULT_SYMBOLS: ['BTC', 'ETH', 'AAPL', 'NVDA', 'SOL'],

  // Greeting messages based on time of day
  GREETINGS: {
    morning: [
      'Good morning, Liam. Systems online.',
      'Morning, Liam. Ready to conquer the day.',
      'Rise and shine, Liam. All systems nominal.'
    ],
    afternoon: [
      'Good afternoon, Liam. How can I assist?',
      'Afternoon, Liam. What shall we tackle?',
      'Good afternoon. Ready for your commands.'
    ],
    evening: [
      'Good evening, Liam. End of day systems check.',
      'Evening, Liam. Wrapping up or getting started?',
      'Good evening. All systems operational.'
    ],
    night: [
      "Working late, Liam? I'm here.",
      'Night mode active. How can I help?',
      'Burning the midnight oil, Liam?'
    ]
  }
};
