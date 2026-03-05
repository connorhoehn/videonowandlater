/**
 * Tests for get-session Lambda handler
 * Validates extended session response includes recording fields
 */

import { handler } from '../get-session';
import * as sessionService from '../../services/session-service';
import { SessionType, SessionStatus, RecordingStatus } from '../../domain/session';
import type { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('../../services/session-service');

const mockGetSession = sessionService.getSession as jest.MockedFunction<typeof sessionService.getSession>;

describe('get-session handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc-123';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(sessionId: string | null): APIGatewayProxyEvent {
    return {
      pathParameters: sessionId ? { sessionId } : null,
      requestContext: {},
    } as any;
  }

  test('returns 400 when sessionId path parameter is missing', async () => {
    const result = await handler(createEvent(null), {} as any, () => {}) as any;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/sessionId/i);
  });

  test('returns 404 when session does not exist', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const result = await handler(createEvent(SESSION_ID), {} as any, () => {}) as any;
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toMatch(/not found/i);
  });

  test('returns 200 with extended session fields including recording metadata', async () => {
    const mockSession = {
      sessionId: SESSION_ID,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      userId: 'broadcaster-user',
      createdAt: '2026-03-04T10:00:00Z',
      startedAt: '2026-03-04T10:01:00Z',
      endedAt: '2026-03-04T10:30:00Z',
      recordingHlsUrl: 'https://cdn.example.com/recordings/session-abc-123/playlist.m3u8',
      recordingDuration: 1740000,
      thumbnailUrl: 'https://cdn.example.com/thumbnails/session-abc-123.jpg',
      recordingStatus: RecordingStatus.AVAILABLE,
    };

    mockGetSession.mockResolvedValueOnce(mockSession);

    const result = await handler(createEvent(SESSION_ID), {} as any, () => {}) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);

    // Required recording fields
    expect(body.recordingHlsUrl).toBe(mockSession.recordingHlsUrl);
    expect(body.recordingDuration).toBe(mockSession.recordingDuration);
    expect(body.recordingStatus).toBe(RecordingStatus.AVAILABLE);
    expect(body.thumbnailUrl).toBe(mockSession.thumbnailUrl);

    // Required metadata fields
    expect(body.userId).toBe(mockSession.userId);
    expect(body.createdAt).toBe(mockSession.createdAt);
    expect(body.endedAt).toBe(mockSession.endedAt);
    expect(body.sessionType).toBe(SessionType.BROADCAST);
    expect(body.status).toBe(SessionStatus.ENDED);

    // Security: ARNs must NOT be present
    expect(body.claimedResources).toBeUndefined();
    expect(body.recordingS3Path).toBeUndefined();
    expect(body.version).toBeUndefined();
  });
});
