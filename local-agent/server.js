'use strict';

/**
 * JARVIS Local Agent v2.0
 * ========================
 * Runs on your local PC and gives the JARVIS web dashboard controlled access
 * to the local filesystem and safe shell commands via WebSocket.
 *
 * Start:   node server.js
 * Dev:     node --watch server.js
 *
 * Dashboard: set JARVIS_CONFIG.LOCAL_AGENT.ENABLED = true
 *            set JARVIS_CONFIG.LOCAL_AGENT.URL = 'ws://localhost:3001'
 */

const WebSocket  = require('ws');
const fs         = require('fs').promises;
const path       = require('path');
const { exec }   = require('child_process');
const os         = require('os');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT           = process.env.JARVIS_AGENT_PORT ? parseInt(process.env.JARVIS_AGENT_PORT) : 3001;
const SAFE_ROOT      = os.homedir();
const TMP_DIR        = os.tmpdir();
const MAX_FILE_READ  = 5 * 1024 * 1024;   // 5 MB
const MAX_FILE_WRITE = 10 * 1024 * 1024;  // 10 MB
const CMD_TIMEOUT_MS = 30000;

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://cyber-jarvis.vercel.app'
];
const ALLOWED_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

// Commands always permitted without explicit confirmation
const ALWAYS_SAFE_PREFIXES = [
  'ls', 'dir', 'pwd', 'echo ', 'date', 'whoami',
  'cat ', 'head ', 'tail ', 'wc ',
  'find ', 'grep ', 'du ', 'df ',
  'node --version', 'node -v', 'npm --version', 'npm -v',
  'python --version', 'python3 --version', 'python -V',
  'git status', 'git log', 'git branch', 'git diff',
  'git remote', 'git stash list',
  'open ', 'explorer '
];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Prevent directory-traversal: only permit paths inside SAFE_ROOT or TMP_DIR.
 */
function isSafePath(targetPath) {
  const resolved = path.resolve(targetPath);
  return (
    resolved === SAFE_ROOT ||
    resolved.startsWith(SAFE_ROOT + path.sep) ||
    resolved === TMP_DIR ||
    resolved.startsWith(TMP_DIR + path.sep)
  );
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return ALLOWED_ORIGIN_RE.test(origin);
}

function isAlwaysSafeCommand(cmd) {
  const lower = cmd.toLowerCase().trim();
  return ALWAYS_SAFE_PREFIXES.some(function (prefix) {
    return lower === prefix || lower.startsWith(prefix);
  });
}

function execPromise(cmd, options) {
  return new Promise(function (resolve) {
    exec(cmd, Object.assign({ timeout: CMD_TIMEOUT_MS }, options), function (err, stdout, stderr) {
      resolve({
        success:  !err,
        stdout:   stdout ? stdout.trim() : '',
        stderr:   stderr ? stderr.trim() : '',
        exitCode: err ? (err.code || 1) : 0
      });
    });
  });
}

function sendMsg(ws, id, type, payload) {
  try {
    ws.send(JSON.stringify({ id: id, type: type, payload: payload }));
  } catch (e) {
    console.error('Send error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

const handlers = {

  read_file: async function (p) {
    const fp = path.resolve(p.path);
    if (!isSafePath(fp)) throw new Error('Access denied: path is outside the safe zone');
    const stats = await fs.stat(fp);
    if (stats.isDirectory()) throw new Error('Path is a directory, not a file');
    if (stats.size > MAX_FILE_READ) {
      throw new Error('File too large (' + Math.round(stats.size / 1024) + ' KB). Limit is ' + (MAX_FILE_READ / 1024) + ' KB');
    }
    const content = await fs.readFile(fp, p.encoding || 'utf8');
    return { success: true, content: content, path: fp, size: stats.size, modified: stats.mtime };
  },

  write_file: async function (p) {
    if (typeof p.content !== 'string') throw new Error('Content must be a string');
    if (p.content.length > MAX_FILE_WRITE) throw new Error('Content too large');
    const fp = path.resolve(p.path);
    if (!isSafePath(fp)) throw new Error('Access denied: path is outside the safe zone');
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, p.content, p.encoding || 'utf8');
    return { success: true, path: fp, bytes: Buffer.byteLength(p.content, p.encoding || 'utf8') };
  },

  delete_file: async function (p) {
    const fp = path.resolve(p.path);
    if (!isSafePath(fp)) throw new Error('Access denied');
    const stats = await fs.stat(fp);
    if (stats.isDirectory()) {
      await fs.rmdir(fp); // only removes empty dirs for safety
    } else {
      await fs.unlink(fp);
    }
    return { success: true, path: fp };
  },

  list_dir: async function (p) {
    const dp         = path.resolve(p.path || SAFE_ROOT);
    const showHidden = p.showHidden || false;
    const recursive  = p.recursive  || false;
    if (!isSafePath(dp)) throw new Error('Access denied');

    async function readDir(cur, depth) {
      const entries = await fs.readdir(cur, { withFileTypes: true });
      const results = [];
      for (const e of entries) {
        if (!showHidden && e.name.startsWith('.')) continue;
        const full  = path.join(cur, e.name);
        const isDir = e.isDirectory();
        const item  = { name: e.name, path: full, type: isDir ? 'dir' : 'file' };
        if (!isDir) {
          try {
            const st  = await fs.stat(full);
            item.size     = st.size;
            item.modified = st.mtime;
          } catch (ex) { /* ignore stat errors on individual files */ }
        }
        if (recursive && isDir && depth < 3) {
          item.children = await readDir(full, depth + 1);
        }
        results.push(item);
      }
      return results;
    }

    return { path: dp, entries: await readDir(dp, 0) };
  },

  file_stats: async function (p) {
    const fp = path.resolve(p.path);
    if (!isSafePath(fp)) throw new Error('Access denied');
    const stats = await fs.stat(fp);
    return {
      path:     fp,
      size:     stats.size,
      modified: stats.mtime,
      created:  stats.birthtime,
      accessed: stats.atime,
      isDir:    stats.isDirectory(),
      isFile:   stats.isFile(),
      mode:     stats.mode.toString(8)
    };
  },

  exec_command: async function (p) {
    const cmd       = p.command;
    const confirmed = p.confirmed || false;
    const env       = p.env || {};
    if (!cmd || typeof cmd !== 'string') throw new Error('Command must be a non-empty string');

    // Block obviously destructive patterns regardless of confirmation
    const BLOCKED = [
      /rm\s+-rf\s+[\/~]/,
      /format\s+[a-z]:/i,
      /mkfs/,
      /dd\s+if=/,
      /:\(\)\{/
    ];
    for (const pat of BLOCKED) {
      if (pat.test(cmd)) throw new Error('Command blocked: potentially destructive operation');
    }

    if (!isAlwaysSafeCommand(cmd) && !confirmed) {
      return {
        requiresConfirmation: true,
        command: cmd,
        message: 'This command requires explicit user confirmation. Set payload.confirmed=true to proceed.'
      };
    }

    const workDir = p.cwd ? path.resolve(p.cwd) : SAFE_ROOT;
    if (!isSafePath(workDir)) throw new Error('cwd is outside safe zone');
    return execPromise(cmd, { cwd: workDir, env: Object.assign({}, process.env, env) });
  },

  system_info: async function () {
    const cpus = os.cpus();
    return {
      platform:    os.platform(),
      arch:        os.arch(),
      hostname:    os.hostname(),
      uptime:      Math.floor(os.uptime()),
      memory: {
        totalGB: parseFloat((os.totalmem()  / 1e9).toFixed(2)),
        freeGB:  parseFloat((os.freemem()   / 1e9).toFixed(2)),
        usedGB:  parseFloat(((os.totalmem() - os.freemem()) / 1e9).toFixed(2))
      },
      cpus:        cpus.length,
      cpuModel:    (cpus[0] && cpus[0].model) || 'Unknown',
      homeDir:     SAFE_ROOT,
      nodeVersion: process.version,
      tmpDir:      TMP_DIR
    };
  },

  ping: async function () {
    return { pong: true, timestamp: Date.now(), uptime: Math.floor(process.uptime()) };
  }

};

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocket.Server({ port: PORT });

console.log('\n  JARVIS Local Agent v2.0');
console.log('  Listening on ws://localhost:' + PORT);
console.log('  Safe root: ' + SAFE_ROOT);
console.log('  Temp dir:  ' + TMP_DIR);
console.log('\n  Waiting for JARVIS dashboard to connect...\n');

wss.on('connection', function (ws, req) {
  const origin = req.headers.origin || '(no origin)';

  if (!isAllowedOrigin(req.headers.origin)) {
    console.warn('  Rejected connection from disallowed origin: ' + origin);
    ws.close(1008, 'Origin not allowed');
    return;
  }

  console.log('  Dashboard connected from ' + origin);

  sendMsg(ws, null, 'connected', {
    platform:  os.platform(),
    hostname:  os.hostname(),
    homeDir:   SAFE_ROOT,
    uptime:    Math.floor(os.uptime()),
    version:   '2.0.0',
    commands:  Object.keys(handlers)
  });

  ws.on('message', async function (raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      sendMsg(ws, null, 'error', { message: 'Invalid JSON payload' });
      return;
    }

    const id      = msg.id;
    const type    = msg.type;
    const payload = msg.payload || {};

    if (!type || typeof type !== 'string') {
      sendMsg(ws, id, 'error', { message: 'Missing or invalid message type' });
      return;
    }

    const handler = handlers[type];
    if (!handler) {
      sendMsg(ws, id, 'error', { message: 'Unknown command type: ' + type });
      return;
    }

    try {
      const result = await handler(payload);
      sendMsg(ws, id, type + '_response', result);
    } catch (e) {
      console.error('  Handler error [' + type + ']:', e.message);
      sendMsg(ws, id, type + '_response', { success: false, error: e.message });
    }
  });

  ws.on('close', function (code) {
    console.log('  Dashboard disconnected (code ' + code + ')');
  });

  ws.on('error', function (e) {
    console.error('  WebSocket error:', e.message);
  });
});

wss.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    console.error('\n  ERROR: Port ' + PORT + ' is already in use.');
    console.error('  Either stop the other process or set JARVIS_AGENT_PORT env var.\n');
  } else {
    console.error('  Server error:', e.message);
  }
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  console.log('\n  ' + signal + ' received - shutting down JARVIS Local Agent...');
  wss.close(function () {
    console.log('  Server closed.\n');
    process.exit(0);
  });
  // Force exit after 3 s if connections do not drain
  setTimeout(function () { process.exit(0); }, 3000);
}

process.on('SIGINT',  function () { shutdown('SIGINT');  });
process.on('SIGTERM', function () { shutdown('SIGTERM'); });

process.on('unhandledRejection', function (reason) {
  console.error('  Unhandled promise rejection:', reason);
});