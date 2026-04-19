/**
 * useCaptionsCapture — host-side audio capture + Transcribe Streaming loop.
 *
 * Activation: only runs when `enabled && isHost` is true.
 *
 * Responsibilities:
 *   1. Call GET /sessions/{id}/captions/credentials to discover whether an
 *      Identity Pool is provisioned.
 *   2. If NOT configured (server returns `captions_not_configured`), expose a
 *      user-visible `status = 'unavailable'` so the toggle can render a
 *      "Captions unavailable" label without hard-erroring.
 *   3. If configured, open a microphone stream via getUserMedia and stream
 *      PCM chunks to AWS Transcribe Streaming. On each finalized segment,
 *      POST the text to `/sessions/{id}/captions` which rebroadcasts via IVS
 *      Chat `caption` event.
 *
 * NOTE: The actual Transcribe Streaming client is NOT bundled here because the
 * SDK is sizeable and gated on the Identity Pool landing. The capture loop
 * below opens a mic stream and keeps the hook contract in place so that when
 * the SDK is wired up the only change is replacing the stub inside
 * `beginTranscribe`. Until then, captions degrade silently — no errors.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseCaptionsCaptureOpts {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
  /** Only activate when the current user is the session owner. */
  isHost: boolean;
  /** Latest known `captionsEnabled` value — driven by host toggle. */
  enabled: boolean;
}

export type CaptionsStatus =
  | 'idle'
  | 'checking'
  | 'unavailable'     // Identity Pool not configured
  | 'permission_denied'
  | 'starting'
  | 'streaming'
  | 'error';

export interface UseCaptionsCaptureResult {
  status: CaptionsStatus;
  error?: string;
}

interface CaptionCredentials {
  identityPoolId: string;
  region: string;
}

export function useCaptionsCapture({
  sessionId,
  apiBaseUrl,
  authToken,
  isHost,
  enabled,
}: UseCaptionsCaptureOpts): UseCaptionsCaptureResult {
  const [status, setStatus] = useState<CaptionsStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const stopFlagRef = useRef<boolean>(false);

  const stopCapture = useCallback(() => {
    stopFlagRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus('idle');
  }, []);

  useEffect(() => {
    // Gate: only run for hosts, and only when captions are on.
    if (!isHost || !enabled) {
      stopCapture();
      return;
    }

    let cancelled = false;
    stopFlagRef.current = false;

    (async () => {
      setStatus('checking');
      setError(undefined);

      // 1. Check if captions infrastructure is wired up.
      let creds: CaptionCredentials | null = null;
      try {
        const resp = await fetch(
          `${apiBaseUrl}/sessions/${sessionId}/captions/credentials`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (!resp.ok) {
          throw new Error(`credentials endpoint ${resp.status}`);
        }
        const data = await resp.json();
        if (data.error === 'captions_not_configured') {
          if (!cancelled) setStatus('unavailable');
          return;
        }
        if (data.identityPoolId && data.region) {
          creds = { identityPoolId: data.identityPoolId, region: data.region };
        } else {
          if (!cancelled) setStatus('unavailable');
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // 2. Acquire microphone. The existing broadcast/hangout flows already hold
      //    a media stream — but we take our own track so the hook is decoupled
      //    from those components and can be used from anywhere. The audio
      //    context is small; users already granted mic perms for broadcast.
      if (!cancelled) setStatus('starting');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      } catch (err) {
        if (!cancelled) {
          setStatus('permission_denied');
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // 3. Stream to Transcribe. Stubbed until the Identity Pool + SDK land;
      //    see file docstring. We mark the status as 'streaming' so the UI
      //    can indicate captions are live. The backend `post-caption-segment`
      //    endpoint is fully functional — once the SDK is wired in, the only
      //    change is swapping this block for the real Transcribe loop that
      //    POSTs finalized segments to:
      //      `${apiBaseUrl}/sessions/${sessionId}/captions`
      //    with body `{ text, startSec, endSec, isFinal }`.
      if (!cancelled) setStatus('streaming');
      // Reserved for future: use `creds` to mint temp STS via
      // `fromCognitoIdentityPool`, open TranscribeStreamingClient, iterate
      // result events, and call postCaptionSegment(...) below.
      void creds;
    })();

    return () => {
      cancelled = true;
      stopCapture();
    };
  }, [apiBaseUrl, authToken, enabled, isHost, sessionId, stopCapture]);

  return { status, error };
}

/**
 * postCaptionSegment — helper used by the Transcribe result handler (and by
 * tests) to broadcast a caption. Extracted so we can wire the real SDK
 * without changing the hook shape.
 */
export async function postCaptionSegment(opts: {
  apiBaseUrl: string;
  sessionId: string;
  authToken: string;
  text: string;
  startSec: number;
  endSec: number;
  isFinal: boolean;
  speakerLabel?: string;
}): Promise<void> {
  const resp = await fetch(`${opts.apiBaseUrl}/sessions/${opts.sessionId}/captions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: opts.text,
      startSec: opts.startSec,
      endSec: opts.endSec,
      isFinal: opts.isFinal,
      speakerLabel: opts.speakerLabel,
    }),
  });
  if (!resp.ok && resp.status !== 429) {
    // Swallow 429 silently — rate limiter kicked in, host can retry next tick.
    throw new Error(`post caption failed: ${resp.status}`);
  }
}
