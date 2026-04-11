// api/voice.js — Voice pipeline: Gemini STT + ElevenLabs TTS
'use strict';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';

/**
 * Download a Telegram voice message by file_id.
 * @param {string} fileId
 * @returns {Promise<Buffer|null>}
 */
async function downloadTelegramVoice(fileId) {
  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
    );
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    const filePath = meta?.result?.file_path;
    if (!filePath) return null;

    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`
    );
    if (!fileRes.ok) return null;

    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Transcribe an OGG audio buffer using Gemini Flash.
 * @param {Buffer} audioBuffer
 * @returns {Promise<string|null>}
 */
async function transcribeAudio(audioBuffer) {
  try {
    const base64Audio = audioBuffer.toString('base64');
    const body = {
      contents: [{
        parts: [
          {
            text: 'Transcribe this audio message exactly as spoken. Return only the transcription text, nothing else.'
          },
          {
            inline_data: {
              mime_type: 'audio/ogg',
              data: base64Audio
            }
          }
        ]
      }]
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Synthesize speech from text using ElevenLabs TTS.
 * Truncates to nearest sentence under 2000 chars if needed.
 * @param {string} text
 * @returns {Promise<{ audioBuffer: Buffer, truncated: boolean, remainingText?: string }|null>}
 */
async function synthesizeSpeech(text) {
  try {
    let truncated = false;
    let remainingText;
    let speakText = text;

    if (text.length > 2000) {
      // Truncate to nearest sentence boundary under 2000 chars
      const slice = text.slice(0, 2000);
      // Try sentence boundaries: ., !, ?
      const lastSentenceEnd = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('.\n'),
        slice.lastIndexOf('!\n'),
        slice.lastIndexOf('?\n')
      );
      if (lastSentenceEnd > 0) {
        speakText = text.slice(0, lastSentenceEnd + 1).trim();
      } else {
        speakText = slice.trim();
      }
      remainingText = text.slice(speakText.length).trim();
      truncated = true;
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: speakText,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.75,
            similarity_boost: 0.85,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    return truncated
      ? { audioBuffer, truncated: true, remainingText }
      : { audioBuffer, truncated: false };
  } catch {
    return null;
  }
}

/**
 * Send an MP3 audio buffer as a Telegram voice message.
 * @param {string|number} chatId
 * @param {Buffer} audioBuffer
 * @returns {Promise<boolean>}
 */
async function sendVoiceMessage(chatId, audioBuffer) {
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append(
      'voice',
      new Blob([audioBuffer], { type: 'audio/mpeg' }),
      'alfred.mp3'
    );

    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVoice`,
      { method: 'POST', body: form }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a text message via Telegram, splitting at paragraph/sentence boundaries
 * if the text exceeds Telegram's 4096-char limit.
 * @param {string|number} chatId
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function sendTextMessage(chatId, text) {
  const MAX_LEN = 4000;
  const chunks = [];

  let remaining = text;
  while (remaining.length > MAX_LEN) {
    const slice = remaining.slice(0, MAX_LEN);

    // Try paragraph break first, then sentence break
    let splitAt = slice.lastIndexOf('\n\n');
    if (splitAt < 1) {
      splitAt = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? ')
      );
    }
    if (splitAt < 1) splitAt = MAX_LEN;

    chunks.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);

  let allOk = true;
  for (const chunk of chunks) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunk })
        }
      );
      if (!res.ok) allOk = false;
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

/**
 * Handle an incoming Telegram voice message: download + transcribe.
 * @param {{ voice: { file_id: string } }} message
 * @returns {Promise<{ transcribedText: string|null, success: boolean }>}
 */
async function handleVoiceInput(message) {
  try {
    const buffer = await downloadTelegramVoice(message.voice.file_id);
    if (!buffer) return { transcribedText: null, success: false };

    const transcribedText = await transcribeAudio(buffer);
    if (!transcribedText) return { transcribedText: null, success: false };

    return { transcribedText, success: true };
  } catch {
    return { transcribedText: null, success: false };
  }
}

/**
 * Handle outbound voice response: synthesize speech and send, with text fallback.
 * If synthesis succeeds and text was truncated, also sends remainder as text.
 * @param {string|number} chatId
 * @param {string} responseText
 * @returns {Promise<boolean>}
 */
async function handleVoiceOutput(chatId, responseText) {
  const synthesis = await synthesizeSpeech(responseText);

  if (!synthesis) {
    // Fallback to plain text
    return sendTextMessage(chatId, responseText);
  }

  const voiceOk = await sendVoiceMessage(chatId, synthesis.audioBuffer);

  if (!voiceOk) {
    // Voice send failed — fall back to text for the whole response
    return sendTextMessage(chatId, responseText);
  }

  if (synthesis.truncated && synthesis.remainingText) {
    await sendTextMessage(chatId, synthesis.remainingText);
  }

  return true;
}

module.exports = {
  downloadTelegramVoice,
  transcribeAudio,
  synthesizeSpeech,
  sendVoiceMessage,
  sendTextMessage,
  handleVoiceInput,
  handleVoiceOutput
};
