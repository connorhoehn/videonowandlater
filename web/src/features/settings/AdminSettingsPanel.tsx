/**
 * Admin-only settings panel with sub-tabs for:
 *  - Rulesets (Phase 4)
 *  - Banned Users (Phase 3)
 *  - Roles (stub — to be filled by roles panel work)
 */

import { useEffect, useState } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import { RulesetEditor } from '../admin/settings/RulesetEditor';
import { RolesPanel } from '../admin/settings/RolesPanel';
import { ChatFlagsPanel } from '../admin/settings/ChatFlagsPanel';
import { SurveysPanel } from '../admin/settings/SurveysPanel';
import { CampaignsPanel } from '../admin/settings/CampaignsPanel';
import { BannedUsersPanel } from '../admin/BannedUsersPanel';

type AdminTab = 'rulesets' | 'bans' | 'roles' | 'chat-flags' | 'surveys' | 'campaigns';

const TABS: { key: AdminTab; label: string }[] = [
  { key: 'rulesets', label: 'Rulesets' },
  { key: 'bans', label: 'Banned Users' },
  { key: 'roles', label: 'Roles' },
  { key: 'chat-flags', label: 'Chat Flags' },
  { key: 'surveys', label: 'Surveys' },
  { key: 'campaigns', label: 'Campaigns' },
];

export function AdminSettingsPanel() {
  const [tab, setTab] = useState<AdminTab>('rulesets');
  const [authToken, setAuthToken] = useState<string>('');
  const apiBaseUrl = getConfig()?.apiUrl ?? '';

  useEffect(() => {
    fetchToken().then(({ token }) => setAuthToken(token ?? '')).catch(() => setAuthToken(''));
  }, []);

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Admin</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Platform-wide settings. Only visible to administrators.
        </p>
      </header>

      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'rulesets' && <RulesetEditor />}
      {tab === 'bans' && authToken && <BannedUsersPanel authToken={authToken} apiBaseUrl={apiBaseUrl} />}
      {tab === 'roles' && <RolesPanel />}
      {tab === 'chat-flags' && <ChatFlagsPanel />}
      {tab === 'surveys' && <SurveysPanel />}
      {tab === 'campaigns' && <CampaignsPanel />}
    </section>
  );
}
