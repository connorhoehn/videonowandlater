/**
 * Reaction service - IVS Chat SendEvent integration for live reaction broadcasting
 */

import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { Logger } from '@aws-lambda-powertools/logger';
import { getIVSChatClient } from '../lib/ivs-clients';
import { EmojiType } from '../domain/reaction';

const logger = new Logger({ serviceName: 'vnl-api' });

/**
 * Broadcast a reaction to all connected chat clients via IVS SendEvent
 * Used for live reactions during active sessions
 *
 * @param chatRoomArn IVS Chat Room ARN
 * @param userId User ID who sent the reaction
 * @param emojiType Emoji type of the reaction
 * @param sessionRelativeTime Milliseconds since session start
 * @returns Event ID from IVS Chat SendEvent response
 * @throws Error if SendEvent fails (propagates AWS SDK errors)
 */
export async function broadcastReaction(
  chatRoomArn: string,
  userId: string,
  emojiType: EmojiType,
  sessionRelativeTime: number
): Promise<string> {
  const chatClient = getIVSChatClient();

  const command = new SendEventCommand({
    roomIdentifier: chatRoomArn,
    eventName: 'reaction',
    attributes: {
      emojiType: emojiType.toString(),
      userId: userId,
      timestamp: sessionRelativeTime.toString(),
      displayName: userId, // Use userId as displayName for simplicity (user profiles deferred)
    },
  });

  try {
    const response = await chatClient.send(command);
    return response.id!;
  } catch (error) {
    logger.error('Error broadcasting reaction', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
