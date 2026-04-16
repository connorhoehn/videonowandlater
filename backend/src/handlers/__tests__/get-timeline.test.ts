/**
 * Tests for get-timeline Lambda handler
 * GET /sessions/{sessionId}/timeline - unified timeline of speaker segments, context events, intent results
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-timeline';
import * as sessionRepository from '../../repositories/session-repository';
import * as contextRepository from '../../repositories/context-repository';
import * as intentRepository from '../../repositories/intent-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockS3Send(...args),
    })),
    GetObjectCommand: jest.fn(),
  };
});
jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/context-repository');
jest.mock('../../repositories/intent-repository');
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
}));

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetContextEvents = contextRepository.getContextEvents as jest.MockedFunction<
  typeof contextRepository.getContextEvents
>;
const mockGetIntentResults = intentRepository.getIntentResults as jest.MockedFunction<
  typeof intentRepository.getIntentResults
>;

describe('get-timeline handler', () => {
  const TABLE_NAME = 'test-table';
  const TRANSCRIPTION_BUCKET = 'test-bucket';

  const sessionWithTranscript: Session = {
    sessionId: 'session-1',
    userId: 'user-owner',
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-14T10:00:00Z',
    version: 2,
    diarizedTranscriptS3Path: 'transcripts/session-1/diarized.json',
    claimedResources: { chatRoom: 'room-1' },
  };

  const sessionWithoutTranscript: Session = {
    sessionId: 'session-2',
    userId: 'user-owner',
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-14T10:00:00Z',
    version: 2,
    claimedResources: { chatRoom: 'room-2' },
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.TRANSCRIPTION_BUCKET = TRANSCRIPTION_BUCKET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(sessionId: string): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-caller' },
        },
      },
      headers: { Authorization: 'Bearer test-token' },
      body: null,
      httpMethod: 'GET',
    } as any;
  }

  test('should return 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(createEvent('nonexistent'));

    expect(result.statusCode).toBe(404);
  });

  test('should return merged timeline sorted by startTime', async () => {
    mockGetSessionById.mockResolvedValueOnce(sessionWithTranscript);

    // S3 speaker segments
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: () =>
          JSON.stringify({
            segments: [
              { start_time: 5000, end_time: 8000, speaker: 'spk_0', text: 'Hello' },
              { start_time: 15000, end_time: 18000, speaker: 'spk_1', text: 'World' },
            ],
          }),
      },
    });

    // Context events at t=10000
    mockGetContextEvents.mockResolvedValueOnce([
      {
        contextId: 'ctx-1',
        sessionId: 'session-1',
        sourceAppId: 'figma',
        eventType: 'DOCUMENT_SWITCH' as any,
        timestamp: 10000,
        metadata: { documentId: 'doc-1' },
        createdAt: '2026-04-14T10:00:10Z',
      },
    ]);

    // Intent results at t=12000
    mockGetIntentResults.mockResolvedValueOnce([
      {
        intentSlot: 'product',
        value: 'Widget X',
        confidence: 0.95,
        extractedAt: '2026-04-14T10:00:12Z',
      },
    ]);

    const result = await handler(createEvent('session-1'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.events).toHaveLength(4);

    // Verify all event types are present
    const types = body.events.map((e: any) => e.type);
    expect(types).toContain('speaker');
    expect(types).toContain('context');
    expect(types).toContain('intent_captured');

    // Verify sort invariant (ascending by startTime)
    for (let i = 1; i < body.events.length; i++) {
      expect(body.events[i].startTime).toBeGreaterThanOrEqual(body.events[i - 1].startTime);
    }
  });

  test('should return empty events array when no data', async () => {
    mockGetSessionById.mockResolvedValueOnce(sessionWithoutTranscript);
    mockGetContextEvents.mockResolvedValueOnce([]);
    mockGetIntentResults.mockResolvedValueOnce([]);

    const result = await handler(createEvent('session-2'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.events).toEqual([]);
  });
});
