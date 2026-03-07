/**
 * Tests for update-spotlight Lambda handler
 * PUT /sessions/:id/spotlight - set or clear featured creator on a session
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../update-spotlight';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockUpdateSpotlight = sessionRepository.updateSpotlight as jest.MockedFunction<
  typeof sessionRepository.updateSpotlight
>;

describe('update-spotlight handler', () => {
  const TABLE_NAME = 'test-table';

  const baseSession: Session = {
    sessionId: 'session-abc',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    createdAt: '2026-03-06T10:00:00Z',
    version: 1,
    claimedResources: { chatRoom: 'room-1' },
  };

  const featuredSession: Session = {
    sessionId: 'featured-session-123',
    userId: 'user-featured',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    createdAt: '2026-03-06T09:00:00Z',
    version: 1,
    claimedResources: { chatRoom: 'room-2' },
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(
    userId: string | undefined,
    sessionId: string,
    body: object
  ): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: userId
          ? { claims: { 'cognito:username': userId } }
          : undefined,
      },
      body: JSON.stringify(body),
    } as any;
  }

  test('should return 200 when setting featured creator', async () => {
    mockGetSessionById
      .mockResolvedValueOnce(baseSession)      // caller's session
      .mockResolvedValueOnce(featuredSession);  // featured session
    mockUpdateSpotlight.mockResolvedValueOnce(undefined);

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Spotlight updated');
    expect(body.featuredCreatorId).toBe('featured-session-123');
    expect(body.featuredCreatorName).toBe('CreatorName');

    expect(mockUpdateSpotlight).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-abc',
      'featured-session-123',
      'CreatorName'
    );
  });

  test('should return 403 when not session owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(baseSession);

    const event = createEvent('user-not-owner', 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    expect(mockUpdateSpotlight).not.toHaveBeenCalled();
  });

  test('should return 404 if session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const event = createEvent('user-owner', 'nonexistent-session', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    expect(mockUpdateSpotlight).not.toHaveBeenCalled();
  });

  test('should return 403 if session is private', async () => {
    const privateSession = { ...baseSession, isPrivate: true };
    mockGetSessionById.mockResolvedValueOnce(privateSession);

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Private broadcasts cannot feature creators');
    expect(mockUpdateSpotlight).not.toHaveBeenCalled();
  });

  test('should return 200 when clearing spotlight with null featuredCreatorId', async () => {
    mockGetSessionById.mockResolvedValueOnce(baseSession);
    mockUpdateSpotlight.mockResolvedValueOnce(undefined);

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: null,
      featuredCreatorName: null,
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Spotlight updated');
    expect(body.featuredCreatorId).toBeNull();

    expect(mockUpdateSpotlight).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-abc',
      null,
      null
    );
  });

  test('should return 400 if featured session is private', async () => {
    const privateFeaturedSession = { ...featuredSession, isPrivate: true };
    mockGetSessionById
      .mockResolvedValueOnce(baseSession)
      .mockResolvedValueOnce(privateFeaturedSession);

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Cannot feature a private broadcast');
    expect(mockUpdateSpotlight).not.toHaveBeenCalled();
  });

  test('should return 401 when not authenticated', async () => {
    const event = createEvent(undefined, 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  test('should return 400 when sessionId is missing', async () => {
    const event = {
      pathParameters: {},
      requestContext: {
        authorizer: { claims: { 'cognito:username': 'user-owner' } },
      },
      body: JSON.stringify({ featuredCreatorId: 'abc', featuredCreatorName: 'Name' }),
    } as any;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  test('should return 500 when TABLE_NAME not set', async () => {
    const originalTableName = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('TABLE_NAME not set');

    process.env.TABLE_NAME = originalTableName;
  });

  test('should include CORS headers on success', async () => {
    mockGetSessionById
      .mockResolvedValueOnce(baseSession)
      .mockResolvedValueOnce(featuredSession);
    mockUpdateSpotlight.mockResolvedValueOnce(undefined);

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: 'featured-session-123',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers!['Access-Control-Allow-Headers']).toBe('*');
    expect(result.headers!['Content-Type']).toBe('application/json');
  });

  test('should return 400 when featured session not found', async () => {
    mockGetSessionById
      .mockResolvedValueOnce(baseSession)
      .mockResolvedValueOnce(null); // featured session not found

    const event = createEvent('user-owner', 'session-abc', {
      featuredCreatorId: 'nonexistent-session',
      featuredCreatorName: 'CreatorName',
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('not found');
  });
});
