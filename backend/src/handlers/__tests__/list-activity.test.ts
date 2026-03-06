/**
 * Tests for list-activity Lambda handler
 * GET /activity - list recent activity (broadcasts and hangouts)
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../list-activity';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus, RecordingStatus } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetRecentActivity = sessionRepository.getRecentActivity as jest.MockedFunction<
  typeof sessionRepository.getRecentActivity
>;

describe('list-activity handler', () => {
  const TABLE_NAME = 'test-table';
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(): APIGatewayProxyEvent {
    return {
      requestContext: {},
    } as any;
  }

  test('should return sessions in reverse chronological order', async () => {
    const sessions = [
      {
        sessionId: 'session-3',
        userId: 'user1',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        messageCount: 5,
      },
      {
        sessionId: 'session-2',
        userId: 'user2',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T09:00:00Z',
        endedAt: '2026-03-06T09:45:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-2' },
        recordingStatus: RecordingStatus.AVAILABLE,
        participantCount: 3,
        messageCount: 12,
      },
      {
        sessionId: 'session-1',
        userId: 'user3',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T08:00:00Z',
        endedAt: '2026-03-06T08:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-3' },
        recordingStatus: RecordingStatus.AVAILABLE,
        messageCount: 3,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce(sessions);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(3);
    // Verify order is DESC by endedAt
    expect(body.sessions[0].sessionId).toBe('session-3');
    expect(body.sessions[1].sessionId).toBe('session-2');
    expect(body.sessions[2].sessionId).toBe('session-1');
  });

  test('should include reactionSummary for broadcasts', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        userId: 'user1',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        reactionSummary: { heart: 42, fire: 17, clap: 8 },
        messageCount: 10,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce(sessions);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions[0].reactionSummary).toEqual({ heart: 42, fire: 17, clap: 8 });
  });

  test('should include participantCount for hangouts', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        userId: 'user1',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        participantCount: 4,
        messageCount: 15,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce(sessions);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions[0].participantCount).toBe(4);
  });

  test('should include messageCount for both types', async () => {
    const sessions = [
      {
        sessionId: 'session-broadcast',
        userId: 'user1',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        messageCount: 25,
      },
      {
        sessionId: 'session-hangout',
        userId: 'user2',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T09:00:00Z',
        endedAt: '2026-03-06T09:45:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-2' },
        recordingStatus: RecordingStatus.AVAILABLE,
        participantCount: 3,
        messageCount: 18,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce(sessions);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions[0].messageCount).toBe(25);
    expect(body.sessions[1].messageCount).toBe(18);
  });

  test('should return 20 most recent sessions', async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `session-${i}`,
      userId: `user-${i}`,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: `2026-03-06T${String(10 + i).padStart(2, '0')}:00:00Z`,
      endedAt: `2026-03-06T${String(10 + i).padStart(2, '0')}:30:00Z`,
      version: 1,
      claimedResources: { chatRoom: `room-${i}` },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: i + 1,
    }));

    mockGetRecentActivity.mockResolvedValueOnce(sessions);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(20);
  });

  test('should handle empty session list', async () => {
    mockGetRecentActivity.mockResolvedValueOnce([]);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toEqual([]);
  });

  test('should return 500 on repository error', async () => {
    mockGetRecentActivity.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Failed to list activity');
  });

  test('should return 500 when TABLE_NAME is not set', async () => {
    const originalTableName = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal server error');

    process.env.TABLE_NAME = originalTableName;
  });

  test('should include CORS headers', async () => {
    mockGetRecentActivity.mockResolvedValueOnce([]);

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers!['Access-Control-Allow-Headers']).toBe('*');
    expect(result.headers!['Content-Type']).toBe('application/json');
  });
});
