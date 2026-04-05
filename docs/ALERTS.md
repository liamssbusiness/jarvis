# JARVIS Proactive Alerts

JARVIS can store alert rules and fire them on a schedule or on-demand. This gives
Liam a conversational way to say things like "remind me daily at 7am" — JARVIS
stores the rule and (once enabled) a scheduler fires it.

## What proactive alerts can do

- **Daily briefings** — a scheduled summary message every morning
- **Market alerts** — fire when BTC/ETH/etc. moves beyond a threshold
- **Reminders** — one-shot nudges like "in 2 hours, remind me to follow up"
- **Calendar checks** — morning rundown of the day's events
- **Custom rules** — any template message on any supported schedule

## How JARVIS is told to configure them

Just talk to JARVIS in Telegram. Examples:

- "Alert me if BTC drops more than 5% in 24 hours"
- "Send me a daily briefing at 7am"
- "Remind me in 2 hours to follow up with the client"
- "Ping me if any urgent emails come in"
- "Show me my alert rules"
- "Turn off the market alert"

JARVIS uses four tools under the hood:

| Tool | What it does |
|------|--------------|
| `create_alert_rule` | Stores a new rule (name, type, schedule, message, conditions) |
| `list_alert_rules` | Returns all configured rules |
| `disable_alert_rule` | Disables a rule by id or name |
| `send_now` | Immediately sends a proactive message to Liam |

## Nothing fires automatically until you enable it

Rules are stored but inert by default. To turn on automated triggering:

1. Open `vercel.json`
2. Rename the key `"// crons"` to `"crons"`
3. Redeploy

Vercel will then hit `GET /api/cron-alerts` every 15 minutes. That endpoint
evaluates every enabled rule and fires any whose schedule matches.

If you don't want Vercel crons, you can instead point any external scheduler
(cron-job.org, GitHub Actions, a cheap VPS) at:

```
GET https://<your-deploy>/api/cron-alerts
Authorization: Bearer <CRON_SECRET>   # optional, only if CRON_SECRET env var is set
```

## Supported schedule formats

The cron evaluator (`api/cron-alerts.js`) understands:

- `daily 7am` / `daily 07:00` / `daily 7:30pm`
- `hourly`
- `every 15m` / `every 2h`
- `at 2025-06-10T14:00Z`  (one-shot, absolute)
- `in 2 hours` / `in 30 minutes`  (one-shot, relative to rule creation)
- `when BTC drops 5%`  (condition-based — requires a data fetcher hook; not auto-evaluated yet)
- `manual`  (never auto-fires, use `trigger` action)

## Required environment variables

For rules to deliver messages:

- `TELEGRAM_BOT_TOKEN` — your bot token
- `TELEGRAM_CHAT_ID` — Liam's chat id (the one JARVIS should message)
- `CRON_SECRET` *(optional)* — if set, `/api/cron-alerts` requires `Authorization: Bearer <secret>`

## API reference (`/api/alerts`)

| Method | Action | Body |
|--------|--------|------|
| GET    | `?action=list` | — |
| POST   | `?action=create` | `{ name, type, schedule, message_template, conditions }` |
| PATCH  | — | `{ id, ...fields }` |
| DELETE | — | `{ id }` |
| POST   | `?action=trigger` | `{ id, message? }`  (manual fire) |

## Storage note

Rules currently live in-memory plus a `/tmp/alerts.json` backup. On Vercel this
is ephemeral — rules persist only while the function is warm. For durable
storage, wire `api/alerts.js` to Vercel KV, Upstash Redis, or Supabase. The
exported helpers (`listRules`, `createRule`, `updateRule`, `deleteRule`,
`fireRule`) can stay as-is; only the `loadRules`/`saveRules` internals need
to swap in a real backend.
