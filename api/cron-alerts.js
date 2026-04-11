// api/cron-alerts.js — Alfred's proactive daily briefs (8am + 9pm LA time)
'use strict';

const { generateBriefing } = require('./briefing.js');
const { handleVoiceOutput, sendTextMessage } = require('../lib/voice.js');
const { extractLocationFromProfile } = require('../lib/memory.js');

// Liam's Telegram user ID — pulled from env with hardcoded fallback
const LIAM_CHAT_ID =
  process.env.LIAM_CHAT_ID ||
  process.env.LIAM_TELEGRAM_USER_ID ||
  '5869226343';

/**
 * Determines brief type from the current UTC hour.
 * UTC 15 → 8am PDT (morning)
 * UTC 04 → 9pm PDT (evening)
 * Any other hour → 'morning' (manual trigger fallback)
 *
 * @param {number} utcHour - 0–23
 * @returns {'morning'|'evening'}
 */
function resolveBriefType(utcHour) {
  if (utcHour === 15) return 'morning';
  if (utcHour === 4)  return 'evening';
  return 'morning';
}

/**
 * Vercel handler for scheduled cron endpoint.
 * Intended to be hit by a Vercel cron or external scheduler twice daily.
 *
 * Auth: if CRON_SECRET env var is set, the request must include:
 *   Authorization: Bearer <CRON_SECRET>
 */
module.exports = async function handler(req, res) {
  // --- Auth check ---
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const sentAt = new Date().toISOString();
  const utcHour = new Date().getUTCHours();
  const type = resolveBriefType(utcHour);

  try {
    // Resolve Liam's current location from memory profile; fall back to LA
    let location = 'Los Angeles';
    try {
      const profileLocation = await extractLocationFromProfile();
      if (profileLocation && typeof profileLocation === 'string' && profileLocation.trim()) {
        location = profileLocation.trim();
      }
    } catch (locErr) {
      console.warn('[cron-alerts] Could not resolve location from profile, using default:', locErr.message);
    }

    // Generate the full briefing
    const { briefingText } = await generateBriefing(type, location);

    // Try voice first; fall back to text if voice delivery fails
    try {
      await handleVoiceOutput(LIAM_CHAT_ID, briefingText);
    } catch (voiceErr) {
      console.warn('[cron-alerts] Voice delivery failed, falling back to text:', voiceErr.message);
      await sendTextMessage(LIAM_CHAT_ID, briefingText);
    }

    return res.status(200).json({ ok: true, type, sentAt });
  } catch (err) {
    console.error('[cron-alerts] Brief generation failed:', err);

    // Best-effort fallback message to Liam
    const greeting = type === 'evening' ? 'Good evening' : 'Good morning';
    const fallbackText =
      `${greeting}, sir. I encountered a minor issue generating your full brief. I'll have it ready shortly.`;

    try {
      await sendTextMessage(LIAM_CHAT_ID, fallbackText);
    } catch (fallbackErr) {
      console.error('[cron-alerts] Fallback message also failed:', fallbackErr.message);
    }

    return res.status(500).json({ ok: false, error: err.message, type, sentAt });
  }
};
