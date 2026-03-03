/**
 * seed-chat command
 * Seed sample chat messages with sessionRelativeTime for replay testing
 */

import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getSessionById } from '../../repositories/session-repository';
import { calculateSessionRelativeTime } from '../../domain/chat-message';

/**
 * Seed sample chat messages for a session
 *
 * @param sessionId Session ID to seed chat for
 * @param options Command options with count
 */
export async function seedChat(sessionId: string, options: { count: string }): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable not set');
  }

  const count = parseInt(options.count, 10);
  if (isNaN(count) || count <= 0) {
    throw new Error('Count must be a positive number');
  }

  console.log(`Fetching session ${sessionId}...`);

  // Fetch session to get startedAt timestamp
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (!session.startedAt) {
    throw new Error(`Session ${sessionId} does not have a startedAt timestamp`);
  }

  console.log(`Seeding ${count} chat messages...`);

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Generate all messages
  const messages = [];
  for (let i = 0; i < count; i++) {
    const messageId = `msg-${i}`;
    const senderId = `user-${i % 3}`; // Rotate through 3 users
    const sentAt = new Date(new Date(session.startedAt).getTime() + i * 5000); // 5-second intervals
    const sessionRelativeTime = calculateSessionRelativeTime(session.startedAt, sentAt.toISOString());

    messages.push({
      PK: `MESSAGE#${sessionId}`,
      SK: `${sentAt.getTime()}#${messageId}`,
      entityType: 'MESSAGE',
      messageId,
      sessionId,
      senderId,
      content: `Test message ${i}`,
      sentAt: sentAt.toISOString(),
      sessionRelativeTime,
      senderAttributes: {
        displayName: `User ${i % 3}`,
      },
    });
  }

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunkSize = 25;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map(msg => ({
            PutRequest: {
              Item: msg,
            },
          })),
        },
      })
    );

    console.log(`Wrote batch ${Math.floor(i / chunkSize) + 1} (${chunk.length} messages)`);
  }

  console.log(`\nSeeded ${count} chat messages successfully!`);
}
