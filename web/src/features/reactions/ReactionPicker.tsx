/**
 * ReactionPicker - emoji selector UI with 5 emoji buttons
 * Implements client-side rate limiting (500ms cooldown)
 */

import React, { useState } from 'react';

export type EmojiType = 'heart' | 'fire' | 'clap' | 'laugh' | 'surprised';

export const EMOJI_MAP: Record<EmojiType, string> = {
  heart: '❤️',
  fire: '🔥',
  clap: '👏',
  laugh: '😂',
  surprised: '😮',
};

interface ReactionPickerProps {
  onReaction: (emoji: EmojiType) => void;
  disabled?: boolean;
}

export const ReactionPicker: React.FC<ReactionPickerProps> = ({
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
        className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full text-2xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 active:scale-95"
        aria-label="Send reaction"
        title="Send reaction"
      >
        ❤️
      </button>

      {/* Emoji picker menu */}
      {isOpen && (
        <div className="animate-context-menu absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-xl shadow-xl p-1.5 flex gap-1 border border-gray-200">
          {Object.entries(EMOJI_MAP).map(([key, emoji]) => (
            <button
              key={key}
              onClick={() => handleReaction(key as EmojiType)}
              className="p-2 hover:bg-gray-100 rounded-lg text-2xl transition-all duration-150 hover:scale-110 active:scale-95"
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
