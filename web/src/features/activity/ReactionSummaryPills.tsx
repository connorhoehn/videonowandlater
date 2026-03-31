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
    return <div className="text-gray-400 text-xs italic">No reactions</div>;
  }

  return (
    <div className="flex gap-1.5 flex-wrap">
      {Object.entries(reactionSummary).map(([emojiType, count]) => (
        <div
          key={emojiType}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-50 border border-gray-200 rounded-full transition-colors hover:bg-gray-100"
        >
          <span className="text-sm">{EMOJI_MAP[emojiType as EmojiType]}</span>
          <span className="text-xs font-semibold text-gray-600 tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  );
}
