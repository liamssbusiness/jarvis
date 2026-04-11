// api/briefing.js — Alfred's morning and evening brief generator
'use strict';

const { fetchWeather } = require('./weather.js');
const { fetchNews } = require('./news.js');
const { fetchMarketData } = require('./stocks.js');
const { getUnreadSummary } = require('./gmail.js');
const { getUpcomingEvents } = require('./calendar.js');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generates Alfred's morning or evening briefing by fetching all data sources
 * in parallel. Uses Promise.allSettled so a single failing source never breaks
 * the full brief.
 *
 * @param {'morning'|'evening'} type  - Which brief to generate
 * @param {string}              location - City name for weather lookup
 * @returns {{ briefingText: string, components: object }}
 */
async function generateBriefing(type = 'morning', location = 'Los Angeles') {
  const isMorning = type !== 'evening';
  const dayOfWeek = DAYS[new Date().getDay()];

  // Fetch all sources concurrently — failures are isolated
  const [weatherResult, newsResult, calendarResult, emailResult, marketsResult] =
    await Promise.allSettled([
      fetchWeather(location, 'fahrenheit'),
      fetchNews('', 'general', 4),
      getUpcomingEvents(isMorning ? 16 : 8),
      getUnreadSummary(3),
      fetchMarketData(['BTC', 'ETH', 'NVDA', 'AAPL']),
    ]);

  // Safely unwrap each settled result
  const weather   = weatherResult.status   === 'fulfilled' ? weatherResult.value   : null;
  const newsItems = newsResult.status      === 'fulfilled' ? newsResult.value       : null;
  const calendar  = calendarResult.status  === 'fulfilled' ? calendarResult.value   : null;
  const email     = emailResult.status     === 'fulfilled' ? emailResult.value      : null;
  const markets   = marketsResult.status   === 'fulfilled' ? marketsResult.value    : null;

  const lines = [];

  // Opening salutation
  if (isMorning) {
    lines.push(`Good morning, sir. Here is your brief for ${dayOfWeek}.`);
  } else {
    lines.push(`Good evening, sir. Here is a recap of the day.`);
  }

  // Weather line
  if (weather && weather.temp != null && weather.condition) {
    lines.push(
      `It is currently ${Math.round(weather.temp)}°F and ${weather.condition} in ${location}.`
    );
  }

  // Calendar line
  const eventsStr = typeof calendar === 'string'
    ? calendar.trim()
    : Array.isArray(calendar)
      ? calendar.slice(0, 3).join('; ')
      : null;

  if (eventsStr) {
    lines.push(`Your schedule: ${eventsStr}`);
  }

  // Email line
  const unreadCount = email && email.count != null ? email.count : null;
  const subjects    = email && email.subjects
    ? (Array.isArray(email.subjects) ? email.subjects.join(', ') : email.subjects)
    : null;

  if (unreadCount > 0) {
    if (subjects) {
      lines.push(`You have ${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}, including: ${subjects}`);
    } else {
      lines.push(`You have ${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}.`);
    }
  }

  // Top 2 news headlines (title only, no URLs)
  if (Array.isArray(newsItems) && newsItems.length > 0) {
    const top2 = newsItems
      .slice(0, 2)
      .map(item => (item.title || item.headline || '').replace(/ - [^-]+$/, '').trim())
      .filter(Boolean);

    if (top2.length > 0) {
      lines.push(`In the news: ${top2.join(' Also, ')}`);
    }
  }

  // Market prices — BTC first, then first available stock
  if (markets && typeof markets === 'object') {
    const btc = markets['BTC'];
    const stock = markets['NVDA'] || markets['AAPL'] || markets['ETH'];

    const mParts = [];
    if (btc != null) {
      mParts.push(`Bitcoin is at $${Number(btc).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    }
    if (stock != null) {
      const stockTicker = markets['NVDA'] ? 'NVDA' : markets['AAPL'] ? 'AAPL' : 'ETH';
      mParts.push(`${stockTicker} at $${Number(stock).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    }
    if (mParts.length > 0) {
      lines.push(`Markets: ${mParts.join(', ')}.`);
    }
  }

  // Closing line
  if (isMorning) {
    lines.push(`Shall I elaborate on anything, sir?`);
  } else {
    let nextEvent = 'nothing scheduled';
    if (Array.isArray(calendar) && calendar.length > 0) {
      nextEvent = calendar[0];
    } else if (typeof calendar === 'string' && calendar.trim()) {
      nextEvent = calendar.trim().split(/[;,\n]/)[0].trim();
    }
    lines.push(`Rest well, sir. Tomorrow's first event: ${nextEvent}.`);
  }

  // Assemble and trim to stay under 1500 characters
  let briefingText = lines.join(' ');
  if (briefingText.length > 1500) {
    briefingText = briefingText.slice(0, 1497) + '...';
  }

  return {
    briefingText,
    components: {
      weather,
      calendar,
      email,
      news: newsItems,
      markets,
    },
  };
}

/**
 * Vercel handler — GET or POST
 * Query/body params: type (morning|evening), location (city string)
 */
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query  = req.query  || {};
  const body   = req.body   || {};

  const type     = query.type     || body.type     || 'morning';
  const location = query.location || body.location || 'Los Angeles';

  try {
    const result = await generateBriefing(type, location);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[briefing] handler error:', err);
    return res.status(500).json({ error: 'Failed to generate briefing', details: err.message });
  }
}

module.exports = handler;
module.exports.generateBriefing = generateBriefing;
