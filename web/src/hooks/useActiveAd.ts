/**
 * useActiveAd — fetches the single active story-inline ad from the public
 * /ads/active endpoint. Returns null when no ad is active. No auth required;
 * response is CloudFront-cached for 30s so the cost of calling is trivial.
 */

import { useEffect, useState } from 'react';
import { getConfig } from '../config/aws-config';

export interface ActiveAd {
  id: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSec: number;
  label: string;
}

export function useActiveAd(): { ad: ActiveAd | null; loading: boolean } {
  const [ad, setAd] = useState<ActiveAd | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const config = getConfig();
    if (!config?.apiUrl) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${config.apiUrl}/ads/active`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { ad: ActiveAd | null };
        if (!cancelled) setAd(data.ad);
      } catch {
        // Non-blocking; ad just doesn't render.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { ad, loading };
}
