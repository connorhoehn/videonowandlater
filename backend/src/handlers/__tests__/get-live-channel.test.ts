/**
 * Tests for get-live-channel handler
 * GET /v1/sessions/:sessionId/live-channel — service-to-service from vnl-ads
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import jwt from 'jsonwebtoken';

const mockSend = jest.fn();

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockSend })),
}));

import { handler } from '../get-live-channel';
import { SessionStatus, SessionType } from '../../domain/session';

const SHARED_SECRET = 'test-shared-secret';
const ISSUER = 'vnl-ads';
const AUDIENCE = 'vnl';

function mkToken(overrides: { iss?: string; aud?: string; expiresInSeconds?: number; sub?: string } = {}): string {
  return jwt.sign(
    { sub: overrides.sub ?? 'vnl-ads-api' },
    SHARED_SECRET,
    {
      algorithm: 'HS256',
      issuer: overrides.iss ?? ISSUER,
      audience: overrides.aud ?? AUDIENCE,
      expiresIn: overrides.expiresInSeconds ?? 300,
    }
  );
}

function mkEvent(sessionId: string | undefined, token: string | null): APIGatewayProxyEvent {
  return {
    pathParameters: sessionId ? { sessionId } : null,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    requestContext: {},
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as any;
const cb = (() => {}) as any;

describe('get-live-channel handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockSend.mockReset();
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      VNL_ADS_JWT_SECRET: SHARED_SECRET,
      VNL_SERVICE_JWT_INCOMING_ISSUER: ISSUER,
      VNL_SERVICE_JWT_INCOMING_AUDIENCE: AUDIENCE,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const result = await handler(mkEvent('sess-1', null), ctx, cb);
    expect(result && typeof result !== 'string' && result.statusCode).toBe(401);
  });

  it('returns 401 for a token with the wrong issuer', async () => {
    const bad = mkToken({ iss: 'someone-else' });
    const result = await handler(mkEvent('sess-1', bad), ctx, cb);
    expect(result && typeof result !== 'string' && result.statusCode).toBe(401);
  });

  it('returns 503 when VNL_ADS_JWT_SECRET is not configured', async () => {
    delete process.env.VNL_ADS_JWT_SECRET;
    const result = await handler(mkEvent('sess-1', mkToken()), ctx, cb);
    expect(result && typeof result !== 'string' && result.statusCode).toBe(503);
  });

  it('returns 404 when the session does not exist', async () => {
    mockSend.mockResolvedValueOnce({});
    const result = await handler(mkEvent('missing', mkToken()), ctx, cb);
    expect(result && typeof result !== 'string' && result.statusCode).toBe(404);
  });

  it('returns 404 for HANGOUT sessions (scope is broadcast-only)', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        sessionId: 'sess-hangout',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.LIVE,
        claimedResources: { stage: 'arn:aws:ivs:us-east-1:1:stage/abc' },
        startedAt: '2026-04-19T14:00:00Z',
      },
    });
    const result = await handler(mkEvent('sess-hangout', mkToken()), ctx, cb);
    expect(result && typeof result !== 'string' && result.statusCode).toBe(404);
  });

  it.each([
    [SessionStatus.SCHEDULED, 'SCHEDULED'],
    [SessionStatus.CREATING, 'CREATING'],
    [SessionStatus.ENDED, 'ENDED'],
    [SessionStatus.ENDING, 'ENDING'],
    [SessionStatus.CANCELED, 'CANCELED'],
  ])('returns 410 with state=%s for non-LIVE broadcast', async (status, expectedState) => {
    mockSend.mockResolvedValueOnce({
      Item: {
        sessionId: 'sess-nonlive',
        sessionType: SessionType.BROADCAST,
        status,
      },
    });
    const result = await handler(mkEvent('sess-nonlive', mkToken()), ctx, cb);
    expect(result && typeof result !== 'string').toBe(true);
    if (result && typeof result !== 'string') {
      expect(result.statusCode).toBe(410);
      const body = JSON.parse(result.body);
      expect(body.state).toBe(expectedState);
      expect(body.sessionId).toBe('sess-nonlive');
    }
  });

  it('returns 200 with channelArn, playbackUrl, and state=LIVE for a live broadcast', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          sessionId: 'sess-live',
          sessionType: SessionType.BROADCAST,
          status: SessionStatus.LIVE,
          claimedResources: { channel: 'arn:aws:ivs:us-east-1:264161986065:channel/abc123' },
          startedAt: '2026-04-19T14:00:00Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          playbackUrl: 'https://xxxx.playback.live-video.net/api/video/v1/abc.m3u8',
        },
      });

    const result = await handler(mkEvent('sess-live', mkToken()), ctx, cb);
    expect(result && typeof result !== 'string').toBe(true);
    if (result && typeof result !== 'string') {
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toMatchObject({
        sessionId: 'sess-live',
        channelArn: 'arn:aws:ivs:us-east-1:264161986065:channel/abc123',
        playbackUrl: 'https://xxxx.playback.live-video.net/api/video/v1/abc.m3u8',
        state: 'LIVE',
        startedAt: '2026-04-19T14:00:00Z',
      });
      // expiresAt defaults to startedAt + 12h when scheduledEndsAt is absent
      expect(new Date(body.expiresAt).toISOString()).toBe('2026-04-20T02:00:00.000Z');
    }
  });

  it('uses scheduledEndsAt for expiresAt when present', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          sessionId: 'sess-sched',
          sessionType: SessionType.BROADCAST,
          status: SessionStatus.LIVE,
          claimedResources: { channel: 'arn:aws:ivs:us-east-1:1:channel/x' },
          startedAt: '2026-04-19T14:00:00Z',
          scheduledEndsAt: '2026-04-19T15:30:00Z',
        },
      })
      .mockResolvedValueOnce({
        Item: { playbackUrl: 'https://p/x.m3u8' },
      });

    const result = await handler(mkEvent('sess-sched', mkToken()), ctx, cb);
    if (result && typeof result !== 'string') {
      const body = JSON.parse(result.body);
      expect(body.expiresAt).toBe('2026-04-19T15:30:00Z');
    }
  });

  it('returns 503 when the pool item is missing for a LIVE channel', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          sessionId: 'sess-nopool',
          sessionType: SessionType.BROADCAST,
          status: SessionStatus.LIVE,
          claimedResources: { channel: 'arn:aws:ivs:us-east-1:1:channel/missing' },
          startedAt: '2026-04-19T14:00:00Z',
        },
      })
      .mockResolvedValueOnce({});

    const result = await handler(mkEvent('sess-nopool', mkToken()), ctx, cb);
    expect(result && typeof result !== 'string' && result.statusCode).toBe(503);
  });
});
