import { useMemo } from 'react';

export function useCommentHighlight(
  comments: { commentId: string; videoPositionMs: number }[],
  syncTime: number
): Set<string> {
  return useMemo(() => {
    const set = new Set<string>();
    for (const c of comments) {
      if (Math.abs(c.videoPositionMs - syncTime) <= 1500) {
        set.add(c.commentId);
      }
    }
    return set;
  }, [comments, syncTime]);
}
