# Meta Ray-Ban Glasses → JARVIS Setup

This connects your Ray-Ban Meta Gen 2 glasses to JARVIS via VisionClaw.
When done: speak to glasses → JARVIS hears + sees → responds through earpiece + Telegram.

## Architecture

```
You speak / take photo with glasses
    ↓
Meta glasses (mic + camera)
    ↓ (Bluetooth)
iPhone (Meta View app)
    ↓ (WebRTC stream via VisionClaw)
Your PC (VisionClaw server)
    ↓ (sends to AI)
Gemini Live (processes vision + voice)
    ↓ (actions)
JARVIS / Telegram Bot (executes tasks, responds)
    ↓ (response audio)
Glasses earpiece (you hear JARVIS)
```

## Prerequisites

- [ ] Ray-Ban Meta Gen 2 glasses paired to iPhone via Meta View app
- [ ] iPhone with Meta View app installed
- [ ] Windows PC (always on, or at least when using glasses remotely)
- [ ] Gemini API key (already have: set in Vercel)

## Step 1: Create Meta Developer Account

1. Go to https://developers.facebook.com
2. Sign in with your Facebook/Meta account
3. Click "Create App" → "Other" → "Business"
4. App name: "JARVIS Vision"
5. Once created, go to App Settings → Basic → note the App ID

## Step 2: Install VisionClaw on PC

Open Command Prompt on your Windows PC:

```bash
cd c:\Users\the10\Downloads\Claude
git clone https://github.com/sseanliu/VisionClaw.git
cd VisionClaw
npm install
```

## Step 3: Configure VisionClaw

Create a `.env` file in the VisionClaw folder:

```env
GEMINI_API_KEY=AIzaSyC7mzutn93_kCMFcnNmDEvd5fBC8MLlkF8
JARVIS_TELEGRAM_TOKEN=8648554559:AAHaNmqPK0MQW1ZrhE-tIGdZ-XY7KyjcIik
JARVIS_API_URL=https://cyber-jarvis-9il2nvtg4-liamssbusiness-projects.vercel.app/api/chat

# Meta DAT SDK (fill in after Step 1)
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
```

## Step 4: Pair Glasses with VisionClaw

1. Open Meta View app on iPhone
2. Ensure glasses are paired and connected
3. In VisionClaw settings, enter your Meta App credentials
4. VisionClaw will connect to the glasses' camera + mic stream

## Step 5: Start VisionClaw

```bash
cd c:\Users\the10\Downloads\Claude\VisionClaw
npm start
```

VisionClaw will start and show "Connected to glasses" when ready.

## Step 6: Test

1. Put on glasses
2. Say "Hey Meta, what do you see?"
3. VisionClaw captures the frame, sends to Gemini
4. If the response requires action, it routes through JARVIS
5. Response plays through glasses earpiece

## Alternative: Simpler Glasses Integration (No VisionClaw)

If VisionClaw setup is too complex, there's a simpler path:

### iPhone Shortcut Method
1. Create an iOS Shortcut called "JARVIS"
2. Trigger: "Hey Siri, JARVIS" (works through glasses)
3. Action: Send text input to JARVIS Telegram bot
4. Response: JARVIS replies in Telegram (glasses read it aloud if notifications are on)

### How to set up the Shortcut:
1. Open Shortcuts app on iPhone
2. Create new shortcut → name it "JARVIS"
3. Add action: "Ask for Input" → "What should I tell JARVIS?"
4. Add action: "Get Contents of URL"
   - URL: https://api.telegram.org/bot8648554559:AAHaNmqPK0MQW1ZrhE-tIGdZ-XY7KyjcIik/sendMessage
   - Method: POST
   - Request Body: JSON
     - chat_id: (your Telegram chat ID — send /start to the bot and check)
     - text: (the input from step 1)
5. Add to Siri: "Hey Siri, JARVIS"

Now from your glasses: "Hey Siri, JARVIS" → speak your command → JARVIS responds in Telegram → glasses read the notification aloud.

## Notes

- VisionClaw streams at ~1fps JPEG — good enough for scene understanding, not real-time video
- Voice is bidirectional at 16kHz in / 24kHz out
- For photo commands ("take a picture of this"), the glasses camera captures a photo and sends it through the pipeline
- The Telegram bot also receives these photos, so everything is logged in your chat history
