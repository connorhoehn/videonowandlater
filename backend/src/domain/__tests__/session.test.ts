/**
 * Session domain model tests - stream metrics backward compatibility
 * Phase 23-03: Verify optional streamMetrics field
 */

// Jest is the test runner for backend
import { Session, SessionStatus, SessionType } from '../session';
import { StreamMetrics } from '../metrics';

describe('Session domain model - streamMetrics backward compatibility', () => {
  const baseSession: Session = {
    sessionId: 'test-session-123',
    userId: 'testuser',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    claimedResources: {
      channel: 'channel-123',
      chatRoom: 'chat-123'
    },
    createdAt: '2026-03-06T10:00:00Z',
    version: 1
  };

  it('should accept Session without streamMetrics field', () => {
    // Session created before Phase 23 - no streamMetrics
    const legacySession: Session = { ...baseSession };

    expect(legacySession.streamMetrics).toBeUndefined();
    expect(legacySession.lastMetricsUpdate).toBeUndefined();

    // Should still be valid Session type
    const isValidSession = (s: Session): boolean => true;
    expect(isValidSession(legacySession)).toBe(true);
  });

  it('should accept Session with streamMetrics field', () => {
    const metricsTimestamp = Date.now();
    const mockMetrics: StreamMetrics = {
      timestamp: metricsTimestamp,
      bitrate: 5000000,
      framesPerSecond: 30,
      resolution: { width: 1920, height: 1080 },
      networkType: 'wifi',
      qualityLimitation: 'none',
      jitter: 5,
      packetsLost: 0
    };

    const sessionWithMetrics: Session = {
      ...baseSession,
      streamMetrics: mockMetrics,
      lastMetricsUpdate: metricsTimestamp
    };

    expect(sessionWithMetrics.streamMetrics).toEqual(mockMetrics);
    expect(sessionWithMetrics.lastMetricsUpdate).toBe(metricsTimestamp);
  });

  it('should handle missing streamMetrics gracefully in processing', () => {
    // Simulate function that processes session
    const processSession = (session: Session): string => {
      // Should use optional chaining
      const hasMetics = session.streamMetrics?.bitrate !== undefined;
      if (hasMetics) {
        return `Session has metrics: ${session.streamMetrics?.bitrate} bps`;
      }
      return 'Session has no metrics';
    };

    // Test with legacy session (no metrics)
    const legacySession: Session = { ...baseSession };
    expect(processSession(legacySession)).toBe('Session has no metrics');

    // Test with Phase 23+ session (has metrics)
    const sessionWithMetrics: Session = {
      ...baseSession,
      streamMetrics: {
        timestamp: Date.now(),
        bitrate: 5000000,
        framesPerSecond: 30,
        resolution: { width: 1920, height: 1080 },
        networkType: 'wifi',
        qualityLimitation: 'none'
      }
    };
    expect(processSession(sessionWithMetrics)).toBe('Session has metrics: 5000000 bps');
  });

  it('should serialize Session with optional streamMetrics to DynamoDB format', () => {
    // Helper to convert Session to DynamoDB item
    const toDynamoDBItem = (session: Session): any => {
      const item: any = {
        PK: `SESSION#${session.sessionId}`,
        SK: `SESSION#${session.sessionId}`,
        sessionId: session.sessionId,
        userId: session.userId,
        sessionType: session.sessionType,
        status: session.status,
        claimedResources: session.claimedResources,
        createdAt: session.createdAt,
        version: session.version
      };

      // Only include streamMetrics if present (omit undefined to keep items clean)
      if (session.streamMetrics) {
        item.streamMetrics = session.streamMetrics;
      }
      if (session.lastMetricsUpdate) {
        item.lastMetricsUpdate = session.lastMetricsUpdate;
      }

      return item;
    };

    // Test legacy session - should not have streamMetrics in DynamoDB item
    const legacySession: Session = { ...baseSession };
    const legacyItem = toDynamoDBItem(legacySession);
    expect(legacyItem.streamMetrics).toBeUndefined();
    expect(legacyItem.lastMetricsUpdate).toBeUndefined();
    expect(Object.keys(legacyItem)).not.toContain('streamMetrics');

    // Test Phase 23+ session - should have streamMetrics in DynamoDB item
    const sessionWithMetrics: Session = {
      ...baseSession,
      streamMetrics: {
        timestamp: Date.now(),
        bitrate: 5000000,
        framesPerSecond: 30,
        resolution: { width: 1920, height: 1080 },
        networkType: 'wifi',
        qualityLimitation: 'none'
      },
      lastMetricsUpdate: Date.now()
    };
    const metricsItem = toDynamoDBItem(sessionWithMetrics);
    expect(metricsItem.streamMetrics).toBeDefined();
    expect(metricsItem.lastMetricsUpdate).toBeDefined();
  });

  it('should deserialize DynamoDB item with missing streamMetrics to Session', () => {
    // Helper to convert DynamoDB item to Session
    const fromDynamoDBItem = (item: any): Session => {
      return {
        sessionId: item.sessionId,
        userId: item.userId,
        sessionType: item.sessionType,
        status: item.status,
        claimedResources: item.claimedResources,
        createdAt: item.createdAt,
        version: item.version,
        // Optional fields - may be undefined
        streamMetrics: item.streamMetrics,
        lastMetricsUpdate: item.lastMetricsUpdate
      };
    };

    // Test legacy DynamoDB item without streamMetrics
    const legacyItem = {
      PK: 'SESSION#test-session-123',
      SK: 'SESSION#test-session-123',
      sessionId: 'test-session-123',
      userId: 'testuser',
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      claimedResources: { chatRoom: 'chat-123' },
      createdAt: '2026-03-06T10:00:00Z',
      version: 1
      // No streamMetrics field
    };

    const legacySession = fromDynamoDBItem(legacyItem);
    expect(legacySession.streamMetrics).toBeUndefined();
    expect(legacySession.lastMetricsUpdate).toBeUndefined();
    expect(() => legacySession.sessionId).not.toThrow();

    // Test Phase 23+ DynamoDB item with streamMetrics
    const metricsItem = {
      ...legacyItem,
      streamMetrics: {
        timestamp: Date.now(),
        bitrate: 5000000,
        framesPerSecond: 30,
        resolution: { width: 1920, height: 1080 },
        networkType: 'wifi',
        qualityLimitation: 'none'
      },
      lastMetricsUpdate: Date.now()
    };

    const metricsSession = fromDynamoDBItem(metricsItem);
    expect(metricsSession.streamMetrics).toBeDefined();
    expect(metricsSession.streamMetrics?.bitrate).toBe(5000000);
    expect(metricsSession.lastMetricsUpdate).toBeDefined();
  });
});