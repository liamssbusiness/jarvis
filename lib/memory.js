// api/memory.js — Obsidian-based persistent memory for Alfred
'use strict';

const LOCAL_AGENT_URL    = process.env.LOCAL_AGENT_URL    || '';
const LOCAL_AGENT_SECRET = process.env.LOCAL_AGENT_SECRET || '';

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/**
 * POST to /api/vault-log on the local agent. Returns parsed JSON or null.
 * @param {Object} body - Request body
 * @returns {Promise<Object|null>}
 */
async function callVaultLog(body) {
  if (!LOCAL_AGENT_URL) return null;

  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/api/vault-log`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${LOCAL_AGENT_SECRET}`,
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST to /api/vault-read on the local agent. Returns { success, content } or null.
 * @param {string} relativePath - Path relative to the vault root
 * @returns {Promise<{success: boolean, content: string}|null>}
 */
async function callVaultRead(relativePath) {
  if (!LOCAL_AGENT_URL) return null;

  try {
    const res = await fetch(`${LOCAL_AGENT_URL}/api/vault-read`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${LOCAL_AGENT_SECRET}`,
      },
      body:   JSON.stringify({ path: relativePath }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Read a file from the Memory/ folder in the Obsidian vault.
 * @param {string} filename - Filename within Memory/
 * @returns {Promise<string>} File contents or empty string on failure
 */
async function readMemoryFile(filename) {
  const result = await callVaultRead(`Memory/${filename}`);
  if (!result || !result.success) return '';
  return result.content || '';
}

/**
 * Write (overwrite) a file in the Memory/ folder.
 * @param {string} filename - Filename within Memory/
 * @param {string} content - Full content to write
 * @returns {Promise<boolean>} True on success
 */
async function writeMemoryFile(filename, content) {
  const result = await callVaultLog({ folder: 'Memory', filename, content });
  return !!(result && result.success !== false);
}

/**
 * Append content to a file in the Memory/ folder.
 * @param {string} filename - Filename within Memory/
 * @param {string} content - Content to append
 * @param {string} [header] - Header to use if the file is new
 * @returns {Promise<boolean>} True on success
 */
async function appendMemoryFile(filename, content, header) {
  const result = await callVaultLog({
    folder:   'Memory',
    filename,
    append:   content,
    header:   header || '',
  });
  return !!(result && result.success !== false);
}

/**
 * Load all memory context files in parallel.
 * @returns {Promise<{profile: string, sessions: string, learning: string}>}
 */
async function loadMemoryContext() {
  try {
    const [profile, sessions, learning] = await Promise.all([
      readMemoryFile('alfred-memory.md'),
      readMemoryFile('alfred-sessions.md'),
      readMemoryFile('alfred-learning.md'),
    ]);
    return { profile, sessions, learning };
  } catch {
    return { profile: '', sessions: '', learning: '' };
  }
}

/**
 * Append a session summary to alfred-sessions.md.
 * @param {string} summary - Summary of the session
 * @returns {Promise<boolean>}
 */
async function saveSessionSummary(summary) {
  const date = new Date().toISOString().split('T')[0];
  const entry = `\n\n---\n## Session ${date}\n${summary}`;
  const header = `# Alfred Session Log\n\nA record of Alfred's conversations with Liam.\n`;
  return appendMemoryFile('alfred-sessions.md', entry, header);
}

/**
 * Overwrite alfred-memory.md with new profile content.
 * @param {string} content - Full profile content
 * @returns {Promise<boolean>}
 */
async function updateProfile(content) {
  return writeMemoryFile('alfred-memory.md', content);
}

/**
 * Append a learning entry to alfred-learning.md.
 * @param {string} entry - The thing Alfred learned
 * @returns {Promise<boolean>}
 */
async function appendLearning(entry) {
  const timestamp = new Date().toISOString();
  const line = `\n- [${timestamp}] ${entry}`;
  const header = `# Alfred Learning Log\n\nThings Alfred has learned about Liam's preferences and patterns.\n`;
  return appendMemoryFile('alfred-learning.md', line, header);
}

/**
 * Update the location field in alfred-memory.md.
 * Finds and replaces the `location:` line or appends it if absent.
 * @param {string} city - City name
 * @returns {Promise<void>}
 */
async function updateLocation(city) {
  try {
    const content = await readMemoryFile('alfred-memory.md');

    const locationLine = `location: ${city}`;

    if (!content) {
      await writeMemoryFile('alfred-memory.md', `${locationLine}\n`);
      return;
    }

    const lines = content.split('\n');
    const idx   = lines.findIndex((l) => l.trimStart().startsWith('location:'));

    let updated;
    if (idx !== -1) {
      lines[idx] = locationLine;
      updated = lines.join('\n');
    } else {
      updated = content.trimEnd() + `\n${locationLine}\n`;
    }

    await writeMemoryFile('alfred-memory.md', updated);
  } catch {
    // Silent — Alfred works without memory
  }
}

/**
 * Extract Liam's current location from alfred-memory.md.
 * @returns {Promise<string>} City name, or 'Los Angeles' as default
 */
async function extractLocationFromProfile() {
  try {
    const content = await readMemoryFile('alfred-memory.md');
    if (!content) return 'Los Angeles';

    const line = content
      .split('\n')
      .find((l) => l.trimStart().startsWith('location:'));

    if (!line) return 'Los Angeles';

    const value = line.slice(line.indexOf(':') + 1).trim();
    return value || 'Los Angeles';
  } catch {
    return 'Los Angeles';
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  callVaultLog,
  callVaultRead,
  readMemoryFile,
  writeMemoryFile,
  appendMemoryFile,
  loadMemoryContext,
  saveSessionSummary,
  updateProfile,
  appendLearning,
  updateLocation,
  extractLocationFromProfile,
};
