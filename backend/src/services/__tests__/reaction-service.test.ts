/**
 * Tests for reaction-service
 * Validates IVS Chat SendEvent integration for live reaction broadcasting
 */

import { broadcastReaction } from '../reaction-service';
import { getIVSChatClient } from '../../lib/ivs-clients';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { EmojiType } from '../../domain/reaction';

// Mock IVS Chat client
jest.mock('../../lib/ivs-clients');

describe('reaction-service', () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getIVSChatClient as jest.Mock).mockReturnValue({
      send: mockSend,
    });
  });

  describe('broadcastReaction', () => {
    it('should call SendEventCommand with correct parameters', async () => {
      const chatRoomArn = 'arn:aws:ivschat:us-east-1:123456789012:room/abcd1234';
      const userId = 'user-123';
      const emojiType = EmojiType.HEART;
      const sessionRelativeTime = 45000; // 45 seconds

      mockSend.mockResolvedValue({
        id: 'event-123',
      });

      await broadcastReaction(chatRoomArn, userId, emojiType, sessionRelativeTime);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(SendEventCommand);
      expect(command.input).toEqual({
        roomIdentifier: chatRoomArn,
        eventName: 'reaction',
        attributes: {
          emojiType: 'heart',
          userId: 'user-123',
          timestamp: '45000',
          displayName: 'user-123',
        },
      });
    });

    it('should return eventId from SendEvent response', async () => {
      const chatRoomArn = 'arn:aws:ivschat:us-east-1:123456789012:room/abcd1234';
      const userId = 'user-123';
      const emojiType = EmojiType.FIRE;
      const sessionRelativeTime = 60000;

      mockSend.mockResolvedValue({
        id: 'event-456',
      });

      const result = await broadcastReaction(chatRoomArn, userId, emojiType, sessionRelativeTime);

      expect(result).toBe('event-456');
    });

    it('should throw error if SendEvent fails', async () => {
      const chatRoomArn = 'arn:aws:ivschat:us-east-1:123456789012:room/abcd1234';
      const userId = 'user-123';
      const emojiType = EmojiType.CLAP;
      const sessionRelativeTime = 30000;

      const awsError = new Error('AccessDeniedException: Not authorized');
      mockSend.mockRejectedValue(awsError);

      await expect(
        broadcastReaction(chatRoomArn, userId, emojiType, sessionRelativeTime)
      ).rejects.toThrow('AccessDeniedException: Not authorized');
    });
  });
});
