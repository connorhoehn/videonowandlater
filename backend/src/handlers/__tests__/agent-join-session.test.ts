/**
 * Tests for agent-join-session Lambda handler
 * POST /sessions/{sessionId}/agent/join - request AI agent to join a live hangout
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../agent-join-session';
import * as sessionRepository from '../../repositories/session-repository';
import * as agentRepository from '../../repositories/agent-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/agent-repository');
jest.mock('../../repositories/intent-repository');
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
}));

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockUpdateAgentStatus = agentRepository.updateAgentStatus as jest.MockedFunction<
  typeof agentRepository.updateAgentStatus
>;
const mockWriteAgentAuditRecord = agentRepository.writeAgentAuditRecord as jest.MockedFunction<
  typeof agentRepository.writeAgentAuditRecord
>;

describe('agent-join-session handler', () => {
  const TABLE_NAME = 'test-table';

  const liveHangout: Session = {
    sessionId: 'session-1',
    userId: 'user-owner',
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.LIVE,
    createdAt: '2026-04-14T10:00:00Z',
    version: 1,
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/stage-1',
    claimedResources: { chatRoom: 'room-1', stage: 'stage-1' },
  };

  const liveBroadcast: Session = {
    sessionId: 'session-2',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    createdAt: '2026-04-14T10:00:00Z',
    version: 1,
    claimedResources: { chatRoom: 'room-2' },
  };

  const endedHangout: Session = {
    sessionId: 'session-3',
    userId: 'user-owner',
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-14T09:00:00Z',
    version: 2,
    claimedResources: { chatRoom: 'room-3' },
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

  test('should return 400 when session is not HANGOUT', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveBroadcast);

    const result = await handler(createEvent('session-2', 'user-owner'));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/HANGOUT/i);
  });

  test('should return 400 when session is not LIVE', async () => {
    mockGetSessionById.mockResolvedValueOnce(endedHangout);

    const result = await handler(createEvent('session-3', 'user-owner'));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/LIVE/i);
  });

  test('should return 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(createEvent('nonexistent', 'user-owner'));

    expect(result.statusCode).toBe(404);
  });

  test('should return 403 when user is not session owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveHangout);

    const result = await handler(createEvent('session-1', 'other-user'));

    expect(result.statusCode).toBe(403);
  });

  test('should return 202 and update agentStatus to joining on success', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveHangout);
    mockUpdateAgentStatus.mockResolvedValueOnce(undefined);
    mockWriteAgentAuditRecord.mockResolvedValueOnce(undefined);

    const result = await handler(createEvent('session-1', 'user-owner'));

    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/joining/i);

    expect(mockUpdateAgentStatus).toHaveBeenCalledWith(TABLE_NAME, 'session-1', 'joining');
    expect(mockWriteAgentAuditRecord).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-1',
      'join',
      expect.objectContaining({ requestedBy: 'user-owner' }),
    );
  });
});
