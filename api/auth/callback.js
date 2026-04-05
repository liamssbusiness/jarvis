// Google OAuth callback — exchanges code for refresh_token
// Displays the token so Liam can add it to Vercel env vars

module.exports = async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`<html><body style="background:#090b10;color:#e8f4f8;font-family:monospace;padding:40px;">
      <h1 style="color:#ff4444;">Authorization Failed</h1>
      <p>${error}</p>
      <a href="/api/auth/google" style="color:#00e5ff;">Try again</a>
    </body></html>`);
  }

  if (!code) {
    return res.status(400).send(`<html><body style="background:#090b10;color:#e8f4f8;font-family:monospace;padding:40px;">
      <h1>Missing authorization code</h1>
      <a href="/api/auth/google" style="color:#00e5ff;">Start OAuth flow</a>
    </body></html>`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${host}/api/auth/callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    const refreshToken = tokenData.refresh_token;

    res.status(200).send(`
      <html>
      <body style="background:#090b10;color:#e8f4f8;font-family:'Inter',monospace;padding:40px;max-width:700px;margin:0 auto;">
        <h1 style="color:#00e5ff;">✅ JARVIS — Google Connected</h1>
        <p>Gmail and Calendar access granted successfully.</p>

        <h2 style="color:#00e5ff;">Final Step — Add Refresh Token to Vercel</h2>
        <p>Copy this token and add it as <code>GOOGLE_REFRESH_TOKEN</code> in your Vercel project settings:</p>

        <div style="background:#0d1117;border:1px solid rgba(0,229,255,0.3);border-radius:8px;padding:16px;margin:16px 0;word-break:break-all;">
          <code id="token" style="color:#00e5ff;font-size:14px;">${refreshToken}</code>
        </div>

        <button onclick="navigator.clipboard.writeText('${refreshToken}');this.textContent='Copied!'"
                style="background:#00e5ff;color:#090b10;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;">
          Copy Token
        </button>

        <h3 style="color:#e8f4f8;margin-top:32px;">How to add to Vercel:</h3>
        <ol style="line-height:2;color:#7a9bb5;">
          <li>Go to <a href="https://vercel.com" style="color:#00e5ff;">vercel.com</a> → your project → Settings → Environment Variables</li>
          <li>Add key: <code>GOOGLE_REFRESH_TOKEN</code></li>
          <li>Paste the token above as the value</li>
          <li>Set it for all environments (Production, Preview, Development)</li>
          <li>Redeploy the project</li>
        </ol>

        <p style="color:#7a9bb5;margin-top:24px;">After adding the token and redeploying, JARVIS will be able to send emails and manage your calendar. Tell JARVIS "send an email to..." and it will work.</p>

        <p style="color:#3a5a7a;margin-top:32px;font-size:12px;">⚠️ Do not share this token. Close this page after copying.</p>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`<html><body style="background:#090b10;color:#e8f4f8;font-family:monospace;padding:40px;">
      <h1 style="color:#ff4444;">Token Exchange Failed</h1>
      <p>${error.message}</p>
      <a href="/api/auth/google" style="color:#00e5ff;">Try again</a>
    </body></html>`);
  }
};
