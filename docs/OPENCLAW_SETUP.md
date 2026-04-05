# OpenClaw Integration — JARVIS Code Execution

OpenClaw gives JARVIS the ability to actually write code, modify files, and deploy changes.
It uses Claude Code under the hood to execute multi-step development tasks.

## Architecture

```
You say: "Build a landing page for X"
    ↓
JARVIS (plans the work, asks questions)
    ↓ (you approve)
OpenClaw (spawns Claude Code agent)
    ↓ (writes code, runs tests, commits)
Your repos (GitHub)
    ↓ (auto-deploys via Vercel/Netlify)
Done — JARVIS reports back
```

## Step 1: Install OpenClaw

```bash
# On your Windows PC
npm install -g openclaw

# Or with npx (no install)
npx openclaw@latest
```

## Step 2: Configure OpenClaw

```bash
openclaw init
```

This creates `~/.openclaw/config.yaml`. Edit it:

```yaml
# Model configuration
model:
  provider: anthropic
  api_key: sk-ant-api03-your-key-here
  model: claude-sonnet-4-6

# Telegram integration
telegram:
  bot_token: 8648554559:your-token-here
  
# Allowed repositories (JARVIS can access these)
repos:
  - path: c:/Users/the10/Downloads/Claude/cyber-jarvis
    name: jarvis-dashboard
  # Add more repos as needed:
  # - path: c:/Users/the10/projects/ads-bot
  #   name: ads-creative-bot

# Security
security:
  require_approval: true       # Always ask before executing
  allowed_commands:
    - git
    - npm
    - node
    - npx
    - vercel
  blocked_patterns:
    - rm -rf /
    - format
    - del /s
```

## Step 3: Connect to Telegram

```bash
openclaw telegram connect
```

This links OpenClaw to your Telegram bot so when JARVIS approves a code task,
OpenClaw picks it up and executes via Claude Code.

## Step 4: Start OpenClaw Agent

```bash
openclaw start --daemon
```

This runs in the background. When JARVIS receives an approved coding task,
it routes to OpenClaw which:
1. Opens the relevant repo
2. Spawns a Claude Code session
3. Writes/modifies code
4. Runs tests
5. Commits and pushes
6. Reports results back to Telegram

## Step 5: Test

In Telegram, send to JARVIS:
> "Add a dark mode toggle to the JARVIS dashboard"

JARVIS will:
1. Ask clarifying questions
2. Present a plan
3. Wait for your "go"
4. Route to OpenClaw → Claude Code
5. Build it
6. Report back with what was changed

## Running OpenClaw as a Windows Service

To keep it running permanently:

```bash
# Install as service
openclaw service install

# Or use PM2
npm install -g pm2
pm2 start openclaw -- start
pm2 save
pm2 startup
```

## Security Notes

- OpenClaw requires approval for ALL destructive operations
- File access is restricted to repos listed in config
- No root/admin commands allowed
- All actions are logged to ~/.openclaw/logs/
- Telegram messages are encrypted end-to-end
