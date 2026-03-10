/**
 * Tests for get-speaker-segments handler
 * GET /sessions/{sessionId}/speaker-segments - retrieve speaker-attributed transcript segments
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-speaker-segments';
import { getSessionById } from '../../repositories/session-repository';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3');
jest.mock('../../repositories/session-repository');

const mockS3Client = S3Client as jest.Mocked<typeof S3Client>;
const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;

// Mock environment variables
process.env.TABLE_NAME = 'test-table';
process.env.TRANSCRIPTION_BUCKET = 'test-transcription-bucket';
process.env.AWS_REGION = 'us-east-1';

describe('get-speaker-segments handler', () => {
  const mockS3Send = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (mockS3Client as any).mockImplementation(() => ({
      send: mockS3Send,
    }));
  });

  const makeEvent = (sessionId?: string): APIGatewayProxyEvent => ({
    pathParameters: sessionId ? { sessionId } : null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/sessions/${sessionId}/speaker-segments`,
    requestContext: {} as any,
    resource: '',
    stageVariables: null,
    body: null,
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(makeEvent(undefined), {} as any, jest.fn());

    expect(result).toBeDefined();
    if (result) {
      expect(result.statusCode).toBe(400);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
      const body = JSON.parse(result.body);
      expect(body.error).toBeDefined();
    }
  });

  it('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(makeEvent('nonexistent-session'), {} as any, jest.fn());

    expect(result).toBeDefined();
    if (result) {
      expect(result.statusCode).toBe(404);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/not found/i);
    }
  });

  it('returns 404 when diarizedTranscriptS3Path is absent', async () => {
    mockGetSessionById.mockResolvedValueOnce({
      sessionId: 'session-no-diarized',
      userId: 'user1',
      sessionType: 'BROADCAST' as any,
      status: 'ended' as any,
      claimedResources: { chatRoom: 'chat1' },
      createdAt: '2026-03-10T00:00:00Z',
      version: 1,
      // diarizedTranscriptS3Path intentionally absent
    });

    const result = await handler(makeEvent('session-no-diarized'), {} as any, jest.fn());

    expect(result).toBeDefined();
    if (result) {
      expect(result.statusCode).toBe(404);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/speaker segments not available/i);
    }
  });

  it('returns 200 with parsed SpeakerSegment array on success', async () => {
    const segments = [
      { speaker: 'Speaker 1', startTime: 0, endTime: 1000, text: 'Hello world.' },
      { speaker: 'Speaker 2', startTime: 2000, endTime: 3000, text: 'How are you?' },
    ];

    mockGetSessionById.mockResolvedValueOnce({
      sessionId: 'session-with-segments',
      userId: 'user1',
      sessionType: 'BROADCAST' as any,
      status: 'ended' as any,
      claimedResources: { chatRoom: 'chat1' },
      createdAt: '2026-03-10T00:00:00Z',
      version: 1,
      diarizedTranscriptS3Path: 'session-with-segments/speaker-segments.json',
    });

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(segments)),
      },
    });

    const result = await handler(makeEvent('session-with-segments'), {} as any, jest.fn());

    expect(result).toBeDefined();
    if (result) {
      expect(result.statusCode).toBe(200);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
      const body = JSON.parse(result.body);
      expect(body.sessionId).toBe('session-with-segments');
      expect(body.segments).toEqual(segments);
      expect(body.segments).toHaveLength(2);
    }
  });

  it('returns 500 when S3 read fails', async () => {
    mockGetSessionById.mockResolvedValueOnce({
      sessionId: 'session-s3-error',
      userId: 'user1',
      sessionType: 'BROADCAST' as any,
      status: 'ended' as any,
      claimedResources: { chatRoom: 'chat1' },
      createdAt: '2026-03-10T00:00:00Z',
      version: 1,
      diarizedTranscriptS3Path: 'session-s3-error/speaker-segments.json',
    });

    mockS3Send.mockRejectedValueOnce(new Error('S3 access denied'));

    const result = await handler(makeEvent('session-s3-error'), {} as any, jest.fn());

    expect(result).toBeDefined();
    if (result) {
      expect(result.statusCode).toBe(500);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    }
  });
});
