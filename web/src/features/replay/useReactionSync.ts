import { useMemo } from 'react';
import type { Reaction } from '../../../../backend/src/domain/reaction';

/**
 * Filters reactions based on video playback position
 *
 * Uses sessionRelativeTime (milliseconds since stream start) to determine
 * which reactions should be visible at the current playback position.
 *
 * Pattern reused from Phase 6 useSynchronizedChat for consistent sync behavior.
 *
 * @param allReactions - Full reaction history for the session
 * @param currentSyncTime - Elapsed playback milliseconds from player.getPosition() * 1000
 * @returns Filtered array of reactions that should be visible at current playback position
 */
export function useReactionSync(
  allReactions: Reaction[],
  currentSyncTime: number
): Reaction[] {
  return useMemo(() => {
    if (currentSyncTime === 0) {
      return []; // No playback started yet
    }

    return allReactions.filter(
      reaction => reaction.sessionRelativeTime !== undefined &&
                  reaction.sessionRelativeTime <= currentSyncTime
    );
  }, [allReactions, currentSyncTime]);
}
