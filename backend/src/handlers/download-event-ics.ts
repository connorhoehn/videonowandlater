/**
 * GET /sessions/{sessionId}/ics
 *
 * Phase 5: scheduled sessions. Returns a text/calendar ICS file with a single
 * VEVENT so users can add an event to their calendar. Public if the session
 * is public; owner-only for private sessions.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

/** Format a JS Date into an iCalendar UTC date-time string (e.g. 20260418T141530Z). */
function formatIcsDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** Escape per RFC 5545 §3.3.11: commas, semicolons, backslashes, newlines. */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    return { statusCode: 500, headers: CORS, body: 'TABLE_NAME not set' };
  }

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return { statusCode: 400, headers: CORS, body: 'sessionId required' };
  }

  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return { statusCode: 404, headers: CORS, body: 'Session not found' };
  }

  if (!session.scheduledFor) {
    return { statusCode: 400, headers: CORS, body: 'Session is not scheduled' };
  }

  // Private sessions are owner-only
  const caller = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (session.isPrivate && session.userId !== caller) {
    return { statusCode: 403, headers: CORS, body: 'Private session' };
  }

  const dtStart = formatIcsDate(session.scheduledFor);
  const endIso = session.scheduledEndsAt
    ?? new Date(new Date(session.scheduledFor).getTime() + 60 * 60 * 1000).toISOString();
  const dtEnd = formatIcsDate(endIso);
  const dtStamp = formatIcsDate(new Date().toISOString());

  const title = escapeIcsText(session.title ?? 'Video Session');
  const description = escapeIcsText(session.description ?? '');

  // RFC 5545-compatible VCALENDAR with a single VEVENT. CRLF line endings required.
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VideoNowAndLater//Scheduled Session//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${session.sessionId}@videonowandlater`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    description ? `DESCRIPTION:${description}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="event-${session.sessionId}.ics"`,
    },
    body: ics,
  };
};
