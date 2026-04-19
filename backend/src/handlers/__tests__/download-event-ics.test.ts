/**
 * Tests for download-event-ics Lambda handler
 * GET /sessions/{sessionId}/ics — returns a VCALENDAR text/calendar body
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../download-event-ics';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;

describe('download-event-ics handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';

  const scheduledSession: Session = {
    sessionId: SESSION_ID,
    userId: 'host',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.SCHEDULED,
    claimedResources: { chatRoom: '' },
    createdAt: '2026-04-18T10:00:00Z',
    version: 1,
    scheduledFor: '2026-04-18T20:00:00Z',
    scheduledEndsAt: '2026-04-18T21:00:00Z',
    title: 'Sample, Event; with \\ specials',
    description: 'Line 1\nLine 2',
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(opts: { sessionId?: string | null } = {}): APIGatewayProxyEvent {
    return {
      pathParameters: opts.sessionId !== null ? { sessionId: opts.sessionId ?? SESSION_ID } : {},
      requestContext: {},
    } as any;
  }

  const mockCtx = {} as any;
  const mockCb = (() => {}) as any;

  test('returns 404 when session is missing', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const result = await handler(createEvent(), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(404);
  });

  test('returns 400 when session has no scheduledFor', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...scheduledSession, scheduledFor: undefined });
    const result = await handler(createEvent(), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns valid VCALENDAR with required VEVENT fields', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    const result = await handler(createEvent(), mockCtx, mockCb) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Type']).toMatch(/text\/calendar/);
    expect(result.headers?.['Content-Disposition']).toMatch(/attachment/);

    const ics = result.body;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain(`UID:${SESSION_ID}@videonowandlater`);
    expect(ics).toContain('DTSTART:20260418T200000Z');
    expect(ics).toContain('DTEND:20260418T210000Z');

    // Commas and semicolons must be escaped; backslash too
    expect(ics).toMatch(/SUMMARY:Sample\\,\s?Event\\;/);
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');

    // CRLF line endings
    expect(ics).toContain('\r\n');
  });

  test('defaults DTEND to scheduledFor + 1h when scheduledEndsAt is absent', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...scheduledSession, scheduledEndsAt: undefined });
    const result = await handler(createEvent(), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('DTEND:20260418T210000Z');
  });

  test('returns 403 on private session for non-owner', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...scheduledSession, isPrivate: true });
    const event = createEvent();
    (event.requestContext as any).authorizer = { claims: { 'cognito:username': 'someone-else' } };
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });
});
