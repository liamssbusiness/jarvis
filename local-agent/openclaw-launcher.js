// JARVIS OpenClaw Launcher
// Wraps OpenClaw / Claude Code CLI to execute approved coding tasks autonomously.
// Lifecycle:
//   1. Telegram bot asks Liam for approval → Liam says "go"
//   2. Bot issues an approval_token and POSTs to /api/openclaw-execute
//   3. This launcher validates the task, spawns the agent, streams output
//   4. Status is polled via /api/openclaw-status?task_id=...

const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const security = require('./openclaw-security');

const LOG_DIR = path.join(os.homedir(), 'jarvis-logs');
const TASK_DIR = path.join(os.homedir(), 'jarvis-logs', 'openclaw-tasks');

// Prefer OpenClaw if installed; fall back to Claude Code CLI
const AGENT_CANDIDATES = [
  { cmd: 'openclaw',  args: (spec) => ['run', '--task-file', spec.specFile, '--cwd', spec.cwd, '--yes'] },
  { cmd: 'claude',    args: (spec) => ['--print', '--dangerously-skip-permissions', '--cwd', spec.cwd, spec.prompt] },
  { cmd: 'npx',       args: (spec) => ['-y', '@anthropic-ai/claude-code', '--print', '--cwd', spec.cwd, spec.prompt] },
];

class OpenClawLauncher {
  constructor() {
    this.tasks = new Map(); // task_id -> task state
    this._ensureDirs();
  }

  async _ensureDirs() {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.mkdir(TASK_DIR, { recursive: true });
  }

  _newTaskId() {
    return 't_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  }

  async _resolveAgentBinary() {
    // Pick the first agent candidate available on PATH.
    const { execSync } = require('child_process');
    for (const cand of AGENT_CANDIDATES) {
      try {
        const probe = os.platform() === 'win32' ? `where ${cand.cmd}` : `which ${cand.cmd}`;
        execSync(probe, { stdio: 'ignore' });
        return cand;
      } catch { /* not found; try next */ }
    }
    return null;
  }

  _buildPrompt(task, repoPath) {
    const files = Array.isArray(task.files_to_modify) && task.files_to_modify.length
      ? `\nFiles likely to modify:\n${task.files_to_modify.map((f) => `- ${f}`).join('\n')}`
      : '';
    const commit = task.commit_message
      ? `\nAfter edits, commit with message: "${task.commit_message}"`
      : `\nAfter edits, create a concise git commit summarizing the change.`;
    const deploy = task.auto_deploy
      ? `\nAfter committing, deploy to Vercel (run: npx vercel --prod --yes) and report the deployment URL.`
      : '';
    return [
      `You are running an APPROVED coding task inside ${repoPath}.`,
      `Task: ${task.task_description}`,
      files,
      `Rules:`,
      `- Never read or write files outside the repo.`,
      `- Never print or commit secrets (.env, API keys, passwords).`,
      `- Run tests after changes if a test script exists.`,
      commit,
      deploy,
      `Report progress concisely as you go.`,
    ].filter(Boolean).join('\n');
  }

  // Validate the task spec against security rules.
  // Returns { ok, errors, repoPath }.
  validateTask(task) {
    return security.validateTask(task);
  }

  // Validate that a repo path is safe to operate in (re-exported for tests).
  async validateRepo(repoPath) {
    const v = security.validatePath(repoPath);
    if (!v.ok) return { ok: false, reason: v.reason };
    try {
      const st = await fs.stat(repoPath);
      if (!st.isDirectory()) return { ok: false, reason: 'Repo path is not a directory' };
    } catch (e) {
      return { ok: false, reason: `Repo path does not exist: ${e.message}` };
    }
    return { ok: true };
  }

  // Launch an approved task. Returns { ok, task_id } immediately; work runs async.
  async execute(taskSpec, { approvalToken, onProgress } = {}) {
    if (!approvalToken) {
      return { ok: false, error: 'approval_token is required (issued by Telegram bot)' };
    }
    if (!security.requireApproval(taskSpec)) {
      return { ok: false, error: 'Task requires approval' };
    }

    const validation = this.validateTask(taskSpec);
    if (!validation.ok) {
      return { ok: false, error: 'Task validation failed', details: validation.errors };
    }
    const repoPath = validation.repoPath;

    const repoOk = await this.validateRepo(repoPath);
    if (!repoOk.ok) return { ok: false, error: repoOk.reason };

    const agent = await this._resolveAgentBinary();
    if (!agent) {
      return { ok: false, error: 'No coding agent found on PATH. Install OpenClaw or Claude Code CLI (see install-openclaw.bat).' };
    }

    const taskId = this._newTaskId();
    const logPath = path.join(LOG_DIR, `openclaw-${taskId}.log`);
    const specFile = path.join(TASK_DIR, `${taskId}.json`);
    const prompt = this._buildPrompt(taskSpec, repoPath);

    const spec = {
      task_id: taskId,
      created: new Date().toISOString(),
      approval_token_hash: crypto.createHash('sha256').update(approvalToken).digest('hex').slice(0, 16),
      repo: repoPath,
      task_description: taskSpec.task_description,
      files_to_modify: taskSpec.files_to_modify || [],
      commit_message: taskSpec.commit_message || null,
      auto_deploy: !!taskSpec.auto_deploy,
      prompt,
    };
    await fs.writeFile(specFile, JSON.stringify(spec, null, 2), 'utf8');

    const argv = agent.args({ specFile, cwd: repoPath, prompt });
    const logStream = fsSync.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n=== OpenClaw task ${taskId} @ ${spec.created} ===\n`);
    logStream.write(`Agent: ${agent.cmd} ${argv.join(' ')}\n`);
    logStream.write(`Repo:  ${repoPath}\n`);
    logStream.write(`Task:  ${spec.task_description}\n\n`);

    const child = spawn(agent.cmd, argv, {
      cwd: repoPath,
      shell: true,
      env: { ...process.env },
      windowsHide: true,
    });

    const state = {
      task_id: taskId,
      status: 'running',
      started: Date.now(),
      finished: null,
      exitCode: null,
      repo: repoPath,
      agent: agent.cmd,
      log_path: logPath,
      spec_path: specFile,
      stdout: '',
      stderr: '',
      progress: [],
      pid: child.pid,
    };
    this.tasks.set(taskId, state);

    const pushProgress = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      state.progress.push({ t: Date.now(), line: trimmed });
      if (state.progress.length > 500) state.progress.shift();
      if (typeof onProgress === 'function') {
        try { onProgress({ task_id: taskId, line: trimmed }); } catch { /* ignore */ }
      }
    };

    child.stdout.on('data', (buf) => {
      const s = buf.toString('utf8');
      state.stdout += s;
      logStream.write(s);
      s.split(/\r?\n/).forEach(pushProgress);
    });
    child.stderr.on('data', (buf) => {
      const s = buf.toString('utf8');
      state.stderr += s;
      logStream.write(s);
      s.split(/\r?\n/).forEach(pushProgress);
    });

    // Kill if task exceeds MAX_EXECUTION_TIME_MS
    const killTimer = setTimeout(() => {
      if (state.status === 'running') {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        state.status = 'timeout';
        logStream.write(`\n=== TIMEOUT after ${security.MAX_EXECUTION_TIME_MS}ms ===\n`);
      }
    }, security.MAX_EXECUTION_TIME_MS);

    child.on('close', (code) => {
      clearTimeout(killTimer);
      state.finished = Date.now();
      state.exitCode = code;
      if (state.status === 'running') {
        state.status = code === 0 ? 'completed' : 'failed';
      }
      logStream.write(`\n=== Task ${taskId} ${state.status} (exit ${code}) ===\n`);
      logStream.end();
    });
    child.on('error', (err) => {
      clearTimeout(killTimer);
      state.finished = Date.now();
      state.status = 'error';
      state.stderr += '\n' + err.message;
      logStream.write(`\n=== ERROR: ${err.message} ===\n`);
      logStream.end();
    });

    return { ok: true, task_id: taskId, agent: agent.cmd, log_path: logPath };
  }

  getStatus(taskId) {
    const s = this.tasks.get(taskId);
    if (!s) return { ok: false, error: 'Unknown task_id' };
    return {
      ok: true,
      task_id: s.task_id,
      status: s.status,
      started: s.started,
      finished: s.finished,
      duration_ms: (s.finished || Date.now()) - s.started,
      exitCode: s.exitCode,
      repo: s.repo,
      agent: s.agent,
      log_path: s.log_path,
      progress_tail: s.progress.slice(-20),
      stdout_tail: s.stdout.slice(-2000),
      stderr_tail: s.stderr.slice(-1000),
    };
  }

  listTasks() {
    return [...this.tasks.values()].map((s) => ({
      task_id: s.task_id,
      status: s.status,
      started: s.started,
      repo: s.repo,
    }));
  }

  async streamProgress(taskId, callback) {
    const state = this.tasks.get(taskId);
    if (!state) return;
    // Replay what we already have
    for (const p of state.progress) callback(p);
    // Attach live: poll progress length and emit new lines
    let idx = state.progress.length;
    const iv = setInterval(() => {
      if (!this.tasks.has(taskId)) return clearInterval(iv);
      const s = this.tasks.get(taskId);
      while (idx < s.progress.length) callback(s.progress[idx++]);
      if (s.status !== 'running') clearInterval(iv);
    }, 500);
  }
}

module.exports = { OpenClawLauncher, LOG_DIR, TASK_DIR };
