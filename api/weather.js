// Vercel serverless function
// Standalone weather endpoint for widget polling
// Uses Open-Meteo API (free, no key required)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { lat = '51.5074', lon = '-0.1278', units = 'celsius' } = req.query;

  // Validate coordinates are numeric
  const parsedLat = parseFloat(lat);
  const parsedLon = parseFloat(lon);
  if (isNaN(parsedLat) || isNaN(parsedLon)) {
    return res.status(400).json({ error: 'Invalid lat/lon parameters' });
  }

  const tempUnit = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${parsedLat}&longitude=${parsedLon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&temperature_unit=${tempUnit}&wind_speed_unit=kmh`
    );

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;

    const codes = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      71: 'Slight snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      80: 'Slight showers',
      81: 'Moderate showers',
      82: 'Violent showers',
      95: 'Thunderstorm'
    };

    const icons = {
      0: '☀️',
      1: '🌤',
      2: '⛅',
      3: '☁️',
      45: '🌫',
      48: '🌫',
      51: '🌦',
      53: '🌦',
      55: '🌧',
      61: '🌧',
      63: '🌧',
      65: '⛈',
      71: '🌨',
      73: '❄️',
      75: '❄️',
      80: '🌦',
      81: '🌧',
      82: '⛈',
      95: '⛈'
    };

    const code = current.weather_code;

    res.status(200).json({
      temperature: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
      wind_speed: Math.round(current.wind_speed_10m),
      condition: codes[code] || 'Unknown',
      icon: icons[code] || '🌡',
      unit: tempUnit === 'fahrenheit' ? 'F' : 'C',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('Weather API error:', e);
    res.status(500).json({ error: e.message });
  }
};
