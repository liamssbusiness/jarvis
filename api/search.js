// Web search — DuckDuckGo primary + Gemini grounding when quota available
const GEMINI_KEYS = [process.env.GEMINI_API_KEY].filter(Boolean);
let gKeyIdx = 0;
function nextGeminiKey() { gKeyIdx = (gKeyIdx + 1) % GEMINI_KEYS.length; return GEMINI_KEYS[gKeyIdx]; }

async function webSearch(query) {
  if (!query) throw new Error('Query required');

  const results = [];
  let summary = '';

  // 1. DuckDuckGo instant answers (always works, no key)
  const ddgRes = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { 'User-Agent': 'JARVIS/2.0' } }
  );
  const ddg = await ddgRes.json();
  if (ddg.AbstractText) {
    results.push({ title: ddg.Heading, snippet: ddg.AbstractText, url: ddg.AbstractURL, type: 'summary' });
    summary = ddg.AbstractText;
  }
  (ddg.RelatedTopics || []).forEach(t => {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.split(' - ')[0]?.substring(0, 80), snippet: t.Text, url: t.FirstURL, type: 'related' });
    }
  });

  // 2. DuckDuckGo HTML search for richer results (scrape lite)
  if (results.length < 3) {
    try {
      const htmlRes = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JARVIS/2.0)' } }
      );
      const html = await htmlRes.text();
      const linkMatches = html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi);
      const snippetMatches = html.matchAll(/<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi);
      const links = [...linkMatches];
      const snippets = [...snippetMatches];
      for (let i = 0; i < Math.min(links.length, 5); i++) {
        const rawUrl = links[i]?.[1] || '';
        const title = (links[i]?.[2] || '').replace(/<[^>]+>/g, '').trim();
        const snip = (snippets[i]?.[1] || '').replace(/<[^>]+>/g, '').trim();
        // DuckDuckGo wraps URLs in redirects — extract actual URL
        const urlMatch = rawUrl.match(/uddg=([^&]+)/);
        const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
        if (title && url) {
          results.push({ title, snippet: snip, url, type: 'web' });
        }
      }
    } catch {}
  }

  // 3. Try Gemini grounding if we have quota (non-blocking — if it fails, we already have results)
  let geminiKey = GEMINI_KEYS[gKeyIdx];
  if (geminiKey && results.length < 4) {
    try {
      const gRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: query }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
          })
        }
      );
      const gData = await gRes.json();
      const chunks = gData.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      chunks.forEach(c => {
        if (c.web) results.push({ title: c.web.title || '', url: c.web.uri || '', snippet: '', type: 'grounded' });
      });
      const gText = gData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (gText && !summary) summary = gText.substring(0, 400);
    } catch {}
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = results.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return { query, results: unique.slice(0, 8), summary };
}

const handler = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q = '' } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const result = await webSearch(q);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, results: [] });
  }
};

module.exports = handler;
module.exports.webSearch = webSearch;
