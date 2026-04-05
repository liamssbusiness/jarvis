# Google OAuth Setup — Gmail & Calendar

This enables JARVIS to read/send emails and manage your Google Calendar.
Takes about 20 minutes. Follow each step exactly.

## Step 1: Create Google Cloud Project
1. Go to https://console.cloud.google.com
2. Click the project dropdown (top left) → **New Project**
3. Name it: `JARVIS Dashboard`
4. Click **Create**

## Step 2: Enable APIs
1. Go to **APIs & Services** → **Library**
2. Search "Gmail API" → Click it → **Enable**
3. Search "Google Calendar API" → Click it → **Enable**

## Step 3: Create OAuth Credentials
1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. If prompted, configure consent screen first:
   - User Type: **External**
   - App name: `JARVIS`
   - Your email for support
   - Click **Save and Continue** through all steps
   - Add yourself as a **Test user**
4. Back to Create Credentials → OAuth client ID:
   - Application type: **Web application**
   - Name: `JARVIS Web`
   - Authorized redirect URIs: add `https://jarvis-dashboard.vercel.app/api/auth/callback`
   - Also add: `http://localhost:3000/api/auth/callback`
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 4: Add to Vercel Environment Variables
In your Vercel dashboard → Settings → Environment Variables:
- `GOOGLE_CLIENT_ID` = (paste Client ID)
- `GOOGLE_CLIENT_SECRET` = (paste Client Secret)
- `GOOGLE_REDIRECT_URI` = `https://jarvis-dashboard.vercel.app/api/auth/callback`

## Step 5: Connect your Google Account
1. Open JARVIS dashboard
2. Type: "Connect my Google account"
3. JARVIS will give you an auth link
4. Click it, sign in, approve permissions
5. Done — JARVIS can now manage Gmail and Calendar

## What JARVIS can do after setup:
- "Read my latest emails"
- "Send an email to..."
- "What's on my calendar today?"
- "Schedule a meeting on Friday at 2pm"
- "Cancel my 3pm appointment"
