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
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type AudioStream,
} from '@aws-sdk/client-transcribe-streaming';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';

export interface UseCaptionsCaptureOpts {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
  /** Cognito User Pool ID — required to mint Identity Pool credentials. */
  userPoolId: string;
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
  userPoolId,
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

      // 3. Stream to Transcribe.
      if (!cancelled) setStatus('streaming');
      try {
        await runTranscribeLoop({
          stream,
          creds,
          apiBaseUrl,
          authToken,
          sessionId,
          userPoolId,
          stopFlagRef,
        });
      } catch (err) {
        if (!cancelled && !stopFlagRef.current) {
          setStatus('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      stopCapture();
    };
  }, [apiBaseUrl, authToken, enabled, isHost, sessionId, userPoolId, stopCapture]);

  return { status, error };
}

const TRANSCRIBE_SAMPLE_RATE = 16000;

async function runTranscribeLoop(args: {
  stream: MediaStream;
  creds: CaptionCredentials;
  apiBaseUrl: string;
  authToken: string;
  sessionId: string;
  userPoolId: string;
  stopFlagRef: React.MutableRefObject<boolean>;
}): Promise<void> {
  const { stream, creds, apiBaseUrl, authToken, sessionId, userPoolId, stopFlagRef } = args;

  const loginKey = `cognito-idp.${creds.region}.amazonaws.com/${userPoolId}`;
  const credentialsProvider = fromCognitoIdentityPool({
    clientConfig: { region: creds.region },
    identityPoolId: creds.identityPoolId,
    logins: { [loginKey]: authToken },
  });

  const client = new TranscribeStreamingClient({
    region: creds.region,
    credentials: credentialsProvider,
  });

  const AudioContextCtor =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('AudioContext unsupported');
  const audioContext = new AudioContextCtor({ sampleRate: TRANSCRIBE_SAMPLE_RATE });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  const chunkQueue: Uint8Array[] = [];
  let resolveNext: ((value: IteratorResult<AudioStream>) => void) | null = null;
  let streamClosed = false;

  processor.onaudioprocess = (event) => {
    if (streamClosed || stopFlagRef.current) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = floatTo16BitPcm(input);
    const chunk = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: { AudioEvent: { AudioChunk: chunk } }, done: false });
    } else {
      chunkQueue.push(chunk);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  const audioStream: AsyncIterable<AudioStream> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        if (stopFlagRef.current || streamClosed) {
          return Promise.resolve({ value: undefined as unknown as AudioStream, done: true });
        }
        const queued = chunkQueue.shift();
        if (queued) {
          return Promise.resolve({ value: { AudioEvent: { AudioChunk: queued } }, done: false });
        }
        return new Promise<IteratorResult<AudioStream>>((resolve) => {
          resolveNext = resolve;
        });
      },
      return: () => {
        streamClosed = true;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: undefined as unknown as AudioStream, done: true });
        }
        return Promise.resolve({ value: undefined as unknown as AudioStream, done: true });
      },
    }),
  };

  const sessionStartMs = Date.now();
  try {
    const response = await client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: 'en-US',
        MediaSampleRateHertz: TRANSCRIBE_SAMPLE_RATE,
        MediaEncoding: 'pcm',
        AudioStream: audioStream,
      }),
    );

    if (!response.TranscriptResultStream) throw new Error('no transcript stream');
    for await (const event of response.TranscriptResultStream) {
      if (stopFlagRef.current) break;
      const results = event.TranscriptEvent?.Transcript?.Results ?? [];
      for (const result of results) {
        const alt = result.Alternatives?.[0];
        if (!alt?.Transcript) continue;
        const isFinal = result.IsPartial === false;
        const startSec = result.StartTime ?? (Date.now() - sessionStartMs) / 1000;
        const endSec = result.EndTime ?? startSec;
        postCaptionSegment({
          apiBaseUrl,
          sessionId,
          authToken,
          text: alt.Transcript,
          startSec,
          endSec,
          isFinal,
        }).catch(() => { /* best-effort */ });
      }
    }
  } finally {
    streamClosed = true;
    try { processor.disconnect(); } catch { /* ignore */ }
    try { source.disconnect(); } catch { /* ignore */ }
    try { await audioContext.close(); } catch { /* ignore */ }
    try { client.destroy(); } catch { /* ignore */ }
  }
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
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
