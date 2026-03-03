/**
 * ReplayReactionPicker - emoji selector UI for replay context
 * Sends reactions with reactionType='replay' (no IVS Chat broadcast)
 */

import React, { useState } from 'react';
import { EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';

interface ReplayReactionPickerProps {
  onReaction: (emoji: EmojiType) => void;
  disabled?: boolean;
}

export const ReplayReactionPicker: React.FC<ReplayReactionPickerProps> = ({
  onReaction,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  const handleReaction = (emoji: EmojiType) => {
    if (cooldown || disabled) return;

    onReaction(emoji);
    setIsOpen(false);

    // Client-side rate limiting (500ms cooldown)
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

  return (
    <div className="relative">
      {/* Main reaction button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || cooldown}
        className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full text-2xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Send reaction during replay"
        title="Send reaction during replay"
      >
        ❤️
      </button>

      {/* Emoji picker menu */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg p-2 flex gap-2 border border-gray-200">
          {Object.entries(EMOJI_MAP).map(([key, emoji]) => (
            <button
              key={key}
              onClick={() => handleReaction(key as EmojiType)}
              className="p-2 hover:bg-gray-100 rounded text-2xl transition-colors"
              aria-label={`Send ${key} reaction`}
              title={`Send ${key} reaction`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Cooldown indicator */}
      {cooldown && (
        <div className="absolute top-0 right-0 w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
      )}
    </div>
  );
};
