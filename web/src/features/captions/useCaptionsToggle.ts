/**
 * useCaptionsToggle — host-facing hook wrapping the POST
 * `/sessions/{id}/captions/toggle` endpoint. Tracks the current `captionsEnabled`
 * state optimistically so the button feels instant; rolls back on error.
 */

import { useCallback, useState } from 'react';

export interface UseCaptionsToggleOpts {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
  initialEnabled: boolean;
}

export interface UseCaptionsToggleResult {
  enabled: boolean;
  busy: boolean;
  error?: string;
  toggle: () => Promise<void>;
  setEnabledDirect: (val: boolean) => void;
}

export function useCaptionsToggle({
  sessionId,
  apiBaseUrl,
  authToken,
  initialEnabled,
}: UseCaptionsToggleOpts): UseCaptionsToggleResult {
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const toggle = useCallback(async () => {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setError(undefined);
    setEnabled(next); // optimistic
    try {
      const resp = await fetch(
        `${apiBaseUrl}/sessions/${sessionId}/captions/toggle`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enabled: next }),
        }
      );
      if (!resp.ok) {
        setEnabled(!next);
        setError(`Toggle failed: ${resp.status}`);
      }
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrl, authToken, busy, enabled, sessionId]);

  return { enabled, busy, error, toggle, setEnabledDirect: setEnabled };
}
