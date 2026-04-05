// Google OAuth flow for Gmail + Calendar
// Step 1: Visit /api/auth/google → redirects to Google consent
// Step 2: Google redirects back to /api/auth/callback with code
// Step 3: We exchange code for refresh_token and display it

module.exports = async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(503).json({
      error: 'Google OAuth not configured',
      steps: [
        '1. Go to console.cloud.google.com',
        '2. Create a project called "JARVIS"',
        '3. Enable Gmail API and Google Calendar API',
        '4. Create OAuth 2.0 credentials (Web application)',
        '5. Add redirect URI: https://YOUR-DOMAIN/api/auth/callback',
        '6. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Vercel env vars',
        '7. Redeploy and visit this page again'
      ]
    });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${host}/api/auth/callback`;

  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.writeHead(302, { Location: authUrl });
  res.end();
};
