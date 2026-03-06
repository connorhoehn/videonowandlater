import { handler } from '../generate-playback-token';
import jwt from 'jsonwebtoken';

const mockDocClient = {
  send: jest.fn(),
};

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => mockDocClient),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: jest.fn((params) => params),
}));

const MOCK_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDDWrlbrh4FL7nvelv8y
nLTGjnygGvRI9kOzV/vpnEeBQpZH+XKp54sCCALH9XNbCQ6hZANiAAR1LONc13r2
3AxSFfCTCDglvFQsz9oLhVg1m/d7VPYLOawZMKXjeCaRv9+47CdyhXEwiIy8kTvl
H/bDVyHwfsWotuYSfGELsva+NB0GVMyXrzwKG/DP7sOPduA/0wNQWDE=
-----END PRIVATE KEY-----`;

describe('generate-playback-token handler', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.IVS_PLAYBACK_PRIVATE_KEY = MOCK_PRIVATE_KEY;
    jest.clearAllMocks();
    mockDocClient.send.mockClear();
  });

  it('should generate valid JWT token for private session', async () => {
    const mockSession = {
      sessionId: 'sess-123',
      userId: 'user-456',
      isPrivate: true,
      claimedResources: {
        channel: 'arn:aws:ivs:us-west-2:123456789:channel/abc123',
      },
      playbackUrl: 'https://abc123.us-west-2.playback.live-video.net/api/video/v1/.../video.m3u8',
    };

    mockDocClient.send.mockResolvedValueOnce({ Item: mockSession });

    const event = {
      pathParameters: { sessionId: 'sess-123' },
      body: JSON.stringify({ expiresIn: 86400 }),
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse((result as any).body);
    expect(body.token).toBeDefined();
    expect(body.expiresAt).toBeDefined();
    expect(body.playbackUrl).toContain('?token=');

    // Verify JWT structure (will fail signature validation without public key, but structure is valid)
    const decoded = jwt.decode(body.token, { complete: true }) as any;
    expect(decoded?.header.alg).toBe('ES384');
    expect(decoded?.payload['aws:channel-arn']).toBe(mockSession.claimedResources.channel);
  });

  it('should use default expiresIn of 24 hours if not provided', async () => {
    const mockSession = {
      sessionId: 'sess-123',
      isPrivate: true,
      claimedResources: { channel: 'arn:...' },
      playbackUrl: 'https://example.com/video.m3u8',
    };

    mockDocClient.send.mockResolvedValueOnce({ Item: mockSession });

    const event = {
      pathParameters: { sessionId: 'sess-123' },
      body: null,  // No expiresIn provided
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse((result as any).body);
    const decoded = jwt.decode(body.token, { complete: true }) as any;

    const now = Math.floor(Date.now() / 1000);
    const expectedExp = now + 86400;
    // Allow 2 second variance for test execution time
    expect(decoded?.payload.exp).toBeGreaterThanOrEqual(expectedExp - 2);
    expect(decoded?.payload.exp).toBeLessThanOrEqual(expectedExp + 2);
  });

  it('should return 400 for public session', async () => {
    const mockSession = {
      sessionId: 'sess-123',
      isPrivate: false,  // Public session
      claimedResources: { channel: 'arn:...' },
    };

    mockDocClient.send.mockResolvedValueOnce({ Item: mockSession });

    const event = {
      pathParameters: { sessionId: 'sess-123' },
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(400);
    const body = JSON.parse((result as any).body);
    expect(body.error).toContain('public');
  });

  it('should return 404 for missing session', async () => {
    mockDocClient.send.mockResolvedValueOnce({ Item: undefined });

    const event = {
      pathParameters: { sessionId: 'sess-nonexistent' },
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(404);
    const body = JSON.parse((result as any).body);
    expect(body.error).toContain('not found');
  });

  it('should return 500 if channel ARN is missing', async () => {
    const mockSession = {
      sessionId: 'sess-123',
      isPrivate: true,
      claimedResources: {},  // No channel ARN
    };

    mockDocClient.send.mockResolvedValueOnce({ Item: mockSession });

    const event = {
      pathParameters: { sessionId: 'sess-123' },
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(500);
    const body = JSON.parse((result as any).body);
    expect(body.error).toContain('channel');
  });

  it('should return 400 for invalid expiresIn', async () => {
    const event = {
      pathParameters: { sessionId: 'sess-123' },
      body: JSON.stringify({ expiresIn: -100 }),
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(400);
    const body = JSON.parse((result as any).body);
    expect(body.error).toContain('positive');
  });

  it('should return 500 if IVS_PLAYBACK_PRIVATE_KEY is not configured', async () => {
    delete process.env.IVS_PLAYBACK_PRIVATE_KEY;

    const event = {
      pathParameters: { sessionId: 'sess-123' },
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(500);
    const body = JSON.parse((result as any).body);
    expect(body.error).toContain('not configured');
  });

  it('should return 400 if sessionId is missing', async () => {
    const event = {
      pathParameters: {},  // No sessionId
    } as any;

    const result = await handler(event, {} as any, {} as any);

    expect(result?.statusCode).toBe(400);
    const body = JSON.parse((result as any).body);
    expect(body.error).toContain('sessionId');
  });
});
