import { Avatar } from './Avatar';
import { Card } from './Card';
import { EngagementBar } from './EngagementBar';

/* ------------------------------------------------------------------ */
/*  Inline SVG icon                                                    */
/* ------------------------------------------------------------------ */

const IconDots = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="w-5 h-5"
  >
    <circle cx={12} cy={5} r={1.5} />
    <circle cx={12} cy={12} r={1.5} />
    <circle cx={12} cy={19} r={1.5} />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PollOption {
  id: string;
  label: string;
  votes?: number;
}

export interface PollCardProps {
  author: { name: string; avatar?: string; subtitle?: string };
  timestamp?: string;
  question: string;
  options: PollOption[];
  totalVotes?: number;
  timeRemaining?: string;
  voted?: string | null;
  onVote?: (optionId: string) => void;
  onMenuClick?: () => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  PollCard                                                           */
/* ------------------------------------------------------------------ */

export function PollCard({
  author,
  timestamp,
  question,
  options,
  totalVotes,
  timeRemaining,
  voted = null,
  onVote,
  onMenuClick,
  className = '',
}: PollCardProps) {
  const total =
    totalVotes ?? options.reduce((sum, o) => sum + (o.votes ?? 0), 0);

  return (
    <Card className={className}>
      {/* ---- Header ---- */}
      <Card.Header borderless>
        <div className="flex items-center gap-3">
          <Avatar src={author.avatar} alt={author.name} name={author.name} />
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
              {author.name}
            </span>
            {author.subtitle && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {author.subtitle}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {timestamp && (
            <span className="text-xs text-gray-400">{timestamp}</span>
          )}
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="More options"
            >
              <IconDots />
            </button>
          )}
        </div>
      </Card.Header>

      {/* ---- Body ---- */}
      <Card.Body className="px-4 py-3">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
          {question}
        </p>

        {voted === null
          ? /* ---- Pre-vote: radio-button-style list ---- */
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onVote?.(option.id)}
                className="border border-blue-500 rounded-lg px-4 py-2.5 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors w-full text-left mb-2 text-gray-800 dark:text-gray-200"
              >
                {option.label}
              </button>
            ))
          : /* ---- Post-vote: progress bars ---- */
            options.map((option) => {
              const pct =
                total > 0
                  ? Math.round(((option.votes ?? 0) / total) * 100)
                  : 0;
              const isVoted = option.id === voted;

              return (
                <div
                  key={option.id}
                  className={`relative h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg overflow-hidden mb-2 ${
                    isVoted ? 'ring-2 ring-blue-500' : ''
                  }`}
                >
                  <div
                    className="bg-blue-200/50 dark:bg-blue-800/30 h-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-3 text-sm text-gray-800 dark:text-gray-200">
                    {option.label}
                    <span className="ml-auto font-medium">{pct}%</span>
                  </span>
                </div>
              );
            })}
      </Card.Body>

      {/* ---- Footer ---- */}
      <div className="px-4 pb-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {total} vote{total !== 1 ? 's' : ''}
          {timeRemaining && ` \u00B7 ${timeRemaining}`}
        </span>
      </div>

      <EngagementBar variant="fill" />
    </Card>
  );
}
