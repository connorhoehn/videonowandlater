import { Card } from './Card';
import { Avatar } from './Avatar';

export interface SuggestionUser {
  id: string;
  name: string;
  avatar?: string;
  subtitle?: string;
  isFollowing?: boolean;
}

export interface SuggestionWidgetProps {
  title?: string;
  users: SuggestionUser[];
  onFollow?: (userId: string) => void;
  onViewMore?: () => void;
}

export function SuggestionWidget({
  title = 'Who to follow',
  users,
  onFollow,
  onViewMore,
}: SuggestionWidgetProps) {
  return (
    <Card>
      <Card.Header borderless>
        <h6 className="font-bold text-base text-gray-900 dark:text-white">{title}</h6>
      </Card.Header>

      <Card.Body className="pt-0">
        {users.map((user) => (
          <div key={user.id} className="flex items-center gap-3 mb-3 last:mb-0">
            <Avatar
              src={user.avatar}
              alt={user.name}
              name={user.name}
              size="md"
            />

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight truncate text-gray-900 dark:text-white">
                {user.name}
              </p>
              {user.subtitle && (
                <p className="text-xs text-gray-500 truncate">{user.subtitle}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onFollow?.(user.id)}
              className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                user.isFollowing
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}
              aria-label={user.isFollowing ? `Unfollow ${user.name}` : `Follow ${user.name}`}
            >
              {user.isFollowing ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path d="M10 5a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-3H6a1 1 0 1 1 0-2h3V6a1 1 0 0 1 1-1Z" />
                </svg>
              )}
            </button>
          </div>
        ))}
      </Card.Body>

      {onViewMore && (
        <Card.Footer borderless className="pt-0">
          <button
            type="button"
            onClick={onViewMore}
            className="w-full py-2 rounded-lg bg-blue-50 text-blue-600 text-sm font-medium hover:bg-blue-100 transition-colors"
          >
            View more
          </button>
        </Card.Footer>
      )}
    </Card>
  );
}
