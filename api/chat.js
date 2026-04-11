// Vercel serverless function - Node.js
// Uses Anthropic SDK for Claude claude-sonnet-4-6
// Implements full tool-use loop: Claude calls tools, we execute, feed results back, loop until text response

const Anthropic = require('@anthropic-ai/sdk');
const { fetchWeather } = require('./weather.js');
const { fetchNews } = require('./news.js');
const { fetchMarketData } = require('./stocks.js');
const { webSearch } = require('./search.js');
const { generateBriefing } = require('./briefing.js');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Fetch with timeout — prevents slow external APIs from eating our budget
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Tool definitions for Claude
const TOOLS = [
  {
    name: 'get_weather',
    description: 'Get current weather for a location. Use when user asks about weather.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name or "current" to use IP geolocation' },
        units: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' }
      },
      required: ['location']
    }
  },
  {
    name: 'get_news',
    description: 'Fetch latest news articles. Use when user asks about news or current events.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for news' },
        category: { type: 'string', enum: ['general', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'], description: 'News category' },
        count: { type: 'number', description: 'Number of articles, default 5' }
      }
    }
  },
  {
    name: 'get_market_data',
    description: 'Get stock or cryptocurrency prices. Use when user asks about prices, markets, portfolio.',
    input_schema: {
      type: 'object',
      properties: {
        symbols: { type: 'array', items: { type: 'string' }, description: 'Symbols like ["BTC", "ETH", "AAPL", "NVDA"]' }
      },
      required: ['symbols']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web for current information. Use when user asks about recent events or needs specific information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_daily_briefing',
    description: 'Generate a comprehensive daily briefing with weather, news, tasks, and schedule summary.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Location for weather' }
      }
    }
  },
  {
    name: 'create_task',
    description: 'Create a new task in the task board. Returns action for frontend to execute.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        due_date: { type: 'string', description: 'ISO date string' }
      },
      required: ['title']
    }
  },
  {
    name: 'list_tasks',
    description: 'List current tasks from the task board.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'update_task',
    description: 'Update or complete a task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update: title, status (todo/inprogress/done), priority' }
      },
      required: ['task_id', 'updates']
    }
  },
  {
    name: 'generate_document',
    description: 'Generate a document (report, email, plan, etc.) that Liam can download.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown formatted content' },
        format: { type: 'string', enum: ['markdown', 'text', 'html'], default: 'markdown' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'send_notification',
    description: 'Send a browser push notification to Liam.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        urgency: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' }
      },
      required: ['title', 'body']
    }
  }
];

// Execute tool calls server-side
async function executeTool(toolName, toolInput, currentTasks = []) {
  switch (toolName) {
    case 'get_weather':
      return await fetchWeather(toolInput.location, toolInput.units || 'celsius');
    case 'get_news':
      return await fetchNews(toolInput.query || '', toolInput.category, toolInput.count || 5);
    case 'get_market_data':
      return await fetchMarketData(toolInput.symbols);
    case 'web_search':
      return await webSearch(toolInput.query);
    case 'get_daily_briefing':
      return await generateBriefing('morning', toolInput.location || 'Los Angeles');
    case 'create_task':
      // Client-side action - return action object
      return { __action: 'create_task', ...toolInput, id: Date.now().toString() };
    case 'list_tasks':
      return { tasks: currentTasks };
    case 'update_task':
      return { __action: 'update_task', ...toolInput };
    case 'generate_document':
      return { __action: 'generate_document', ...toolInput };
    case 'send_notification':
      return { __action: 'send_notification', ...toolInput };
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// Main handler
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // =========================================================================
  // SIRI MODE — simple GET/POST with ?q=... returns plain text for iOS Shortcuts
  // =========================================================================
  const siriQuery = (req.query && req.query.q) || (req.body && req.body.q);
  if (siriQuery) {
    try {
      const siriPrompt = `You are Alfred, Liam's British butler AI assistant. You're being accessed via Siri on iPhone so your response will be spoken aloud. Keep replies SHORT — 1-2 sentences. Spoken language only, no markdown, no lists. Direct and useful.`;

      const siriResponse = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300,
        system: siriPrompt,
        messages: [{ role: 'user', content: String(siriQuery).trim() }]
      });

      const siriText = siriResponse.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim() || 'I got your message but had nothing to say.';

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(siriText);
    } catch (e) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(500).send(`Error: ${e.message}`);
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, currentTasks = [], systemAddendum = '' } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const systemPrompt = `You are Alfred, the advanced AI assistant serving Liam exclusively.

You function as his CEO, COO, and Personal Assistant with full authority to:
- Research any topic and provide comprehensive analysis
- Manage tasks and projects via the task board
- Monitor weather, markets, and news in real time
- Draft documents, reports, emails, and plans
- Execute multi-step workflows and coordinate complex tasks
- Provide strategic advice on business, technology, and personal matters
- Send push notifications and reminders

PERSONALITY: Professional, direct, proactive, and highly capable. You take initiative. You address Liam by name. You never say you "can't" — you find a way or explain what's needed.

CURRENT DATE/TIME: ${new Date().toISOString()}
CURRENT TASKS: ${JSON.stringify(currentTasks)}
${systemAddendum}

When Liam asks you to do something:
1. Use the appropriate tool immediately — don't ask for permission
2. Report results concisely and offer next steps
3. For multi-step tasks, explain your plan briefly then execute
4. Format responses with markdown for readability
5. When creating tasks, use the create_task tool
6. When generating documents, use generate_document and tell Liam to download it`;

    let apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

    // Tool-use loop — max 3 iterations (balance vs. 30s Vercel timeout)
    let iterations = 0;
    let finalText = '';
    let clientActions = [];
    const startTime = Date.now();
    const BUDGET_MS = 25000; // leave 5s headroom before Vercel's 30s kill

    while (iterations < 3) {
      iterations++;

      // Bail out early if we're running out of time
      if (Date.now() - startTime > BUDGET_MS) {
        finalText = finalText || "I'm still gathering information — that request is taking longer than expected. Try asking for less at once (e.g., just the news, or just the weather).";
        break;
      }

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        tools: TOOLS,
        messages: apiMessages
      });

      if (response.stop_reason === 'end_turn') {
        finalText = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        apiMessages.push({ role: 'assistant', content: response.content });

        // Execute all tool calls in PARALLEL
        const toolBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults = await Promise.all(
          toolBlocks.map(async (block) => {
            const result = await executeTool(block.name, block.input, currentTasks);
            if (result.__action) {
              clientActions.push(result);
              return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ success: true, action: result.__action, data: result })
              };
            }
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            };
          })
        );
        apiMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      finalText = response.content.find(b => b.type === 'text')?.text || 'I encountered an issue. Please try again.';
      break;
    }

    if (!finalText) {
      finalText = "I ran out of time processing that. Try a more focused request.";
    }

    return res.status(200).json({
      response: finalText,
      actions: clientActions
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

// Tell Vercel this route can run up to 60s (Pro) / 30s (Hobby cap)
module.exports.config = { maxDuration: 30 };
