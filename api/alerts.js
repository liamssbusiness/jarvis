// JARVIS Proactive Alerts — Rules storage & management API
//
// STORAGE NOTE: Rules are kept in an in-process array that persists only
// while the serverless function is warm. For true persistence Liam should
// migrate this to a DB (Vercel KV, Upstash Redis, Supabase, etc.) — the
// handler API will stay the same. A best-effort file backup is written to
// /tmp/alerts.json (ephemeral on Vercel but survives warm invocations).
//
// Actions (via ?action= or POST body.action):
//   list     -> GET    returns configured rules
//   create   -> POST   add a new rule
//   update   -> PATCH  update a rule by id
//   delete   -> DELETE remove a rule by id
//   trigger  -> POST   manually fire a rule (sends via Telegram)
//   cron     -> GET    evaluate all enabled rules (called by cron)
//
// IMPORTANT: Nothing fires automatically. The `cron` action only runs
// when Liam wires up a scheduler (see vercel.json commented crons).

const fs = require('fs');
const path = require('path');

const STORE_PATH = '/tmp/alerts.json';
const SYNC_PATH = '/tmp/jarvis-state.json';

// ---------------------------------------------------------------------------
// Sync store — shared state blob for dashboard <-> Telegram bot coordination.
// Shape: { tasks: [], alerts: [], chat_messages: [], updated: ISOString }
// Tasks/alerts are merged by id; newest updated_at wins.
// ---------------------------------------------------------------------------
let syncStore = null;

function loadSyncState() {
  if (syncStore !== null) return syncStore;
  try {
    if (fs.existsSync(SYNC_PATH)) {
      const raw = fs.readFileSync(SYNC_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      syncStore = {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        chat_messages: Array.isArray(parsed.chat_messages) ? parsed.chat_messages : [],
        updated: parsed.updated || new Date().toISOString()
      };
      return syncStore;
    }
  } catch (e) {
    console.error('sync: failed to load state:', e.message);
  }
  syncStore = { tasks: [], alerts: [], chat_messages: [], updated: new Date().toISOString() };
  return syncStore;
}

function saveSyncState() {
  try {
    fs.writeFileSync(SYNC_PATH, JSON.stringify(syncStore), 'utf8');
  } catch (e) {
    console.error('sync: failed to persist state:', e.message);
  }
}

function _itemTimestamp(item) {
  // Pick the most recent timestamp available for merge comparison
  const ts = item.updated || item.updated_at || item.created || item.created_at || item.timestamp || 0;
  try { return new Date(ts).getTime() || 0; } catch { return 0; }
}

function _mergeById(existing, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  const byId = new Map();
  for (const it of existing) {
    if (it && it.id) byId.set(it.id, it);
  }
  for (const it of incoming) {
    if (!it || !it.id) continue;
    // Deletion marker: { id, _deleted: true }
    if (it._deleted) { byId.delete(it.id); continue; }
    const prev = byId.get(it.id);
    if (!prev) { byId.set(it.id, it); continue; }
    // Newest timestamp wins
    if (_itemTimestamp(it) >= _itemTimestamp(prev)) {
      byId.set(it.id, { ...prev, ...it });
    }
  }
  return Array.from(byId.values());
}

function getSyncSnapshot() {
  return loadSyncState();
}

function applySyncUpdate(patch) {
  const state = loadSyncState();
  if (patch.tasks)         state.tasks = _mergeById(state.tasks, patch.tasks);
  if (patch.alerts)        state.alerts = _mergeById(state.alerts, patch.alerts);
  if (patch.chat_messages) state.chat_messages = _mergeById(state.chat_messages, patch.chat_messages);
  // Full replacement (used when dashboard pushes its entire task list on save)
  if (patch.tasks_replace && Array.isArray(patch.tasks_replace)) state.tasks = patch.tasks_replace;
  state.updated = new Date().toISOString();
  syncStore = state;
  saveSyncState();
  return state;
}

// In-memory rules store
// Each rule: { id, name, type, schedule, enabled, config, message_template,
//              conditions, created, updated, last_fired, fire_count }
let rulesStore = null;

function loadRules() {
  if (rulesStore !== null) return rulesStore;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      rulesStore = Array.isArray(parsed.rules) ? parsed.rules : [];
      return rulesStore;
    }
  } catch (e) {
    console.error('alerts: failed to load store:', e.message);
  }
  rulesStore = [];
  return rulesStore;
}

function saveRules() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ rules: rulesStore }, null, 2), 'utf8');
  } catch (e) {
    console.error('alerts: failed to persist store:', e.message);
  }
}

function genId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Exported helpers so other modules (telegram.js, cron-alerts.js) can
// manipulate rules without going through HTTP.
function listRules() {
  return loadRules().slice();
}

function createRule(input) {
  const rules = loadRules();
  const now = new Date().toISOString();
  const rule = {
    id: genId(),
    name: input.name || 'Untitled Alert',
    type: input.type || 'custom',
    schedule: input.schedule || 'manual',
    enabled: input.enabled !== false,
    message_template: input.message_template || '',
    conditions: input.conditions || {},
    config: input.config || {},
    created: now,
    updated: now,
    last_fired: null,
    fire_count: 0
  };
  rules.push(rule);
  saveRules();
  return rule;
}

function updateRule(id, patch) {
  const rules = loadRules();
  const idx = rules.findIndex(r => r.id === id || r.name === id);
  if (idx === -1) return null;
  const allowed = ['name', 'type', 'schedule', 'enabled', 'message_template',
                   'conditions', 'config', 'last_fired', 'fire_count'];
  for (const k of allowed) {
    if (k in patch) rules[idx][k] = patch[k];
  }
  rules[idx].updated = new Date().toISOString();
  saveRules();
  return rules[idx];
}

function deleteRule(id) {
  const rules = loadRules();
  const idx = rules.findIndex(r => r.id === id || r.name === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  saveRules();
  return true;
}

function getRule(id) {
  return loadRules().find(r => r.id === id || r.name === id) || null;
}

// Fire a rule: sends its message via Telegram
async function fireRule(rule, overrideMessage = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' };
  }
  const body = overrideMessage
    || rule.message_template
    || `🔔 *${rule.name}*\n\nAlert rule triggered (${rule.type}).`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'Markdown' })
    });
    const data = await res.json();
    if (!data.ok) return { success: false, error: data.description || 'telegram error' };
    // Update fire stats
    updateRule(rule.id, {
      last_fired: new Date().toISOString(),
      fire_count: (rule.fire_count || 0) + 1
    });
    return { success: true, message_id: data.result?.message_id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// HTTP handler
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query?.action) || (req.body?.action) || null;
  const method = req.method;

  try {
    // SYNC: snapshot (GET) — returns full shared state
    if (method === 'GET' && action === 'sync-snapshot') {
      return res.status(200).json({ ok: true, state: getSyncSnapshot() });
    }

    // SYNC: update (POST) — merge a partial update into shared state
    if (method === 'POST' && action === 'sync-update') {
      const patch = req.body || {};
      const state = applySyncUpdate(patch);
      return res.status(200).json({
        ok: true,
        updated: state.updated,
        counts: {
          tasks: state.tasks.length,
          alerts: state.alerts.length,
          chat_messages: state.chat_messages.length
        }
      });
    }

    // LIST
    if (method === 'GET' && (!action || action === 'list')) {
      return res.status(200).json({ ok: true, rules: listRules() });
    }

    // CRON evaluation — delegate to cron-alerts endpoint's logic
    if (method === 'GET' && action === 'cron') {
      const rules = listRules().filter(r => r.enabled);
      return res.status(200).json({
        ok: true,
        note: 'cron evaluation stub — wire scheduler to /api/cron-alerts',
        enabled_rules: rules.length,
        rules: rules.map(r => ({ id: r.id, name: r.name, schedule: r.schedule }))
      });
    }

    // CREATE
    if (method === 'POST' && (!action || action === 'create')) {
      const input = req.body || {};
      if (!input.name || !input.type || !input.schedule) {
        return res.status(400).json({ ok: false, error: 'name, type, and schedule are required' });
      }
      const rule = createRule(input);
      return res.status(200).json({ ok: true, rule });
    }

    // TRIGGER (manual fire)
    if (method === 'POST' && action === 'trigger') {
      const id = req.body?.id || req.body?.rule_id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const rule = getRule(id);
      if (!rule) return res.status(404).json({ ok: false, error: 'rule not found' });
      const result = await fireRule(rule, req.body?.message);
      return res.status(200).json({ ok: result.success, rule_id: rule.id, ...result });
    }

    // UPDATE
    if (method === 'PATCH' || (method === 'POST' && action === 'update')) {
      const id = req.body?.id || req.query?.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const updated = updateRule(id, req.body || {});
      if (!updated) return res.status(404).json({ ok: false, error: 'rule not found' });
      return res.status(200).json({ ok: true, rule: updated });
    }

    // DELETE
    if (method === 'DELETE' || (method === 'POST' && action === 'delete')) {
      const id = req.body?.id || req.query?.id;
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const ok = deleteRule(id);
      if (!ok) return res.status(404).json({ ok: false, error: 'rule not found' });
      return res.status(200).json({ ok: true, deleted: id });
    }

    return res.status(400).json({ ok: false, error: `unsupported action/method: ${method} ${action || ''}` });
  } catch (e) {
    console.error('alerts handler error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// Export helpers for internal use
module.exports.listRules = listRules;
module.exports.createRule = createRule;
module.exports.updateRule = updateRule;
module.exports.deleteRule = deleteRule;
module.exports.getRule = getRule;
module.exports.fireRule = fireRule;
module.exports.getSyncSnapshot = getSyncSnapshot;
module.exports.applySyncUpdate = applySyncUpdate;
