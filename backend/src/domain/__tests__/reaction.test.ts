/**
 * Reaction domain model tests
 * Tests for calculateShardId and calculateSessionRelativeTime utilities
 */

import { calculateShardId, calculateSessionRelativeTime } from '../reaction';

describe('Reaction Domain', () => {
  describe('calculateShardId', () => {
    it('should return a value between 1 and 100', () => {
      const shardId = calculateShardId('user123');
      expect(shardId).toBeGreaterThanOrEqual(1);
      expect(shardId).toBeLessThanOrEqual(100);
    });

    it('should be deterministic for the same userId', () => {
      const userId = 'user456';
      const shardId1 = calculateShardId(userId);
      const shardId2 = calculateShardId(userId);
      const shardId3 = calculateShardId(userId);

      expect(shardId1).toBe(shardId2);
      expect(shardId2).toBe(shardId3);
    });

    it('should distribute different userIds across shards', () => {
      const userIds = [
        'user1',
        'user2',
        'user3',
        'user4',
        'user5',
        'user6',
        'user7',
        'user8',
        'user9',
        'user10',
      ];

      const shardIds = userIds.map(calculateShardId);
      const uniqueShards = new Set(shardIds);

      // At least 70% of test users should get different shards (7+ unique shards)
      expect(uniqueShards.size).toBeGreaterThanOrEqual(7);
    });
  });

  describe('calculateSessionRelativeTime', () => {
    it('should calculate correct milliseconds difference', () => {
      const sessionStartedAt = '2024-01-01T10:00:00.000Z';
      const reactionTime = '2024-01-01T10:05:30.500Z';

      const relativeTime = calculateSessionRelativeTime(sessionStartedAt, reactionTime);

      // 5 minutes and 30.5 seconds = 330,500 milliseconds
      expect(relativeTime).toBe(330500);
    });

    it('should return 0 for reaction at session start', () => {
      const timestamp = '2024-01-01T10:00:00.000Z';
      const relativeTime = calculateSessionRelativeTime(timestamp, timestamp);

      expect(relativeTime).toBe(0);
    });

    it('should handle reactions within first second', () => {
      const sessionStartedAt = '2024-01-01T10:00:00.000Z';
      const reactionTime = '2024-01-01T10:00:00.250Z';

      const relativeTime = calculateSessionRelativeTime(sessionStartedAt, reactionTime);

      expect(relativeTime).toBe(250);
    });
  });
});
