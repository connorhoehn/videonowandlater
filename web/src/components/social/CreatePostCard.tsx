import { useRef, useState, useCallback } from 'react';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { PhotoIcon, VideoIcon, CalendarIcon, EmojiIcon, EllipsisIcon } from './Icons';

export interface PostAction {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  color?: string;
}

export interface CreatePostCardProps {
  avatar?: string;
  userName?: string;
  placeholder?: string;
  actions?: PostAction[];
  onSubmit?: (text: string) => void;
  className?: string;
}

const DEFAULT_ACTIONS: PostAction[] = [
  { label: 'Photo', icon: <PhotoIcon size={16} />, color: 'text-green-600' },
  { label: 'Video', icon: <VideoIcon size={16} />, color: 'text-info-600' },
  { label: 'Event', icon: <CalendarIcon size={16} />, color: 'text-red-500' },
  { label: 'Feeling /Activity', icon: <EmojiIcon size={16} />, color: 'text-yellow-500' },
];

export function CreatePostCard({
  avatar,
  userName,
  placeholder = 'Share your thoughts...',
  actions = DEFAULT_ACTIONS,
  onSubmit,
  className = '',
}: CreatePostCardProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    autoResize();
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || !onSubmit) return;
    onSubmit(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <Card className={className}>
      <Card.Body>
        {/* Top row: Avatar + textarea */}
        <div className="flex items-start gap-3">
          <Avatar
            src={avatar}
            alt={userName ?? 'User'}
            name={userName}
            size="xs"
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            placeholder={placeholder}
            rows={1}
            className="bg-transparent border-0 resize-none w-full focus:outline-none text-sm leading-relaxed min-h-[1.5rem]"
          />
        </div>

        {/* Bottom row: action buttons */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-sm transition-colors cursor-pointer"
            >
              <span className={action.color}>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}

          {/* Overflow menu */}
          <button
            type="button"
            className="ml-auto flex items-center justify-center p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            <EllipsisIcon size={16} />
          </button>

          {/* Post button */}
          {onSubmit && text.trim().length > 0 && (
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              Post
            </button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
