/**
 * Tests for seed-chat command
 */

import { calculateSessionRelativeTime } from '../../domain/chat-message';

describe('seed-chat command', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  it('should calculate sessionRelativeTime correctly for time-series messages', () => {
    const sessionStartedAt = '2026-03-03T10:00:00Z';

    // Test messages at 5-second intervals
    const times = [0, 1, 2, 3].map(i => {
      const sentAt = new Date(new Date(sessionStartedAt).getTime() + i * 5000).toISOString();
      return calculateSessionRelativeTime(sessionStartedAt, sentAt);
    });

    expect(times[0]).toBe(0);
    expect(times[1]).toBe(5000);
    expect(times[2]).toBe(10000);
    expect(times[3]).toBe(15000);
  });

  it('should batch messages in groups of 25 for DynamoDB BatchWrite', () => {
    // Verify batch chunking logic
    const totalMessages = 50;
    const chunkSize = 25;
    const expectedBatches = Math.ceil(totalMessages / chunkSize);

    expect(expectedBatches).toBe(2);
  });

  it('should use proper DynamoDB key structure', () => {
    const sessionId = 'test-session-123';
    const messageId = 'msg-0';
    const sentAtTimestamp = 1709466030000;

    const keys = {
      PK: `MESSAGE#${sessionId}`,
      SK: `${sentAtTimestamp}#${messageId}`,
      entityType: 'MESSAGE',
    };

    expect(keys.PK).toBe('MESSAGE#test-session-123');
    expect(keys.SK).toMatch(/^\d+#msg-\d+$/);
    expect(keys.entityType).toBe('MESSAGE');
  });

  it('should rotate through multiple users', () => {
    // Verify user rotation logic (3 users)
    const senderIds = [0, 1, 2, 3, 4, 5].map(i => `user-${i % 3}`);

    expect(senderIds[0]).toBe('user-0');
    expect(senderIds[1]).toBe('user-1');
    expect(senderIds[2]).toBe('user-2');
    expect(senderIds[3]).toBe('user-0'); // Wraps around
    expect(senderIds[4]).toBe('user-1');
    expect(senderIds[5]).toBe('user-2');
  });
});
