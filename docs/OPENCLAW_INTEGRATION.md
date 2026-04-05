# OpenClaw Integration

JARVIS can write code, modify files, run tests, commit, and deploy — **but only after Liam approves a plan**. OpenClaw (or Claude Code CLI) is the worker that actually edits files. JARVIS just orchestrates, approves, and reports.

---

## Architecture

```
 ┌──────────────┐    approval_token    ┌──────────────────┐
 │  Telegram    │ ───────────────────▶ │  Local HTTP      │
 │  (api/       │                      │  Bridge          │
 │  telegram.js)│ ◀─ status updates ── │  (http-bridge.js)│
 └──────────────┘                      └────────┬─────────┘
        ▲                                       │ spawns
        │                                       ▼
        │                              ┌──────────────────┐
        │                              │ OpenClawLauncher │
        │                              │ (launcher.js)    │
        │                              └────────┬─────────┘
        │                                       │
        │                              ┌────────▼─────────┐
        └────────  final report ──────│ claude / openclaw │
                                       │  writes code     │
                                       │  runs tests      │
                                       │  git commit      │
                                       │  vercel deploy   │
                                       └──────────────────┘
```

Every step is gated:

1. **Plan** — `request_approval` tool builds a plan and presents it on Telegram.
2. **Approve** — Liam replies `go`. A single-use **approval_token** (`apr_…`, 30-min TTL) is minted server-side.
3. **Execute** — Claude calls `execute_code_task`. The bot attaches the most recent approval_token and POSTs `/api/openclaw-execute` on the local bridge.
4. **Validate** — `openclaw-security.js` verifies the repo is in `ALLOWED_REPOS`, no blocked patterns, no path traversal.
5. **Run** — `openclaw-launcher.js` spawns `claude` (or `openclaw`) in the repo directory with a scoped prompt.
6. **Report** — progress streams to `~/jarvis-logs/openclaw-<task_id>.log`. Telegram polls status.

---

## Example conversation

```
Liam:   "Add a settings page to the dashboard with dark/light mode toggle."
JARVIS: "Quick questions:
         • Where should it live — new /settings route or a modal?
         • Persist preference in localStorage or user profile?
         • Any existing design tokens I should reuse?"
Liam:   "new route, localStorage, reuse the existing css variables"
JARVIS: [calls request_approval]
        📋 PLAN: Add settings page with dark/light mode
        Steps:
         1. Create js/settings.js with toggle state + localStorage
         2. Create settings.html with toggle UI
         3. Wire theme CSS vars to --theme-light / --theme-dark
         4. Add nav link from dashboard
         5. Run tests, commit, deploy to Vercel
        Complexity: low
        ✅ Reply go to approve.
Liam:   "go"
JARVIS: ✅ Approved. Executing: Add settings page…
         [calls execute_code_task with repo=cyber-jarvis, auto_deploy=true]
        ⚙️ OpenClaw started (task t_ln4f8x_a1b2c3d4)
         Agent: claude
         I'll report when it finishes.
JARVIS: ✅ Done. Committed as "feat: add settings page with dark/light toggle"
         Preview: https://cyber-jarvis-abc123.vercel.app
```

---

## Security model

### Approval tokens
- Minted **only** when Liam says `go` to an active plan.
- Single-use. Consumed by `execute_code_task` and rejected by the bridge on replay.
- 30-minute TTL.
- Stored in memory on both Vercel and local bridge (cleared on process restart).

### Scoped filesystem access
OpenClaw can **only** touch paths inside `ALLOWED_REPOS`. Everything else is rejected before spawn:
```javascript
// local-agent/openclaw-security.js
const ALLOWED_REPOS = [
  'c:/Users/the10/Downloads/Claude/cyber-jarvis',
];
```

### Blocked patterns
Paths, filenames, and task descriptions matching any of these are refused:
`.env`, `credentials`, `password`, `secret`, `private_key`, `id_rsa`, `rm -rf`, `format`, `shutdown`, …

### Secret scanning
Before any commit, the bridge scans modified files for:
- Anthropic keys (`sk-ant-…`), OpenAI keys (`sk-…`)
- AWS access/secret keys
- GitHub/Slack tokens, Google API keys
- Private RSA/EC keys, Telegram bot tokens

### Limits
| Limit | Value |
|---|---|
| Max files per task | 50 |
| Max execution time | 30 minutes |
| Max file size | 2 MB |
| Max task description | 4000 chars |

### Audit log
Every run is logged to `~/jarvis-logs/openclaw-<task_id>.log`:
- Full command line used
- Every stdout/stderr line from the agent
- Start/finish timestamps, exit code
- Approval token **hash** (not the raw token)

### Reversibility
Every change is a git commit. To undo: `git revert <sha>` or `git reset --hard HEAD~1`.

---

## Adding a new repo

Edit `local-agent/openclaw-security.js`:
```javascript
const ALLOWED_REPOS = [
  'c:/Users/the10/Downloads/Claude/cyber-jarvis',
  'c:/Users/the10/Downloads/Claude/my-new-project',  // ← add here
];
```
Restart the local HTTP bridge.

---

## Troubleshooting

**"No approval token available"**
→ Liam needs to approve a plan first. Ask JARVIS to present a plan, then reply `go`.

**"Approval token expired"**
→ Tokens live 30 minutes. Re-approve.

**"approval_token has already been used (replay blocked)"**
→ Each token is single-use. Re-approve to mint a fresh one.

**"No coding agent found on PATH"**
→ Run `local-agent/install-openclaw.bat` to install Claude Code CLI or OpenClaw globally.

**"Path is outside ALLOWED_REPOS"**
→ The repo Liam asked about isn't whitelisted. Add it to `ALLOWED_REPOS` and restart.

**Task hangs / stuck at "running"**
→ Auto-killed at 30 min. Check `~/jarvis-logs/openclaw-<task_id>.log` for what it was doing.

**Secret scan blocked a commit**
→ Good — it prevented an accidental leak. Remove the secret from the file, then re-run.

---

## HTTP bridge endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/openclaw-execute` | Start a task. Requires `approval_token`. |
| `POST /api/openclaw-status` | Get status of `task_id`. |
| `POST /api/openclaw-list`   | List all tasks seen this session. |
| `POST /api/openclaw-config` | Dump allowed repos + limits. |

All require `Authorization: Bearer <LOCAL_AGENT_SECRET>`.

---

## Files

- `local-agent/openclaw-launcher.js` — spawns the agent, tracks state, timeouts
- `local-agent/openclaw-security.js` — allowlist, blocked patterns, secret scanner
- `local-agent/http-bridge.js` — HTTP endpoints (`openclaw-execute`, `openclaw-status`)
- `local-agent/install-openclaw.bat` — one-shot installer for Claude Code CLI
- `api/telegram.js` — `execute_code_task` and `check_code_task` tools + approval-token mint/consume
