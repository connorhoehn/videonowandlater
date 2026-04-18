/**
 * Tests for track-ad-click handler — passthrough to ad-service.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../track-ad-click';
import * as adClient from '../../lib/ad-service-client';

jest.mock('../../lib/ad-service-client');

const mockTrackClick = adClient.trackClick as jest.MockedFunction<typeof adClient.trackClick>;

describe('track-ad-click handler', () => {
  const SESSION_ID = 'session-xyz';
  const VIEWER_ID = 'viewer-1';
  const CREATIVE_ID = 'cre-1';

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeEach(() => jest.clearAllMocks());

  function createEvent(overrides: {
    actorId?: string;
    sessionId?: string | null;
    body?: object | null;
  }): APIGatewayProxyEvent {
    const { actorId, sessionId, body } = overrides;
    return {
      pathParameters: sessionId !== null ? { sessionId: sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: actorId ? { claims: { 'cognito:username': actorId } } : undefined,
      },
      body: body !== null ? JSON.stringify(body ?? { creativeId: CREATIVE_ID }) : null,
    } as any;
  }

  test('returns 401 when unauthenticated', async () => {
    const res = (await handler(createEvent({ actorId: undefined }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when creativeId missing', async () => {
    const res = (await handler(createEvent({ actorId: VIEWER_ID, body: {} }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });

  test('happy path: passthrough ctaUrl from ad-service-client', async () => {
    mockTrackClick.mockResolvedValue({ ctaUrl: 'https://sponsor.example.com/promo' });
    const res = (await handler(createEvent({ actorId: VIEWER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ctaUrl: 'https://sponsor.example.com/promo' });
    expect(mockTrackClick).toHaveBeenCalledWith({
      creativeId: CREATIVE_ID,
      sessionId: SESSION_ID,
      viewerId: VIEWER_ID,
    });
  });

  test('feature-flag-off: ad-service-client returns null; handler returns 200 ctaUrl=null', async () => {
    mockTrackClick.mockResolvedValue(null);
    const res = (await handler(createEvent({ actorId: VIEWER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ctaUrl: null });
  });

  test('trackClick throws → graceful 200 null', async () => {
    mockTrackClick.mockRejectedValue(new Error('boom'));
    const res = (await handler(createEvent({ actorId: VIEWER_ID }), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ctaUrl: null });
  });
});
