/**
 * ProfilePanel — edit the caller's public profile.
 *
 * Loads the current profile from GET /me/profile and lets the user update
 * handle, displayName, and bio via PATCH /me/profile.
 * 409 from the server (handle taken) surfaces as a toast.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import { useToast } from '../../components/social';

interface UserProfile {
  userId: string;
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

export function ProfilePanel() {
  const { user, isAdmin } = useAuth();
  const { addToast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');

  // Load current profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = getConfig();
      if (!cfg?.apiUrl) { setLoading(false); return; }
      try {
        const { token } = await fetchToken();
        if (!token) { setLoading(false); return; }
        const res = await fetch(`${cfg.apiUrl}/me/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { profile: UserProfile };
        if (!cancelled) {
          setProfile(data.profile);
          setHandle(data.profile.handle ?? '');
          setDisplayName(data.profile.displayName ?? '');
          setBio(data.profile.bio ?? '');
        }
      } catch {
        /* silent — form just shows empty values */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dirty =
    handle.trim() !== (profile?.handle ?? '') ||
    displayName.trim() !== (profile?.displayName ?? '') ||
    bio.trim() !== (profile?.bio ?? '');

  const onSave = async () => {
    const cfg = getConfig();
    if (!cfg?.apiUrl) return;
    setSaving(true);
    try {
      const { token } = await fetchToken();
      if (!token) throw new Error('Not signed in');
      const patch: Record<string, string> = {};
      if (handle.trim() !== (profile?.handle ?? '')) patch.handle = handle.trim();
      if (displayName.trim() !== (profile?.displayName ?? '')) patch.displayName = displayName.trim();
      if (bio.trim() !== (profile?.bio ?? '')) patch.bio = bio.trim();
      if (Object.keys(patch).length === 0) { setSaving(false); return; }

      const res = await fetch(`${cfg.apiUrl}/me/profile`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.status === 409) {
        addToast({ variant: 'error', title: `Handle "${handle.trim()}" is already taken.` });
        return;
      }
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        addToast({ variant: 'error', title: (body as { error?: string }).error ?? 'Invalid profile data.' });
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { profile: UserProfile };
      setProfile(data.profile);
      setHandle(data.profile.handle ?? '');
      setDisplayName(data.profile.displayName ?? '');
      setBio(data.profile.bio ?? '');
      addToast({ variant: 'success', title: 'Profile saved.' });
    } catch (err: any) {
      addToast({ variant: 'error', title: err?.message ?? 'Failed to save profile.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        Profile
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Your public profile. Handle and display name show up on your creator page.
      </p>

      <dl className="space-y-4 mb-6">
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Username
          </dt>
          <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">
            {user?.username ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Role
          </dt>
          <dd className="mt-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${
                isAdmin
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600/50'
              }`}
            >
              {isAdmin ? 'Admin' : 'User'}
            </span>
          </dd>
        </div>
      </dl>

      <div className="space-y-4">
        <div>
          <label htmlFor="profile-handle" className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Handle
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-gray-500">@</span>
            <input
              id="profile-handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              disabled={loading}
              className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition disabled:opacity-50"
              placeholder="yourhandle"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            2-30 chars, letters / digits / underscore / hyphen. Must be unique.
          </p>
        </div>

        <div>
          <label htmlFor="profile-displayname" className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Display name
          </label>
          <input
            id="profile-displayname"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={loading}
            maxLength={80}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition disabled:opacity-50"
            placeholder="Your name"
          />
        </div>

        <div>
          <label htmlFor="profile-bio" className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Bio
          </label>
          <textarea
            id="profile-bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            disabled={loading}
            maxLength={500}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition disabled:opacity-50 resize-none"
            placeholder="Tell people about you"
          />
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {bio.length}/500
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving || loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </section>
  );
}
