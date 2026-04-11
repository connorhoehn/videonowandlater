/**
 * ActivityFeed - Vertical activity feed displaying all recent sessions in reverse chronological order
 * Shows broadcast, hangout, and upload sessions with loading skeletons and empty state
 */

import { motion } from 'motion/react';
import { Card, InfiniteScroll, Skeleton } from '../../components/social';
import { BroadcastActivityCard } from './BroadcastActivityCard';
import { HangoutActivityCard } from './HangoutActivityCard';
import { UploadActivityCard } from './UploadActivityCard';
import type { ActivitySession } from './RecordingSlider';

const feedVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

interface ActivityFeedProps {
  sessions: ActivitySession[];
  loading?: boolean;
  /** Called when the user scrolls near the bottom and more pages exist */
  onLoadMore?: () => void | Promise<void>;
  /** Whether additional pages are available */
  hasMore?: boolean;
  /** Whether a next page is currently being fetched */
  loadingMore?: boolean;
}

function SkeletonCard() {
  return (
    <Card>
      {/* Thumbnail skeleton */}
      <Skeleton.Rect height="h-48 sm:h-56" rounded="rounded-none" />
      <Card.Body>
        {/* Header row */}
        <div className="flex items-center gap-2.5 mb-2.5">
          <Skeleton.Circle size="w-8 h-8" className="flex-shrink-0" />
          <Skeleton.Line width="w-28" height="h-4" />
          <Skeleton.Line width="w-16" height="h-5" className="rounded-full" />
        </div>
        {/* Meta row */}
        <Skeleton.Line width="w-44" height="h-3" className="mb-3" />
        {/* Reaction pills */}
        <div className="flex gap-2 mb-3">
          <Skeleton.Line width="w-14" height="h-7" className="rounded-full" />
          <Skeleton.Line width="w-14" height="h-7" className="rounded-full" />
          <Skeleton.Line width="w-14" height="h-7" className="rounded-full" />
        </div>
        {/* Summary block */}
        <Skeleton.Rect height="h-12" rounded="rounded-xl" />
      </Card.Body>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="py-16 text-center">
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

export function ActivityFeed({
  sessions,
  loading = false,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: ActivityFeedProps) {
  // Sort by endedAt DESC (most recent first)
  const sortedSessions = [...sessions].sort((a, b) => {
    const dateA = new Date(a.endedAt || a.createdAt).getTime();
    const dateB = new Date(b.endedAt || b.createdAt).getTime();
    return dateB - dateA;
  });

  if (loading) {
    return (
      <div className="py-6">
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

  const noop = () => {};

  return (
    <div className="py-6">
      <InfiniteScroll
        onLoadMore={onLoadMore ?? noop}
        hasMore={hasMore}
        loading={loadingMore}
        endText="You're all caught up"
        showEndText={sortedSessions.length > 0}
      >
        <motion.div
          className="space-y-5"
          variants={feedVariants}
          initial="hidden"
          animate="visible"
        >
          {sortedSessions.map((session) => {
            let card: React.ReactNode;
            switch (session.sessionType) {
              case 'BROADCAST':
                card = <BroadcastActivityCard session={session} />;
                break;
              case 'HANGOUT':
                card = <HangoutActivityCard session={session} />;
                break;
              case 'UPLOAD':
                card = <UploadActivityCard session={session} />;
                break;
              default:
                return null;
            }
            return (
              <motion.div key={session.sessionId} variants={cardVariants}>
                {card}
              </motion.div>
            );
          })}
        </motion.div>
      </InfiniteScroll>
    </div>
  );
}
