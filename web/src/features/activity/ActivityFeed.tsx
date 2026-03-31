/**
 * ActivityFeed - Vertical activity feed displaying all recent sessions in reverse chronological order
 * Shows broadcast, hangout, and upload sessions with loading skeletons and empty state
 */

import { BroadcastActivityCard } from './BroadcastActivityCard';
import { HangoutActivityCard } from './HangoutActivityCard';
import { UploadActivityCard } from './UploadActivityCard';
import type { ActivitySession } from './RecordingSlider';

interface ActivityFeedProps {
  sessions: ActivitySession[];
  loading?: boolean;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
      {/* Thumbnail skeleton */}
      <div className="animate-shimmer h-48 sm:h-56" />
      {/* Content */}
      <div className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="animate-shimmer w-8 h-8 rounded-full flex-shrink-0" />
          <div className="animate-shimmer h-4 w-28 rounded" />
          <div className="animate-shimmer h-5 w-16 rounded-full" />
        </div>
        {/* Meta row */}
        <div className="animate-shimmer h-3 w-44 rounded mb-3" />
        {/* Reaction pills */}
        <div className="flex gap-2 mb-3">
          <div className="animate-shimmer h-7 w-14 rounded-full" />
          <div className="animate-shimmer h-7 w-14 rounded-full" />
          <div className="animate-shimmer h-7 w-14 rounded-full" />
        </div>
        {/* Summary block */}
        <div className="animate-shimmer h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-4">
        {/* Empty state icon */}
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500">No activity yet</p>
          <p className="text-xs text-gray-400 mt-1">Start a broadcast, hangout, or upload a video to get started</p>
        </div>
      </div>
    </div>
  );
}

export function ActivityFeed({ sessions, loading = false }: ActivityFeedProps) {
  // Sort by endedAt DESC (most recent first)
  const sortedSessions = [...sessions].sort((a, b) => {
    const dateA = new Date(a.endedAt || a.createdAt).getTime();
    const dateB = new Date(b.endedAt || b.createdAt).getTime();
    return dateB - dateA;
  });

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="space-y-5">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (sortedSessions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="space-y-5">
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
