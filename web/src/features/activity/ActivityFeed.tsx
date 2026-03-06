/**
 * ActivityFeed - Vertical activity feed displaying all recent sessions in reverse chronological order
 * Shows broadcast, hangout, and upload sessions
 */

import { BroadcastActivityCard } from './BroadcastActivityCard';
import { HangoutActivityCard } from './HangoutActivityCard';
import { UploadActivityCard } from './UploadActivityCard';
import type { ActivitySession } from './RecordingSlider';

interface ActivityFeedProps {
  sessions: ActivitySession[];
}

export function ActivityFeed({ sessions }: ActivityFeedProps) {
  // Sort by endedAt DESC (most recent first)
  const sortedSessions = [...sessions].sort((a, b) => {
    const dateA = new Date(a.endedAt || a.createdAt).getTime();
    const dateB = new Date(b.endedAt || b.createdAt).getTime();
    return dateB - dateA;
  });

  if (sortedSessions.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 text-center text-gray-400">
        No activity yet
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="space-y-4">
        {sortedSessions.map((session) => {
          switch (session.sessionType) {
            case 'BROADCAST':
              return <BroadcastActivityCard key={session.sessionId} session={session} />;
            case 'HANGOUT':
              return <HangoutActivityCard key={session.sessionId} session={session} />;
            case 'UPLOAD':
              return <UploadActivityCard key={session.sessionId} session={session} />;
            default:
              // Fallback for unknown session types
              return null;
          }
        })}
      </div>
    </div>
  );
}
