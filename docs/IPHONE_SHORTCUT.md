# iPhone "Hey Siri, JARVIS" Shortcut

This lets you talk to JARVIS from your iPhone (or Meta glasses via Siri).

## Setup (5 minutes)

### Step 1: Get your Telegram Chat ID
1. Open Telegram → @Jarvis102107_bot
2. Send `/start` if you haven't already
3. Send any message like "test"
4. Open this URL in your browser:
   `https://api.telegram.org/bot8648554559:AAHaNmqPK0MQW1ZrhE-tIGdZ-XY7KyjcIik/getUpdates`
5. Find `"chat":{"id":` — that number is your Chat ID
6. Write it down (e.g., 123456789)

### Step 2: Create the Shortcut
1. Open **Shortcuts** app on iPhone
2. Tap **+** to create new shortcut
3. Tap the name at the top → rename to **JARVIS**

### Step 3: Add Actions

Add these actions in order:

**Action 1: Ask for Input**
- Input Type: Text
- Prompt: "What should I tell JARVIS?"

**Action 2: Get Contents of URL**
- URL: `https://api.telegram.org/bot8648554559:AAHaNmqPK0MQW1ZrhE-tIGdZ-XY7KyjcIik/sendMessage`
- Method: POST
- Request Body: JSON
  - Key: `chat_id` → Value: YOUR_CHAT_ID (the number from Step 1)
  - Key: `text` → Value: (tap "Provided Input" from the variable list)

**Action 3: Wait 3 seconds**
- Add "Wait" action → 3 seconds

**Action 4: Get Contents of URL (read response)**
- URL: `https://api.telegram.org/bot8648554559:AAHaNmqPK0MQW1ZrhE-tIGdZ-XY7KyjcIik/getUpdates?offset=-1&limit=1`
- Method: GET

**Action 5: Show Result**
- Show "Contents of URL" from previous step
- (This shows JARVIS's reply)

### Step 4: Add to Siri
1. Tap the **ℹ️** icon at bottom of shortcut
2. Tap **Add to Siri**
3. Record phrase: **"JARVIS"**
4. Done!

## Usage

### From iPhone:
- "Hey Siri, JARVIS" → speak your command → JARVIS responds

### From Meta Glasses:
- "Hey Siri, JARVIS" → speak → (glasses mic picks up) → JARVIS processes → response shows in Telegram → glasses read notification aloud

### Pro tip:
Turn on Telegram notification read-aloud in:
iPhone Settings → Notifications → Telegram → Announce Notifications → ON

This makes the glasses automatically speak JARVIS's Telegram replies to you.

## Alternative: Voice Note Shortcut

For a more natural experience (just hold and talk):

**Action 1: Record Audio**
- Record for: Until tapped (or set max 30s)

**Action 2: Share** → Send to Telegram JARVIS bot

This sends a voice note directly to JARVIS, which transcribes and responds.
