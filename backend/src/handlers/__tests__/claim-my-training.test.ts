/**
 * Tests for POST /me/training-claim — caller-scoped userId injection,
 * feature-flag handling, and passthrough of the SDK response.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockClaimTraining = jest.fn();

jest.mock('@vnl/ads-client', () => {
  const actual = jest.requireActual('@vnl/ads-client');
  return {
    ...actual,
    AdsClient: jest.fn().mockImplementation(() => ({
      claimTraining: mockClaimTraining,
    })),
  };
});

function enableAds(env: NodeJS.ProcessEnv = process.env) {
  env.VNL_ADS_FEATURE_ENABLED = 'true';
  env.VNL_ADS_BASE_URL = 'https://ads.example.com';
  env.VNL_ADS_JWT_SECRET = 'shared-secret';
}

function createEvent(
  body: object | string | null,
  claims: Record<string, any> | null = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: null,
    body: typeof body === 'string' ? body : body ? JSON.stringify(body) : null,
    httpMethod: 'POST',
    headers: {},
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('claim-my-training handler', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VNL_ADS_FEATURE_ENABLED;
    delete process.env.VNL_ADS_BASE_URL;
    delete process.env.VNL_ADS_JWT_SECRET;
    mockClaimTraining.mockReset();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('401 when unauthenticated', async () => {
    const { handler } = await import('../claim-my-training.js');
    const res = await handler(createEvent({ creativeId: 'c1' }, null));
    expect(res.statusCode).toBe(401);
  });

  test('400 on invalid JSON', async () => {
    const { handler } = await import('../claim-my-training.js');
    const res = await handler(createEvent('not-json'));
    expect(res.statusCode).toBe(400);
  });

  test('400 when creativeId missing', async () => {
    const { handler } = await import('../claim-my-training.js');
    const res = await handler(createEvent({}));
    expect(res.statusCode).toBe(400);
  });

  test('feature flag off → 200 with ads_disabled reason, no SDK call', async () => {
    const { handler } = await import('../claim-my-training.js');
    const res = await handler(createEvent({ creativeId: 'c1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ overlayPayload: null, reason: 'ads_disabled' });
    expect(mockClaimTraining).not.toHaveBeenCalled();
  });

  test('happy path — SDK is called with caller userId (not body-provided)', async () => {
    enableAds();
    mockClaimTraining.mockResolvedValue({
      overlayPayload: { schemaVersion: 1, type: 'PREROLL', kind: 'training', creativeId: 'c1', title: 'T', assetUrl: 'u', thumbnailUrl: null, durationMs: 15000 },
    });
    const { handler } = await import('../claim-my-training.js');
    const res = await handler(
      // attempt to inject a different userId via body — handler must ignore it
      createEvent({ creativeId: 'c1', sessionId: 's1', userId: 'attacker' } as any, { 'cognito:username': 'alice' }),
    );
    expect(res.statusCode).toBe(200);
    expect(mockClaimTraining).toHaveBeenCalledWith({
      userId: 'alice',
      creativeId: 'c1',
      sessionId: 's1',
      orgId: 'default',
    });
  });

  test('graceful fallback when SDK is unavailable', async () => {
    enableAds();
    const { AdsUnavailableError } = await import('@vnl/ads-client');
    mockClaimTraining.mockRejectedValue(new AdsUnavailableError('down'));
    const { handler } = await import('../claim-my-training.js');
    const res = await handler(createEvent({ creativeId: 'c1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ overlayPayload: null, reason: 'ads_unavailable' });
  });
});
