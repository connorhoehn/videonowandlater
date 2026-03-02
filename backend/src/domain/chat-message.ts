/**
 * ChatMessage domain model
 * Defines chat message structure with session-relative timestamps for replay sync
 */

/**
 * Chat message entity
 * Represents a chat message sent during a live session
 */
export interface ChatMessage {
  messageId: string;
  sessionId: string;
  senderId: string;
  content: string;
  sentAt: string;
  sessionRelativeTime: number;
  senderAttributes: Record<string, string>;
}

/**
 * Calculate session-relative time for replay synchronization
 *
 * @param sessionStartedAt Session start timestamp (ISO 8601)
 * @param messageSentAt Message sent timestamp (ISO 8601)
 * @returns Milliseconds elapsed since session start
 */
export function calculateSessionRelativeTime(sessionStartedAt: string, messageSentAt: string): number {
  const startTime = new Date(sessionStartedAt).getTime();
  const sentTime = new Date(messageSentAt).getTime();
  return sentTime - startTime;
}
