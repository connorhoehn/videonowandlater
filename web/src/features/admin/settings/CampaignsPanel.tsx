/**
 * CampaignsPanel — mounts the <AdsAdminPanel/> component library from @vnl/ads-admin-ui.
 * Wires a `getToken` callback that fetches a short-lived admin JWT from our
 * own backend (the secret never touches the browser).
 */

import { useCallback, useEffect, useState } from 'react';
import { AdsAdminPanel } from '@vnl/ads-admin-ui';
import '@vnl/ads-admin-ui/styles.css';
import { fetchToken } from '../../../auth/fetchToken';
import { getConfig } from '../../../config/aws-config';

interface TokenCache {
  token: string;
  expiresAt: number;
}

export function CampaignsPanel() {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const adsBaseUrl = (getConfig() as { adsBaseUrl?: string } | null)?.adsBaseUrl ?? '';
  const [err, setErr] = useState<string | null>(null);
  const [tokenCacheRef] = useState<{ current: TokenCache | null }>({ current: null });

  const getAdsToken = useCallback(async (): Promise<string> => {
    const cached = tokenCacheRef.current;
    if (cached && cached.expiresAt - 30_000 > Date.now()) {
      return cached.token;
    }
    const { token: userToken } = await fetchToken();
    const res = await fetch(`${apiBaseUrl}/admin/ads/mint-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      const msg = `Failed to mint ads admin token: ${res.status}`;
      setErr(msg);
      throw new Error(msg);
    }
    const data = (await res.json()) as { token: string; expiresAt: string };
    tokenCacheRef.current = {
      token: data.token,
      expiresAt: new Date(data.expiresAt).getTime(),
    };
    return data.token;
  }, [apiBaseUrl, tokenCacheRef]);

  useEffect(() => {
    // Prime the cache so the first panel render has a token ready.
    getAdsToken().catch(() => { /* surfaced via err state */ });
  }, [getAdsToken]);

  if (!adsBaseUrl) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Campaigns</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          vnl-ads is not configured. Set <code>adsBaseUrl</code> in <code>aws-config.json</code> and
          deploy with <code>-c vnlAdsJwtSecret=...</code> to enable campaign management.
        </p>
      </div>
    );
  }

  return (
    <div className="vnl-ads-root">
      {err && (
        <div className="mb-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      <AdsAdminPanel
        baseUrl={adsBaseUrl}
        getToken={getAdsToken}
      />
    </div>
  );
}
