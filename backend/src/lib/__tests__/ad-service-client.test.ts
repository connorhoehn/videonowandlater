/**
 * Tests for ad-service-client — feature flag, JWT signing, timeout, retry.
 */

import { createHmac } from 'node:crypto';

function enableAds(env: NodeJS.ProcessEnv = process.env) {
  env.VNL_ADS_FEATURE_ENABLED = 'true';
  env.VNL_ADS_BASE_URL = 'https://ads.example.com';
  env.VNL_ADS_JWT_SECRET = 'shared-secret';
}

describe('ad-service-client', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VNL_ADS_FEATURE_ENABLED;
    delete process.env.VNL_ADS_BASE_URL;
    delete process.env.VNL_ADS_JWT_SECRET;
    delete process.env.VNL_ADS_JWT_ISSUER;
    delete process.env.VNL_ADS_JWT_AUDIENCE;
    delete process.env.VNL_ADS_TIMEOUT_MS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  // ── adsEnabled ───────────────────────────────────────────────────────────

  test('adsEnabled returns false when VNL_ADS_FEATURE_ENABLED is not "true"', async () => {
    process.env.VNL_ADS_BASE_URL = 'https://ads.example.com';
    process.env.VNL_ADS_JWT_SECRET = 'shh';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled returns false when VNL_ADS_BASE_URL is missing', async () => {
    process.env.VNL_ADS_FEATURE_ENABLED = 'true';
    process.env.VNL_ADS_JWT_SECRET = 'shh';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled returns false when VNL_ADS_JWT_SECRET is missing', async () => {
    process.env.VNL_ADS_FEATURE_ENABLED = 'true';
    process.env.VNL_ADS_BASE_URL = 'https://ads.example.com';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled returns true when flag on and both env vars set', async () => {
    enableAds();
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(true);
  });

  // ── Feature-flag-off defaults ────────────────────────────────────────────

  test('getDrawer returns [] when disabled — no fetch issued', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({} as any);
    const { getDrawer } = await import('../ad-service-client.js');
    const result = await getDrawer('user-1', 'session-1');
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('triggerAd returns null when disabled — no fetch issued', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({} as any);
    const { triggerAd } = await import('../ad-service-client.js');
    const result = await triggerAd({
      creativeId: 'c1',
      sessionId: 's1',
      creatorId: 'u1',
      triggerType: 'manual',
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('trackClick returns null when disabled — no fetch issued', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({} as any);
    const { trackClick } = await import('../ad-service-client.js');
    const result = await trackClick({ creativeId: 'c1', sessionId: 's1', viewerId: 'v1' });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── JWT signing ──────────────────────────────────────────────────────────

  test('signServiceJwt produces HS256 JWT with iss/aud/sub/iat/exp (5min TTL)', async () => {
    enableAds();
    const { signServiceJwt } = await import('../ad-service-client.js');
    const jwt = signServiceJwt('test-secret');
    const [headerB64, payloadB64, sigB64] = jwt.split('.');

    const decodeB64Url = (s: string) =>
      Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const header = JSON.parse(decodeB64Url(headerB64));
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.iss).toBe('vnl');
    expect(payload.aud).toBe('vnl-ads');
    expect(payload.sub).toBe('vnl-api');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp - payload.iat).toBe(300);

    const expected = createHmac('sha256', 'test-secret')
      .update(`${headerB64}.${payloadB64}`)
      .digest()
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(sigB64).toBe(expected);
  });

  test('signServiceJwt honors custom iss/aud env overrides', async () => {
    process.env.VNL_ADS_JWT_ISSUER = 'vnl-staging';
    process.env.VNL_ADS_JWT_AUDIENCE = 'vnl-ads-staging';
    const { signServiceJwt } = await import('../ad-service-client.js');
    const jwt = signServiceJwt('s');
    const payload = JSON.parse(
      Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    expect(payload.iss).toBe('vnl-staging');
    expect(payload.aud).toBe('vnl-ads-staging');
  });

  test('getDrawer sends Authorization Bearer JWT header signed with secret', async () => {
    enableAds();
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as any);
    const { getDrawer } = await import('../ad-service-client.js');
    await getDrawer('user-1', 'session-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://ads.example.com/v1/creators/user-1/drawer?sessionId=session-1');
    const auth = (init as RequestInit).headers as Record<string, string>;
    expect(auth.Authorization).toMatch(/^Bearer /);
    const jwt = auth.Authorization.replace('Bearer ', '');
    expect(jwt.split('.')).toHaveLength(3);
  });

  // ── 5xx retry, 4xx no-retry, network error ────────────────────────────────

  test('triggerAd retries once on 5xx', async () => {
    enableAds();
    const fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ ok: false, status: 503 } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ overlayPayload: { schemaVersion: 1, type: 'PROMO' } }),
      } as any);
    const { triggerAd } = await import('../ad-service-client.js');
    const result = await triggerAd({
      creativeId: 'c1',
      sessionId: 's1',
      creatorId: 'u1',
      triggerType: 'manual',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ schemaVersion: 1, type: 'PROMO' });
  });

  test('triggerAd returns null after retry still 5xx', async () => {
    enableAds();
    const fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValue({ ok: false, status: 502 } as any);
    const { triggerAd } = await import('../ad-service-client.js');
    const result = await triggerAd({
      creativeId: 'c1',
      sessionId: 's1',
      creatorId: 'u1',
      triggerType: 'manual',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  test('getDrawer does not retry on 4xx', async () => {
    enableAds();
    const fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValue({ ok: false, status: 404 } as any);
    const { getDrawer } = await import('../ad-service-client.js');
    const result = await getDrawer('u1', 's1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  test('getDrawer returns [] on network error (fetch throws)', async () => {
    enableAds();
    jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const { getDrawer } = await import('../ad-service-client.js');
    const result = await getDrawer('u1', 's1');
    expect(result).toEqual([]);
  });

  test('trackClick returns ctaUrl on success', async () => {
    enableAds();
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ctaUrl: 'https://sponsor.example.com/promo' }),
    } as any);
    const { trackClick } = await import('../ad-service-client.js');
    const result = await trackClick({ creativeId: 'c1', sessionId: 's1', viewerId: 'v1' });
    expect(result).toEqual({ ctaUrl: 'https://sponsor.example.com/promo' });
  });

  // ── Timeout / abort ──────────────────────────────────────────────────────

  test('fetch is invoked with an AbortSignal', async () => {
    enableAds();
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as any);
    const { getDrawer } = await import('../ad-service-client.js');
    await getDrawer('u1', 's1');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect(typeof (init.signal as AbortSignal).aborted).toBe('boolean');
  });

  test('fetch timeout abort causes getDrawer to return [] (default 2000ms)', async () => {
    enableAds();
    jest.spyOn(global, 'fetch' as any).mockImplementation(((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as any);

    const { getDrawer } = await import('../ad-service-client.js');
    jest.useFakeTimers();
    const resultPromise = getDrawer('u1', 's1');
    jest.advanceTimersByTime(2001);
    jest.useRealTimers();
    const result = await resultPromise;
    expect(result).toEqual([]);
  });

  test('VNL_ADS_TIMEOUT_MS override is honored', async () => {
    enableAds();
    process.env.VNL_ADS_TIMEOUT_MS = '500';
    jest.spyOn(global, 'fetch' as any).mockImplementation(((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as any);

    const { getDrawer } = await import('../ad-service-client.js');
    jest.useFakeTimers();
    const resultPromise = getDrawer('u1', 's1');
    jest.advanceTimersByTime(501);
    jest.useRealTimers();
    const result = await resultPromise;
    expect(result).toEqual([]);
  });
});
