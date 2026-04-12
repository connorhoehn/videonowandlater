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
  className?: string;
}

const DEFAULT_ACTIONS: PostAction[] = [
  { label: 'Photo', icon: <PhotoIcon size={16} />, color: 'text-green-600' },
  { label: 'Video', icon: <VideoIcon size={16} />, color: 'text-info-600' },
  { label: 'Event', icon: <CalendarIcon size={16} />, color: 'text-red-500' },
  { label: 'Feeling /Activity', icon: <EmojiIcon size={16} />, color: 'text-yellow-500' },
];

export function CreatePostCard({
  actions = DEFAULT_ACTIONS,
  className = '',
}: CreatePostCardProps) {
  return (
    <Card className={className}>
      <Card.Body>
        <div className="flex items-center gap-2 flex-wrap">
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

          <button
            type="button"
            className="ml-auto flex items-center justify-center p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            <EllipsisIcon size={16} />
          </button>
        </div>
      </Card.Body>
    </Card>
  );
}
