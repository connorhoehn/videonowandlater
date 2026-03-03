/**
 * ReactionTimeline - horizontal timeline displaying reaction "heatmap" markers
 * Aggregates reactions into 5-second buckets positioned along video duration
 */

import { useMemo } from 'react';
import type { Reaction } from '../../../../backend/src/domain/reaction';
import { EMOJI_MAP } from '../reactions/ReactionPicker';

interface ReactionTimelineProps {
  reactions: Reaction[];
  currentTime: number; // syncTime from player (milliseconds)
  duration: number; // video duration (milliseconds)
}

interface ReactionBucket {
  bucketNumber: number;
  count: number;
  emojis: string[]; // unique emoji icons for this bucket
}

/**
 * Aggregate reactions into 5-second time buckets
 */
function aggregateReactions(reactions: Reaction[]): Map<number, ReactionBucket> {
  const buckets = new Map<number, ReactionBucket>();

  reactions.forEach((reaction) => {
    const bucketNumber = Math.floor(reaction.sessionRelativeTime / 5000);

    if (!buckets.has(bucketNumber)) {
      buckets.set(bucketNumber, {
        bucketNumber,
        count: 0,
        emojis: [],
      });
    }

    const bucket = buckets.get(bucketNumber)!;
    bucket.count++;

    // Add unique emoji icon (convert emojiType to emoji string)
    const emoji = EMOJI_MAP[reaction.emojiType as keyof typeof EMOJI_MAP];
    if (emoji && !bucket.emojis.includes(emoji)) {
      bucket.emojis.push(emoji);
    }
  });

  return buckets;
}

export function ReactionTimeline({ reactions, currentTime, duration }: ReactionTimelineProps) {
  const buckets = useMemo(() => aggregateReactions(reactions), [reactions]);

  // Avoid division by zero
  if (duration === 0) {
    return null;
  }

  return (
    <div className="reaction-timeline relative w-full h-12 bg-gray-100 rounded-md overflow-hidden">
      {/* Timeline markers */}
      {Array.from(buckets.values()).map((bucket) => {
        const bucketStartTime = bucket.bucketNumber * 5000; // milliseconds
        const position = (bucketStartTime / duration) * 100; // percentage

        // Highlight marker if video has passed this timestamp
        const isHighlighted = currentTime >= bucketStartTime;

        return (
          <div
            key={bucket.bucketNumber}
            className={`absolute top-1 transition-all duration-200 ${
              isHighlighted ? 'bg-blue-600 scale-110' : 'bg-gray-400'
            } rounded-full cursor-pointer hover:scale-125`}
            style={{
              left: `${position}%`,
              width: '24px',
              height: '24px',
              transform: 'translateX(-50%)',
            }}
            title={`${bucket.count} reaction${bucket.count > 1 ? 's' : ''} at ${Math.floor(bucketStartTime / 1000)}s`}
          >
            {/* Count badge */}
            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-semibold">
              {bucket.count}
            </div>

            {/* Emoji icons (display up to 3 unique emojis) */}
            <div className="flex items-center justify-center h-full text-sm">
              {bucket.emojis.slice(0, 3).map((emoji, idx) => (
                <span key={idx} className="text-xs">
                  {emoji}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
