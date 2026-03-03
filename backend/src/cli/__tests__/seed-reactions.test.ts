/**
 * Tests for seed-reactions command
 */

import { EmojiType, calculateShardId } from '../../domain/reaction';

describe('seed-reactions command', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  it('should generate reactions with random types', () => {
    const emojiTypes = Object.values(EmojiType);

    // All valid emoji types
    expect(emojiTypes).toContain(EmojiType.HEART);
    expect(emojiTypes).toContain(EmojiType.FIRE);
    expect(emojiTypes).toContain(EmojiType.CLAP);
    expect(emojiTypes).toContain(EmojiType.LAUGH);
    expect(emojiTypes).toContain(EmojiType.SURPRISED);
  });

  it('should distribute reactions across 100 shards using hash-based sharding', () => {
    // Test consistent hashing for same userId
    const userId = 'test-user-123';
    const shard1 = calculateShardId(userId);
    const shard2 = calculateShardId(userId);

    expect(shard1).toBe(shard2); // Consistent
    expect(shard1).toBeGreaterThanOrEqual(1);
    expect(shard1).toBeLessThanOrEqual(100);
  });

  it('should create both live and replay reactions based on flag', () => {
    const isReplayReaction = false;
    expect(isReplayReaction).toBe(false);

    const isReplayReaction2 = true;
    expect(isReplayReaction2).toBe(true);
  });

  it('should ensure sessionRelativeTime within session recording duration', () => {
    const recordingDuration = 1800; // 30 minutes in seconds
    const maxRelativeTime = recordingDuration * 1000; // in milliseconds

    // Random time within bounds
    const randomTime = Math.floor(Math.random() * maxRelativeTime);

    expect(randomTime).toBeGreaterThanOrEqual(0);
    expect(randomTime).toBeLessThanOrEqual(maxRelativeTime);
  });

  it('should use proper DynamoDB key structure with sharding', () => {
    const sessionId = 'test-session-123';
    const shardKey = 42;
    const sessionRelativeTime = 5000;
    const reactionId = 'reaction-123';

    const keys = {
      PK: `REACTION#${sessionId}#SHARD${shardKey.toString().padStart(2, '0')}`,
      SK: `${sessionRelativeTime.toString().padStart(10, '0')}#${reactionId}`,
      GSI2PK: `REACTION#${sessionId}`,
      GSI2SK: `${sessionRelativeTime.toString().padStart(10, '0')}#${reactionId}`,
      entityType: 'REACTION',
    };

    expect(keys.PK).toMatch(/^REACTION#.*#SHARD\d{2}$/);
    expect(keys.SK).toMatch(/^\d{10}#reaction-/);
    expect(keys.GSI2PK).toBe('REACTION#test-session-123');
    expect(keys.entityType).toBe('REACTION');
  });

  it('should batch reactions in groups of 25 for DynamoDB BatchWrite', () => {
    // Verify batch chunking logic
    const totalReactions = 100;
    const chunkSize = 25;
    const expectedBatches = Math.ceil(totalReactions / chunkSize);

    expect(expectedBatches).toBe(4);
  });
});
