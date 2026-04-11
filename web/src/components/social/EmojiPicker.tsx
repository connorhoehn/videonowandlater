import { useState, useMemo } from 'react';
import { CloseIcon, SearchIcon, EmojiIcon } from './Icons';

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
}

interface EmojiCategory {
  label: string;
  emojis: string[];
}

const categories: EmojiCategory[] = [
  {
    label: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋',
      '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡',
      '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
      '🥵', '🥶', '😵', '🤯', '🥳', '🥺', '😢', '😭', '😤', '😠',
      '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👻', '👽',
    ],
  },
  {
    label: 'People',
    emojis: [
      '👍', '👎', '👏', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '👌',
      '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️',
      '🖖', '👋', '🤙', '💪', '🦾', '🙌', '👐', '🤲', '🫶', '👶',
      '👦', '👧', '🧑', '👨', '👩', '🧓', '👴', '👵',
    ],
  },
  {
    label: 'Animals',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧',
      '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄',
      '🐝', '🐛', '🦋', '🐌', '🐞',
    ],
  },
  {
    label: 'Food',
    emojis: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒',
      '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍔', '🍟', '🍕', '🌭',
      '🌮', '🌯', '🥗', '🍣', '🍱', '🍩', '🍪', '🎂', '🍰', '🧁',
      '☕', '🍵', '🧃', '🍺', '🍷',
    ],
  },
  {
    label: 'Travel',
    emojis: [
      '🚗', '🚕', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '✈️', '🚀',
      '🛸', '🚁', '⛵', '🚢', '🏠', '🏢', '🏖️', '🏔️', '⛰️', '🌋',
      '🗽', '🗼', '🏰', '🎡', '🌍', '🌎', '🌏',
    ],
  },
  {
    label: 'Activities',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱',
      '🏓', '🏸', '🥊', '🥋', '⛳', '🎿', '🏂', '🏋️', '🤸', '🧘',
      '🎮', '🎯', '🎲', '🧩', '🎭', '🎨', '🎬', '🎤', '🎧',
    ],
  },
  {
    label: 'Objects',
    emojis: [
      '🔥', '⭐', '💡', '🎯', '🎉', '🎊', '🏆', '🎮', '📱', '💻',
      '🎵', '🎶', '💰', '💎', '🔔', '📣', '💬', '💭', '🔑', '🔒',
      '📌', '📎', '✏️', '📝', '📚', '📷', '🎁', '🪄', '💊', '🧲',
    ],
  },
  {
    label: 'Hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
    ],
  },
  {
    label: 'Symbols',
    emojis: [
      '✅', '❌', '⭕', '❗', '❓', '‼️', '⁉️', '💯', '🔴', '🟠',
      '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔶', '🔷', '🔸',
      '🔹', '▶️', '⏸️', '⏹️', '⏺️', '⏭️', '⏮️', '🔀', '🔁', '🔂',
      '♻️', '🚫', '⚠️', '🏳️', '🏴', '🚩',
    ],
  },
];

export function EmojiPicker({ onSelect, onClose, className = '' }: EmojiPickerProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);

  const filteredCategories = useMemo(() => {
    if (!search) return categories;
    // Simple search: there's no text to search on unicode emojis directly,
    // so we filter category labels and return matching categories,
    // or return all emojis flattened if no category matches.
    const lower = search.toLowerCase();
    const matched = categories.filter((c) => c.label.toLowerCase().includes(lower));
    if (matched.length > 0) return matched;
    // If no category label matches, return all (user can scroll)
    return categories;
  }, [search]);

  return (
    <div
      className={`w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
          <EmojiIcon size={16} />
          <span>Emoji</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="px-3 py-1.5">
        <div className="relative">
          <SearchIcon
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search category..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveCategory(0);
            }}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg outline-none focus:ring-1 focus:ring-blue-400 text-gray-700 dark:text-gray-200 placeholder-gray-400"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 px-3 py-1 overflow-x-auto scrollbar-none">
        {filteredCategories.map((cat, i) => (
          <button
            key={cat.label}
            onClick={() => setActiveCategory(i)}
            className={`shrink-0 px-2 py-1 text-xs rounded-md transition-colors ${
              activeCategory === i
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="grid grid-cols-8 gap-1 p-2 max-h-48 overflow-y-auto">
        {(filteredCategories[activeCategory]?.emojis ?? []).map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
