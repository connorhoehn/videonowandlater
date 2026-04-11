import { Avatar } from './Avatar';
import { Card } from './Card';
import { TabNav } from './TabNav';

export interface ProfileHeaderProps {
  user: {
    name: string;
    avatar?: string;
    coverImage?: string;
    bio?: string;
    subtitle?: string;
    stats?: { label: string; value: string | number }[];
  };
  isOwnProfile?: boolean;
  isFollowing?: boolean;
  onFollow?: () => void;
  onMessage?: () => void;
  onEditProfile?: () => void;
  tabs?: { id: string; label: string; badge?: number }[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
}

export function ProfileHeader({
  user,
  isOwnProfile = false,
  isFollowing = false,
  onFollow,
  onMessage,
  onEditProfile,
  tabs,
  activeTab,
  onTabChange,
  className = '',
}: ProfileHeaderProps) {
  const { name, avatar, coverImage, bio, subtitle, stats } = user;

  return (
    <Card className={className}>
      {/* Cover photo */}
      <div className="relative">
        {coverImage ? (
          <div
            className="h-48 sm:h-64 bg-cover bg-center rounded-t-xl"
            style={{ backgroundImage: `url(${coverImage})` }}
          />
        ) : (
          <div className="h-48 sm:h-64 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-t-xl" />
        )}

        {/* Avatar overlapping bottom of cover */}
        <div className="absolute -bottom-12 left-6">
          <Avatar
            src={avatar}
            alt={name}
            name={name}
            size="xl"
            className="w-24 h-24 sm:w-32 sm:h-32 border-4 border-white dark:border-gray-900 rounded-full [&>*]:w-full [&>*]:h-full"
          />
        </div>
      </div>

      {/* Info section */}
      <div className="pt-14 px-6 pb-4">
        <div className="flex items-start justify-between">
          {/* Name, subtitle, bio */}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {name}
            </h2>
            {subtitle && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {subtitle}
              </p>
            )}
            {bio && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                {bio}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {isOwnProfile ? (
              onEditProfile && (
                <button
                  type="button"
                  onClick={onEditProfile}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Edit Profile
                </button>
              )
            ) : (
              <>
                {onFollow && (
                  <button
                    type="button"
                    onClick={onFollow}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isFollowing
                        ? 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
                {onMessage && (
                  <button
                    type="button"
                    onClick={onMessage}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Message
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Stats row */}
        {stats && stats.length > 0 && (
          <div className="flex items-center mt-4">
            {stats.map((stat, i) => (
              <div key={stat.label} className="flex items-center">
                {i > 0 && (
                  <div className="w-px h-8 bg-gray-200 dark:bg-gray-600 mx-4" />
                )}
                <div className="text-center min-w-[3rem]">
                  <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    {stat.value}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {stat.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TabNav */}
      {tabs && tabs.length > 0 && activeTab && onTabChange && (
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onChange={onTabChange}
          variant="underline"
          fullWidth
        />
      )}
    </Card>
  );
}
