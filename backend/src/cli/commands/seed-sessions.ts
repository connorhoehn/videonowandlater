/**
 * seed-sessions command
 * Creates sample broadcast and hangout sessions with recording metadata
 */

import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { v4 as uuid } from 'uuid';
import { Session, SessionType, SessionStatus, RecordingStatus } from '../../domain/session';

/**
 * Seed sample sessions for development/testing
 *
 * @param options Command options with count
 */
export async function seedSessions(options: { count: string }): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable not set');
  }

  const count = parseInt(options.count, 10);
  if (isNaN(count) || count <= 0) {
    throw new Error('Count must be a positive number');
  }

  console.log(`Seeding ${count} sessions...`);

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  for (let i = 0; i < count; i++) {
    const sessionId = uuid();
    const sessionType = i % 2 === 0 ? SessionType.BROADCAST : SessionType.HANGOUT;

    // Create timestamps with 1-hour intervals
    const createdAt = new Date(Date.now() - (count - i) * 3600000);
    const startedAt = new Date(createdAt.getTime() + 30000); // +30s
    const endedAt = new Date(startedAt.getTime() + 1800000); // +30min

    const session: Session = {
      sessionId,
      userId: `test-user-${i % 3}`,
      sessionType,
      status: SessionStatus.ENDED,
      claimedResources: {
        channel: sessionType === SessionType.BROADCAST ? `arn:aws:ivs:us-west-2:123456789:channel/${uuid()}` : undefined,
        stage: sessionType === SessionType.HANGOUT ? `arn:aws:ivs:us-west-2:123456789:stage/${uuid()}` : undefined,
        chatRoom: `arn:aws:ivschat:us-west-2:123456789:room/${uuid()}`,
      },
      createdAt: createdAt.toISOString(),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      version: 1,
      // Recording metadata
      recordingStatus: RecordingStatus.AVAILABLE,
      recordingDuration: 1800, // 30 minutes
      recordingS3Path: `s3://vnl-recordings/sessions/${sessionId}/recording.mp4`,
      recordingHlsUrl: `https://d1234567890.cloudfront.net/sessions/${sessionId}/playlist.m3u8`,
      thumbnailUrl: `https://d1234567890.cloudfront.net/sessions/${sessionId}/thumbnail.jpg`,
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: 'METADATA',
          GSI1PK: `STATUS#${session.status.toUpperCase()}`,
          GSI1SK: session.createdAt,
          entityType: 'SESSION',
          ...session,
        },
      })
    );

    console.log(`Created ${sessionType} session: ${sessionId}`);
  }

  console.log(`\nSeeded ${count} sessions successfully!`);
}
