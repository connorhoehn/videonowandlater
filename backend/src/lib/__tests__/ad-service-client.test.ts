/**
 * Tests for ad-service-client — feature flag, JWT signing, timeout, retry.
 */

import { createHmac } from 'node:crypto';

describe('ad-service-client', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AD_SERVICE_URL;
    delete process.env.AD_SERVICE_SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  // ── adsEnabled ───────────────────────────────────────────────────────────

  test('adsEnabled returns false when AD_SERVICE_URL is missing', async () => {
    process.env.AD_SERVICE_SECRET = 'shh';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled returns false when AD_SERVICE_SECRET is missing', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    const { adsEnabled } = await import('../ad-service-client.js');
    expect(adsEnabled()).toBe(false);
  });

  test('adsEnabled returns true when both env vars are set', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
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

  test('signServiceJwt produces a valid HS256 JWT with iss/iat/exp claims', async () => {
    process.env.AD_SERVICE_SECRET = 'test-secret';
    const { signServiceJwt } = await import('../ad-service-client.js');
    const jwt = signServiceJwt('test-secret');
    const [headerB64, payloadB64, sigB64] = jwt.split('.');
    expect(headerB64).toBeTruthy();
    expect(payloadB64).toBeTruthy();
    expect(sigB64).toBeTruthy();

    const decodeB64Url = (s: string) =>
      Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const header = JSON.parse(decodeB64Url(headerB64));
    const payload = JSON.parse(decodeB64Url(payloadB64));
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.iss).toBe('vnl-api');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    // 5-minute TTL.
    expect(payload.exp - payload.iat).toBe(300);

    // Signature verifies with the shared secret.
    const expected = createHmac('sha256', 'test-secret')
      .update(`${headerB64}.${payloadB64}`)
      .digest()
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    expect(sigB64).toBe(expected);
  });

  test('getDrawer sends Authorization Bearer JWT header signed with AD_SERVICE_SECRET', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shared-secret';
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as any);
    const { getDrawer } = await import('../ad-service-client.js');
    await getDrawer('user-1', 'session-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://ads.example.com/v1/creators/user-1/drawer?sessionId=session-1',
    );
    const auth = (init as RequestInit).headers as Record<string, string>;
    expect(auth.Authorization).toMatch(/^Bearer /);
    const jwt = auth.Authorization.replace('Bearer ', '');
    expect(jwt.split('.')).toHaveLength(3);
  });

  // ── 5xx retry, 4xx no-retry, network error, non-2xx defaults ─────────────

  test('triggerAd retries once on 5xx', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
    const fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ ok: false, status: 503 } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ overlayPayload: { type: 'sponsor_card' } }),
      } as any);
    const { triggerAd } = await import('../ad-service-client.js');
    const result = await triggerAd({
      creativeId: 'c1',
      sessionId: 's1',
      creatorId: 'u1',
      triggerType: 'manual',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ type: 'sponsor_card' });
  });

  test('triggerAd returns null after retry still 5xx', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
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
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
    const fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValue({ ok: false, status: 404 } as any);
    const { getDrawer } = await import('../ad-service-client.js');
    const result = await getDrawer('u1', 's1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  test('getDrawer returns [] on network error (fetch throws)', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
    jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const { getDrawer } = await import('../ad-service-client.js');
    const result = await getDrawer('u1', 's1');
    expect(result).toEqual([]);
  });

  test('trackClick returns ctaUrl on success', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
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

  test('fetch is invoked with an AbortSignal (3s timeout)', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
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

  test('fetch timeout abort causes getDrawer to return []', async () => {
    process.env.AD_SERVICE_URL = 'https://ads.example.com';
    process.env.AD_SERVICE_SECRET = 'shh';
    // Simulate abort — fetch rejects with AbortError when the signal fires.
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
    jest.advanceTimersByTime(3001);
    jest.useRealTimers();
    const result = await resultPromise;
    expect(result).toEqual([]);
  });
});
