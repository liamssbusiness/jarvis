// Reads tunnel URL from tunnel-output.log, updates Vercel env var, and triggers redeploy
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const VERCEL_TOKEN = 'vcp_1lrWCR84kp4lGvRTToCsSpk5tllJpOq6bRfUSmtRBrGTokvdU91cfgGB';
const PROJECT_ID = 'prj_BXUQB5gqZ75QWb19u5yctmLAJQbJ';
const ENV_VAR_ID = 'jU5EMnJxGhtfKkQK';
const DASHBOARD_DIR = path.join(__dirname, '..');

function extractTunnelUrl() {
  const logPath = path.join(__dirname, 'tunnel-output.log');
  if (!fs.existsSync(logPath)) return null;
  const log = fs.readFileSync(logPath, 'utf8');
  const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  return match ? match[0] : null;
}

function vercelRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vercel.com',
      path: endpoint,
      method,
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('\n   Looking for tunnel URL...');

  let tunnelUrl = null;
  for (let i = 0; i < 15; i++) {
    tunnelUrl = extractTunnelUrl();
    if (tunnelUrl) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!tunnelUrl) {
    console.log('   ❌ Could not find tunnel URL after 30 seconds');
    console.log('   ℹ️  Check tunnel-output.log manually');
    return;
  }

  console.log(`   Found: ${tunnelUrl}`);

  console.log('   Updating Vercel env var...');
  const updateRes = await vercelRequest('PATCH', `/v9/projects/${PROJECT_ID}/env/${ENV_VAR_ID}`, {
    value: tunnelUrl
  });

  if (updateRes.error) {
    console.log(`   ❌ Update failed: ${updateRes.error.message}`);
    return;
  }
  console.log(`   ✅ Env var updated`);

  console.log('   Triggering Vercel redeploy (so the new URL takes effect)...');
  const deploy = exec(
    `npx vercel --prod --token ${VERCEL_TOKEN} --yes`,
    { cwd: DASHBOARD_DIR, timeout: 180000 },
    (err, stdout, stderr) => {
      if (err) {
        console.log(`   ⚠️  Deploy had issues: ${err.message}`);
        return;
      }
      const match = (stdout + stderr).match(/https:\/\/cyber-jarvis[^\s]+\.vercel\.app/);
      if (match) console.log(`   ✅ Deployed: ${match[0]}`);
      else console.log('   ✅ Deploy finished');
      console.log('\n   🚀 JARVIS PC control is LIVE. Test it in Telegram.');
    }
  );
}

main().catch(e => console.error('Error:', e.message));
