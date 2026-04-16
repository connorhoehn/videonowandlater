/**
 * Tests for push-context-event Lambda handler
 * POST /sessions/{sessionId}/context - push a context event into a session timeline
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../push-context-event';
import * as sessionRepository from '../../repositories/session-repository';
import * as contextRepository from '../../repositories/context-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/context-repository');
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
}));
jest.mock('uuid', () => ({
  v4: () => 'test-context-uuid',
}));

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockAddContextEvent = contextRepository.addContextEvent as jest.MockedFunction<
  typeof contextRepository.addContextEvent
>;

describe('push-context-event handler', () => {
  const TABLE_NAME = 'test-table';

  const liveSession: Session = {
    sessionId: 'session-1',
    userId: 'user-owner',
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.LIVE,
    createdAt: '2026-04-14T10:00:00Z',
    version: 1,
    claimedResources: { chatRoom: 'room-1' },
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(
    sessionId: string | undefined,
    body?: Record<string, any>,
  ): APIGatewayProxyEvent {
    return {
      pathParameters: sessionId ? { sessionId } : null,
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-caller' },
        },
      },
      headers: { Authorization: 'Bearer test-token' },
      body: body ? JSON.stringify(body) : null,
      httpMethod: 'POST',
    } as any;
  }

  test('should return 400 when sessionId is missing', async () => {
    const result = await handler(createEvent(undefined));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/sessionId/i);
  });

  test('should return 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(
      createEvent('nonexistent', {
        sourceAppId: 'app-1',
        eventType: 'DOCUMENT_SWITCH',
        timestamp: 5000,
      }),
    );

    expect(result.statusCode).toBe(404);
  });

  test('should return 201 with contextId on success', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    mockAddContextEvent.mockResolvedValueOnce(undefined);

    const result = await handler(
      createEvent('session-1', {
        sourceAppId: 'figma',
        eventType: 'DOCUMENT_SWITCH',
        timestamp: 12000,
        metadata: { documentId: 'doc-abc' },
      }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.contextId).toBeDefined();
  });

  test('should call addContextEvent with correct params', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    mockAddContextEvent.mockResolvedValueOnce(undefined);

    await handler(
      createEvent('session-1', {
        sourceAppId: 'figma',
        eventType: 'DOCUMENT_SWITCH',
        timestamp: 12000,
        metadata: { documentId: 'doc-abc' },
      }),
    );

    expect(mockAddContextEvent).toHaveBeenCalledTimes(1);
    const [tableName, sessionId, event] = mockAddContextEvent.mock.calls[0];
    expect(tableName).toBe(TABLE_NAME);
    expect(sessionId).toBe('session-1');
    expect(event.sourceAppId).toBe('figma');
    expect(event.eventType).toBe('DOCUMENT_SWITCH');
    expect(event.timestamp).toBe(12000);
    expect(event.metadata).toEqual({ documentId: 'doc-abc' });
    expect(event.contextId).toBeDefined();
    expect(event.createdAt).toBeDefined();
  });
});
