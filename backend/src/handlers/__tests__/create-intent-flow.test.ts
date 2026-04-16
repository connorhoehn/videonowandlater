/**
 * Tests for create-intent-flow Lambda handler
 * POST /sessions/{sessionId}/intent-flow - create an intent flow for a session
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../create-intent-flow';
import * as sessionRepository from '../../repositories/session-repository';
import * as intentRepository from '../../repositories/intent-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/intent-repository');
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
}));

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockCreateIntentFlow = intentRepository.createIntentFlow as jest.MockedFunction<
  typeof intentRepository.createIntentFlow
>;

describe('create-intent-flow handler', () => {
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
    sessionId: string,
    userId: string,
    body?: Record<string, any>,
  ): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': userId },
        },
      },
      headers: { Authorization: 'Bearer test-token' },
      body: body ? JSON.stringify(body) : null,
      httpMethod: 'POST',
    } as any;
  }

  const validBody = {
    flowId: 'flow-1',
    name: 'Order Capture',
    sourceAppId: 'crm-app',
    steps: [
      { stepId: 's1', intentSlot: 'product', prompt: 'What product?' },
    ],
    callbackUrl: 'https://example.com/callback',
  };

  test('should return 403 when user is not session owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);

    const result = await handler(createEvent('session-1', 'other-user', validBody));

    expect(result.statusCode).toBe(403);
  });

  test('should return 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(createEvent('nonexistent', 'user-owner', validBody));

    expect(result.statusCode).toBe(404);
  });

  test('should return 201 with flowId on success', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    mockCreateIntentFlow.mockResolvedValueOnce(undefined);

    const result = await handler(createEvent('session-1', 'user-owner', validBody));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.flowId).toBe('flow-1');
  });

  test('should return 400 when required fields missing', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);

    const result = await handler(
      createEvent('session-1', 'user-owner', { flowId: 'flow-1' }),
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/required/i);
  });
});
