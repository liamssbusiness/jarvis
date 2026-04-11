// api/status.js — Live Alfred status for the Game World dashboard
'use strict';

const fs = require('fs');
const path = require('path');

// In-memory counters (reset each cold start — Vercel ephemeral)
let sessionMessages = 0;
let sessionTokens = 0;

// Simple in-memory activity ring buffer
const MAX_ACTIVITY = 20;
const activityLog = [];

function pushActivity(type, text) {
  activityLog.unshift({ type, text, ts: new Date().toISOString() });
  if (activityLog.length > MAX_ACTIVITY) activityLog.pop();
}

// ─── Zone stats pulled from env / memory files ───────────────────────────────
function getZoneStats() {
  return {
    chambers:  { tasks: 0, automations: 1, items: 3,  label: "Alfred's home base" },
    mission:   { tasks: 0, automations: 2, items: 0,  label: 'Active task queue' },
    telegram:  { tasks: 0, automations: 1, items: sessionMessages, label: 'Messages processed' },
    memory:    { tasks: 0, automations: 0, items: 3,  label: 'Vault files synced' },
    research:  { tasks: 0, automations: 0, items: 0,  label: 'Research operations' },
    market:    { tasks: 0, automations: 1, items: 0,  label: 'Market data feeds' },
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS for game dashboard (different origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow external services to push activity events
  if (req.method === 'POST') {
    try {
      const { type, text, tokens, messages } = req.body || {};
      if (type && text) pushActivity(type, text);
      if (tokens) sessionTokens += tokens;
      if (messages) sessionMessages += messages;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  // GET — return full status snapshot
  const now = new Date();

  res.status(200).json({
    ok: true,
    ts: now.toISOString(),

    // Alfred agent
    alfred: {
      status: 'IDLE',       // IDLE | THINKING | WORKING | OFFLINE
      currentZone: 'chambers',
      lastAction: activityLog[0]?.text || 'Systems nominal, sir.',
    },

    // Swarm
    agentsOnline: 1,
    agentList: [
      {
        id: 'alfred',
        name: 'Alfred',
        status: 'IDLE',
        color: '#00c8ff',
        task: activityLog[0]?.text || 'Awaiting your commands, sir.',
      },
    ],

    // Resources
    resources: {
      messages:  sessionMessages,
      tokens:    sessionTokens,
      memoryFiles: 3,
      utc: now.toUTCString(),
    },

    // Zone data
    zones: getZoneStats(),

    // Recent activity (for log feed)
    activity: activityLog.slice(0, 10),

    // Ticker quote
    ticker: activityLog[0]?.text || 'All systems nominal. Good to see you, sir.',
  });
};
