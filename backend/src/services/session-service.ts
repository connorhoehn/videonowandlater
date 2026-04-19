/**
 * Session service - business logic orchestrating pool claims and session creation
 */

import { v4 as uuidv4 } from 'uuid';
import type { Session } from '../domain/session';
import { SessionType, SessionStatus, RecordingStatus } from '../domain/session';
import { ResourceType } from '../domain/types';
import { claimNextAvailableResource } from '../repositories/resource-pool-repository';
import { createSession, getSessionById } from '../repositories/session-repository';

const MAX_RETRIES = 3;

interface CreateSessionRequest {
  userId: string;
  sessionType: SessionType;
  // Phase 4: image moderation (Nova Lite) — optional
  moderationEnabled?: boolean;
  rulesetName?: string;
  rulesetVersion?: number;
  // Live captions — opt-in; defaults to false when omitted
  captionsEnabled?: boolean;
}

interface CreateSessionResponse {
  sessionId: string;
  sessionType: SessionType;
  status: SessionStatus;
  error?: string;
}

interface GetSessionResponse {
  sessionId: string;
  sessionType: SessionType;
  status: SessionStatus;
  userId: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  recordingHlsUrl?: string;
  recordingDuration?: number;
  thumbnailUrl?: string;
  recordingStatus?: RecordingStatus;
  reactionSummary?: Record<string, number>;
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  convertStatus?: 'pending' | 'processing' | 'available' | 'failed';
  mediaConvertJobName?: string;
  // Phase 4: image moderation
  moderationEnabled?: boolean;
  rulesetName?: string;
}

/**
 * Create a new session by claiming resources from the pool
 * Implements retry logic for handling concurrent claim conflicts
 *
 * @param tableName DynamoDB table name
 * @param request Session creation request
 * @returns Session response with sessionId, type, and status (or error if pool exhausted)
 */
export async function createNewSession(
  tableName: string,
  request: CreateSessionRequest
): Promise<CreateSessionResponse> {
  const sessionId = uuidv4();

  // Claim resources with retry logic (per research Pitfall 1)
  let channelArn: string | undefined;
  let stageArn: string | undefined;
  let chatRoomArn: string | undefined;

  // Claim channel (for BROADCAST) or stage (for HANGOUT)
  if (request.sessionType === SessionType.BROADCAST) {
    const channelResult = await claimResourceWithRetry(tableName, sessionId, ResourceType.CHANNEL, MAX_RETRIES);
    if (!channelResult) {
      return {
        sessionId,
        sessionType: request.sessionType,
        status: SessionStatus.CREATING,
        error: 'No available channels - pool exhausted',
      };
    }
    channelArn = channelResult.resourceArn;
  } else {
    const stageResult = await claimResourceWithRetry(tableName, sessionId, ResourceType.STAGE, MAX_RETRIES);
    if (!stageResult) {
      return {
        sessionId,
        sessionType: request.sessionType,
        status: SessionStatus.CREATING,
        error: 'No available stages - pool exhausted',
      };
    }
    stageArn = stageResult.resourceArn;
  }

  // Claim chat room (for both types)
  const roomResult = await claimResourceWithRetry(tableName, sessionId, ResourceType.ROOM, MAX_RETRIES);
  if (!roomResult) {
    return {
      sessionId,
      sessionType: request.sessionType,
      status: SessionStatus.CREATING,
      error: 'No available chat rooms - pool exhausted',
    };
  }
  chatRoomArn = roomResult.resourceArn;

  // Create session in DynamoDB
  const session: Session = {
    sessionId,
    userId: request.userId,
    sessionType: request.sessionType,
    status: SessionStatus.CREATING,
    claimedResources: {
      channel: channelArn,
      stage: stageArn,
      chatRoom: chatRoomArn,
    },
    // Denormalized for GSI-based lookups (avoids full-table scans)
    channelArn,
    stageArn,
    createdAt: new Date().toISOString(),
    version: 1,
    // Phase 4: pin ruleset at session creation (never read CURRENT at runtime)
    ...(request.moderationEnabled
      ? {
          moderationEnabled: true,
          rulesetName: request.rulesetName,
          rulesetVersion: request.rulesetVersion,
          moderationStrikes: 0,
        }
      : {}),
    // Live captions flag — defaults to false when omitted (opt-in only)
    ...(request.captionsEnabled === true ? { captionsEnabled: true } : {}),
  };

  await createSession(tableName, session);

  return {
    sessionId,
    sessionType: request.sessionType,
    status: SessionStatus.CREATING,
  };
}

/**
 * Retry helper for claiming resources
 * Handles both pool exhaustion and concurrent claim conflicts
 */
async function claimResourceWithRetry(
  tableName: string,
  sessionId: string,
  resourceType: ResourceType,
  maxRetries: number
): Promise<{ resourceArn: string } | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await claimNextAvailableResource(tableName, sessionId, resourceType);
    if (result) {
      return result;
    }
    // null = either pool exhausted or ConditionalCheckFailedException
    // Retry immediately (no backoff for v1 - can add later if needed)
  }
  return null;
}

/**
 * Get a session by ID
 * Returns user-safe object without AWS ARNs (per SESS-04)
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to retrieve
 * @returns Session response with sessionId, type, and status (no ARNs)
 */
export async function getSession(tableName: string, sessionId: string): Promise<GetSessionResponse | null> {
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return null;
  }

  // Return user-safe object (per SESS-04: no AWS ARNs exposed)
  return {
    sessionId: session.sessionId,
    sessionType: session.sessionType,
    status: session.status,
    userId: session.userId,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    recordingHlsUrl: session.recordingHlsUrl,
    recordingDuration: session.recordingDuration,
    thumbnailUrl: session.thumbnailUrl,
    recordingStatus: session.recordingStatus,
    reactionSummary: session.reactionSummary,
    aiSummary: session.aiSummary,
    aiSummaryStatus: session.aiSummaryStatus,
    transcriptStatus: session.transcriptStatus,
    convertStatus: session.convertStatus,
    mediaConvertJobName: session.mediaConvertJobName,
    // Phase 4: safe-to-expose fields for moderation UI (version/strikes are NOT exposed)
    moderationEnabled: session.moderationEnabled,
    rulesetName: session.rulesetName,
  };
}
