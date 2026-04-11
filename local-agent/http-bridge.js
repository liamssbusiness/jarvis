// JARVIS Local Agent — HTTP Bridge
// Exposes PC control via HTTP so the Telegram bot (Vercel) can reach it
// Start: node http-bridge.js
// Then run: npx cloudflared tunnel --url http://localhost:3002

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const { OpenClawLauncher } = require('./openclaw-launcher');
const openclawSecurity = require('./openclaw-security');

const PORT = 3002;
const HOME = os.homedir();

// Singleton OpenClaw launcher + accepted approval-token cache
const openclaw = new OpenClawLauncher();
const seenApprovalTokens = new Map(); // token -> firstSeenTs (prevents replay)
const APPROVAL_TOKEN_TTL_MS = 30 * 60 * 1000;

// Simple auth token — must match VERCEL env var LOCAL_AGENT_SECRET
// Refuse to start if unset (prevents predictable-default attack)
const SECRET = process.env.LOCAL_AGENT_SECRET;
if (!SECRET) {
  console.error('\n[FATAL] LOCAL_AGENT_SECRET environment variable is required.');
  console.error('Set it before starting: $env:LOCAL_AGENT_SECRET="your-random-string"');
  console.error('Then match the same value in Vercel env for cyber-jarvis.\n');
  process.exit(1);
}

function isSafePath(p) {
  const r = path.resolve(p);
  return r.startsWith(HOME) || r.startsWith(os.tmpdir());
}

// Blocked command patterns
const BLOCKED = [/rm\s+-rf\s+\//, /format\s+c/i, /del\s+\/s/i, /:(){ :|:& };:/, /shutdown/, /reboot/];

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// Allowed origins — block wildcard CORS
const ALLOWED_ORIGINS = [
  'https://cyber-jarvis.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const ALLOWED_VERCEL_PREVIEW = /^https:\/\/cyber-jarvis-[a-z0-9-]+-liamssbusiness-projects\.vercel\.app$/;

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Origin-based CORS (not wildcard)
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_VERCEL_PREVIEW.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Server-to-server (no origin header) — allow, Bearer token still gates it
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  // Auth check
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== SECRET) {
    res.writeHead(401);
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const action = url.pathname.replace('/api/', '').replace('/', '');

  try {
    let result;
    const body = req.method === 'POST' ? await parseBody(req) : {};

    switch (action) {
      case 'ping':
        result = { pong: true, hostname: os.hostname(), platform: os.platform(), uptime: Math.floor(os.uptime()) };
        break;

      case 'system-info':
        result = {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          uptime: Math.floor(os.uptime()),
          memory: { total: Math.round(os.totalmem() / 1e9), free: Math.round(os.freemem() / 1e9) },
          cpus: os.cpus().length,
          cpuModel: os.cpus()[0]?.model,
          homeDir: HOME,
          nodeVersion: process.version,
          user: os.userInfo().username
        };
        break;

      case 'read-file': {
        const fp = path.resolve(body.path);
        if (!isSafePath(fp)) throw new Error('Access denied — outside home directory');
        const content = await fs.readFile(fp, 'utf8');
        result = { success: true, content, path: fp, size: content.length };
        break;
      }

      case 'write-file': {
        const fp = path.resolve(body.path);
        if (!isSafePath(fp)) throw new Error('Access denied — outside home directory');
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, body.content || '', 'utf8');
        result = { success: true, path: fp };
        break;
      }

      case 'create-folder': {
        const fp = path.resolve(body.path);
        if (!isSafePath(fp)) throw new Error('Access denied — outside home directory');
        await fs.mkdir(fp, { recursive: true });
        result = { success: true, path: fp, created: true };
        break;
      }

      case 'delete-file': {
        const fp = path.resolve(body.path);
        if (!isSafePath(fp)) throw new Error('Access denied — outside home directory');
        const stats = await fs.stat(fp);
        if (stats.isDirectory()) {
          await fs.rm(fp, { recursive: true });
        } else {
          await fs.unlink(fp);
        }
        result = { success: true, path: fp, deleted: true };
        break;
      }

      case 'find-files': {
        const { query, path: searchPath, extensions, maxResults = 50 } = body;
        const root = path.resolve(searchPath || HOME);
        if (!isSafePath(root)) throw new Error('Access denied');
        const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', 'dist', 'build', '.next', '.cache', 'coverage']);
        const results = [];
        const qLower = query ? String(query).toLowerCase() : null;
        async function walk(dir, depth = 0) {
          if (depth > 10 || results.length >= maxResults) return;
          let entries;
          try {
            entries = await fs.readdir(dir, { withFileTypes: true });
          } catch { return; }
          for (const entry of entries) {
            if (results.length >= maxResults) return;
            if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
            if (SKIP_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(full, depth + 1);
            } else if (entry.isFile()) {
              const nameLower = entry.name.toLowerCase();
              const matchesQuery = !qLower || nameLower.includes(qLower);
              const matchesExt = !extensions || !extensions.length || extensions.some(e => {
                const ext = e.startsWith('.') ? e : '.' + e;
                return nameLower.endsWith(ext.toLowerCase());
              });
              if (matchesQuery && matchesExt) {
                try {
                  const stats = await fs.stat(full);
                  results.push({ path: full, name: entry.name, size: stats.size, modified: stats.mtime });
                } catch {}
              }
            }
          }
        }
        await walk(root);
        result = { count: results.length, files: results, root, query: query || null, extensions: extensions || null };
        break;
      }

      case 'list-dir': {
        const dp = path.resolve(body.path || HOME);
        if (!isSafePath(dp)) throw new Error('Access denied');
        const entries = await fs.readdir(dp, { withFileTypes: true });
        result = {
          path: dp,
          entries: entries
            .filter(e => body.showHidden || !e.name.startsWith('.'))
            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
        };
        break;
      }

      case 'exec': {
        const cmd = (body.command || '').trim();
        if (!cmd) throw new Error('No command provided');
        // Block dangerous commands
        for (const pattern of BLOCKED) {
          if (pattern.test(cmd)) throw new Error(`Blocked dangerous command: ${cmd}`);
        }
        result = await new Promise((resolve) => {
          exec(cmd, { cwd: body.cwd || HOME, timeout: 60000, shell: true }, (err, stdout, stderr) => {
            resolve({
              success: !err,
              stdout: (stdout || '').trim(),
              stderr: (stderr || '').trim(),
              exitCode: err?.code || 0
            });
          });
        });
        break;
      }

      case 'open-app': {
        const app = body.app || '';
        // Windows: start command
        const cmd = os.platform() === 'win32' ? `start "" "${app}"` : `open "${app}"`;
        result = await new Promise((resolve) => {
          exec(cmd, { timeout: 10000, shell: true }, (err) => {
            resolve({ success: !err, app, opened: !err });
          });
        });
        break;
      }

      case 'screenshot': {
        // Windows: use PowerShell snippet to capture screen
        if (os.platform() === 'win32') {
          const screenshotPath = path.join(os.tmpdir(), `jarvis-screenshot-${Date.now()}.png`);
          const psCmd = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $bitmap.Save('${screenshotPath.replace(/\\/g, '\\\\')}'); $graphics.Dispose(); $bitmap.Dispose();"`;
          await new Promise((resolve) => {
            exec(psCmd, { timeout: 15000 }, (err) => resolve());
          });
          try {
            const imgData = await fs.readFile(screenshotPath);
            result = { success: true, base64: imgData.toString('base64'), path: screenshotPath };
          } catch {
            result = { success: false, error: 'Screenshot capture failed' };
          }
        } else {
          result = { success: false, error: 'Screenshot not supported on this OS yet' };
        }
        break;
      }

      case 'openclaw-execute': {
        // Require approval_token — issued by Telegram bot only AFTER Liam said "go".
        const approvalToken = body.approval_token;
        if (!approvalToken || typeof approvalToken !== 'string' || approvalToken.length < 8) {
          throw new Error('approval_token required (issued by Telegram bot after Liam approves)');
        }
        // Replay protection: reject tokens we've seen before
        const now = Date.now();
        for (const [tok, ts] of seenApprovalTokens) {
          if (now - ts > APPROVAL_TOKEN_TTL_MS) seenApprovalTokens.delete(tok);
        }
        if (seenApprovalTokens.has(approvalToken)) {
          throw new Error('approval_token has already been used (replay blocked)');
        }
        seenApprovalTokens.set(approvalToken, now);

        const taskSpec = {
          repo: body.repo,
          task_description: body.task_description,
          files_to_modify: body.files_to_modify || [],
          commit_message: body.commit_message,
          auto_deploy: !!body.auto_deploy,
        };
        result = await openclaw.execute(taskSpec, { approvalToken });
        break;
      }

      case 'openclaw-status': {
        const taskId = body.task_id || url.searchParams.get('task_id');
        if (!taskId) throw new Error('task_id required');
        result = openclaw.getStatus(taskId);
        break;
      }

      case 'openclaw-list': {
        result = { tasks: openclaw.listTasks() };
        break;
      }

      case 'openclaw-config': {
        result = {
          allowed_repos: openclawSecurity.ALLOWED_REPOS,
          max_files_per_task: openclawSecurity.MAX_FILES_PER_TASK,
          max_execution_time_ms: openclawSecurity.MAX_EXECUTION_TIME_MS,
        };
        break;
      }

      case 'vault-log': {
        // Log a conversation/event to the Obsidian vault
        // body: { folder, filename, content } or { folder, filename, append, header }
        // If 'append' is provided and file is new, 'header' is prepended automatically
        const vaultBase = path.join(HOME, 'Downloads', 'ObsidianVault', 'SecondBrain');
        const folder = (body.folder || 'Inbox').replace(/\.\./g, '');
        const filename = (body.filename || `note-${Date.now()}.md`).replace(/\.\./g, '');
        const targetDir = path.join(vaultBase, folder);
        const targetFile = path.join(targetDir, filename);

        if (!targetFile.startsWith(vaultBase)) {
          console.error('[vault-log] path traversal blocked:', targetFile);
          result = { success: false, error: 'Path traversal blocked' };
          break;
        }

        try {
          await fs.mkdir(targetDir, { recursive: true });

          if (body.append) {
            // Check if file exists; if not, start with header
            let existing = '';
            try {
              existing = await fs.readFile(targetFile, 'utf8');
            } catch {
              // File doesn't exist — use header as starting content
              existing = body.header || '';
            }
            await fs.writeFile(targetFile, existing + body.append, 'utf8');
          } else {
            await fs.writeFile(targetFile, body.content || '', 'utf8');
          }
          console.log(`[vault-log] wrote ${folder}/${filename} (${body.append ? 'append' : 'overwrite'})`);
          result = { success: true, path: `${folder}/${filename}` };
        } catch (e) {
          console.error(`[vault-log] failed to write ${folder}/${filename}:`, e.message);
          result = { success: false, error: e.message };
        }
        break;
      }

      case 'vault-read': {
        // Read a file from the Obsidian vault by relative path
        // body: { path: 'Memory/alfred-memory.md' }
        const vaultBase = path.join(HOME, 'Downloads', 'ObsidianVault', 'SecondBrain');
        const relPath = (body.path || '').replace(/\.\./g, '').replace(/^\//, '');
        if (!relPath) {
          result = { success: false, error: 'path required' };
          break;
        }
        const targetFile = path.join(vaultBase, relPath);
        if (!targetFile.startsWith(vaultBase)) {
          result = { success: false, error: 'Path traversal blocked' };
          break;
        }
        try {
          const content = await fs.readFile(targetFile, 'utf8');
          result = { success: true, content, path: relPath };
        } catch (e) {
          // File doesn't exist yet — return empty, not an error
          result = { success: true, content: '', path: relPath, empty: true };
        }
        break;
      }

      default:
        result = { error: `Unknown action: ${action}`, available: ['ping', 'system-info', 'read-file', 'write-file', 'create-folder', 'delete-file', 'list-dir', 'find-files', 'exec', 'open-app', 'screenshot', 'vault-log', 'vault-read', 'openclaw-execute', 'openclaw-status', 'openclaw-list', 'openclaw-config'] };
    }

    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ success: false, error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   J.A.R.V.I.S  Local Agent v2.0 (HTTP)  ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  HTTP server: http://localhost:${PORT}        ║`);
  console.log(`║  Home dir:    ${HOME.substring(0, 28).padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\n🔑 Auth secret: ${SECRET}`);
  console.log('\n📡 Next step: expose via tunnel:');
  console.log(`   npx cloudflared tunnel --url http://localhost:${PORT}`);
  console.log('\n   Then add the tunnel URL to Vercel as LOCAL_AGENT_URL');
  console.log('   and the secret as LOCAL_AGENT_SECRET\n');
});
