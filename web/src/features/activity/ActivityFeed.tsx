/**
 * ActivityFeed - Vertical activity feed displaying all recent sessions in reverse chronological order
 * Shows broadcast, hangout, and upload sessions with loading skeletons and empty state
 */

import { motion } from 'motion/react';
import { Card, EmptyState, InfiniteScroll, Skeleton, VideoIcon } from '../../components/social';
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
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
    return (
      <EmptyState
        title="No activity yet"
        description="Start a broadcast, hangout, or upload a video to get started"
        icon={<VideoIcon className="w-8 h-8 text-gray-300" />}
      />
    );
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
