// Vercel serverless function
// Standalone news endpoint for widget polling
// Requires NEWS_API_KEY environment variable (newsapi.org)

async function fetchNews(query = '', category = 'general', count = 5) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) throw new Error('NEWS_API_KEY environment variable is not set');

  const validCategories = ['general', 'technology', 'business', 'science', 'health', 'sports', 'entertainment'];
  const safeCategory = validCategories.includes(category) ? category : 'general';
  const safePageSize = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);

  let url;
  if (query) {
    url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=${safePageSize}&sortBy=publishedAt&language=en&apiKey=${apiKey}`;
  } else {
    url = `https://newsapi.org/v2/top-headlines?category=${safeCategory}&pageSize=${safePageSize}&country=us&apiKey=${apiKey}`;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`NewsAPI error: ${response.status}`);

  const data = await response.json();
  if (data.status === 'error') throw new Error(data.message || 'NewsAPI returned an error');

  return {
    totalResults: data.totalResults || 0,
    articles: (data.articles || []).map(a => ({
      title: a.title?.replace(/ - [^-]+$/, ''),
      description: a.description,
      source: a.source?.name,
      url: a.url,
      urlToImage: a.urlToImage,
      publishedAt: a.publishedAt
    }))
  };
}

const handler = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q = '', category = 'general', pageSize = '5' } = req.query;

  if (!process.env.NEWS_API_KEY) {
    return res.status(500).json({ error: 'NEWS_API_KEY environment variable is not set', articles: [] });
  }

  try {
    const result = await fetchNews(q, category, pageSize);
    res.status(200).json(result);
  } catch (e) {
    console.error('News API error:', e);
    res.status(500).json({ error: e.message, articles: [] });
  }
};

module.exports = handler;
module.exports.fetchNews = fetchNews;
