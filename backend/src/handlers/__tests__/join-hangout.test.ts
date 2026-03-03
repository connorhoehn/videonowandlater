/**
 * Tests for join-hangout Lambda handler
 * Token generation for RealTime hangout sessions
 */

import { handler } from '../join-hangout';
import * as sessionRepository from '../../repositories/session-repository';
import * as ivsClients from '../../lib/ivs-clients';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Mock dependencies
jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ivs-clients');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockGetIVSRealTimeClient = ivsClients.getIVSRealTimeClient as jest.MockedFunction<typeof ivsClients.getIVSRealTimeClient>;

describe('join-hangout handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session123';
  const USER_ID = 'user123';
  const USERNAME = 'testuser';
  const STAGE_ARN = 'arn:aws:ivs:us-west-2:123456789012:stage/abcd1234';
  const PARTICIPANT_TOKEN = 'participant-token-xyz';
  const PARTICIPANT_ID = 'participant-id-123';
  const EXPIRATION_TIME = '2026-03-04T13:52:44Z';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId: SESSION_ID },
      requestContext: {
        authorizer: {
          claims: {
            sub: USER_ID,
            'cognito:username': USERNAME,
          },
        },
      },
      ...overrides,
    } as any;
  }

  test('Handler validates sessionId and userId presence (400 if missing)', async () => {
    // Missing sessionId
    const eventNoSessionId = createEvent({ pathParameters: null });
    const resultNoSessionId = await handler(eventNoSessionId) as APIGatewayProxyResult;
    expect(resultNoSessionId.statusCode).toBe(400);
    expect(JSON.parse(resultNoSessionId.body).error).toContain('sessionId');

    // Missing userId (no authorizer)
    const eventNoUserId = createEvent({ requestContext: {} } as any);
    const resultNoUserId = await handler(eventNoUserId) as APIGatewayProxyResult;
    expect(resultNoUserId.statusCode).toBe(400);
    expect(JSON.parse(resultNoUserId.body).error).toContain('userId');
  });

  test('Handler returns 404 if session not found or sessionType != HANGOUT', async () => {
    const event = createEvent();

    // Session not found
    mockGetSessionById.mockResolvedValueOnce(null);
    const resultNotFound = await handler(event) as APIGatewayProxyResult;
    expect(resultNotFound.statusCode).toBe(404);
    expect(JSON.parse(resultNotFound.body).error).toContain('not found');

    // Session is not a HANGOUT
    const broadcastSession: Session = {
      sessionId: SESSION_ID,
      userId: 'owner123',
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.LIVE,
      claimedResources: {
        channel: 'arn:aws:ivs:us-west-2:123456789012:channel/xyz',
        chatRoom: 'arn:aws:ivschat:us-west-2:123456789012:room/abc',
      },
      createdAt: '2026-03-03T12:00:00Z',
      version: 1,
    };
    mockGetSessionById.mockResolvedValueOnce(broadcastSession);
    const resultNotHangout = await handler(event) as APIGatewayProxyResult;
    expect(resultNotHangout.statusCode).toBe(404);
    expect(JSON.parse(resultNotHangout.body).error).toContain('HANGOUT');
  });

  test('Handler generates token with userId, capabilities:[PUBLISH,SUBSCRIBE], 12-hour TTL', async () => {
    const event = createEvent();

    const hangoutSession: Session = {
      sessionId: SESSION_ID,
      userId: 'owner123',
      sessionType: SessionType.HANGOUT,
      status: SessionStatus.LIVE,
      claimedResources: {
        stage: STAGE_ARN,
        chatRoom: 'arn:aws:ivschat:us-west-2:123456789012:room/abc',
      },
      createdAt: '2026-03-03T12:00:00Z',
      version: 1,
    };

    mockGetSessionById.mockResolvedValueOnce(hangoutSession);

    const mockSend = jest.fn().mockResolvedValueOnce({
      participantToken: {
        token: PARTICIPANT_TOKEN,
        participantId: PARTICIPANT_ID,
        expirationTime: new Date(EXPIRATION_TIME),
      },
    });

    mockGetIVSRealTimeClient.mockReturnValueOnce({
      send: mockSend,
    } as any);

    const result = await handler(event) as APIGatewayProxyResult;

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          stageArn: STAGE_ARN,
          userId: USER_ID,
          duration: 43200, // 12 hours
          capabilities: ['PUBLISH', 'SUBSCRIBE'],
          attributes: { username: USERNAME },
        }),
      })
    );
    expect(result.statusCode).toBe(200);
  });

  test('Handler returns token structure: {token, participantId, expirationTime}', async () => {
    const event = createEvent();

    const hangoutSession: Session = {
      sessionId: SESSION_ID,
      userId: 'owner123',
      sessionType: SessionType.HANGOUT,
      status: SessionStatus.LIVE,
      claimedResources: {
        stage: STAGE_ARN,
        chatRoom: 'arn:aws:ivschat:us-west-2:123456789012:room/abc',
      },
      createdAt: '2026-03-03T12:00:00Z',
      version: 1,
    };

    mockGetSessionById.mockResolvedValueOnce(hangoutSession);

    const mockSend = jest.fn().mockResolvedValueOnce({
      participantToken: {
        token: PARTICIPANT_TOKEN,
        participantId: PARTICIPANT_ID,
        expirationTime: new Date(EXPIRATION_TIME),
      },
    });

    mockGetIVSRealTimeClient.mockReturnValueOnce({
      send: mockSend,
    } as any);

    const result = await handler(event) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({
      token: PARTICIPANT_TOKEN,
      participantId: PARTICIPANT_ID,
      expirationTime: new Date(EXPIRATION_TIME).toISOString(),
    });
  });
});
