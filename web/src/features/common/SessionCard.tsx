/**
 * SessionCard — shared discovery card used by the home feed, search page,
 * and creator pages. Click navigates to the appropriate session route
 * (broadcast viewer / hangout / replay).
 *
 * The card is intentionally lightweight: it renders from a DiscoveryItem,
 * which is the common shape returned by /feed, /search, and
 * /creators/{handle}/sessions.
 */
import { useNavigate, Link } from 'react-router-dom';
import { Avatar, Card } from '../../components/social';
import { LiveBadge } from '../activity/LiveBadge';
import { LiveDuration } from '../activity/LiveDuration';
import { formatDate } from '../activity/utils';

export interface DiscoverySessionItem {
  sessionId: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  userId: string;
  creatorHandle?: string;
  creatorDisplayName?: string;
  createdAt: string;
  status: string;
  participantCount: number;
  tags?: string[];
  sessionType?: string;
}

interface SessionCardProps {
  item: DiscoverySessionItem;
}

function routeFor(item: DiscoverySessionItem): string {
  const isLive = item.status?.toLowerCase() === 'live';
  if (isLive) {
    return item.sessionType === 'HANGOUT'
      ? `/hangout/${item.sessionId}`
      : `/viewer/${item.sessionId}`;
  }
  return item.sessionType === 'UPLOAD'
    ? `/video/${item.sessionId}`
    : `/replay/${item.sessionId}`;
}

function ThumbPlaceholder() {
  return (
    <div className="w-full aspect-video bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-800 dark:to-black flex items-center justify-center">
      <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    </div>
  );
}

export function SessionCard({ item }: SessionCardProps) {
  const navigate = useNavigate();
  const isLive = item.status?.toLowerCase() === 'live';
  const route = routeFor(item);

  // Fallbacks for missing creator profile: @<userId> / userId
  const fallbackHandle = `@${item.userId}`;
  const displayHandle = item.creatorHandle ? `@${item.creatorHandle}` : fallbackHandle;
  const displayName = item.creatorDisplayName ?? item.userId;
  const title = item.title?.trim() || displayName;

  const liveVariant = item.sessionType === 'HANGOUT' ? 'hangout' : 'broadcast';

  return (
    <Card
      className="group transition-all duration-200 hover:shadow-lg cursor-pointer"
      onClick={() => navigate(route)}
    >
      <div className="relative">
        {isLive && <LiveBadge variant={liveVariant} />}
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={title}
            className="w-full aspect-video object-cover"
            loading="lazy"
          />
        ) : (
          <ThumbPlaceholder />
        )}
        {isLive && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm">
            <LiveDuration createdAt={item.createdAt} />
          </div>
        )}
        {isLive && item.participantCount > 0 && (
          <span className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[11px] font-medium">
            {item.participantCount} watching
          </span>
        )}
      </div>

      <Card.Body>
        <div className="flex items-start gap-2.5">
          <Link
            to={item.creatorHandle ? `/@${item.creatorHandle}` : '#'}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
            aria-label={`View ${displayName}'s profile`}
          >
            <Avatar name={displayName} alt={displayName} size="sm" />
          </Link>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {title}
            </h3>
            <Link
              to={item.creatorHandle ? `/@${item.creatorHandle}` : '#'}
              onClick={(e) => e.stopPropagation()}
              className="block text-xs text-gray-500 dark:text-gray-400 truncate hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {displayHandle}
            </Link>
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              {isLive ? 'Live now' : formatDate(item.createdAt)}
            </p>
          </div>
        </div>

        {item.description && (
          <p className="mt-2.5 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
            {item.description}
          </p>
        )}

        {item.tags && item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-600 dark:text-gray-300"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

interface SessionCardGridProps {
  items: DiscoverySessionItem[];
  emptyMessage?: string;
  loading?: boolean;
}

export function SessionCardGrid({ items, emptyMessage = 'Nothing to show yet.', loading }: SessionCardGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden animate-pulse">
            <div className="aspect-video bg-gray-200 dark:bg-gray-700" />
            <div className="p-3 space-y-2">
              <div className="h-3 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-2 w-1/2 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <SessionCard key={item.sessionId} item={item} />
      ))}
    </div>
  );
}
