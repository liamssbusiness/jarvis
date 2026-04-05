// Vercel serverless function
// Web search endpoint using DuckDuckGo instant answers API
// Free, no API key required

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q = '' } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required', results: [] });
  }

  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q.trim())}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'JARVIS/2.0' } }
    );

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    // Main abstract / summary result
    if (data.AbstractText) {
      results.push({
        title: data.Heading,
        snippet: data.AbstractText,
        url: data.AbstractURL,
        type: 'summary'
      });
    }

    // Answer (for calculations, conversions, etc.)
    if (data.Answer && !data.AbstractText) {
      results.push({
        title: 'Answer',
        snippet: data.Answer,
        url: '',
        type: 'answer'
      });
    }

    // Related topics
    (data.RelatedTopics || []).slice(0, 6).forEach(t => {
      if (t.Text && t.FirstURL) {
        results.push({
          title: t.Text.split(' - ')[0] || t.Text.substring(0, 60),
          snippet: t.Text,
          url: t.FirstURL,
          type: 'related'
        });
      }
    });

    res.status(200).json({
      query: q,
      results: results.slice(0, 6),
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Search API error:', e);
    res.status(500).json({ error: e.message, results: [] });
  }
};
