// Standalone reminder sender — schedules a Telegram message to Liam
// Usage: node send-reminder.js "message text" "HH:MM" (24h format)

const https = require('https');

const TELEGRAM_TOKEN = '8648554559:AAHaNmqPK0MQW1ZrhE-tIGdZ-XY7KyjcIik';
// Chat ID will be captured on first run by listening to the bot OR hardcoded
const CHAT_ID = process.env.JARVIS_CHAT_ID || null;

function sendMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const [,, message, time] = process.argv;
  if (!message || !time) {
    console.log('Usage: node send-reminder.js "message" "HH:MM"');
    console.log('Example: node send-reminder.js "Time for VisionClaw setup" "20:00"');
    process.exit(1);
  }

  if (!CHAT_ID) {
    console.log('❌ JARVIS_CHAT_ID not set. Send a message to @Jarvis102107_bot first, then set:');
    console.log('   set JARVIS_CHAT_ID=<your-chat-id>');
    process.exit(1);
  }

  const [hour, minute] = time.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  const msUntil = target - now;
  const hoursUntil = (msUntil / 3600000).toFixed(2);
  console.log(`⏰ Reminder scheduled for ${target.toLocaleString()} (in ${hoursUntil}h)`);
  console.log(`📝 Message: "${message}"`);
  console.log('Keep this window open until the reminder fires.');

  setTimeout(async () => {
    const result = await sendMessage(CHAT_ID, `🔔 *Reminder*\n\n${message}`);
    console.log(result.ok ? '✅ Sent!' : '❌ Failed: ' + JSON.stringify(result));
    process.exit(0);
  }, msUntil);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
