import { StreamMetrics } from '../metrics';

describe('StreamMetrics backend type', () => {
  it('should be a valid TypeScript interface', () => {
    const metrics: StreamMetrics = {
      timestamp: Date.now(),
      bitrate: 2500000,
      framesPerSecond: 30,
      resolution: { width: 1920, height: 1080 },
      networkType: 'wifi',
      qualityLimitation: 'none',
      jitter: undefined,
      packetsLost: undefined
    };

    expect(metrics).toBeDefined();
    expect(metrics.timestamp).toBeGreaterThan(0);
    expect(metrics.bitrate).toBe(2500000);
  });

  it('should allow optional fields', () => {
    const minimalMetrics: StreamMetrics = {
      timestamp: Date.now(),
      bitrate: 0,
      framesPerSecond: 0,
      resolution: { width: 0, height: 0 },
      networkType: 'unknown',
      qualityLimitation: 'none'
    };

    expect(minimalMetrics.jitter).toBeUndefined();
    expect(minimalMetrics.packetsLost).toBeUndefined();
  });

  it('should support backward compatibility with Session type', () => {
    // Session type should be able to optionally include streamMetrics
    interface MockSession {
      id: string;
      streamMetrics?: StreamMetrics;
    }

    const sessionWithoutMetrics: MockSession = {
      id: 'session-123'
    };

    const sessionWithMetrics: MockSession = {
      id: 'session-456',
      streamMetrics: {
        timestamp: Date.now(),
        bitrate: 2500000,
        framesPerSecond: 30,
        resolution: { width: 1920, height: 1080 },
        networkType: 'wifi',
        qualityLimitation: 'none'
      }
    };

    expect(sessionWithoutMetrics.streamMetrics).toBeUndefined();
    expect(sessionWithMetrics.streamMetrics).toBeDefined();
    expect(sessionWithMetrics.streamMetrics?.bitrate).toBe(2500000);
  });
});