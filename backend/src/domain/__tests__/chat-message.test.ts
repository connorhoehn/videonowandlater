/**
 * Tests for ChatMessage domain model
 */

import { calculateSessionRelativeTime } from '../chat-message';
import type { ChatMessage } from '../chat-message';

describe('ChatMessage Domain Model', () => {
  describe('ChatMessage interface', () => {
    it('should have required fields', () => {
      const message: ChatMessage = {
        messageId: 'msg-123',
        sessionId: 'session-123',
        senderId: 'user-123',
        content: 'Hello, world!',
        sentAt: '2026-03-02T15:00:00.000Z',
        sessionRelativeTime: 5000,
        senderAttributes: { displayName: 'Test User', role: 'broadcaster' },
      };

      expect(message.messageId).toBe('msg-123');
      expect(message.sessionId).toBe('session-123');
      expect(message.senderId).toBe('user-123');
      expect(message.content).toBe('Hello, world!');
      expect(message.sentAt).toBe('2026-03-02T15:00:00.000Z');
      expect(message.sessionRelativeTime).toBe(5000);
      expect(message.senderAttributes).toEqual({ displayName: 'Test User', role: 'broadcaster' });
    });
  });

  describe('calculateSessionRelativeTime', () => {
    it('should return correct millisecond difference', () => {
      const sessionStartedAt = '2026-03-02T15:00:00.000Z';
      const messageSentAt = '2026-03-02T15:00:05.000Z';

      const result = calculateSessionRelativeTime(sessionStartedAt, messageSentAt);

      expect(result).toBe(5000); // 5 seconds = 5000 milliseconds
    });

    it('should handle same timestamp (returns 0)', () => {
      const timestamp = '2026-03-02T15:00:00.000Z';

      const result = calculateSessionRelativeTime(timestamp, timestamp);

      expect(result).toBe(0);
    });

    it('should handle message before session start (negative value)', () => {
      const sessionStartedAt = '2026-03-02T15:00:10.000Z';
      const messageSentAt = '2026-03-02T15:00:05.000Z';

      const result = calculateSessionRelativeTime(sessionStartedAt, messageSentAt);

      expect(result).toBe(-5000); // -5 seconds
    });

    it('should handle large time differences', () => {
      const sessionStartedAt = '2026-03-02T15:00:00.000Z';
      const messageSentAt = '2026-03-02T16:30:00.000Z'; // 90 minutes later

      const result = calculateSessionRelativeTime(sessionStartedAt, messageSentAt);

      expect(result).toBe(90 * 60 * 1000); // 5,400,000 milliseconds
    });

    it('should handle millisecond precision', () => {
      const sessionStartedAt = '2026-03-02T15:00:00.000Z';
      const messageSentAt = '2026-03-02T15:00:00.123Z';

      const result = calculateSessionRelativeTime(sessionStartedAt, messageSentAt);

      expect(result).toBe(123);
    });
  });
});
