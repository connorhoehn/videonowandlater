/** Shared utility functions for activity cards */

/** Format ISO date as relative time (e.g., "2h ago", "3d ago") */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format duration in ms as "X min Y sec" */
export function formatHumanDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}

/** Get the navigation route for a session based on type and status */
export function getSessionRoute(session: { sessionId: string; sessionType: string; status?: string }): string {
  const isLive = session.status === 'live';
  if (isLive) {
    return session.sessionType === 'HANGOUT'
      ? `/hangout/${session.sessionId}`
      : `/viewer/${session.sessionId}`;
  }
  return session.sessionType === 'UPLOAD'
    ? `/video/${session.sessionId}`
    : `/replay/${session.sessionId}`;
}
