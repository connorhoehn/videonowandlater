/**
 * simulate-presence command
 * Send custom presence events for viewer count testing using IVS Chat SendEvent API
 */

import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { getIVSChatClient } from '../../lib/ivs-clients';
import { getSessionById } from '../../repositories/session-repository';

interface SimulatePresenceOptions {
  viewers: string;
}

/**
 * Simulate presence/viewer activity for testing
 * Sends custom presence:update event to IVS Chat room
 *
 * @param sessionId Session ID to send presence event to
 * @param options Command options (viewers count)
 */
export async function simulatePresence(
  sessionId: string,
  options: SimulatePresenceOptions
): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable not set');
  }

  // Parse viewer count
  const viewerCount = parseInt(options.viewers, 10);
  if (isNaN(viewerCount) || viewerCount < 0) {
    throw new Error('Invalid viewer count - must be a positive number');
  }

  // Fetch session
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Extract chatRoom ARN
  const roomIdentifier = session.claimedResources.chatRoom;
  if (!roomIdentifier) {
    throw new Error(`Session ${sessionId} has no chatRoom ARN`);
  }

  // Send presence event
  const chatClient = getIVSChatClient();
  await chatClient.send(
    new SendEventCommand({
      roomIdentifier,
      eventName: 'presence:update',
      attributes: {
        viewerCount: viewerCount.toString(),
        timestamp: new Date().toISOString(),
      },
    })
  );

  console.log(`Sent presence event: ${viewerCount} viewers to session ${sessionId}`);
}
