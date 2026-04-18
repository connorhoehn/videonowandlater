import { useAuth } from '../../auth/useAuth';

export function ProfilePanel() {
  const { user, isAdmin } = useAuth();

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        Profile
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Your account details. Editing coming in a later phase.
      </p>

      <dl className="space-y-4">
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
    </section>
  );
}
