// JARVIS OpenClaw Security Layer
// Enforces safety rules for autonomous code execution tasks.
// Every destructive operation is validated here BEFORE being handed to OpenClaw.

const path = require('path');

// ============================================================
// ALLOWED REPOS — OpenClaw may only touch files inside these
// ============================================================
// To add a new repo: append its absolute path (forward slashes).
// Paths are normalized before comparison.
const ALLOWED_REPOS = [
  'c:/Users/the10/Downloads/Claude/cyber-jarvis',
  // Add more repos here as Liam creates them, e.g.:
  // 'c:/Users/the10/Downloads/Claude/another-project',
];

// ============================================================
// BLOCKED PATTERNS — file paths/contents matching these are refused
// ============================================================
const BLOCKED_PATTERNS = [
  /rm\s+-rf/i,
  /\.env(\.|$)/i,
  /\.env\.local/i,
  /credentials/i,
  /password/i,
  /secret/i,
  /private[_-]?key/i,
  /id_rsa/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /aws_access_key/i,
  /aws_secret/i,
];

// ============================================================
// BLOCKED COMMANDS — never executed, regardless of context
// ============================================================
const BLOCKED_COMMANDS = [
  'format',
  'shutdown',
  'reboot',
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  ':(){ :|:& };:',
  'del /s /q c:\\',
  'diskpart',
  'mkfs',
  'dd if=',
];

// ============================================================
// Secret scanners — detect accidentally committed secrets
// ============================================================
const SECRET_SIGNATURES = [
  { name: 'OpenAI API key',      pattern: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic API key',   pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key',      pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS secret key',      pattern: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/i },
  { name: 'GitHub token',        pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Google API key',      pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Slack token',         pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private RSA key',     pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Telegram bot token',  pattern: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/ },
  { name: 'Generic bearer token',pattern: /bearer\s+[A-Za-z0-9_\-.=]{30,}/i },
];

// ============================================================
// Limits
// ============================================================
const MAX_FILES_PER_TASK = 50;
const MAX_EXECUTION_TIME_MS = 30 * 60 * 1000; // 30 minutes
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;   // 2 MB per file
const MAX_TASK_DESCRIPTION_LEN = 4000;

// ============================================================
// Helpers
// ============================================================
function normalize(p) {
  if (!p) return '';
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function isWithinAllowedRepo(filePath) {
  const norm = normalize(filePath);
  return ALLOWED_REPOS.some((repo) => {
    const normRepo = normalize(repo);
    return norm === normRepo || norm.startsWith(normRepo + '/');
  });
}

function validatePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, reason: 'Path must be a non-empty string' };
  }
  // Reject directory traversal tokens before resolution
  if (filePath.includes('..')) {
    return { ok: false, reason: 'Path traversal (..) not allowed' };
  }
  // Reject UNC and drive hops
  if (/^\\\\/.test(filePath)) {
    return { ok: false, reason: 'UNC paths not allowed' };
  }
  if (!isWithinAllowedRepo(filePath)) {
    return { ok: false, reason: `Path is outside ALLOWED_REPOS: ${filePath}` };
  }
  // Reject blocked file name patterns (but still allow reading the repo root)
  const leaf = path.basename(filePath);
  for (const pat of BLOCKED_PATTERNS) {
    if (pat.test(leaf)) {
      return { ok: false, reason: `Path matches blocked pattern (${pat}): ${leaf}` };
    }
  }
  return { ok: true, resolved: normalize(filePath) };
}

function validateCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') {
    return { ok: false, reason: 'Command must be a non-empty string' };
  }
  const lower = cmd.toLowerCase().trim();
  for (const blocked of BLOCKED_COMMANDS) {
    if (lower.includes(blocked.toLowerCase())) {
      return { ok: false, reason: `Command contains blocked token: ${blocked}` };
    }
  }
  for (const pat of BLOCKED_PATTERNS) {
    if (pat.test(cmd)) {
      return { ok: false, reason: `Command matches blocked pattern: ${pat}` };
    }
  }
  return { ok: true };
}

function scanForSecrets(content) {
  if (typeof content !== 'string') return { found: false, hits: [] };
  const hits = [];
  for (const sig of SECRET_SIGNATURES) {
    const m = content.match(sig.pattern);
    if (m) hits.push({ type: sig.name, sample: m[0].slice(0, 16) + '…' });
  }
  return { found: hits.length > 0, hits };
}

function resolveRepoPath(repoNameOrPath) {
  // Accept either a bare repo name ("cyber-jarvis") or full path
  const norm = normalize(repoNameOrPath);
  const direct = ALLOWED_REPOS.find((r) => normalize(r) === norm);
  if (direct) return direct;
  const byName = ALLOWED_REPOS.find((r) => path.basename(r).toLowerCase() === repoNameOrPath.toLowerCase());
  return byName || null;
}

function validateTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object') {
    return { ok: false, errors: ['Task must be an object'] };
  }
  if (!task.repo) errors.push('repo is required');
  if (!task.task_description) errors.push('task_description is required');
  if (task.task_description && task.task_description.length > MAX_TASK_DESCRIPTION_LEN) {
    errors.push(`task_description exceeds ${MAX_TASK_DESCRIPTION_LEN} chars`);
  }
  const repoPath = task.repo ? resolveRepoPath(task.repo) : null;
  if (task.repo && !repoPath) {
    errors.push(`Repo not in ALLOWED_REPOS: ${task.repo}`);
  }
  if (Array.isArray(task.files_to_modify)) {
    if (task.files_to_modify.length > MAX_FILES_PER_TASK) {
      errors.push(`Too many files (${task.files_to_modify.length} > ${MAX_FILES_PER_TASK})`);
    }
    for (const f of task.files_to_modify) {
      const abs = path.isAbsolute(f) ? f : path.join(repoPath || '', f);
      const v = validatePath(abs);
      if (!v.ok) errors.push(`File rejected — ${v.reason}`);
    }
  }
  const desc = (task.task_description || '') + ' ' + (task.commit_message || '');
  const cmdCheck = validateCommand(desc);
  if (!cmdCheck.ok) errors.push(`Task description blocked — ${cmdCheck.reason}`);

  return { ok: errors.length === 0, errors, repoPath };
}

// Always require approval — destructive actions need an approval_token
function requireApproval(_task) {
  return true;
}

module.exports = {
  ALLOWED_REPOS,
  BLOCKED_PATTERNS,
  BLOCKED_COMMANDS,
  SECRET_SIGNATURES,
  MAX_FILES_PER_TASK,
  MAX_EXECUTION_TIME_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_TASK_DESCRIPTION_LEN,
  isWithinAllowedRepo,
  validatePath,
  validateCommand,
  validateTask,
  scanForSecrets,
  resolveRepoPath,
  requireApproval,
};
