/**
 * Tests for admin-kill-session Lambda handler
 * POST /admin/sessions/:sessionId/kill - forcefully terminate a session
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-kill-session';
import * as sessionRepository from '../../repositories/session-repository';
import * as resourcePoolRepository from '../../repositories/resource-pool-repository';
import * as adminAuth from '../../lib/admin-auth';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/resource-pool-repository');
const mockDocSend = jest.fn().mockResolvedValue({});
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));
jest.mock('@aws-sdk/client-ivs', () => ({
  IvsClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  StopStreamCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-ivs-realtime', () => ({
  IVSRealTimeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  DisconnectParticipantCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-ivschat', () => ({
  IvschatClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  SendEventCommand: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));
jest.mock('../../lib/admin-auth');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetHangoutParticipants = sessionRepository.getHangoutParticipants as jest.MockedFunction<
  typeof sessionRepository.getHangoutParticipants
>;
const mockUpdateSessionStatus = sessionRepository.updateSessionStatus as jest.MockedFunction<
  typeof sessionRepository.updateSessionStatus
>;
const mockReleasePoolResource = resourcePoolRepository.releasePoolResource as jest.MockedFunction<
  typeof resourcePoolRepository.releasePoolResource
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockGetAdminUserId = adminAuth.getAdminUserId as jest.MockedFunction<
  typeof adminAuth.getAdminUserId
>;

describe('admin-kill-session handler', () => {
  const TABLE_NAME = 'test-table';

  const liveBroadcast: Session = {
    sessionId: 'session-broadcast',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    createdAt: '2026-04-14T10:00:00Z',
    version: 1,
    channelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/channel-1',
    claimedResources: { channel: 'channel-1', chatRoom: 'room-1' },
  };

  const liveHangout: Session = {
    sessionId: 'session-hangout',
    userId: 'user-owner',
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.LIVE,
    createdAt: '2026-04-14T10:00:00Z',
    version: 1,
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/stage-1',
    claimedResources: { stage: 'stage-1', chatRoom: 'room-2' },
  };

  const endedSession: Session = {
    sessionId: 'session-ended',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
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
    mockIsAdmin.mockReturnValue(false);
    mockGetAdminUserId.mockReturnValue(undefined);
  });

  function createEvent(sessionId: string): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'admin-user' },
        },
      },
      headers: { Authorization: 'Bearer admin-token' },
      body: null,
      httpMethod: 'POST',
    } as any;
  }

  test('should return 403 when user is not admin', async () => {
    mockIsAdmin.mockReturnValue(false);

    const result = await handler(createEvent('session-broadcast'));

    expect(result.statusCode).toBe(403);
  });

  test('should return 404 when session not found', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(createEvent('nonexistent'));

    expect(result.statusCode).toBe(404);
  });

  test('should return 200 no-op when session already ENDED', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(endedSession);

    const result = await handler(createEvent('session-ended'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/already.*ended/i);
    expect(mockUpdateSessionStatus).not.toHaveBeenCalled();
  });

  test('should kill BROADCAST session: StopStream, SendEvent, update status to ENDING', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(liveBroadcast);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);

    const { IvsClient } = require('@aws-sdk/client-ivs');
    const { IvschatClient } = require('@aws-sdk/client-ivschat');
    const { StopStreamCommand } = require('@aws-sdk/client-ivs');
    const { SendEventCommand } = require('@aws-sdk/client-ivschat');

    const result = await handler(createEvent('session-broadcast'));

    expect(result.statusCode).toBe(200);
    expect(StopStreamCommand).toHaveBeenCalled();
    expect(SendEventCommand).toHaveBeenCalled();
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-broadcast',
      SessionStatus.ENDING,
      'endedAt'
    );
  });

  test('should kill HANGOUT session: disconnect all participants, SendEvent, update status', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(liveHangout);
    mockGetHangoutParticipants.mockResolvedValueOnce([
      { participantId: 'p1', userId: 'user-1', stageArn: 'arn:stage-1' },
      { participantId: 'p2', userId: 'user-2', stageArn: 'arn:stage-1' },
    ] as any);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);

    const { DisconnectParticipantCommand } = require('@aws-sdk/client-ivs-realtime');
    const { SendEventCommand } = require('@aws-sdk/client-ivschat');

    const result = await handler(createEvent('session-hangout'));

    expect(result.statusCode).toBe(200);
    expect(DisconnectParticipantCommand).toHaveBeenCalledTimes(2);
    expect(SendEventCommand).toHaveBeenCalled();
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-hangout',
      SessionStatus.ENDING,
      'endedAt'
    );
  });

  test('should handle IVS StopStream failure gracefully (still transitions to ENDING)', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(liveBroadcast);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);

    const { IvsClient } = require('@aws-sdk/client-ivs');
    // Make the IVS client send reject
    IvsClient.mockImplementationOnce(() => ({
      send: jest.fn().mockRejectedValue(new Error('Stream not found')),
    }));

    const result = await handler(createEvent('session-broadcast'));

    // Should still succeed - StopStream failure is non-fatal
    expect(result.statusCode).toBe(200);
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-broadcast',
      SessionStatus.ENDING,
      'endedAt'
    );
  });

  test('should write MOD# audit record with correct PK/SK pattern', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(liveBroadcast);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);

    const result = await handler(createEvent('session-broadcast'));

    expect(result.statusCode).toBe(200);
    // Verify audit record was written with MOD# prefix pattern
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.SK?.startsWith?.('MOD#');
    });
    expect(putCall).toBeDefined();
  });

  test('should release pool resources after kill', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockGetSessionById.mockResolvedValueOnce(liveBroadcast);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);
    mockReleasePoolResource.mockResolvedValue(undefined);

    const result = await handler(createEvent('session-broadcast'));

    expect(result.statusCode).toBe(200);
    expect(mockReleasePoolResource).toHaveBeenCalled();
  });
});
