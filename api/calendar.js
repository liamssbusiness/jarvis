// api/calendar.js — Google Calendar integration for Alfred
'use strict';

const { getAccessToken } = require('./gmail.js');

// List upcoming calendar events
async function listCalendarEvents({ maxResults = 10, daysAhead = 7, calendarId = 'primary' } = {}) {
  try {
    const accessToken = await getAccessToken();
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?maxResults=${maxResults}` +
      `&timeMin=${encodeURIComponent(timeMin)}` +
      `&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true` +
      `&orderBy=startTime`;

    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    return (data.items || []).map(e => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location,
      description: e.description,
      attendees: (e.attendees || []).map(a => ({ email: a.email, responseStatus: a.responseStatus }))
    }));
  } catch (_e) {
    return [];
  }
}

// Get upcoming events formatted as readable string for briefing
async function getUpcomingEvents(hoursAhead = 24) {
  const daysAhead = hoursAhead / 24;
  const events = await listCalendarEvents({ maxResults: 20, daysAhead });

  if (events.length === 0) return 'No events scheduled.';

  return events.map(e => {
    const start = e.start ? new Date(e.start) : null;
    const timeStr = start
      ? start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
      : 'all day';
    return `- ${timeStr}: ${e.summary || '(no title)'}`;
  }).join('\n');
}

// Create a calendar event (approval-gated — caller must have gotten user approval)
async function createCalendarEvent({ summary, start, end, description = '', location = '', attendees = [] }) {
  try {
    const accessToken = await getAccessToken();

    const eventBody = {
      summary,
      description,
      location,
      start: { dateTime: start, timeZone: 'America/Los_Angeles' },
      end: { dateTime: end, timeZone: 'America/Los_Angeles' },
      attendees: attendees.map(a => (typeof a === 'string' ? { email: a } : a))
    };

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventBody)
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    return { id: data.id, htmlLink: data.htmlLink, success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Delete a calendar event (approval-gated)
async function deleteCalendarEvent(eventId, calendarId = 'primary') {
  try {
    const accessToken = await getAccessToken();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    return { success: res.status === 204 || res.status === 200 };
  } catch (_e) {
    return { success: false };
  }
}

// Vercel handler for dashboard compatibility
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://cyber-jarvis.vercel.app');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action || req.body?.action;
  try {
    if (action === 'list') {
      const events = await listCalendarEvents(req.body || {});
      return res.status(200).json({ events });
    }
    if (action === 'upcoming') {
      const text = await getUpcomingEvents(req.body?.hoursAhead || 24);
      return res.status(200).json({ text });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

module.exports = handler;
module.exports.listCalendarEvents = listCalendarEvents;
module.exports.getUpcomingEvents = getUpcomingEvents;
module.exports.createCalendarEvent = createCalendarEvent;
module.exports.deleteCalendarEvent = deleteCalendarEvent;
