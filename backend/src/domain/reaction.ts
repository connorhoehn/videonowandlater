/**
 * Reaction domain model
 * Defines emoji reaction structure with sharding for high-throughput writes
 */

/**
 * Emoji types supported for reactions
 * Limited to 5 types for viral engagement patterns
 */
export const EmojiType = {
  HEART: 'heart',
  FIRE: 'fire',
  CLAP: 'clap',
  LAUGH: 'laugh',
  SURPRISED: 'surprised',
} as const;
export type EmojiType = typeof EmojiType[keyof typeof EmojiType];

/**
 * Reaction type distinguishes live vs replay contexts
 */
export const ReactionType = {
  LIVE: 'live',
  REPLAY: 'replay',
} as const;
export type ReactionType = typeof ReactionType[keyof typeof ReactionType];

/**
 * Reaction entity
 * Represents an emoji reaction sent during a live session or replay
 */
export interface Reaction {
  reactionId: string;
  sessionId: string;
  userId: string;
  emojiType: EmojiType;
  reactionType: ReactionType;
  reactedAt: string;
  sessionRelativeTime: number;
  shardId: number;
}

/**
 * Number of shards for reaction write distribution
 * 100 shards * 1000 WCU per shard = 100K WCU capacity
 */
export const SHARD_COUNT = 100;

/**
 * Calculate consistent shard ID from userId
 * Uses simple UTF-8 character code sum modulo SHARD_COUNT
 *
 * @param userId User identifier
 * @returns Shard ID between 1 and 100 (inclusive)
 */
export function calculateShardId(userId: string): number {
  let hash = 0;

  for (let i = 0; i < userId.length; i++) {
    hash += userId.charCodeAt(i);
  }

  // Modulo SHARD_COUNT gives 0-99, add 1 to get 1-100
  return (hash % SHARD_COUNT) + 1;
}

/**
 * Calculate session-relative time for replay synchronization
 *
 * @param sessionStartedAt Session start timestamp (ISO 8601)
 * @param reactionTime Reaction timestamp (ISO 8601)
 * @returns Milliseconds elapsed since session start
 */
export function calculateSessionRelativeTime(sessionStartedAt: string, reactionTime: string): number {
  const startTime = new Date(sessionStartedAt).getTime();
  const reactTime = new Date(reactionTime).getTime();
  return reactTime - startTime;
}
