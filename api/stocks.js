// Vercel serverless function
// Market data endpoint: crypto via CoinGecko (free), stocks via Yahoo Finance (unofficial)
// No API key required for either source

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols = 'BTC,ETH,AAPL,NVDA' } = req.query;
  const symList = symbols
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20); // cap at 20 symbols to avoid abuse

  const cryptoMap = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'DOGE': 'dogecoin',
    'ADA': 'cardano',
    'MATIC': 'matic-network',
    'LINK': 'chainlink',
    'DOT': 'polkadot',
    'AVAX': 'avalanche-2',
    'UNI': 'uniswap',
    'XRP': 'ripple',
    'BNB': 'binancecoin'
  };

  const results = {};
  const cryptoSyms = symList.filter(s => cryptoMap[s]);
  const stockSyms = symList.filter(s => !cryptoMap[s]);

  try {
    // Fetch crypto prices from CoinGecko
    if (cryptoSyms.length > 0) {
      const ids = cryptoSyms.map(s => cryptoMap[s]).join(',');
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
        { headers: { 'Accept': 'application/json' } }
      );

      if (response.ok) {
        const data = await response.json();
        cryptoSyms.forEach(s => {
          const id = cryptoMap[s];
          if (data[id]) {
            const price = data[id].usd;
            results[s] = {
              price: price >= 1000 ? price.toFixed(0) : price >= 1 ? price.toFixed(2) : price.toFixed(6),
              change: parseFloat(data[id].usd_24h_change || 0).toFixed(2),
              type: 'crypto',
              symbol: s
            };
          }
        });
      }
    }

    // Fetch stock prices from Yahoo Finance (unofficial chart API)
    for (const sym of stockSyms) {
      try {
        const response = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d&includePrePost=false`,
          { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
        );

        if (!response.ok) continue;

        const data = await response.json();
        const result = data?.chart?.result?.[0];

        if (result) {
          const closes = result.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
          const price = closes[closes.length - 1];
          const prev = closes[closes.length - 2] || price;

          if (price != null) {
            const change = prev ? ((price - prev) / prev * 100).toFixed(2) : '0.00';
            results[sym] = {
              price: price.toFixed(2),
              change,
              type: 'stock',
              symbol: sym
            };
          }
        }
      } catch (_err) {
        // Skip individual symbol failures silently
      }
    }

    res.status(200).json({
      prices: results,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Stocks API error:', e);
    res.status(500).json({ error: e.message, prices: {} });
  }
};
