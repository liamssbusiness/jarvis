// Vercel serverless function
// Web search endpoint using Gemini with Google Search grounding
// Falls back to DuckDuckGo instant answers if grounding fails

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q = '' } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  const geminiKey = process.env.GEMINI_API_KEY;

  try {
    // Use Gemini with Google Search grounding for reliable results
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Search the web for: ${q}\n\nReturn the top 5 most relevant results. For each result provide: title, URL, and a 1-2 sentence summary. Format as JSON array: [{"title":"...","url":"...","snippet":"..."}]` }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );
    const data = await response.json();

    // Extract grounding metadata (search results)
    const candidate = data.candidates?.[0];
    const groundingMeta = candidate?.groundingMetadata;
    const searchResults = groundingMeta?.searchEntryPoint?.renderedContent
      || groundingMeta?.groundingChunks?.map(c => ({
        title: c.web?.title || '',
        url: c.web?.uri || '',
        snippet: ''
      })) || [];

    // Also get the text response as a summary
    const textResponse = candidate?.content?.parts?.[0]?.text || '';

    // Try to parse JSON from response
    let parsedResults = searchResults;
    if (!parsedResults.length) {
      try {
        const jsonMatch = textResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) parsedResults = JSON.parse(jsonMatch[0]);
      } catch {}
    }

    // Fallback: DuckDuckGo if Gemini grounding fails
    if (!parsedResults.length) {
      const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`);
      const ddgData = await ddgRes.json();
      if (ddgData.AbstractText) parsedResults.push({ title: ddgData.Heading, snippet: ddgData.AbstractText, url: ddgData.AbstractURL });
      (ddgData.RelatedTopics || []).slice(0, 5).forEach(t => {
        if (t.Text) parsedResults.push({ title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL });
      });
    }

    res.status(200).json({
      query: q,
      results: parsedResults.slice(0, 6),
      summary: textResponse.substring(0, 500)
    });
  } catch (e) {
    res.status(500).json({ error: e.message, results: [] });
  }
};
