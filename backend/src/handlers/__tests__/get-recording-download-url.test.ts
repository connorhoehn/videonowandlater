/**
 * Tests for get-recording-download-url Lambda handler
 * GET /sessions/{sessionId}/recording/download
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-recording-download-url';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionStatus, SessionType } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;

describe('get-recording-download-url handler', () => {
  const TABLE_NAME = 'test-table';
  const BUCKET = 'test-transcription-bucket';

  const availableSession: Session = {
    sessionId: 'session-avail',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-10T10:00:00Z',
    version: 3,
    claimedResources: { chatRoom: 'room-1' },
    recordingStatus: 'available' as any,
    convertStatus: 'available',
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.TRANSCRIPTION_BUCKET = BUCKET;
    process.env.AWS_REGION = 'us-east-1';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(
    sessionId: string | undefined,
    claims?: Record<string, any>,
  ): APIGatewayProxyEvent {
    return {
      pathParameters: sessionId ? { sessionId } : null,
      requestContext: {
        authorizer: claims ? { claims } : undefined,
      },
      headers: {},
      httpMethod: 'GET',
    } as any;
  }

  test('returns 400 when sessionId missing', async () => {
    const result = await handler(createEvent(undefined, { 'cognito:username': 'user-owner' }));
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const result = await handler(createEvent('missing', { 'cognito:username': 'user-owner' }));
    expect(result.statusCode).toBe(404);
  });

  test('returns 404 when recording is not yet available', async () => {
    mockGetSessionById.mockResolvedValueOnce({
      ...availableSession,
      recordingStatus: 'processing' as any,
      convertStatus: 'processing',
    });
    const result = await handler(createEvent('session-avail', { 'cognito:username': 'user-owner' }));
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toMatch(/not available/i);
  });

  test('owner gets a signed URL with ~15-min expiry', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...availableSession, isPrivate: true });

    const before = Date.now();
    const result = await handler(
      createEvent('session-avail', { 'cognito:username': 'user-owner' }),
    );
    const after = Date.now();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(typeof body.url).toBe('string');
    expect(body.url.length).toBeGreaterThan(0);

    const expiresAtMs = Date.parse(body.expiresAt);
    expect(Number.isNaN(expiresAtMs)).toBe(false);
    // Should be ~15 min in the future (allow ±5s for test jitter)
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 5000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 5000);
  });

  test('non-owner is forbidden on private session', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...availableSession, isPrivate: true });

    const result = await handler(
      createEvent('session-avail', { 'cognito:username': 'someone-else' }),
    );

    expect(result.statusCode).toBe(403);
  });

  test('any authenticated user can download a public (not isPrivate) session', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...availableSession, isPrivate: false });

    const result = await handler(
      createEvent('session-avail', { 'cognito:username': 'random-viewer' }),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(typeof body.url).toBe('string');
  });

  test('admin caller can download a private session owned by someone else', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...availableSession, isPrivate: true });

    const result = await handler(
      createEvent('session-avail', {
        'cognito:username': 'admin-user',
        'cognito:groups': 'admin',
      }),
    );

    expect(result.statusCode).toBe(200);
  });
});
