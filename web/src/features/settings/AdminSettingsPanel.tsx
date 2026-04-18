/**
 * Admin-only settings panel. Placeholder shells for:
 *  - Rulesets (Phase 4)
 *  - Banned Users
 *  - Roles
 */

function PlaceholderCard({
  title,
  description,
  comingIn,
}: {
  title: string;
  description: string;
  comingIn?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        {comingIn && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium">
            {comingIn}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}

export function AdminSettingsPanel() {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        Admin
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Platform-wide settings. Only visible to administrators.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PlaceholderCard
          title="Rulesets"
          description="Define moderation rulesets and attach them to sessions."
          comingIn="Phase 4"
        />
        <PlaceholderCard
          title="Banned Users"
          description="Review and revoke platform-level bans."
        />
        <PlaceholderCard
          title="Roles"
          description="Assign moderator and admin roles."
        />
      </div>
    </section>
  );
}
