interface LoadMoreButtonProps {
  onClick?: () => void;
  loading?: boolean;
  variant?: 'link' | 'soft';
  children?: React.ReactNode;
  className?: string;
}

function SpinnerDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function SpinnerCircle() {
  return (
    <svg
      className="w-4 h-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function LoadMoreButton({
  onClick,
  loading = false,
  variant = 'link',
  children = 'Load more',
  className = '',
}: LoadMoreButtonProps) {
  const baseClasses =
    'inline-flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses =
    variant === 'link'
      ? 'text-sm text-gray-500 hover:text-gray-700'
      : 'bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg px-4 py-2 text-sm font-medium';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`${baseClasses} ${variantClasses} ${className}`}
    >
      {loading ? <SpinnerCircle /> : <SpinnerDots />}
      {children}
    </button>
  );
}
