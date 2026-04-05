// Vercel serverless function
// Standalone daily briefing endpoint — combines weather + news + time
// Requires NEWS_API_KEY environment variable

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { location = 'London' } = req.query;

  try {
    // Step 1: Geocode the location
    let lat = 51.5074;
    let lon = -0.1278;

    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData.results?.[0]) {
        lat = geoData.results[0].latitude;
        lon = geoData.results[0].longitude;
      }
    }

    // Step 2: Fetch weather and news in parallel
    const [weatherRes, newsRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,apparent_temperature&wind_speed_unit=kmh`
      ),
      fetch(
        `https://newsapi.org/v2/top-headlines?category=general&pageSize=4&country=us&apiKey=${process.env.NEWS_API_KEY}`
      )
    ]);

    const weatherData = weatherRes.ok ? await weatherRes.json() : null;
    const newsData = newsRes.ok ? await newsRes.json() : null;

    // Weather code to condition label
    const codes = {
      0: 'Clear',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Freezing fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      61: 'Light rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      71: 'Light snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      80: 'Showers',
      81: 'Moderate showers',
      82: 'Violent showers',
      95: 'Thunderstorm'
    };

    const w = weatherData?.current;
    const now = new Date();

    const weather = w
      ? {
          temperature: Math.round(w.temperature_2m),
          feels_like: Math.round(w.apparent_temperature),
          condition: codes[w.weather_code] || 'Unknown',
          humidity: w.relative_humidity_2m,
          wind_speed: Math.round(w.wind_speed_10m),
          unit: 'C'
        }
      : null;

    const headlines = (newsData?.articles || []).slice(0, 4).map(a => ({
      title: a.title?.replace(/ - [^-]+$/, ''),
      source: a.source?.name,
      url: a.url,
      publishedAt: a.publishedAt
    }));

    res.status(200).json({
      date: now.toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      location,
      weather,
      headlines,
      timestamp: now.toISOString()
    });
  } catch (e) {
    console.error('Briefing API error:', e);
    res.status(500).json({ error: e.message });
  }
};
