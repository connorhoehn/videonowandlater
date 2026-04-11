import { Avatar } from './Avatar';
import { Card } from './Card';
import { EngagementBar } from './EngagementBar';

/* ------------------------------------------------------------------ */
/*  Inline SVG icon helpers                                           */
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
/*  Hashtag parser                                                    */
/* ------------------------------------------------------------------ */

function parseHashtags(text: string) {
  const parts = text.split(/(#\w+)/g);
  return parts.map((part, i) =>
    /^#\w+$/.test(part) ? (
      <span
        key={i}
        className="text-blue-600 cursor-pointer hover:underline"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  LinkPreviewCard                                                   */
/* ------------------------------------------------------------------ */

export interface LinkPreviewCardProps {
  author: { name: string; avatar?: string; subtitle?: string };
  timestamp?: string;
  content?: string;
  link: {
    url: string;
    title: string;
    description?: string;
    image?: string;
  };
  likes?: number;
  comments?: number;
  shares?: number;
  onMenuClick?: () => void;
  className?: string;
}

export function LinkPreviewCard({
  author,
  timestamp,
  content,
  link,
  likes,
  comments,
  shares,
  onMenuClick,
  className = '',
}: LinkPreviewCardProps) {
  return (
    <Card className={className}>
      {/* ---- Header ---- */}
      <Card.Header borderless>
        <div className="flex items-center gap-3">
          <Avatar src={author.avatar} alt={author.name} name={author.name} />
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-gray-900 dark:text-white">
              {author.name}
            </span>
            {author.subtitle && (
              <span className="text-xs text-gray-500">{author.subtitle}</span>
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
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="More options"
            >
              <IconDots />
            </button>
          )}
        </div>
      </Card.Header>

      {/* ---- Content ---- */}
      <Card.Body className="px-0 py-0">
        {content && (
          <p className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">
            {parseHashtags(content)}
          </p>
        )}

        {/* ---- Link preview image ---- */}
        {link.image && (
          <img
            src={link.image}
            alt={link.title}
            className="w-full object-cover"
          />
        )}

        {/* ---- Link preview info ---- */}
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-gray-50 dark:bg-gray-800 px-4 py-3"
        >
          <span className="text-xs text-blue-600 hover:underline truncate block">
            {link.url}
          </span>
          <span className="text-sm font-semibold text-gray-900 dark:text-white mt-1 block">
            {link.title}
          </span>
          {link.description && (
            <span className="text-xs text-gray-500 mt-0.5 line-clamp-2 block">
              {link.description}
            </span>
          )}
        </a>
      </Card.Body>

      {/* ---- Footer ---- */}
      <EngagementBar
        variant="fill"
        likes={likes}
        comments={comments}
        shares={shares}
      />
    </Card>
  );
}
