/**
 * Chat service - business logic for chat token generation
 */

import { CreateChatTokenCommand } from '@aws-sdk/client-ivschat';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getSessionById } from '../repositories/session-repository';

export interface GenerateChatTokenRequest {
  sessionId: string;
  userId: string;
  displayName?: string;
}

export interface GenerateChatTokenResponse {
  token: string;
  sessionExpirationTime: string;
  tokenExpirationTime: string;
}

/**
 * Generate IVS Chat token for authenticated user
 * Server-side token generation following CHAT-05 requirement
 *
 * @param tableName DynamoDB table name
 * @param request Token generation request
 * @returns Chat token with expiration times
 * @throws Error if session not found or missing chat room ARN
 */
export async function generateChatToken(
  tableName: string,
  request: GenerateChatTokenRequest
): Promise<GenerateChatTokenResponse> {
  // Fetch session to get chat room ARN
  const session = await getSessionById(tableName, request.sessionId);
  if (!session) {
    throw new Error(`Session ${request.sessionId} not found`);
  }

  // Extract chat room ARN from claimed resources
  const chatRoomArn = session.claimedResources.chatRoom;
  if (!chatRoomArn) {
    throw new Error(`Session ${request.sessionId} has no chat room claimed`);
  }

  // Determine role: broadcaster if session owner, otherwise viewer
  const role = request.userId === session.userId ? 'broadcaster' : 'viewer';

  // Determine display name
  const displayName = request.displayName || request.userId;

  // Generate chat token via IVS Chat API
  const chatClient = getIVSChatClient();
  const command = new CreateChatTokenCommand({
    roomIdentifier: chatRoomArn,
    userId: request.userId,
    capabilities: ['SEND_MESSAGE', 'DELETE_MESSAGE'],
    sessionDurationInMinutes: 60,
    attributes: {
      displayName,
      role,
    },
  });

  const response = await chatClient.send(command);

  if (!response.token || !response.sessionExpirationTime || !response.tokenExpirationTime) {
    throw new Error('Invalid response from CreateChatToken API');
  }

  return {
    token: response.token,
    sessionExpirationTime: response.sessionExpirationTime.toISOString(),
    tokenExpirationTime: response.tokenExpirationTime.toISOString(),
  };
}
