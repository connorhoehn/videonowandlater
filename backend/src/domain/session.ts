/**
 * Session domain model
 * Defines the lifecycle and data structure for video sessions
 */

/**
 * Session status enum - represents the lifecycle states
 * State machine: creating -> live -> ending -> ended
 */
export enum SessionStatus {
  CREATING = 'creating',
  LIVE = 'live',
  ENDING = 'ending',
  ENDED = 'ended',
}

/**
 * Type of video session
 */
export enum SessionType {
  BROADCAST = 'BROADCAST',
  HANGOUT = 'HANGOUT',
}

/**
 * Recording status enum - represents the lifecycle of session recordings
 */
export enum RecordingStatus {
  PENDING = 'pending',      // Session created but recording not started
  PROCESSING = 'processing', // Recording in progress or finalizing
  AVAILABLE = 'available',   // Recording complete and ready
  FAILED = 'failed',        // Recording encountered an error
}

/**
 * Resources claimed by a session
 */
export interface ClaimedResources {
  channel?: string;
  stage?: string;
  chatRoom: string;
}

/**
 * Session entity
 * Represents an active or historical video session with its lifecycle state
 */
export interface Session {
  sessionId: string;
  userId: string;
  sessionType: SessionType;
  status: SessionStatus;
  claimedResources: ClaimedResources;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  version: number;
  // Recording metadata fields (populated when recording lifecycle events occur)
  recordingS3Path?: string;
  recordingDuration?: number;
  thumbnailUrl?: string;
  recordingHlsUrl?: string;
  recordingStatus?: RecordingStatus;
  reactionSummary?: Record<string, number>;
  // Transcription pipeline state (populated after recording is available)
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  transcriptS3Path?: string;
  transcript?: string;
  // Hangout participant tracking (populated at session end)
  participantCount?: number;
  // Chat activity (tracked atomically in send-message handler)
  messageCount?: number;
  // AI-generated summary pipeline (Phase 20)
  /**
   * AI-generated one-paragraph summary from Bedrock/Claude
   * Populated after transcriptStatus becomes 'available'
   */
  aiSummary?: string;
  /**
   * Status of AI summary pipeline: 'pending' (waiting to generate), 'available' (success), 'failed' (Bedrock error)
   * Used to show placeholder states on frontend during processing
   */
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
}

/**
 * Validates whether a status transition is allowed
 * @param from Current status
 * @param to Target status
 * @returns true if transition is valid, false otherwise
 */
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  const validTransitions: Record<SessionStatus, SessionStatus[]> = {
    [SessionStatus.CREATING]: [SessionStatus.LIVE],
    [SessionStatus.LIVE]: [SessionStatus.ENDING],
    [SessionStatus.ENDING]: [SessionStatus.ENDED],
    [SessionStatus.ENDED]: [],
  };

  return validTransitions[from].includes(to);
}
