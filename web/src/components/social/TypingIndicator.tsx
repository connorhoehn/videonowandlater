interface TypingIndicatorProps {
  names?: string[];
  className?: string;
}

function formatTypingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more are typing...`;
}

export function TypingIndicator({ names, className }: TypingIndicatorProps) {
  const delays = [0, 200, 400];

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <div className="flex items-end gap-0.5 h-4">
        {delays.map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
      {names && names.length > 0 && (
        <span className="text-xs text-gray-400 italic">
          {formatTypingText(names)}
        </span>
      )}
    </div>
  );
}
