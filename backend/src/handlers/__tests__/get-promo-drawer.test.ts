/**
 * Tests for get-promo-drawer handler — auth, happy path, feature-flag-off.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../get-promo-drawer';
import * as sessionRepository from '../../repositories/session-repository';
import * as adClient from '../../lib/ad-service-client';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ad-service-client');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetDrawer = adClient.getDrawer as jest.MockedFunction<typeof adClient.getDrawer>;

describe('get-promo-drawer handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';
  const OWNER_ID = 'owner-1';

  const session: Session = {
    sessionId: SESSION_ID,
    userId: OWNER_ID,
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    claimedResources: { chatRoom: 'arn:aws:ivschat:...:room/x' },
    createdAt: '2026-03-10T10:00:00Z',
    version: 1,
  };

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(overrides: {
    actorId?: string;
    sessionId?: string | null;
  }): APIGatewayProxyEvent {
    const { actorId, sessionId } = overrides;
    return {
      pathParameters: sessionId !== null ? { sessionId: sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: actorId
          ? { claims: { 'cognito:username': actorId } }
          : undefined,
      },
      body: null,
    } as any;
  }

  test('returns 401 when unauthenticated', async () => {
    const res = (await handler(createEvent({ actorId: undefined }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when sessionId missing', async () => {
    const res = (await handler(createEvent({ actorId: OWNER_ID, sessionId: null }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const res = (await handler(createEvent({ actorId: OWNER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when caller is not the session owner', async () => {
    mockGetSessionById.mockResolvedValue(session);
    const res = (await handler(createEvent({ actorId: 'not-owner' }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(403);
    expect(mockGetDrawer).not.toHaveBeenCalled();
  });

  test('happy path: returns items from ad-service-client', async () => {
    mockGetSessionById.mockResolvedValue(session);
    mockGetDrawer.mockResolvedValue([
      {
        creativeId: 'c1',
        campaignId: 'camp-1',
        type: 'PROMO',
        thumbnail: 'https://img',
        title: 'Promo 1',
        durationMs: 5000,
        productId: null,
      },
    ]);
    const res = (await handler(createEvent({ actorId: OWNER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ creativeId: 'c1', type: 'PROMO' });
    expect(mockGetDrawer).toHaveBeenCalledWith(OWNER_ID, SESSION_ID);
  });

  test('feature-flag-off: ad-service-client returns []; handler returns 200 with empty items', async () => {
    mockGetSessionById.mockResolvedValue(session);
    mockGetDrawer.mockResolvedValue([]); // simulates adsEnabled() === false path
    const res = (await handler(createEvent({ actorId: OWNER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [] });
  });

  test('getDrawer throws → returns 200 with empty items (graceful)', async () => {
    mockGetSessionById.mockResolvedValue(session);
    mockGetDrawer.mockRejectedValue(new Error('boom'));
    const res = (await handler(createEvent({ actorId: OWNER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [] });
  });
});
