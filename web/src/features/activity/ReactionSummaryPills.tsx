/**
 * ReactionSummaryPills - Display emoji + count pills for reaction summary
 * Shows aggregated reaction counts (e.g., "❤️ 42  🔥 17")
 */

import { EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';

interface ReactionSummaryPillsProps {
  reactionSummary?: Record<string, number>;
}

export function ReactionSummaryPills({ reactionSummary }: ReactionSummaryPillsProps) {
  if (!reactionSummary || Object.keys(reactionSummary).length === 0) {
    return <div className="text-gray-400 text-xs">No reactions</div>;
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {Object.entries(reactionSummary).map(([emojiType, count]) => (
        <div key={emojiType} className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full">
          <span>{EMOJI_MAP[emojiType as EmojiType]}</span>
          <span className="text-xs font-semibold text-gray-700">{count}</span>
        </div>
      ))}
    </div>
  );
}
