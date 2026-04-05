// JARVIS Cron Alerts — Scheduled rule evaluator
//
// GET /api/cron-alerts
//
// Iterates enabled rules from api/alerts.js and fires any whose schedule
// matches "now". This endpoint is INERT until Liam wires a scheduler
// (Vercel cron, cron-job.org, GitHub Actions) to hit it. See docs/ALERTS.md.
//
// Supported schedule forms (lightweight parser):
//   "daily 7am", "daily 07:00", "daily 7:30pm"
//   "hourly"
//   "every 15m" / "every 2h"
//   "at 2025-06-10T14:00Z"              (one-shot)
//   "in 2 hours" / "in 30 minutes"      (one-shot, relative to created)
//   "when BTC drops 5%"                 (condition-based, evaluated elsewhere)
//   "manual"                            (never auto-fires)

const alerts = require('./alerts.js');

function parseHourMin(str) {
  // "7am", "07:00", "7:30pm", "14:00"
  const s = str.trim().toLowerCase();
  const ampm = s.endsWith('am') ? 'am' : s.endsWith('pm') ? 'pm' : null;
  const core = ampm ? s.slice(0, -2).trim() : s;
  const [hStr, mStr] = core.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr ? parseInt(mStr, 10) : 0;
  if (Number.isNaN(h)) return null;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return { h, m };
}

function shouldFire(rule, now) {
  const sched = (rule.schedule || '').trim().toLowerCase();
  if (!sched || sched === 'manual') return false;

  const last = rule.last_fired ? new Date(rule.last_fired) : null;
  const minsSinceLast = last ? (now - last) / 60000 : Infinity;

  // hourly
  if (sched === 'hourly') return minsSinceLast >= 60;

  // every Nm / every Nh
  const every = sched.match(/^every\s+(\d+)\s*(m|min|minutes|h|hr|hours)$/);
  if (every) {
    const n = parseInt(every[1], 10);
    const unit = every[2];
    const mins = unit.startsWith('h') ? n * 60 : n;
    return minsSinceLast >= mins;
  }

  // daily <time>
  const daily = sched.match(/^daily\s+(.+)$/);
  if (daily) {
    const t = parseHourMin(daily[1]);
    if (!t) return false;
    // Fire if within the same minute window and not already fired today
    if (now.getHours() !== t.h || now.getMinutes() !== t.m) return false;
    if (!last) return true;
    const sameDay = last.getFullYear() === now.getFullYear()
                 && last.getMonth() === now.getMonth()
                 && last.getDate() === now.getDate();
    return !sameDay;
  }

  // at <ISO>
  const atIso = sched.match(/^at\s+(.+)$/);
  if (atIso) {
    const target = new Date(atIso[1]);
    if (Number.isNaN(target.getTime())) return false;
    if (rule.fire_count > 0) return false; // one-shot
    return now >= target;
  }

  // in N minutes/hours (relative to rule.created)
  const inRel = sched.match(/^in\s+(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours)$/);
  if (inRel) {
    if (rule.fire_count > 0) return false;
    const n = parseInt(inRel[1], 10);
    const mins = inRel[2].startsWith('h') ? n * 60 : n;
    const created = new Date(rule.created);
    const fireAt = new Date(created.getTime() + mins * 60000);
    return now >= fireAt;
  }

  // condition-based: "when BTC drops 5%" — not auto-evaluated here.
  // These require a data fetch; Liam should hook a condition-evaluator later.
  if (sched.startsWith('when ')) return false;

  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Lightweight bearer check (optional)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  try {
    const now = new Date();
    const rules = alerts.listRules().filter(r => r.enabled);
    const fired = [];
    const skipped = [];

    for (const rule of rules) {
      if (shouldFire(rule, now)) {
        const result = await alerts.fireRule(rule);
        fired.push({ id: rule.id, name: rule.name, result });
      } else {
        skipped.push({ id: rule.id, name: rule.name, schedule: rule.schedule });
      }
    }

    return res.status(200).json({
      ok: true,
      evaluated_at: now.toISOString(),
      total_enabled: rules.length,
      fired_count: fired.length,
      fired,
      skipped
    });
  } catch (e) {
    console.error('cron-alerts error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
