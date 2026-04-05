// Vercel serverless function - Node.js
// Uses Anthropic SDK for Claude claude-sonnet-4-6
// Implements full tool-use loop: Claude calls tools, we execute, feed results back, loop until text response

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
      return await getDailyBriefing(toolInput.location, currentTasks);
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

async function fetchWeather(location, units) {
  try {
    // Geocode location
    let lat, lon;
    if (location === 'current' || !location) {
      // Default to London if no geolocation
      lat = 51.5074; lon = -0.1278;
    } else {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
      const geoData = await geoRes.json();
      if (geoData.results && geoData.results[0]) {
        lat = geoData.results[0].latitude;
        lon = geoData.results[0].longitude;
      } else {
        lat = 51.5074; lon = -0.1278;
      }
    }
    const tempUnit = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=${tempUnit}`
    );
    const data = await weatherRes.json();
    const current = data.current;
    const conditions = {
      0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Freezing Fog', 51: 'Light Drizzle', 61: 'Light Rain',
      63: 'Moderate Rain', 65: 'Heavy Rain', 71: 'Light Snow', 73: 'Moderate Snow',
      80: 'Showers', 95: 'Thunderstorm'
    };
    return {
      temperature: Math.round(current.temperature_2m),
      unit: tempUnit === 'celsius' ? 'C' : 'F',
      condition: conditions[current.weather_code] || 'Unknown',
      humidity: current.relative_humidity_2m,
      wind_speed: Math.round(current.wind_speed_10m),
      location: location
    };
  } catch (e) {
    return { error: 'Weather fetch failed', message: e.message };
  }
}

async function fetchNews(query, category, count) {
  try {
    const apiKey = process.env.NEWS_API_KEY;
    let url;
    if (query) {
      url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=${count}&sortBy=publishedAt&apiKey=${apiKey}`;
    } else {
      url = `https://newsapi.org/v2/top-headlines?category=${category || 'general'}&pageSize=${count}&country=us&apiKey=${apiKey}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    return {
      articles: (data.articles || []).slice(0, count).map(a => ({
        title: a.title,
        description: a.description,
        source: a.source?.name,
        url: a.url,
        publishedAt: a.publishedAt
      }))
    };
  } catch (e) {
    return { error: 'News fetch failed', articles: [] };
  }
}

async function fetchMarketData(symbols) {
  try {
    const results = {};
    // Crypto via CoinGecko (free, no key)
    const cryptoMap = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'DOGE': 'dogecoin',
      'ADA': 'cardano', 'MATIC': 'matic-network', 'LINK': 'chainlink', 'DOT': 'polkadot',
      'AVAX': 'avalanche-2', 'UNI': 'uniswap'
    };
    const cryptoSymbols = symbols.filter(s => cryptoMap[s.toUpperCase()]);
    const stockSymbols = symbols.filter(s => !cryptoMap[s.toUpperCase()]);

    if (cryptoSymbols.length > 0) {
      const ids = cryptoSymbols.map(s => cryptoMap[s.toUpperCase()]).join(',');
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
      const data = await res.json();
      cryptoSymbols.forEach(s => {
        const id = cryptoMap[s.toUpperCase()];
        if (data[id]) {
          results[s.toUpperCase()] = {
            price: data[id].usd,
            change24h: data[id].usd_24h_change?.toFixed(2),
            type: 'crypto'
          };
        }
      });
    }

    if (stockSymbols.length > 0) {
      // Yahoo Finance unofficial API
      for (const sym of stockSymbols) {
        try {
          const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`);
          const data = await res.json();
          const result = data?.chart?.result?.[0];
          if (result) {
            const prices = result.indicators?.quote?.[0]?.close || [];
            const price = prices[prices.length - 1];
            const prevPrice = prices[prices.length - 2] || price;
            const change = ((price - prevPrice) / prevPrice * 100).toFixed(2);
            results[sym.toUpperCase()] = { price: price?.toFixed(2), change24h: change, type: 'stock' };
          }
        } catch (_err) {
          // Skip individual symbol failures silently
        }
      }
    }
    return { prices: results };
  } catch (e) {
    return { error: 'Market data fetch failed', prices: {} };
  }
}

async function webSearch(query) {
  try {
    // DuckDuckGo instant answers API (free, no key)
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'JARVIS/2.0' } }
    );
    const data = await res.json();
    const results = [];
    if (data.AbstractText) {
      results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
    }
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 4).forEach(t => {
        if (t.Text) results.push({ title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL });
      });
    }
    return { query, results: results.slice(0, 5), note: 'Results from DuckDuckGo instant answers' };
  } catch (e) {
    return { error: 'Search failed', results: [] };
  }
}

async function getDailyBriefing(location, tasks) {
  const weather = await fetchWeather(location || 'London', 'celsius');
  const news = await fetchNews('', 'general', 4);
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const pendingTasks = tasks?.filter(t => t.status !== 'done') || [];
  return {
    date,
    weather,
    top_news: news.articles,
    pending_tasks: pendingTasks.length,
    tasks_summary: pendingTasks.slice(0, 3).map(t => t.title)
  };
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, currentTasks = [], systemAddendum = '' } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const systemPrompt = `You are J.A.R.V.I.S (Just A Rather Very Intelligent System), the advanced AI assistant serving Liam exclusively.

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

    // Tool-use loop — max 5 iterations
    let iterations = 0;
    let finalText = '';
    let clientActions = [];

    while (iterations < 5) {
      iterations++;
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages: apiMessages
      });

      if (response.stop_reason === 'end_turn') {
        // Extract text content
        finalText = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        // Add assistant's response to messages
        apiMessages.push({ role: 'assistant', content: response.content });

        // Execute all tool calls
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const result = await executeTool(block.name, block.input, currentTasks);

          // Check if it's a client-side action
          if (result.__action) {
            clientActions.push(result);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ success: true, action: result.__action, data: result })
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            });
          }
        }
        apiMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop reason — extract any available text
      finalText = response.content.find(b => b.type === 'text')?.text || 'I encountered an issue. Please try again.';
      break;
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
