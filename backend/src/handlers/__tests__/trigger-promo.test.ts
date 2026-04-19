/**
 * Tests for trigger-promo handler — BROADCAST → PutMetadata, HANGOUT → SendEvent.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler, serializeOverlayForIvs } from '../trigger-promo';
import * as sessionRepository from '../../repositories/session-repository';
import * as ivsClients from '../../lib/ivs-clients';
import * as adClient from '../../lib/ad-service-client';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ivs-clients');
jest.mock('../../lib/ad-service-client');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetIVSClient = ivsClients.getIVSClient as jest.MockedFunction<
  typeof ivsClients.getIVSClient
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;
const mockAdsEnabled = adClient.adsEnabled as jest.MockedFunction<typeof adClient.adsEnabled>;
const mockTriggerAd = adClient.triggerAd as jest.MockedFunction<typeof adClient.triggerAd>;

describe('trigger-promo handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-123';
  const OWNER_ID = 'owner-1';
  const CHANNEL_ARN = 'arn:aws:ivs:us-east-1:123:channel/abc';
  const CHAT_ROOM = 'arn:aws:ivschat:us-east-1:123:room/xyz';

  const broadcastSession: Session = {
    sessionId: SESSION_ID,
    userId: OWNER_ID,
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    claimedResources: { channel: 'pool-chan', chatRoom: CHAT_ROOM },
    channelArn: CHANNEL_ARN,
    createdAt: '2026-03-10T10:00:00Z',
    version: 1,
  };

  const hangoutSession: Session = {
    sessionId: SESSION_ID,
    userId: OWNER_ID,
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.LIVE,
    claimedResources: { stage: 'pool-stage', chatRoom: CHAT_ROOM },
    createdAt: '2026-03-10T10:00:00Z',
    version: 1,
  };

  const mockIvsSend = jest.fn();
  const mockChatSend = jest.fn();
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIVSClient.mockReturnValue({ send: mockIvsSend } as any);
    mockGetIVSChatClient.mockReturnValue({ send: mockChatSend } as any);
    mockIvsSend.mockResolvedValue({});
    mockChatSend.mockResolvedValue({});
    mockAdsEnabled.mockReturnValue(true);
  });

  function createEvent(overrides: {
    actorId?: string;
    sessionId?: string | null;
    body?: object | null;
  }): APIGatewayProxyEvent {
    const { actorId, sessionId, body } = overrides;
    return {
      pathParameters: sessionId !== null ? { sessionId: sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: actorId
          ? { claims: { 'cognito:username': actorId } }
          : undefined,
      },
      body: body !== null ? JSON.stringify(body ?? { creativeId: 'cre-1' }) : null,
    } as any;
  }

  test('returns 401 when unauthenticated', async () => {
    const event = createEvent({ actorId: undefined });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when creativeId missing', async () => {
    const event = createEvent({ actorId: OWNER_ID, body: {} });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = createEvent({ actorId: OWNER_ID });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when caller is not the session owner', async () => {
    mockGetSessionById.mockResolvedValue(broadcastSession);
    const event = createEvent({ actorId: 'not-owner' });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(403);
    expect(mockIvsSend).not.toHaveBeenCalled();
    expect(mockChatSend).not.toHaveBeenCalled();
    expect(mockTriggerAd).not.toHaveBeenCalled();
  });

  test('feature-flag off → 200 with delivered=false, no IVS calls', async () => {
    mockAdsEnabled.mockReturnValue(false);
    mockGetSessionById.mockResolvedValue(broadcastSession);
    const event = createEvent({ actorId: OWNER_ID });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ delivered: false, reason: 'ads_disabled' });
    expect(mockTriggerAd).not.toHaveBeenCalled();
    expect(mockIvsSend).not.toHaveBeenCalled();
  });

  test('BROADCAST path → PutMetadataCommand with {type:"ad", ...}', async () => {
    mockGetSessionById.mockResolvedValue(broadcastSession);
    mockTriggerAd.mockResolvedValue({ schemaVersion: 1, type: 'sponsor_card', banner: 'https://cdn/img.png' });
    const event = createEvent({ actorId: OWNER_ID });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ delivered: true });

    expect(mockIvsSend).toHaveBeenCalledTimes(1);
    expect(mockChatSend).not.toHaveBeenCalled();
    const cmd = mockIvsSend.mock.calls[0][0];
    expect(cmd.input.channelArn).toBe(CHANNEL_ARN);
    const metadata = JSON.parse(cmd.input.metadata);
    expect(metadata.type).toBe('ad');
    expect(metadata.banner).toBe('https://cdn/img.png');
    expect(metadata.creativeId).toBe('cre-1');
  });

  test('HANGOUT path → SendEventCommand with eventName=ad_overlay', async () => {
    mockGetSessionById.mockResolvedValue(hangoutSession);
    mockTriggerAd.mockResolvedValue({ schemaVersion: 1, type: 'product_pin', sku: 'SKU-1' });
    const event = createEvent({ actorId: OWNER_ID });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ delivered: true });

    expect(mockChatSend).toHaveBeenCalledTimes(1);
    expect(mockIvsSend).not.toHaveBeenCalled();
    const cmd = mockChatSend.mock.calls[0][0];
    expect(cmd.input.roomIdentifier).toBe(CHAT_ROOM);
    expect(cmd.input.eventName).toBe('ad_overlay');
    const payload = JSON.parse(cmd.input.attributes.payload);
    expect(payload.type).toBe('ad');
    expect(payload.sku).toBe('SKU-1');
  });

  test('triggerAd returns null → 200 delivered=false, no IVS call', async () => {
    mockGetSessionById.mockResolvedValue(broadcastSession);
    mockTriggerAd.mockResolvedValue(null);
    const event = createEvent({ actorId: OWNER_ID });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ delivered: false, reason: 'no_overlay' });
    expect(mockIvsSend).not.toHaveBeenCalled();
  });

  test('IVS PutMetadata throws → 200 delivered=false, no 500', async () => {
    mockGetSessionById.mockResolvedValue(broadcastSession);
    mockTriggerAd.mockResolvedValue({ schemaVersion: 1, type: 'sponsor_card' });
    mockIvsSend.mockRejectedValueOnce(new Error('Channel offline'));
    const event = createEvent({ actorId: OWNER_ID });
    const res = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ delivered: false });
  });
});

describe('serializeOverlayForIvs', () => {
  test('small payload → not truncated', () => {
    const { json, truncated } = serializeOverlayForIvs({
      schemaVersion: 1,
      type: 'sponsor_card',
      creativeId: 'c1',
      title: 'Test',
    });
    expect(truncated).toBe(false);
    expect(JSON.parse(json)).toMatchObject({ type: 'ad', creativeId: 'c1' });
  });

  test('oversize payload → truncated to minimal envelope', () => {
    const huge = 'x'.repeat(2000);
    const { json, truncated } = serializeOverlayForIvs({
      schemaVersion: 1,
      type: 'sponsor_card',
      creativeId: 'c1',
      bigField: huge,
    });
    expect(truncated).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ type: 'ad', creativeId: 'c1', overlayType: 'sponsor_card' });
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(1024);
  });
});
