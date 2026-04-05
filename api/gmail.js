// JARVIS Gmail API — Send/read emails via Google OAuth
// Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN env vars
// Set up OAuth following docs/GOOGLE_OAUTH_SETUP.md

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(503).json({
      error: 'Gmail not configured',
      setup_needed: true,
      instructions: 'Complete Google OAuth setup — see docs/GOOGLE_OAUTH_SETUP.md',
      steps: [
        '1. Create Google Cloud project at console.cloud.google.com',
        '2. Enable Gmail API',
        '3. Create OAuth credentials',
        '4. Get refresh token via /api/auth/google',
        '5. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to Vercel env vars'
      ]
    });
  }

  try {
    // Get fresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Failed to get access token');
    const accessToken = tokenData.access_token;

    const { action } = req.query;

    switch (action) {
      case 'send': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { to, subject, body: emailBody, html } = req.body;
        if (!to || !subject) return res.status(400).json({ error: 'to and subject required' });

        const boundary = 'jarvis_boundary_' + Date.now();
        const mimeContent = html
          ? [
              `Content-Type: multipart/alternative; boundary="${boundary}"`,
              '',
              `--${boundary}`,
              'Content-Type: text/plain; charset=UTF-8',
              '',
              emailBody || '',
              `--${boundary}`,
              'Content-Type: text/html; charset=UTF-8',
              '',
              html,
              `--${boundary}--`
            ].join('\r\n')
          : (emailBody || '');

        const rawEmail = [
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          html ? `Content-Type: multipart/alternative; boundary="${boundary}"` : 'Content-Type: text/plain; charset=UTF-8',
          '',
          html ? mimeContent : (emailBody || '')
        ].join('\r\n');

        const encodedEmail = Buffer.from(rawEmail)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ raw: encodedEmail })
        });
        const sendData = await sendRes.json();
        if (sendData.error) throw new Error(sendData.error.message);

        return res.status(200).json({ success: true, messageId: sendData.id, threadId: sendData.threadId });
      }

      case 'inbox': {
        const { maxResults = '10', q = '' } = req.query;
        const listRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? '&q=' + encodeURIComponent(q) : ''}`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const listData = await listRes.json();

        const messages = [];
        for (const msg of (listData.messages || []).slice(0, parseInt(maxResults))) {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          const msgData = await msgRes.json();
          const headers = msgData.payload?.headers || [];
          messages.push({
            id: msg.id,
            from: headers.find(h => h.name === 'From')?.value,
            subject: headers.find(h => h.name === 'Subject')?.value,
            date: headers.find(h => h.name === 'Date')?.value,
            snippet: msgData.snippet
          });
        }

        return res.status(200).json({ messages });
      }

      case 'read': {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'message id required' });
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const msgData = await msgRes.json();
        return res.status(200).json(msgData);
      }

      case 'profile': {
        const profRes = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/profile',
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const profData = await profRes.json();
        return res.status(200).json(profData);
      }

      // ========== GOOGLE CALENDAR ACTIONS ==========

      case 'calendars-list': {
        const calRes = await fetch(
          'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        const calData = await calRes.json();
        if (calData.error) throw new Error(calData.error.message);
        return res.status(200).json({
          calendars: (calData.items || []).map(c => ({
            id: c.id,
            summary: c.summary,
            description: c.description,
            primary: !!c.primary,
            accessRole: c.accessRole,
            timeZone: c.timeZone,
            backgroundColor: c.backgroundColor
          }))
        });
      }

      case 'calendar-list-events': {
        const days = parseInt(req.query.days || '7', 10);
        const calendarId = req.query.calendarId || 'primary';
        const maxResults = parseInt(req.query.maxResults || '50', 10);
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=${maxResults}`;
        const eventsRes = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const eventsData = await eventsRes.json();
        if (eventsData.error) throw new Error(eventsData.error.message);
        const events = (eventsData.items || []).map(e => ({
          id: e.id,
          summary: e.summary,
          description: e.description,
          location: e.location,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          attendees: (e.attendees || []).map(a => ({ email: a.email, responseStatus: a.responseStatus })),
          status: e.status,
          htmlLink: e.htmlLink,
          hangoutLink: e.hangoutLink
        }));
        return res.status(200).json({ count: events.length, events, days, calendarId });
      }

      case 'calendar-create-event': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { summary, description, start, end, attendees = [], location, calendarId = 'primary', timeZone } = req.body || {};
        if (!summary || !start || !end) return res.status(400).json({ error: 'summary, start, end required' });

        // Build start/end objects. If string includes 'T', treat as dateTime, else date.
        const startObj = start.includes('T') ? { dateTime: start, timeZone: timeZone || 'UTC' } : { date: start };
        const endObj = end.includes('T') ? { dateTime: end, timeZone: timeZone || 'UTC' } : { date: end };

        const eventBody = {
          summary,
          description,
          location,
          start: startObj,
          end: endObj,
          attendees: (attendees || []).map(a => typeof a === 'string' ? { email: a } : a)
        };

        const createRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(eventBody)
          }
        );
        const createData = await createRes.json();
        if (createData.error) throw new Error(createData.error.message);
        return res.status(200).json({
          success: true,
          id: createData.id,
          htmlLink: createData.htmlLink,
          summary: createData.summary,
          start: createData.start,
          end: createData.end
        });
      }

      case 'calendar-update-event': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { id, calendarId = 'primary', summary, description, start, end, attendees, location, timeZone } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });

        // Fetch existing then patch
        const patchBody = {};
        if (summary !== undefined) patchBody.summary = summary;
        if (description !== undefined) patchBody.description = description;
        if (location !== undefined) patchBody.location = location;
        if (start !== undefined) {
          patchBody.start = start.includes('T') ? { dateTime: start, timeZone: timeZone || 'UTC' } : { date: start };
        }
        if (end !== undefined) {
          patchBody.end = end.includes('T') ? { dateTime: end, timeZone: timeZone || 'UTC' } : { date: end };
        }
        if (attendees !== undefined) {
          patchBody.attendees = (attendees || []).map(a => typeof a === 'string' ? { email: a } : a);
        }

        const updateRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}?sendUpdates=all`,
          {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody)
          }
        );
        const updateData = await updateRes.json();
        if (updateData.error) throw new Error(updateData.error.message);
        return res.status(200).json({ success: true, id: updateData.id, htmlLink: updateData.htmlLink, summary: updateData.summary });
      }

      case 'calendar-delete-event': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { id, calendarId = 'primary' } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        const delRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}?sendUpdates=all`,
          { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        if (delRes.status !== 204 && delRes.status !== 200) {
          const errData = await delRes.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Delete failed (status ${delRes.status})`);
        }
        return res.status(200).json({ success: true, id, deleted: true });
      }

      case 'calendar-find-slots': {
        // Find free time slots in the next N days.
        // Body or query: days (default 7), durationMinutes (default 30), workingHours {start, end} (24h, default 9-17), timeZone
        const days = parseInt(req.query.days || (req.body && req.body.days) || '7', 10);
        const durationMinutes = parseInt(req.query.durationMinutes || (req.body && req.body.durationMinutes) || '30', 10);
        const calendarId = (req.body && req.body.calendarId) || req.query.calendarId || 'primary';
        const workingHours = (req.body && req.body.workingHours) || { start: 9, end: 17 };

        const timeMin = new Date();
        const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            items: [{ id: calendarId }]
          })
        });
        const fbData = await fbRes.json();
        if (fbData.error) throw new Error(fbData.error.message);
        const busy = (fbData.calendars?.[calendarId]?.busy || []).map(b => ({
          start: new Date(b.start).getTime(),
          end: new Date(b.end).getTime()
        }));

        // Walk day-by-day, hour window, and emit slots of durationMinutes that don't overlap busy
        const slots = [];
        const durationMs = durationMinutes * 60 * 1000;
        for (let d = 0; d < days; d++) {
          const dayStart = new Date(timeMin);
          dayStart.setDate(dayStart.getDate() + d);
          dayStart.setHours(workingHours.start, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setHours(workingHours.end, 0, 0, 0);
          let cursor = Math.max(dayStart.getTime(), Date.now());
          while (cursor + durationMs <= dayEnd.getTime()) {
            const slotStart = cursor;
            const slotEnd = cursor + durationMs;
            const overlaps = busy.some(b => slotStart < b.end && slotEnd > b.start);
            if (!overlaps) {
              slots.push({ start: new Date(slotStart).toISOString(), end: new Date(slotEnd).toISOString() });
              if (slots.length >= 20) break;
            }
            cursor += durationMs;
          }
          if (slots.length >= 20) break;
        }
        return res.status(200).json({ count: slots.length, slots, durationMinutes, days, workingHours });
      }

      default:
        return res.status(400).json({
          error: 'action required',
          available: ['send', 'inbox', 'read', 'profile', 'calendars-list', 'calendar-list-events', 'calendar-create-event', 'calendar-update-event', 'calendar-delete-event', 'calendar-find-slots'],
          examples: {
            send: 'POST /api/gmail?action=send body: {to, subject, body}',
            inbox: 'GET /api/gmail?action=inbox&maxResults=5',
            read: 'GET /api/gmail?action=read&id=messageId',
            'calendar-list-events': 'GET /api/gmail?action=calendar-list-events&days=7',
            'calendar-create-event': 'POST /api/gmail?action=calendar-create-event body: {summary, start, end, attendees[]}'
          }
        });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
