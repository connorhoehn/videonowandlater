/**
 * Session repository - session persistence operations
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, UpdateCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Session } from '../domain/session';
import { SessionStatus, SessionType, RecordingStatus } from '../domain/session';
import { EmojiType, SHARD_COUNT } from '../domain/reaction';

/**
 * Hangout participant record - one per user per session
 */
export interface HangoutParticipant {
  sessionId: string;
  userId: string;
  displayName: string;
  participantId: string;
  joinedAt: string;
}

/**
 * Create a new session in DynamoDB
 *
 * @param tableName DynamoDB table name
 * @param session Session object to store
 */
export async function createSession(tableName: string, session: Session): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${session.sessionId}`,
      SK: 'METADATA',
      GSI1PK: `STATUS#${session.status.toUpperCase()}`,
      GSI1SK: session.createdAt,
      entityType: 'SESSION',
      ...session,
    },
  }));
}

/**
 * Get a session by ID
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to retrieve
 * @returns Session object if found, null otherwise
 */
export async function getSessionById(tableName: string, sessionId: string): Promise<Session | null> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
  }));

  if (!result.Item) {
    return null;
  }

  // Extract session fields (remove DynamoDB keys)
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = result.Item;
  return session as Session;
}

/**
 * Update session status with optimistic locking
 * Validates state transitions using canTransition
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param newStatus New status to set
 * @param timestampField Optional timestamp field to update (startedAt or endedAt)
 * @throws ConditionalCheckFailedException if invalid transition or version mismatch
 */
export async function updateSessionStatus(
  tableName: string,
  sessionId: string,
  newStatus: SessionStatus,
  timestampField?: 'startedAt' | 'endedAt'
): Promise<void> {
  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const { canTransition } = await import('../domain/session.js');
  const docClient = getDocumentClient();

  // First get current session to validate transition
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (!canTransition(session.status, newStatus)) {
    throw new Error(`Invalid transition from ${session.status} to ${newStatus}`);
  }

  const updateExpression = timestampField
    ? `SET #status = :newStatus, #timestamp = :now, GSI1PK = :gsi, #version = #version + :inc`
    : `SET #status = :newStatus, GSI1PK = :gsi, #version = #version + :inc`;

  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#version': 'version',
  };

  const expressionAttributeValues: Record<string, any> = {
    ':newStatus': newStatus,
    ':gsi': `STATUS#${newStatus.toUpperCase()}`,
    ':inc': 1,
    ':currentVersion': session.version,
  };

  if (timestampField) {
    expressionAttributeNames['#timestamp'] = timestampField;
    expressionAttributeValues[':now'] = new Date().toISOString();
  }

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ConditionExpression: '#version = :currentVersion',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Update session recording metadata fields
 * Supports partial updates of recording-related fields
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param metadata Partial recording metadata to update
 */
export async function updateRecordingMetadata(
  tableName: string,
  sessionId: string,
  metadata: {
    recordingS3Path?: string;
    recordingDuration?: number;
    thumbnailUrl?: string;
    recordingHlsUrl?: string;
    recordingStatus?: RecordingStatus | 'processing' | 'available' | 'failed' | 'pending';
    reactionSummary?: Record<string, number>;
  }
): Promise<void> {
  const docClient = getDocumentClient();

  // Build dynamic update expression for provided fields only
  const updateParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {
    '#version': 'version',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':inc': 1,
  };

  if (metadata.recordingS3Path !== undefined) {
    updateParts.push('#recordingS3Path = :recordingS3Path');
    expressionAttributeNames['#recordingS3Path'] = 'recordingS3Path';
    expressionAttributeValues[':recordingS3Path'] = metadata.recordingS3Path;
  }

  if (metadata.recordingDuration !== undefined) {
    updateParts.push('#recordingDuration = :recordingDuration');
    expressionAttributeNames['#recordingDuration'] = 'recordingDuration';
    expressionAttributeValues[':recordingDuration'] = metadata.recordingDuration;
  }

  if (metadata.thumbnailUrl !== undefined) {
    updateParts.push('#thumbnailUrl = :thumbnailUrl');
    expressionAttributeNames['#thumbnailUrl'] = 'thumbnailUrl';
    expressionAttributeValues[':thumbnailUrl'] = metadata.thumbnailUrl;
  }

  if (metadata.recordingHlsUrl !== undefined) {
    updateParts.push('#recordingHlsUrl = :recordingHlsUrl');
    expressionAttributeNames['#recordingHlsUrl'] = 'recordingHlsUrl';
    expressionAttributeValues[':recordingHlsUrl'] = metadata.recordingHlsUrl;
  }

  if (metadata.recordingStatus !== undefined) {
    updateParts.push('#recordingStatus = :recordingStatus');
    expressionAttributeNames['#recordingStatus'] = 'recordingStatus';
    expressionAttributeValues[':recordingStatus'] = metadata.recordingStatus;
  }

  if (metadata.reactionSummary !== undefined) {
    updateParts.push('#reactionSummary = :reactionSummary');
    expressionAttributeNames['#reactionSummary'] = 'reactionSummary';
    expressionAttributeValues[':reactionSummary'] = metadata.reactionSummary;
  }

  if (updateParts.length === 0) {
    // No fields to update
    return;
  }

  const updateExpression = `SET ${updateParts.join(', ')}, #version = #version + :inc`;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Compute per-emoji reaction counts for a session and store on session record
 * Queries all shards for each emoji type and aggregates counts
 * Called at session end (recording-ended handler) to pre-compute summaries
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @returns Promise resolving to reactionSummary map { emojiType: count, ... }
 */
export async function computeAndStoreReactionSummary(
  tableName: string,
  sessionId: string
): Promise<Record<string, number>> {
  const docClient = getDocumentClient();
  const reactionSummary: Record<string, number> = {};

  try {
    // For each emoji type, count reactions across all shards
    for (const emojiType of Object.values(EmojiType)) {
      let emojiCount = 0;
      const queryPromises = [];

      for (let shardId = 1; shardId <= SHARD_COUNT; shardId++) {
        const pk = `REACTION#${sessionId}#${emojiType}#SHARD${shardId}`;
        queryPromises.push(
          docClient.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: 'PK = :pk',
              ExpressionAttributeValues: {
                ':pk': pk,
              },
              Select: 'COUNT',
            })
          )
        );
      }

      // Execute all shard queries in parallel
      const results = await Promise.all(queryPromises);

      // Sum up counts across all shards
      for (const result of results) {
        emojiCount += result.Count || 0;
      }

      // Store count in summary (include even if 0 for completeness)
      reactionSummary[emojiType] = emojiCount;
    }

    console.log('Computed reaction summary:', { sessionId, reactionSummary });

    // Update session record with reaction summary
    await updateRecordingMetadata(tableName, sessionId, {
      reactionSummary,
    });

    return reactionSummary;
  } catch (error) {
    console.error('Error computing reaction summary:', error);
    throw error;  // Caller (recording-ended) handles with try/catch
  }
}

/**
 * Get recently recorded sessions
 * Returns sessions that have ended or are ending (recording may still be processing).
 * Excludes failed recordings. Sorted by endedAt descending.
 *
 * @param tableName DynamoDB table name
 * @param limit Maximum number of recordings to return (default 20)
 * @returns Array of Session objects
 */
export async function getRecentRecordings(
  tableName: string,
  limit: number = 20
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :session) AND #status IN (:ending, :ended) AND #recordingStatus <> :failed',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#recordingStatus': 'recordingStatus',
      },
      ExpressionAttributeValues: {
        ':session': 'SESSION#',
        ':ending': SessionStatus.ENDING,
        ':ended': SessionStatus.ENDED,
        ':failed': 'failed',
      },
      Limit: limit * 2, // Scan is cheaper with higher limit; we'll sort in memory
    })
  );

  if (!result.Items) {
    return [];
  }

  // Extract session fields and sort by endedAt descending
  const sessions = result.Items
    .map(item => {
      const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
      return session as Session;
    })
    .sort((a, b) => {
      const aTime = a.endedAt ? new Date(a.endedAt).getTime() : 0;
      const bTime = b.endedAt ? new Date(b.endedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);

  return sessions;
}

/**
 * Find session by Stage ARN (used for hangout/RealTime recordings)
 *
 * @param tableName DynamoDB table name
 * @param stageArn Stage ARN to search for
 * @returns Session object if found, null otherwise
 */
export async function findSessionByStageArn(
  tableName: string,
  stageArn: string
): Promise<Session | null> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :pkPrefix) AND claimedResources.stage = :stageArn',
    ExpressionAttributeValues: {
      ':pkPrefix': 'SESSION#',
      ':stageArn': stageArn,
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0];
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
  return session as Session;
}

/**
 * Add hangout participant to session
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param userId User ID
 * @param displayName Display name
 * @param participantId Unique participant ID (generated by client or API)
 */
export async function addHangoutParticipant(
  tableName: string,
  sessionId: string,
  userId: string,
  displayName: string,
  participantId: string
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `PARTICIPANT#${userId}`,
      entityType: 'PARTICIPANT',
      sessionId,
      userId,
      displayName,
      participantId,
      joinedAt: new Date().toISOString(),
    },
  }));
}

/**
 * Get all participants for a hangout session
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @returns Array of HangoutParticipant objects
 */
export async function getHangoutParticipants(
  tableName: string,
  sessionId: string,
): Promise<HangoutParticipant[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'PARTICIPANT#',
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  // Strip DynamoDB keys, return clean participant objects
  return result.Items.map(item => {
    const { PK, SK, entityType, ...participant } = item;
    return participant as HangoutParticipant;
  });
}

/**
 * Update participant count on session METADATA record
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param participantCount Number of unique participants
 */
export async function updateParticipantCount(
  tableName: string,
  sessionId: string,
  participantCount: number,
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #participantCount = :count, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#participantCount': 'participantCount',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':count': participantCount,
      ':inc': 1,
    },
  }));
}

/**
 * Update transcript status and metadata on a session record
 * Used by transcription pipeline to track MediaConvert and Transcribe job progress
 * Atomically updates transcript-related fields without affecting other session data
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param status Transcript lifecycle status: 'processing' | 'available' | 'failed'
 * @param s3Path Optional S3 path where transcript JSON is stored (format: s3://bucket/sessionId/transcript.json)
 * @param plainText Optional plain text transcript for display (extracted from Transcribe JSON output)
 */
export async function updateTranscriptStatus(
  tableName: string,
  sessionId: string,
  status: 'processing' | 'available' | 'failed',
  s3Path?: string,
  plainText?: string
): Promise<void> {
  const docClient = getDocumentClient();

  // Build dynamic update expression for provided fields only
  const updateParts: string[] = ['#transcriptStatus = :status', '#version = #version + :inc'];
  const expressionAttributeNames: Record<string, string> = {
    '#transcriptStatus': 'transcriptStatus',
    '#version': 'version',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':inc': 1,
  };

  if (s3Path !== undefined) {
    updateParts.push('#transcriptS3Path = :s3Path');
    expressionAttributeNames['#transcriptS3Path'] = 'transcriptS3Path';
    expressionAttributeValues[':s3Path'] = s3Path;
  }

  if (plainText !== undefined) {
    updateParts.push('#transcript = :plainText');
    expressionAttributeNames['#transcript'] = 'transcript';
    expressionAttributeValues[':plainText'] = plainText;
  }

  const updateExpression = `SET ${updateParts.join(', ')}`;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));

  console.log('Transcript status updated:', { sessionId, status, s3Path });
}

/**
 * Update diarized transcript S3 path on a session record
 * Called by transcribe-completed handler after writing speaker-segments.json to S3
 * Does NOT affect transcriptStatus or any other pipeline fields
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param diarizedTranscriptS3Path S3 key where speaker-segments.json is stored
 */
export async function updateDiarizedTranscriptPath(
  tableName: string,
  sessionId: string,
  diarizedTranscriptS3Path: string
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #diarizedTranscriptS3Path = :path, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#diarizedTranscriptS3Path': 'diarizedTranscriptS3Path',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':path': diarizedTranscriptS3Path,
      ':inc': 1,
    },
  }));

  console.log('Diarized transcript path updated:', { sessionId, diarizedTranscriptS3Path });
}

/**
 * Update session AI summary fields (aiSummary and/or aiSummaryStatus)
 * Non-blocking pattern: used to store Bedrock-generated summaries without affecting transcript
 * Selective updates only affect provided fields; transcriptText is never touched
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param updates Partial update object with optional aiSummary and aiSummaryStatus fields
 */
export async function updateSessionAiSummary(
  tableName: string,
  sessionId: string,
  updates: {
    aiSummary?: string;
    aiSummaryStatus?: 'pending' | 'available' | 'failed';
  }
): Promise<void> {
  const docClient = getDocumentClient();

  // Build dynamic update expression for provided fields only
  const updateParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {
    '#version': 'version',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':inc': 1,
  };

  if (updates.aiSummary !== undefined) {
    updateParts.push('#aiSummary = :aiSummary');
    expressionAttributeNames['#aiSummary'] = 'aiSummary';
    expressionAttributeValues[':aiSummary'] = updates.aiSummary;
  }

  if (updates.aiSummaryStatus !== undefined) {
    updateParts.push('#aiSummaryStatus = :aiSummaryStatus');
    expressionAttributeNames['#aiSummaryStatus'] = 'aiSummaryStatus';
    expressionAttributeValues[':aiSummaryStatus'] = updates.aiSummaryStatus;
  }

  if (updateParts.length === 0) {
    return; // No updates to apply
  }

  const updateExpression = `SET ${updateParts.join(', ')}, #version = #version + :inc`;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));

  console.log('AI summary updated:', { sessionId, ...updates });
}

/**
 * Get all sessions sorted by creation time for activity feed
 * Returns sessions of all types (BROADCAST, HANGOUT, UPLOAD) with all activity metadata
 * Used by GET /activity endpoint to populate activity feed
 *
 * @param tableName DynamoDB table name
 * @param limit Maximum number of sessions to return (default 50)
 * @returns Array of Session objects sorted by createdAt descending
 */
export async function getRecentActivity(
  tableName: string,
  limit: number = 50
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :session) AND (#status IN (:ending, :ended) OR (#sessionType = :upload AND attribute_exists(#uploadStatus)))',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#sessionType': 'sessionType',
        '#uploadStatus': 'uploadStatus',
      },
      ExpressionAttributeValues: {
        ':session': 'SESSION#',
        ':ending': SessionStatus.ENDING,
        ':ended': SessionStatus.ENDED,
        ':upload': SessionType.UPLOAD,
      },
      Limit: limit * 2, // Scan is cheaper with higher limit; we'll sort in memory
    })
  );

  if (!result.Items) {
    return [];
  }

  // Extract session fields and sort by createdAt descending
  const sessions = result.Items
    .map(item => {
      const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
      return session as Session;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  return sessions;
}

/**
 * Create a new UPLOAD session with source file metadata
 * Initializes session with status=creating and uploadStatus=pending
 *
 * @param tableName DynamoDB table name
 * @param userId User ID who created the upload session
 * @param sourceFileName Name of uploaded file
 * @param sourceFileSize Size of uploaded file in bytes
 * @param sourceCodec Optional codec of source file (e.g., 'H.264', 'H.265')
 * @returns Newly created Session object
 */
export async function createUploadSession(
  tableName: string,
  userId: string,
  sourceFileName: string,
  sourceFileSize: number,
  sourceCodec?: string
): Promise<Session> {
  const sessionId = uuidv4();
  const now = new Date().toISOString();

  const uploadSession: Session = {
    sessionId,
    userId,
    sessionType: SessionType.UPLOAD,
    status: SessionStatus.CREATING,
    claimedResources: { chatRoom: '' },
    createdAt: now,
    version: 1,
    // Upload tracking fields
    uploadStatus: 'pending',
    uploadProgress: 0,
    sourceFileName,
    sourceFileSize,
    sourceCodec,
  };

  // Create session in DynamoDB
  await createSession(tableName, uploadSession);

  return uploadSession;
}

/**
 * Update upload progress tracking
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param uploadStatus New upload status ('pending' | 'processing' | 'converting' | 'available' | 'failed')
 * @param uploadProgress Progress percentage 0-100
 */
export async function updateUploadProgress(
  tableName: string,
  sessionId: string,
  uploadStatus: string,
  uploadProgress: number
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #uploadStatus = :status, #uploadProgress = :progress, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#uploadStatus': 'uploadStatus',
      '#uploadProgress': 'uploadProgress',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':status': uploadStatus,
      ':progress': uploadProgress,
      ':inc': 1,
    },
  }));
}

/**
 * Update convert status after MediaConvert job submission or completion
 * Stores job name and conversion progress
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param mediaConvertJobName Job name in format vnl-{sessionId}-{timestamp}
 * @param convertStatus Status ('pending' | 'processing' | 'available' | 'failed')
 */
export async function updateConvertStatus(
  tableName: string,
  sessionId: string,
  mediaConvertJobName: string,
  convertStatus: string
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #mediaConvertJobName = :jobName, #convertStatus = :status, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#mediaConvertJobName': 'mediaConvertJobName',
      '#convertStatus': 'convertStatus',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':jobName': mediaConvertJobName,
      ':status': convertStatus,
      ':inc': 1,
    },
  }));
}

/**
 * Update session with recording metadata after MediaConvert completion
 * Atomic update for recording-related fields including convert and upload status
 * Used by on-mediaconvert-complete handler to update session after encoding
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param updates Partial update object with optional recording and conversion fields
 */
export async function updateSessionRecording(
  tableName: string,
  sessionId: string,
  updates: {
    recordingHlsUrl?: string;
    recordingStatus?: string;
    recordingDuration?: number;
    convertStatus?: string;
    uploadStatus?: string;
    status?: string;
  }
): Promise<void> {
  const docClient = getDocumentClient();

  // Build UpdateExpression dynamically based on provided fields
  const fields: string[] = [];
  const values: Record<string, any> = {};
  const names: Record<string, string> = {
    '#version': 'version',
  };

  if (updates.recordingHlsUrl !== undefined) {
    fields.push('#recordingHlsUrl = :recordingHlsUrl');
    names['#recordingHlsUrl'] = 'recordingHlsUrl';
    values[':recordingHlsUrl'] = updates.recordingHlsUrl;
  }
  if (updates.recordingStatus !== undefined) {
    fields.push('#recordingStatus = :recordingStatus');
    names['#recordingStatus'] = 'recordingStatus';
    values[':recordingStatus'] = updates.recordingStatus;
  }
  if (updates.recordingDuration !== undefined) {
    fields.push('#recordingDuration = :recordingDuration');
    names['#recordingDuration'] = 'recordingDuration';
    values[':recordingDuration'] = updates.recordingDuration;
  }
  if (updates.convertStatus !== undefined) {
    fields.push('#convertStatus = :convertStatus');
    names['#convertStatus'] = 'convertStatus';
    values[':convertStatus'] = updates.convertStatus;
  }
  if (updates.uploadStatus !== undefined) {
    fields.push('#uploadStatus = :uploadStatus');
    names['#uploadStatus'] = 'uploadStatus';
    values[':uploadStatus'] = updates.uploadStatus;
  }
  if (updates.status !== undefined) {
    fields.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = updates.status;
  }

  if (fields.length === 0) {
    return; // No updates provided
  }

  // Always increment version
  fields.push('#version = #version + :inc');
  values[':inc'] = 1;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: `SET ${fields.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/**
 * Get live public sessions for spotlight selection
 * Queries GSI1 for STATUS#LIVE, filters out private sessions and optionally the caller's own session
 *
 * @param tableName DynamoDB table name
 * @param excludeUserId Optional userId to exclude (typically the caller's own session)
 * @param limit Maximum number of sessions to return (default 50)
 * @returns Array of public live Session objects
 */
export async function getLivePublicSessions(
  tableName: string,
  excludeUserId?: string,
  limit: number = 50
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const expressionAttributeNames: Record<string, string> = {
    '#isPrivate': 'isPrivate',
    '#userId': 'userId',
  };

  const expressionAttributeValues: Record<string, any> = {
    ':status': 'STATUS#LIVE',
    ':true': true,
  };

  let filterExpression: string;
  if (excludeUserId) {
    filterExpression = '(attribute_not_exists(#isPrivate) OR #isPrivate <> :true) AND #userId <> :excludeUser';
    expressionAttributeValues[':excludeUser'] = excludeUserId;
  } else {
    filterExpression = '(attribute_not_exists(#isPrivate) OR #isPrivate <> :true)';
  }

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    FilterExpression: filterExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: limit,
    ScanIndexForward: false,
  }));

  return result.Items?.map(item => {
    const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
    return session as Session;
  }) || [];
}

/**
 * Update spotlight (featured creator) on a session
 * Sets or clears the featuredCreatorId and featuredCreatorName fields
 * Uses conditional write to ensure session exists
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param featuredCreatorId Session ID of featured creator, or null to clear
 * @param featuredCreatorName Display name of featured creator, or null to clear
 */
export async function updateSpotlight(
  tableName: string,
  sessionId: string,
  featuredCreatorId: string | null,
  featuredCreatorName: string | null
): Promise<void> {
  const docClient = getDocumentClient();

  if (featuredCreatorId === null && featuredCreatorName === null) {
    // Clear spotlight: REMOVE both attributes
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'REMOVE #featuredCreatorId, #featuredCreatorName SET #version = #version + :inc',
      ExpressionAttributeNames: {
        '#featuredCreatorId': 'featuredCreatorId',
        '#featuredCreatorName': 'featuredCreatorName',
        '#version': 'version',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
      },
      ConditionExpression: 'attribute_exists(PK)',
    }));
  } else {
    // Set spotlight
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET #featuredCreatorId = :featuredCreatorId, #featuredCreatorName = :featuredCreatorName, #version = #version + :inc',
      ExpressionAttributeNames: {
        '#featuredCreatorId': 'featuredCreatorId',
        '#featuredCreatorName': 'featuredCreatorName',
        '#version': 'version',
      },
      ExpressionAttributeValues: {
        ':featuredCreatorId': featuredCreatorId,
        ':featuredCreatorName': featuredCreatorName,
        ':inc': 1,
      },
      ConditionExpression: 'attribute_exists(PK)',
    }));
  }
}

/**
 * Claim a private channel from the pre-warmed pool for a private broadcast session
 * Private channels require JWT tokens for playback authentication
 * Returns null if no private channels available; caller should retry or fail gracefully
 *
 * @param tableName DynamoDB table name
 * @returns Object with channelArn and isPrivate=true, or null if no channels available
 */
export async function claimPrivateChannel(
  tableName: string
): Promise<{ channelArn: string; isPrivate: boolean } | null> {
  const docClient = getDocumentClient();

  // Query GSI1 for available private channels
  const queryResult = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'STATUS#AVAILABLE#PRIVATE_CHANNEL',
      },
      Limit: 1,
    })
  );

  if (!queryResult.Items?.length) {
    return null; // No available private channels
  }

  const poolItem = queryResult.Items[0];
  const channelArn = poolItem.channelArn as string;

  // Transition pool item to CLAIMED state
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: poolItem.PK as string,
          SK: poolItem.SK as string,
        },
        UpdateExpression: 'SET GSI1PK = :claimed',
        ExpressionAttributeValues: {
          ':claimed': 'STATUS#CLAIMED#PRIVATE_CHANNEL',
          ':expected': 'STATUS#AVAILABLE#PRIVATE_CHANNEL',
        },
        ConditionExpression: 'GSI1PK = :expected',
      })
    );
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Pool item was claimed by another concurrent request; retry by calling again
      return null;
    }
    throw err;
  }

  // Return claimed channel with isPrivate flag
  return {
    channelArn,
    isPrivate: true,
  };
}
