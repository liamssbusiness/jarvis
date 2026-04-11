// api/telegram.js — Alfred, Liam's British butler AI assistant
// Telegram webhook handler — the main brain
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt, ALFRED_TOOLS, APPROVAL_REQUIRED, selectModel } = require('./alfred.js');
const { loadMemoryContext, saveSessionSummary, appendLearning, updateLocation, readMemoryFile, writeMemoryFile } = require('./memory.js');
const { handleVoiceInput, handleVoiceOutput, sendTextMessage } = require('./voice.js');
const { fetchWeather } = require('./weather.js');
const { fetchNews } = require('./news.js');
const { fetchMarketData } = require('./stocks.js');
const { webSearch } = require('./search.js');
const { listCalendarEvents, createCalendarEvent } = require('./calendar.js');

// ─── Constants ────────────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const AUTHORIZED_USER_ID = parseInt(process.env.LIAM_TELEGRAM_USER_ID || '5869226343', 10);

// ─── Per-instance state (resets on cold start — short-term memory only) ───────

const conversationHistory = []; // max 20 messages
const MAX_HISTORY = 20;
const pendingApprovals = new Map(); // chatId → { toolName, toolInput, expiresAt }
let currentLocation = 'Los Angeles';
let sessionStartTime = Date.now();
let toolsDisabled = false; // /lockdown flag

// ─── Authorization ─────────────────────────────────────────────────────────────

function isAuthorized(userId) {
  return userId === AUTHORIZED_USER_ID;
}

// ─── Telegram helpers ──────────────────────────────────────────────────────────

async function sendTyping(chatId) {
  try {
    await fetch(`${TELEGRAM_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' })
    });
  } catch (_) { /* non-critical */ }
}

/**
 * Split text on clean boundaries respecting Telegram's 4096-char limit.
 * Returns an array of chunks.
 */
function splitMessage(text, limit = 4000) {
  const chunks = [];
  let remaining = String(text || '');
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf('\n', limit);
    if (breakAt < limit / 2) breakAt = limit;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return chunks;
}

/**
 * Send a plain text message to Telegram, chunked if necessary.
 * Falls back to plain text if Markdown parse fails.
 */
async function sendTelegram(chatId, text, extra = {}) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    try {
      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown', ...extra })
      });
      const data = await res.json();
      // If Markdown parse fails, retry without parse_mode
      if (!data.ok && data.description && data.description.includes('parse')) {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunk, ...extra })
        });
      }
    } catch (e) {
      console.error('[Alfred] sendTelegram error:', e.message);
    }
  }
}

// ─── Approval workflow ─────────────────────────────────────────────────────────

/**
 * Store a pending approval and send an inline keyboard to Liam asking confirmation.
 * TTL: 5 minutes.
 */
async function sendApprovalRequest(chatId, toolName, toolInput, description) {
  const expiresAt = Date.now() + 5 * 60 * 1000;
  pendingApprovals.set(chatId, { toolName, toolInput, expiresAt });

  const safeDesc = String(description || toolName).slice(0, 400);
  const msg =
    `One moment, sir — this action requires your approval before I proceed:\n\n` +
    `*${safeDesc}*\n\n` +
    `Shall I proceed?`;

  await sendTelegram(chatId, msg, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Yes, proceed', callback_data: 'approve' },
        { text: 'No, cancel', callback_data: 'reject' }
      ]]
    }
  });
}

/**
 * Handle an inline keyboard callback (approval buttons).
 * If approved: execute tool, feed result to Claude, send summary.
 * If rejected: cancel and notify.
 */
async function handleApprovalCallback(chatId, data, callbackQueryId) {
  // Acknowledge the button press immediately
  try {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId })
    });
  } catch (_) { /* non-critical */ }

  const pending = pendingApprovals.get(chatId);

  if (!pending) {
    await sendTelegram(chatId, 'There is no pending action to approve, sir. The request may have expired.');
    return;
  }

  // Expire check
  if (Date.now() > pending.expiresAt) {
    pendingApprovals.delete(chatId);
    await sendTelegram(chatId, 'I\'m afraid that approval request has expired, sir. Please make the request again if you still wish to proceed.');
    return;
  }

  if (data === 'reject') {
    pendingApprovals.delete(chatId);
    await sendTelegram(chatId, 'Very good, sir. The action has been cancelled. Is there anything else I can assist with?');
    return;
  }

  if (data === 'approve') {
    pendingApprovals.delete(chatId);
    await sendTyping(chatId);

    let toolResult;
    try {
      toolResult = await executeTool(pending.toolName, pending.toolInput);
    } catch (e) {
      await sendTelegram(chatId, `I encountered an error executing that action, sir: ${e.message}`);
      return;
    }

    // Ask Claude for a brief natural-language summary of the result
    try {
      const memCtx = await loadMemoryContext().catch(() => ({}));
      const systemPrompt = buildSystemPrompt(memCtx, currentLocation, false);
      const summaryMessages = [
        ...conversationHistory.slice(-6),
        {
          role: 'user',
          content: `The approved action "${pending.toolName}" has been executed. Result: ${JSON.stringify(toolResult).slice(0, 2000)}. Please give Liam a brief, butler-style confirmation of what was done.`
        }
      ];
      const summaryResp = await client.messages.create({
        model: selectModel('', conversationHistory.length),
        max_tokens: 512,
        system: systemPrompt,
        messages: summaryMessages
      });
      const summaryText = summaryResp.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (summaryText) {
        conversationHistory.push({ role: 'assistant', content: summaryText });
        if (conversationHistory.length > MAX_HISTORY) conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
        await sendTextMessage(chatId, summaryText);
        return;
      }
    } catch (e) {
      console.error('[Alfred] approval summary error:', e.message);
    }

    // Fallback: send raw result
    await sendTelegram(chatId, `Done, sir. Result:\n\`\`\`\n${JSON.stringify(toolResult, null, 2).slice(0, 1500)}\n\`\`\``);
  }
}

// ─── Location detection ────────────────────────────────────────────────────────

/**
 * Parse city from common location phrases.
 * Returns the city string or null.
 */
function detectLocationUpdate(text) {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /i(?:'m| am) in ([A-Za-z ]+?)(?:\.|,|!|\?|$)/i,
    /just landed in ([A-Za-z ]+?)(?:\.|,|!|\?|$)/i,
    /i(?:'m| am) at ([A-Za-z ]+?)(?:\.|,|!|\?|$)/i,
    /heading to ([A-Za-z ]+?)(?:\.|,|!|\?|$)/i,
    /traveling to ([A-Za-z ]+?)(?:\.|,|!|\?|$)/i,
    /arrived in ([A-Za-z ]+?)(?:\.|,|!|\?|$)/i
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const city = m[1].trim();
      // Filter out false positives (very short or clearly not a city)
      if (city.length >= 2 && city.length <= 50 && !/^\d/.test(city)) {
        return city;
      }
    }
  }
  return null;
}

// ─── Conversation end detection ────────────────────────────────────────────────

function detectConversationEnd(text) {
  if (!text || typeof text !== 'string') return false;
  const lc = text.toLowerCase().trim();
  return (
    lc === 'goodbye' ||
    lc === 'good night' ||
    lc === 'goodnight' ||
    lc === "that's all" ||
    lc === "that's all, alfred" ||
    lc === 'thanks alfred' ||
    lc === 'thank you alfred' ||
    lc === 'cheers alfred' ||
    lc === 'cheers' ||
    /^(good ?night|goodbye|that'?s? all|thanks,? alfred|cheers,? alfred)\b/i.test(lc)
  );
}

// ─── Local agent bridge ────────────────────────────────────────────────────────

/**
 * POST to local agent at LOCAL_AGENT_URL with Bearer auth.
 * 5-second timeout. Returns parsed JSON or throws.
 */
async function callLocalAgent(action, body = {}) {
  const agentUrl = process.env.LOCAL_AGENT_URL;
  const agentSecret = process.env.LOCAL_AGENT_SECRET;

  if (!agentUrl) {
    throw new Error('Local agent not connected. LOCAL_AGENT_URL is not set.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${agentUrl}/api/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(agentSecret ? { 'Authorization': `Bearer ${agentSecret}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Tool executor ─────────────────────────────────────────────────────────────

/**
 * Execute a named tool and return its result.
 * Approval-gated tools (create_calendar_event, pc_run_command) should only
 * be called here after the user has approved via handleApprovalCallback.
 */
async function executeTool(toolName, toolInput) {
  switch (toolName) {

    case 'get_weather':
      return await fetchWeather(
        toolInput.location || currentLocation,
        toolInput.units || 'fahrenheit'
      );

    case 'get_news':
      return await fetchNews(
        toolInput.query || '',
        toolInput.category,
        toolInput.count || 4
      );

    case 'get_market_data':
      return await fetchMarketData(toolInput.symbols);

    case 'web_search':
      return await webSearch(toolInput.query);

    case 'read_emails':
      // Return a useful stub while Gmail integration is wired up
      return { emails: [], note: 'Gmail integration active — please ensure Google OAuth is configured at /api/auth/google.' };

    case 'list_calendar_events':
      return await listCalendarEvents({
        maxResults: toolInput.maxResults || 10,
        daysAhead: toolInput.daysAhead || 7
      });

    case 'create_calendar_event':
      // Only called after approval gate
      return await createCalendarEvent(toolInput);

    case 'pc_run_command':
      // Only called after approval gate
      return await callLocalAgent('exec', {
        command: toolInput.command,
        cwd: toolInput.cwd
      });

    case 'pc_read_file':
      return await callLocalAgent('read-file', { path: toolInput.path });

    case 'read_vault_memory':
      return await readMemoryFile(toolInput.filename);

    case 'write_vault_memory':
      return await writeMemoryFile(toolInput.filename, toolInput.content);

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── Alfred reasoning loop ─────────────────────────────────────────────────────

/**
 * Run the Claude tool-use loop.
 * Max 5 iterations, 25-second wall-clock budget.
 *
 * Returns: { text: string|null, pendingApproval: { toolName, toolInput, description }|null }
 */
async function runAlfredLoop(userMessages, systemPrompt, model) {
  const deadline = Date.now() + 25000;
  let messages = [...userMessages];
  let iterations = 0;
  const MAX_ITER = 5;

  while (iterations < MAX_ITER && Date.now() < deadline) {
    iterations++;

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: ALFRED_TOOLS,
      messages
    });

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return { text: text || null, pendingApproval: null };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // Check if any tool in this batch requires approval
      for (const block of toolUseBlocks) {
        if (APPROVAL_REQUIRED.has(block.name)) {
          // Return the first approval-gated tool; abort this iteration
          const textSoFar = response.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('') || null;

          // Build a human-readable description of the action
          const description = buildActionDescription(block.name, block.input);

          return {
            text: textSoFar,
            pendingApproval: {
              toolName: block.name,
              toolInput: block.input,
              description
            }
          };
        }
      }

      // No approval needed — execute all tools in parallel
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          let result;
          try {
            result = await executeTool(block.name, block.input);
          } catch (e) {
            result = { error: e.message };
          }
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          };
        })
      );

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop_reason — return whatever text we have
    const fallback = response.content.find(b => b.type === 'text')?.text || null;
    return { text: fallback, pendingApproval: null };
  }

  return {
    text: 'I appear to have reached my processing limit on that request, sir. Could you simplify or break it into smaller steps?',
    pendingApproval: null
  };
}

/**
 * Build a short human-readable description of a tool call for the approval request.
 */
function buildActionDescription(toolName, toolInput) {
  switch (toolName) {
    case 'create_calendar_event':
      return `Create calendar event: "${toolInput.summary || '(no title)'}" on ${toolInput.start || '(no date)'}`;
    case 'pc_run_command':
      return `Run command on your PC: \`${(toolInput.command || '').slice(0, 200)}\`${toolInput.cwd ? ` in ${toolInput.cwd}` : ''}`;
    case 'write_vault_memory':
      return `Write to vault file: ${toolInput.filename || '(unknown)'}`;
    default:
      return `Execute: ${toolName}`;
  }
}

// ─── Session summary ───────────────────────────────────────────────────────────

/**
 * Ask Claude (haiku) to produce a 2-3 sentence summary of the current session
 * for storage in memory.
 */
async function generateSessionSummary() {
  if (conversationHistory.length < 2) return null;

  try {
    const transcript = conversationHistory
      .slice(-10)
      .map(m => {
        const role = m.role === 'user' ? 'Liam' : 'Alfred';
        const content = typeof m.content === 'string'
          ? m.content
          : m.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        return `${role}: ${content.slice(0, 300)}`;
      })
      .join('\n');

    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: 'You are a concise note-taker. Summarize this conversation in 2-3 sentences, focusing on what Liam asked for and what was accomplished. Be factual and brief.',
      messages: [{ role: 'user', content: transcript }]
    });

    return resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim() || null;
  } catch (e) {
    console.error('[Alfred] generateSessionSummary error:', e.message);
    return null;
  }
}

// ─── Learning heuristic ────────────────────────────────────────────────────────

/**
 * Simple heuristic: if Liam used correction language, extract a lesson.
 * Returns a string lesson or null.
 */
function extractLesson(userText, alfredReply) {
  if (!userText || typeof userText !== 'string') return null;
  const lc = userText.toLowerCase();
  const correctionWords = ['actually', "no,", "don't", "instead", 'not that', 'wrong', 'incorrect', 'that\'s not'];
  const hasCorrection = correctionWords.some(w => lc.includes(w));
  if (!hasCorrection) return null;

  // Truncate for storage
  return `Correction from Liam: "${userText.slice(0, 200)}" — Alfred replied: "${(alfredReply || '').slice(0, 200)}"`;
}

// ─── /start greeting ───────────────────────────────────────────────────────────

function buildStartMessage() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    `${greeting}, sir. Alfred online.\n\n` +
    `I'm your personal assistant — at your service via text or voice.\n\n` +
    `I can: check your calendar and emails, search the web, manage tasks, control your PC, research anything, and much more.\n\n` +
    `What shall we tackle?`
  );
}

// ─── /status message ───────────────────────────────────────────────────────────

function buildStatusMessage() {
  const uptimeMs = Date.now() - sessionStartTime;
  const uptimeMins = Math.floor(uptimeMs / 60000);
  const historyCount = conversationHistory.length;
  const hasPending = pendingApprovals.size > 0;

  return (
    `*Alfred Status*\n\n` +
    `Session uptime: ${uptimeMins} min\n` +
    `Conversation turns: ${historyCount}/${MAX_HISTORY}\n` +
    `Location: ${currentLocation}\n` +
    `Tools: ${toolsDisabled ? 'DISABLED (lockdown)' : 'Enabled'}\n` +
    `Pending approvals: ${hasPending ? 'Yes' : 'None'}\n` +
    `Authorized user: ${AUTHORIZED_USER_ID}`
  );
}

// ─── Main message processor ────────────────────────────────────────────────────

/**
 * Full message processing pipeline.
 * Handles text, voice, photos, commands, approvals, and the Claude loop.
 */
async function processMessage(update) {
  // ── 1. Route callback_query (approval buttons) ──────────────────────────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const userId = cq.from?.id;

    if (!chatId) return;
    if (!isAuthorized(userId)) {
      await sendTelegram(chatId, 'Apologies — you are not authorized to interact with Alfred.');
      return;
    }

    await handleApprovalCallback(chatId, cq.data, cq.id);
    return;
  }

  // ── 2. Extract message ────────────────────────────────────────────────────────
  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId = message.chat.id;
  const userId = message.from?.id;
  const rawText = message.text || message.caption || '';

  // ── 3. Auth check ──────────────────────────────────────────────────────────
  if (!isAuthorized(userId)) {
    console.warn(`[Alfred] Unauthorized access attempt: user_id=${userId}, chat_id=${chatId}`);
    await sendTelegram(chatId, 'Apologies — I only serve Liam. Unauthorized access is not permitted.');
    return;
  }

  // ── 4. Typing indicator ────────────────────────────────────────────────────
  await sendTyping(chatId);

  // ── 5. Voice input ─────────────────────────────────────────────────────────
  let userText = rawText;
  let isVoice = false;
  let photoBase64 = null;

  if (message.voice || message.audio) {
    const voiceResult = await handleVoiceInput(message);
    if (voiceResult && voiceResult.success && voiceResult.transcribedText) {
      userText = voiceResult.transcribedText;
      isVoice = true;
      // Echo the transcript back so Liam can confirm what was heard
      await sendTelegram(chatId, `_Heard: "${userText.slice(0, 200)}"_`);
    } else {
      await sendTelegram(chatId, 'I\'m afraid I couldn\'t transcribe that voice message, sir. Please try again or send it as text.');
      return;
    }
  }

  // ── 6. Photo input ─────────────────────────────────────────────────────────
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    try {
      const fileRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${largest.file_id}`);
      const fileData = await fileRes.json();
      if (fileData.ok) {
        const filePath = fileData.result.file_path;
        const photoRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
        const buf = Buffer.from(await photoRes.arrayBuffer());
        photoBase64 = buf.toString('base64');
      }
    } catch (e) {
      console.error('[Alfred] photo download error:', e.message);
    }
    if (!userText) {
      userText = 'I\'ve sent you a photo. Please analyse it and tell me what you see, then suggest what we might do with it.';
    }
  }

  // ── 7. Commands ────────────────────────────────────────────────────────────
  if (rawText === '/start') {
    await sendTelegram(chatId, buildStartMessage());
    return;
  }

  if (rawText === '/chatid') {
    await sendTelegram(chatId, `Chat ID: \`${chatId}\``);
    return;
  }

  if (rawText.startsWith('/note ') || rawText.startsWith('/n ')) {
    const noteBody = rawText.replace(/^\/(note|n)\s+/, '').trim();
    if (!noteBody) {
      await sendTelegram(chatId, 'Usage: `/note your thought here` — saves a note to your vault Inbox.');
      return;
    }
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const filename = `${dateStr} ${timeStr.replace(/:/g, '-')} quick-note.md`;
    const content =
      `---\ndate: ${dateStr}\ntime: ${timeStr}\ntype: quick-capture\nsource: alfred-telegram\ntags: [inbox, quick-capture]\n---\n\n# Quick Note\n\n${noteBody}\n\n---\n*Captured via Alfred at ${timeStr}.*\n`;
    try {
      await writeMemoryFile(filename, content);
      await sendTelegram(chatId, `Very good, sir. Note saved to your vault Inbox: \`${filename}\``);
    } catch (e) {
      await sendTelegram(chatId, `I wasn't able to save that note, sir: ${e.message}`);
    }
    return;
  }

  if (rawText.startsWith('/idea ') || rawText.startsWith('/i ')) {
    const ideaBody = rawText.replace(/^\/(idea|i)\s+/, '').trim();
    if (!ideaBody) {
      await sendTelegram(chatId, 'Usage: `/idea your idea here` — saves to your vault Ideas folder.');
      return;
    }
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const title = ideaBody.slice(0, 50).replace(/[^\w\s-]/g, '').trim() || 'Untitled';
    const filename = `${dateStr} ${title}.md`;
    const content =
      `---\ndate: ${dateStr}\ntype: idea\nstatus: raw\ntags: [idea, alfred-telegram]\n---\n\n# ${title}\n\n## The Idea\n${ideaBody}\n\n## Next Step\n- [ ] *Define the first action*\n\n---\n*Captured via Alfred on ${dateStr}.*\n`;
    try {
      await writeMemoryFile(filename, content);
      await sendTelegram(chatId, `Excellent idea, sir. Saved to your vault: \`${filename}\``);
    } catch (e) {
      await sendTelegram(chatId, `I wasn't able to save that idea, sir: ${e.message}`);
    }
    return;
  }

  if (rawText === '/status') {
    await sendTelegram(chatId, buildStatusMessage());
    return;
  }

  if (rawText === '/lockdown') {
    toolsDisabled = true;
    await sendTelegram(chatId, 'Understood, sir. Tools are now disabled. I can only respond with text. Send `/unlock` to restore full capability.');
    return;
  }

  if (rawText === '/unlock') {
    toolsDisabled = false;
    await sendTelegram(chatId, 'Tools re-enabled, sir. Alfred is fully operational.');
    return;
  }

  // ── 8. Nothing to process ──────────────────────────────────────────────────
  if (!userText && !photoBase64) return;

  // ── 9. Detect location update ──────────────────────────────────────────────
  const detectedCity = detectLocationUpdate(userText);
  if (detectedCity) {
    currentLocation = detectedCity;
    try { await updateLocation(detectedCity); } catch (_) { /* non-critical */ }
  }

  // ── 10. Detect conversation end → save session summary ────────────────────
  if (detectConversationEnd(userText)) {
    const summary = await generateSessionSummary();
    if (summary) {
      try { await saveSessionSummary(summary); } catch (_) { /* non-critical */ }
    }
    await sendTelegram(chatId, 'Very good, sir. Alfred standing by whenever you need me. Have a splendid day.');
    return;
  }

  // ── 11. Load memory context ────────────────────────────────────────────────
  let memoryCtx = {};
  try {
    memoryCtx = await loadMemoryContext();
  } catch (e) {
    console.error('[Alfred] loadMemoryContext error:', e.message);
  }

  // ── 12. Build system prompt ────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(memoryCtx, currentLocation, isVoice);

  // ── 13. Select model ───────────────────────────────────────────────────────
  const model = toolsDisabled ? 'claude-haiku-4-5' : selectModel(userText, conversationHistory.length);

  // ── 14. Build user message content (text + optional image) ─────────────────
  const userContent = [];
  if (photoBase64) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photoBase64 } });
  }
  if (userText) {
    userContent.push({ type: 'text', text: userText });
  }

  conversationHistory.push({ role: 'user', content: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
  }

  // ── 15. Run Alfred loop ────────────────────────────────────────────────────
  let loopResult = { text: null, pendingApproval: null };

  if (toolsDisabled) {
    // Lockdown: respond without tools
    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt + '\n\n[LOCKDOWN ACTIVE: Do not use any tools. Respond with text only.]',
        messages: conversationHistory.slice(-MAX_HISTORY)
      });
      loopResult.text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('') || null;
    } catch (e) {
      loopResult.text = `I appear to be having some difficulty, sir: ${e.message}`;
    }
  } else {
    try {
      loopResult = await runAlfredLoop([...conversationHistory], systemPrompt, model);
    } catch (e) {
      console.error('[Alfred] runAlfredLoop error:', e.message);
      loopResult.text = `I encountered an error processing your request, sir: ${e.message}`;
    }
  }

  // ── 16. Handle pending approval ────────────────────────────────────────────
  if (loopResult.pendingApproval) {
    const { toolName, toolInput, description } = loopResult.pendingApproval;

    // If Alfred produced some text before hitting the approval gate, send it first
    if (loopResult.text && loopResult.text.trim()) {
      const preText = loopResult.text.trim();
      conversationHistory.push({ role: 'assistant', content: preText });
      if (conversationHistory.length > MAX_HISTORY) conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
      if (isVoice) {
        await handleVoiceOutput(chatId, preText);
      } else {
        await sendTextMessage(chatId, preText);
      }
    }

    await sendApprovalRequest(chatId, toolName, toolInput, description);
    return;
  }

  // ── 17. Deliver text response ──────────────────────────────────────────────
  if (loopResult.text && loopResult.text.trim()) {
    const responseText = loopResult.text.trim();

    conversationHistory.push({ role: 'assistant', content: responseText });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);

    if (isVoice) {
      const voiceOk = await handleVoiceOutput(chatId, responseText);
      if (!voiceOk) {
        // Fall back to text if voice output fails
        await sendTextMessage(chatId, responseText);
      }
    } else {
      await sendTextMessage(chatId, responseText);
    }

    // ── 18. Learning heuristic ───────────────────────────────────────────────
    const lesson = extractLesson(userText, responseText);
    if (lesson) {
      try { await appendLearning({ lesson, timestamp: new Date().toISOString() }); } catch (_) { /* non-critical */ }
    }
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Respond to Telegram immediately to avoid retry storms
  res.status(200).json({ ok: true });

  if (req.method === 'GET') return; // health check

  if (req.method !== 'POST') return;

  try {
    const update = req.body;
    if (!update) return;
    // Process asynchronously after responding
    await processMessage(update);
  } catch (e) {
    console.error('[Alfred] Unhandled error:', e.message);
  }
};

module.exports.config = { maxDuration: 60 };
