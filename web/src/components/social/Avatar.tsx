const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
} as const;

const INDICATOR_CLASSES = {
  xs: 'w-1.5 h-1.5 border',
  sm: 'w-2 h-2 border',
  md: 'w-2.5 h-2.5 border-2',
  lg: 'w-3 h-3 border-2',
  xl: 'w-4 h-4 border-2',
} as const;

const RING_PADDING = {
  xs: 'p-[2px]',
  sm: 'p-[2px]',
  md: 'p-[3px]',
  lg: 'p-[3px]',
  xl: 'p-[3px]',
} as const;

const FALLBACK_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-pink-500',
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  src?: string;
  alt: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  hasStory?: boolean;
  isOnline?: boolean;
  className?: string;
  onClick?: () => void;
}

export function Avatar({
  src,
  alt,
  name,
  size = 'md',
  hasStory = false,
  isOnline = false,
  className = '',
  onClick,
}: AvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  const indicatorClass = INDICATOR_CLASSES[size];

  const avatar = src ? (
    <img
      src={src}
      alt={alt}
      className={`${sizeClass} rounded-full object-cover`}
    />
  ) : (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-semibold text-white ${
        name ? getColorFromName(name) : 'bg-gray-400'
      }`}
    >
      {name ? getInitials(name) : '?'}
    </div>
  );

  const inner = hasStory ? (
    <div
      className={`rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 ${RING_PADDING[size]}`}
    >
      <div className="rounded-full bg-white dark:bg-gray-900 p-[2px]">
        {avatar}
      </div>
    </div>
  ) : (
    avatar
  );

  return (
    <div
      className={`relative inline-flex shrink-0 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {inner}
      {isOnline && (
        <span
          className={`absolute bottom-0 right-0 ${indicatorClass} rounded-full bg-green-500 border-white dark:border-gray-900`}
        />
      )}
    </div>
  );
}
