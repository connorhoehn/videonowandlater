import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';

export interface MentionUser {
  id: string;
  name: string;
  avatar?: string;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  users?: MentionUser[];
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function MentionInput({
  value,
  onChange,
  onSubmit,
  users = [],
  placeholder,
  rows = 3,
  className = '',
}: MentionInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(query.toLowerCase()),
  );

  const closeMention = useCallback(() => {
    setShowDropdown(false);
    setQuery('');
    setMentionStart(null);
    setActiveIndex(0);
  }, []);

  const selectUser = useCallback(
    (user: MentionUser) => {
      if (mentionStart === null) return;
      const before = value.slice(0, mentionStart);
      const after = value.slice(mentionStart + query.length + 1); // +1 for @
      const next = `${before}@${user.name} ${after}`;
      onChange(next);
      closeMention();

      // Restore focus after state update
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          const cursor = mentionStart + user.name.length + 2; // @name + space
          ta.focus();
          ta.setSelectionRange(cursor, cursor);
        }
      });
    },
    [value, mentionStart, query, onChange, closeMention],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const pos = e.target.selectionStart ?? 0;
    // Walk backwards from cursor to find an unescaped @
    let atPos: number | null = null;
    for (let i = pos - 1; i >= 0; i--) {
      const ch = newValue[i];
      if (ch === ' ' || ch === '\n') break;
      if (ch === '@') {
        // Only trigger if @ is at start or preceded by whitespace
        if (i === 0 || /\s/.test(newValue[i - 1])) {
          atPos = i;
        }
        break;
      }
    }

    if (atPos !== null) {
      const partial = newValue.slice(atPos + 1, pos);
      setMentionStart(atPos);
      setQuery(partial);
      setShowDropdown(true);
      setActiveIndex(0);
    } else {
      closeMention();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDropdown && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectUser(filtered[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }

    if (!showDropdown && e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit(value);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return;
    const item = dropdownRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, showDropdown]);

  return (
    <div className={`relative ${className}`}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className="w-full bg-transparent border-0 resize-none focus:outline-none text-sm"
      />

      {showDropdown && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 z-50 max-h-40 overflow-y-auto w-56"
        >
          {filtered.map((user, i) => (
            <div
              key={user.id}
              className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm ${
                i === activeIndex ? 'bg-gray-50 dark:bg-gray-700' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent textarea blur
                selectUser(user);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <Avatar src={user.avatar} alt={user.name} name={user.name} size="xs" />
              <span className="truncate">{user.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
