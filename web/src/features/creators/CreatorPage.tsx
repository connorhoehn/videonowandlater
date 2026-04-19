/**
 * CreatorPage — route `/@{handle}` (also reachable at `/creators/:handle`).
 *
 * Shows the creator hero (avatar, displayName, handle, bio, follower count,
 * follow/unfollow button) plus a tabbed grid of their Live / Past sessions.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
import { useAuth } from '../../auth/useAuth';
import { getConfig } from '../../config/aws-config';
import { Avatar, TabNav, type Tab } from '../../components/social';
import { SessionCardGrid } from '../common/SessionCard';
import { useCreatorSessions } from '../common/useDiscovery';

interface UserProfile {
  userId: string;
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}
interface UserStats {
  userId: string;
  followersCount: number;
  followingCount: number;
}

type CreatorTab = 'live' | 'ended';

export function CreatorPage() {
  const { handle: rawHandle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const handle = useMemo(() => rawHandle?.replace(/^@/, '') ?? '', [rawHandle]);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [tab, setTab] = useState<CreatorTab>('live');

  // Hero data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = getConfig();
      if (!cfg?.apiUrl || !handle) return;
      setLoadingProfile(true);
      setNotFound(false);
      try {
        const res = await fetch(`${cfg.apiUrl}/creators/${encodeURIComponent(handle)}`);
        if (res.status === 404) {
          if (!cancelled) { setNotFound(true); setLoadingProfile(false); }
          return;
        }
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { profile: UserProfile; stats: UserStats };
        if (!cancelled) {
          setProfile(data.profile);
          setStats(data.stats);
          setLoadingProfile(false);
        }
      } catch {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  // Sessions
  const { items, loading: loadingSessions } = useCreatorSessions(handle, tab);

  const isSelf = !!user && !!profile && user.username === profile.userId;

  // Follow state: lazy probe by calling POST idempotently? The /users/{id}/follow
  // endpoint doesn't expose "is following", but Phase 1's `follow` returns
  // `{ following: true, changed: boolean }`. Here we deliberately DON'T
  // auto-follow on mount. Instead, optimistic toggle works for both states.
  const toggleFollow = async () => {
    if (!profile || isSelf || followBusy) return;
    const cfg = getConfig();
    if (!cfg?.apiUrl) return;
    setFollowBusy(true);
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    setStats((s) => s ? { ...s, followersCount: s.followersCount + (wasFollowing ? -1 : 1) } : s);
    try {
      const { token } = await fetchToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch(`${cfg.apiUrl}/users/${encodeURIComponent(profile.userId)}/follow`, {
        method: wasFollowing ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch {
      // Revert on error
      setIsFollowing(wasFollowing);
      setStats((s) => s ? { ...s, followersCount: s.followersCount + (wasFollowing ? 1 : -1) } : s);
    } finally {
      setFollowBusy(false);
    }
  };

  const tabs = useMemo<Tab[]>(() => [
    { id: 'live', label: 'Live' },
    { id: 'ended', label: 'Past sessions' },
  ], []);

  if (notFound) {
    return (
      <div className="text-center py-20">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Creator not found</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          No profile for <span className="font-mono">@{handle}</span>.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-violet-600 hover:bg-violet-500"
        >
          Back to feed
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="bg-white dark:bg-gray-800 rounded-xl p-6">
        {loadingProfile || !profile ? (
          <div className="flex items-center gap-4 animate-pulse">
            <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <Avatar
              src={profile.avatarUrl}
              name={profile.displayName ?? profile.userId}
              alt={profile.displayName ?? profile.userId}
              size="xl"
            />
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
                {profile.displayName ?? profile.userId}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {profile.handle ? `@${profile.handle}` : `@${profile.userId}`}
              </p>
              {profile.bio && (
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {profile.bio}
                </p>
              )}
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                <span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {stats?.followersCount ?? 0}
                  </span>{' '}
                  followers
                </span>
                <span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {stats?.followingCount ?? 0}
                  </span>{' '}
                  following
                </span>
              </div>
            </div>
            {!isSelf && user && (
              <button
                type="button"
                disabled={followBusy}
                onClick={toggleFollow}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  isFollowing
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    : 'bg-violet-600 text-white hover:bg-violet-500'
                } disabled:opacity-50`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-xl p-4 space-y-3">
        <TabNav
          tabs={tabs}
          activeTab={tab}
          onChange={(id) => setTab(id as CreatorTab)}
          variant="underline"
        />
        <SessionCardGrid
          items={items}
          loading={loadingSessions}
          emptyMessage={tab === 'live' ? 'Not live right now.' : 'No past sessions yet.'}
        />
      </section>
    </div>
  );
}
