# JARVIS MEMORY FILE
> Auto-maintained by JARVIS. Last updated: 2026-04-06
> Format: compressed facts only. No fluff. High-density context.

---

## 👤 LIAM — WHO HE IS
- Goes by **Liam**
- Communicates via **Telegram** with JARVIS
- Uses **Meta glasses** + phone camera to send photos for analysis
- PC username: `the10` | Base path: `C:\Users\the10\`
- Main project dir: `C:\Users\the10\Downloads\Claude\`

## 🧠 LIAM'S STYLE & PREFERENCES
- Direct, no-bullshit communication
- Doesn't want long-winded explanations — get to the point
- Wants JARVIS to take initiative and act like a CEO/COO, not just a tool
- Hates re-explaining himself — memory is critical
- Wants things done automatically where possible
- Trusts JARVIS to make good decisions on implementation details (e.g. "wherever you think is best")
- Wants proactive recommendations, not just answers
- Does NOT want memory to cost heavy token usage — keep entries compressed, high-density, no fluff
- Wants memory to be automatic — JARVIS updates it without being asked

## 🏗️ PROJECTS

### cyber-jarvis
- **Path:** `C:\Users\the10\Downloads\Claude\cyber-jarvis\`
- **Type:** Web dashboard (HTML/CSS/JS) + local agent
- **Deployed on:** Vercel
- **Stack:** Vanilla JS frontend, Node.js local agent, API routes in `/api`
- **Key files:** `index.html`, `js/`, `css/`, `api/`, `local-agent/`, `sw.js`, `vercel.json`
- **What it is:** JARVIS's command dashboard — task board, alerts, controls
- **CLAUDE.md config:** Uses claude-flow V3, hierarchical swarm topology, max 15 agents, hybrid memory, HNSW + Neural enabled

### RuFlo V3
- Referenced in CLAUDE.md — the agentic framework powering Claude Code operations
- Uses 3-tier model routing (WASM booster / Haiku / Sonnet-Opus)
- 60+ agent types available

## ⚙️ SYSTEM SETUP
- JARVIS runs via **Telegram bot** (primary interface)
- Local agent on PC handles file ops, shell commands, app control
- Claude Code / claude-flow CLI available on PC
- Memory file location: `cyber-jarvis/docs/JARVIS_MEMORY.md`

## 📋 DECISIONS MADE
- Memory system: single `JARVIS_MEMORY.md` file, auto-updated by JARVIS, stored in `cyber-jarvis/docs/`
- Memory update trigger: **automatically** after any conversation containing meaningful new info (projects, preferences, decisions, things built)
- Memory format: compressed markdown, facts only — no verbose explanations
- JARVIS reads this file at the start of relevant conversations to avoid re-asking Liam things

## 🔑 KEY RULES LIAM SET
- Don't re-explain things he's already said — check memory first
- Don't waste his usage quota on unnecessary verbosity
- Act automatically — don't ask for permission on small decisions
- Always tell him when something meaningful has been saved to memory
- Memory updates happen silently and automatically — no need to ask

---
_JARVIS updates this file. Liam does not need to maintain it._
