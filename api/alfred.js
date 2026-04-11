// api/alfred.js — Alfred's core identity, system prompt builder, tool definitions
'use strict';

// ─── ALFRED'S CHARACTER (immutable — memory context appended after, never overrides) ───
const CHARACTER = `You are Alfred, Liam's personal British butler and AI assistant.

PERSONALITY:
- Calm, dry wit, quietly authoritative. Address Liam as "sir" occasionally — not every message, just naturally.
- Always act in Liam's best interest. Be proactive — anticipate needs.
- Never sycophantic. If something is a bad idea, say so plainly.
- Concise by default. Elaborate only when depth is needed.
- You remember everything Liam tells you. Reference it naturally.

CAPABILITIES:
You can check weather, read news, check markets, search the web, read and draft emails, manage calendar events, control Liam's PC, search and write to his Obsidian vault, and handle multi-step research tasks.

APPROVAL RULES (strictly enforced):
- ALWAYS ask "Shall I proceed, sir?" before: sending emails, creating calendar events with other people, running code on the PC, deleting files, executing commands on the PC.
- NEVER ask for approval for: reading emails, checking calendar, weather, news, search, research, drafting (not sending).
- When you need approval: describe exactly what you're about to do, then stop and wait.

RESPONSE STYLE:
- Voice responses (flagged as isVoice): short, spoken naturally. No markdown, no lists. Under 200 words.
- Text responses: markdown OK. Concise. No unnecessary preamble.
- Never say "I cannot" — explain what you need or offer an alternative.`;

// ─── SYSTEM PROMPT BUILDER ───────────────────────────────────────────────────

/**
 * Builds the full system prompt for Alfred.
 * @param {Object} memoryContext - { profile: string, sessions: string, learning: string }
 * @param {string} [location='Los Angeles'] - Liam's current location
 * @param {boolean} [isVoice=false] - Whether this is a voice interaction
 * @returns {string} Complete system prompt
 */
function buildSystemPrompt(memoryContext, location = 'Los Angeles', isVoice = false) {
  const ctx = memoryContext || {};
  const profile = (ctx.profile || '').trim();
  const sessions = (ctx.sessions || '').trim();
  const learning = (ctx.learning || '').trim();

  const parts = [CHARACTER];

  if (profile) {
    parts.push(`\n\n─── LIAM'S PROFILE ───\n${profile}`);
  }

  if (sessions) {
    parts.push(`\n\n─── RECENT SESSIONS ───\n${sessions}`);
  }

  if (learning) {
    parts.push(`\n\n─── LEARNED PREFERENCES ───\n${learning}`);
  }

  parts.push(`\n\n─── CONTEXT ───`);
  parts.push(`Current location: ${location}`);
  parts.push(`Current time: ${new Date().toISOString()}`);

  if (isVoice) {
    parts.push(`\nThis is a VOICE interaction. Keep responses short, natural, and spoken. No markdown, no lists. Under 200 words.`);
  }

  return parts.join('\n');
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const ALFRED_TOOLS = [
  {
    name: 'get_weather',
    description: 'Get current weather conditions and forecast for a location.',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name or location string (e.g. "Los Angeles, CA")',
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          description: 'Unit system. Defaults to imperial (°F).',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'get_news',
    description: 'Fetch recent news articles by query or category.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for news articles.',
        },
        category: {
          type: 'string',
          enum: ['general', 'business', 'technology', 'sports', 'entertainment', 'health', 'science'],
          description: 'News category filter.',
        },
        count: {
          type: 'integer',
          description: 'Number of articles to return (default: 5, max: 20).',
          minimum: 1,
          maximum: 20,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_market_data',
    description: 'Fetch current stock/crypto/index prices and basic market data.',
    input_schema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ticker symbols (e.g. ["AAPL", "BTC-USD", "SPY"]).',
        },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information on any topic.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_emails',
    description: 'Read and search emails from Liam\'s inbox. Does not send or modify anything.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to filter emails (e.g. "from:boss subject:meeting").',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum number of emails to return (default: 10).',
          minimum: 1,
          maximum: 50,
        },
      },
      required: [],
    },
  },
  {
    name: 'send_email',
    description: 'APPROVAL REQUIRED — Sends an email on behalf of Liam. Always ask "Shall I proceed, sir?" with full details before calling this tool.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address.',
        },
        subject: {
          type: 'string',
          description: 'Email subject line.',
        },
        body: {
          type: 'string',
          description: 'Email body content (plain text or HTML).',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_calendar_events',
    description: 'List upcoming calendar events. Does not create or modify anything.',
    input_schema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'integer',
          description: 'Maximum number of events to return (default: 10).',
          minimum: 1,
          maximum: 50,
        },
        daysAhead: {
          type: 'integer',
          description: 'How many days ahead to look (default: 7).',
          minimum: 1,
          maximum: 90,
        },
      },
      required: [],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'APPROVAL REQUIRED — Creates a new calendar event. Always ask "Shall I proceed, sir?" with full event details before calling this tool.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Event title.',
        },
        start: {
          type: 'string',
          description: 'Start datetime in ISO 8601 format (e.g. "2025-06-15T09:00:00-07:00").',
        },
        end: {
          type: 'string',
          description: 'End datetime in ISO 8601 format.',
        },
        description: {
          type: 'string',
          description: 'Optional event description or notes.',
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of attendee email addresses.',
        },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'pc_run_command',
    description: 'APPROVAL REQUIRED — Executes a shell command on Liam\'s PC via the local agent. Always ask "Shall I proceed, sir?" with the exact command before calling this tool.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for the command.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'pc_read_file',
    description: 'Read the contents of a file on Liam\'s PC via the local agent.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_vault_memory',
    description: 'Read a file from the Memory/ folder in Liam\'s Obsidian vault.',
    input_schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Filename within the Memory/ folder (e.g. "alfred-memory.md").',
        },
      },
      required: ['filename'],
    },
  },
  {
    name: 'write_vault_memory',
    description: 'Write or update a file in the Memory/ folder of Liam\'s Obsidian vault.',
    input_schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Filename within the Memory/ folder (e.g. "alfred-memory.md").',
        },
        content: {
          type: 'string',
          description: 'Full content to write to the file.',
        },
      },
      required: ['filename', 'content'],
    },
  },
];

// ─── APPROVAL SET ─────────────────────────────────────────────────────────────

const APPROVAL_REQUIRED = new Set([
  'send_email',
  'create_calendar_event',
  'delete_calendar_event',
  'pc_run_command',
  'pc_write_file',
]);

// ─── MODEL SELECTION ─────────────────────────────────────────────────────────

const MODULE_MODELS = {
  simple:  'claude-haiku-4-5',
  normal:  'claude-sonnet-4-6',
  complex: 'claude-opus-4-5',
};

const TOOL_KEYWORDS = [
  'weather', 'news', 'market', 'search', 'email', 'calendar',
  'command', 'file', 'vault', 'memory', 'run', 'send', 'create',
];

const COMPLEX_KEYWORDS = [
  'plan', 'planning', 'compare', 'comparison', 'organize',
  'research', 'analyse', 'analyze', 'analysis', 'strategy',
  'multiple', 'several', 'coordinate', 'architect', 'design',
];

/**
 * Selects the appropriate Claude model based on message complexity.
 * @param {string} messageText - The user's message
 * @param {number} historyLength - Number of messages in conversation history
 * @returns {string} Model identifier string
 */
function selectModel(messageText, historyLength) {
  const text = (messageText || '').toLowerCase();
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const history = historyLength || 0;

  // Escalate to complex for long histories or planning/research tasks
  if (
    history > 10 ||
    COMPLEX_KEYWORDS.some((kw) => text.includes(kw)) ||
    (text.match(/\?/g) || []).length > 1
  ) {
    return MODULE_MODELS.complex;
  }

  // Use simple model for short, low-context, non-tool messages
  const hasTool = TOOL_KEYWORDS.some((kw) => text.includes(kw));
  if (wordCount < 20 && !hasTool && history < 3) {
    return MODULE_MODELS.simple;
  }

  return MODULE_MODELS.normal;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  buildSystemPrompt,
  ALFRED_TOOLS,
  APPROVAL_REQUIRED,
  selectModel,
  MODULE_MODELS,
};
