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
