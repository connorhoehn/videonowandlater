/**
 * Tests for the ad-service-client wrapper around @vnl/ads-client.
 * Verifies: feature flag gating, singleton construction, happy-path unwrap,
 * graceful failure on AdsHttpError / AdsUnavailableError / unknown errors.
 */

import { AdsHttpError, AdsUnavailableError } from '@vnl/ads-client';

const mockGetDrawer = jest.fn();
const mockTrigger = jest.fn();
const mockClick = jest.fn();

jest.mock('@vnl/ads-client', () => {
  const actual = jest.requireActual('@vnl/ads-client');
  return {
    ...actual,
    AdsClient: jest.fn().mockImplementation(() => ({
      getDrawer: mockGetDrawer,
      trigger: mockTrigger,
      click: mockClick,
    })),
  };
});

function enableAds() {
  process.env.VNL_ADS_FEATURE_ENABLED = 'true';
  process.env.VNL_ADS_BASE_URL = 'https://ads.example.com';
  process.env.VNL_ADS_JWT_SECRET = 'shared-secret';
}

describe('ad-service-client', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VNL_ADS_FEATURE_ENABLED;
    delete process.env.VNL_ADS_BASE_URL;
    delete process.env.VNL_ADS_JWT_SECRET;
    mockGetDrawer.mockReset();
    mockTrigger.mockReset();
    mockClick.mockReset();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── adsEnabled ───────────────────────────────────────────────────────────

  test('adsEnabled: false when feature flag not "true"', async () => {
    process.env.VNL_ADS_BASE_URL = 'https://ads.example.com';
    process.env.VNL_ADS_JWT_SECRET = 'shh';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled: false when base URL missing', async () => {
    process.env.VNL_ADS_FEATURE_ENABLED = 'true';
    process.env.VNL_ADS_JWT_SECRET = 'shh';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled: false when secret missing', async () => {
    process.env.VNL_ADS_FEATURE_ENABLED = 'true';
    process.env.VNL_ADS_BASE_URL = 'https://ads.example.com';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled: true when flag + env set', async () => {
    enableAds();
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(true);
  });

  // ── Feature-flag-off → safe defaults, no SDK call ──────────────────────

  test('getDrawer returns [] when disabled', async () => {
    const { getDrawer } = await import('../ad-service-client.js');
    const result = await getDrawer('u1', 's1');
    expect(result).toEqual([]);
    expect(mockGetDrawer).not.toHaveBeenCalled();
  });

  test('triggerAd returns null when disabled', async () => {
    const { triggerAd } = await import('../ad-service-client.js');
    const result = await triggerAd({ creativeId: 'c1', sessionId: 's1', creatorId: 'u1', triggerType: 'manual' });
    expect(result).toBeNull();
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  test('trackClick returns null when disabled', async () => {
    const { trackClick } = await import('../ad-service-client.js');
    const result = await trackClick({ creativeId: 'c1', sessionId: 's1', viewerId: 'v1' });
    expect(result).toBeNull();
    expect(mockClick).not.toHaveBeenCalled();
  });

  // ── Happy paths ─────────────────────────────────────────────────────────

  test('getDrawer unwraps SDK {items: []} response', async () => {
    enableAds();
    mockGetDrawer.mockResolvedValue({
      items: [
        { creativeId: 'c1', campaignId: 'cp1', type: 'PROMO', thumbnail: 't', title: 'T', durationMs: 5000, productId: null },
      ],
    });
    const { getDrawer, __resetClientForTests } = await import('../ad-service-client.js');
    __resetClientForTests();
    const result = await getDrawer('u1', 's1');
    expect(result).toHaveLength(1);
    expect(result[0].creativeId).toBe('c1');
    expect(mockGetDrawer).toHaveBeenCalledWith('u1', 's1');
  });

  test('triggerAd returns overlayPayload from SDK response', async () => {
    enableAds();
    mockTrigger.mockResolvedValue({
      overlayPayload: { schemaVersion: 1, type: 'PROMO', cta: { clickResolveEndpoint: '/v1/click' } },
      impressionId: 'imp-1',
    });
    const { triggerAd, __resetClientForTests } = await import('../ad-service-client.js');
    __resetClientForTests();
    const result = await triggerAd({ creativeId: 'c1', sessionId: 's1', creatorId: 'u1', triggerType: 'manual' });
    expect(result).toEqual({ schemaVersion: 1, type: 'PROMO', cta: { clickResolveEndpoint: '/v1/click' } });
  });

  test('trackClick returns ctaUrl from SDK response', async () => {
    enableAds();
    mockClick.mockResolvedValue({ ctaUrl: 'https://sponsor/buy', clickId: 'clk-1' });
    const { trackClick, __resetClientForTests } = await import('../ad-service-client.js');
    __resetClientForTests();
    const result = await trackClick({ creativeId: 'c1', sessionId: 's1', viewerId: 'v1' });
    expect(result).toEqual({ ctaUrl: 'https://sponsor/buy' });
  });

  // ── Error handling ─────────────────────────────────────────────────────

  test('getDrawer returns [] on AdsHttpError', async () => {
    enableAds();
    mockGetDrawer.mockRejectedValue(new AdsHttpError(503, 'BAD_GATEWAY', 'nope'));
    const { getDrawer, __resetClientForTests } = await import('../ad-service-client.js');
    __resetClientForTests();
    const result = await getDrawer('u1', 's1');
    expect(result).toEqual([]);
  });

  test('triggerAd returns null on AdsUnavailableError', async () => {
    enableAds();
    mockTrigger.mockRejectedValue(new AdsUnavailableError('breaker open'));
    const { triggerAd, __resetClientForTests } = await import('../ad-service-client.js');
    __resetClientForTests();
    const result = await triggerAd({ creativeId: 'c1', sessionId: 's1', creatorId: 'u1', triggerType: 'manual' });
    expect(result).toBeNull();
  });

  test('trackClick returns null on unknown error', async () => {
    enableAds();
    mockClick.mockRejectedValue(new Error('weird'));
    const { trackClick, __resetClientForTests } = await import('../ad-service-client.js');
    __resetClientForTests();
    const result = await trackClick({ creativeId: 'c1', sessionId: 's1', viewerId: 'v1' });
    expect(result).toBeNull();
  });
});
