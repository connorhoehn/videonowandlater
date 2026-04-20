/**
 * AdsPanel — admin-only UI for creating and managing story-inline ads.
 *
 * v1 scope: Polly synthesis path only (text → voice → color backdrop →
 * preview → publish). Record-on-platform path is a v2 follow-up.
 *
 * One ad can be active at any moment; activating a new one deactivates
 * the previous one server-side (single-pointer AD#ACTIVE row in DynamoDB).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchToken } from '../../../auth/fetchToken';
import { getConfig } from '../../../config/aws-config';

type AdSource = 'recording' | 'polly';

interface Ad {
  id: string;
  source: AdSource;
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSec: number;
  contentHash?: string;
  label: string;
  placement: 'story-inline';
  active: boolean;
  createdAt: string;
  createdBy: string;
}

interface SynthStartResponse {
  synthesisId: string;
  state: 'synthesizing';
  expiresAt: string;
}

/**
 * vnl-ads is shipping `errorCode` as a stable enum alongside the free-form
 * `error` string. Treat unknown codes as the generic failure so we remain
 * forward-compatible if they add codes later.
 */
type SynthErrorCode = 'NOT_FOUND' | 'MEDIACONVERT_ERROR' | 'MEDIACONVERT_CANCELED' | 'UNKNOWN' | string;

interface SynthPollResponse {
  state: 'synthesizing' | 'ready' | 'failed';
  mediaUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  contentHash?: string;
  error?: string;
  errorCode?: SynthErrorCode;
  expiresAt: string;
}

const VOICES = [
  { id: 'Matthew', label: 'Matthew — calm, neutral' },
  { id: 'Joanna', label: 'Joanna — warm, friendly' },
  { id: 'Stephen', label: 'Stephen — authoritative' },
  { id: 'Ruth', label: 'Ruth — youthful, upbeat' },
];

const MAX_TEXT_CHARS = 1000;
const MAX_LABEL_CHARS = 80;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

function describeSynthFailure(data: SynthPollResponse): string {
  switch (data.errorCode) {
    case 'NOT_FOUND':
      return 'Synthesis expired or not found. Try Preview again.';
    case 'MEDIACONVERT_ERROR':
      return 'Media rendering failed on the ads service. Try different text or a different voice.';
    case 'MEDIACONVERT_CANCELED':
      return 'Media rendering was canceled. Try again.';
    case 'UNKNOWN':
    default:
      return data.error || 'Synthesis failed — check the ads service.';
  }
}

export function AdsPanel() {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [authToken, setAuthToken] = useState('');
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [error, setError] = useState('');

  // Polly form state
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Matthew');
  const [backdropColor, setBackdropColor] = useState('#111827');

  // Preview state
  const [previewing, setPreviewing] = useState(false);
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [previewDurationSec, setPreviewDurationSec] = useState<number | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string>('idle');

  const [publishing, setPublishing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchToken().then(({ token }) => setAuthToken(token ?? '')).catch(() => setError('Failed to authenticate'));
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const loadAds = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/ads`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ads: Ad[] };
      setAds(data.ads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ads');
    }
  }, [apiBaseUrl, authToken]);

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  const resetPreview = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    setPreviewing(false);
    setPreviewMediaUrl(null);
    setPreviewHash(null);
    setPreviewDurationSec(null);
    setPreviewStatus('idle');
  }, []);

  const startPreview = async () => {
    if (!label.trim()) { setError('Label is required'); return; }
    if (!text.trim()) { setError('Text is required'); return; }
    if (text.length > MAX_TEXT_CHARS) { setError(`Text must be ≤ ${MAX_TEXT_CHARS} chars`); return; }

    setError('');
    resetPreview();
    setPreviewing(true);
    setPreviewStatus('synthesizing');

    try {
      const startRes = await fetch(`${apiBaseUrl}/admin/ads/synth`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // vnl-ads wraps the synthesis spec under `source: { kind: 'polly' }`
          // to share the creative schema with uploaded-MP4 creatives.
          source: {
            kind: 'polly',
            text,
            voice,
            engine: 'neural',
            languageCode: 'en-US',
          },
          backdrop: { kind: 'color', value: backdropColor },
          format: 'story',
        }),
      });
      if (!startRes.ok) throw new Error(`Synth start ${startRes.status}`);
      const start = (await startRes.json()) as SynthStartResponse;

      const startedAt = Date.now();
      const poll = async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setPreviewStatus('timed out');
          setPreviewing(false);
          return;
        }
        const pollRes = await fetch(
          `${apiBaseUrl}/admin/ads/synth/${encodeURIComponent(start.synthesisId)}`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!pollRes.ok) {
          setPreviewStatus(`poll failed (${pollRes.status})`);
          setPreviewing(false);
          return;
        }
        const data = (await pollRes.json()) as SynthPollResponse;
        if (data.state === 'ready' && data.mediaUrl && data.contentHash && data.durationSec) {
          setPreviewMediaUrl(data.mediaUrl);
          setPreviewHash(data.contentHash);
          setPreviewDurationSec(data.durationSec);
          setPreviewStatus('ready');
          setPreviewing(false);
          return;
        }
        if (data.state === 'failed') {
          setPreviewStatus(describeSynthFailure(data));
          setPreviewing(false);
          return;
        }
        pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      };
      pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setPreviewing(false);
    }
  };

  const publishPreview = async () => {
    if (!previewMediaUrl || !previewHash || previewDurationSec == null) return;
    setPublishing(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/ads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'polly',
          mediaUrl: previewMediaUrl,
          durationSec: previewDurationSec,
          contentHash: previewHash,
          label: label.trim(),
          activate: true,
        }),
      });
      if (!res.ok && res.status !== 201) throw new Error(`HTTP ${res.status}`);
      await loadAds();
      resetPreview();
      setLabel('');
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const activateAd = async (id: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/ads/${id}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activate failed');
    }
  };

  const deactivateAd = async (id: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/ads/${id}/deactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deactivate failed');
    }
  };

  const deleteAd = async (id: string) => {
    if (!confirm('Delete this ad? This cannot be undone.')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/ads/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const active = ads?.find((a) => a.active);
  const inactive = ads?.filter((a) => !a.active) ?? [];

  return (
    <section className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Active ad slot */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Active ad</h3>
        {active ? (
          <div className="flex items-start gap-4 p-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
            <video src={active.mediaUrl} controls muted playsInline className="w-40 h-auto rounded" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{active.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {active.source} · {active.durationSec}s · {new Date(active.createdAt).toLocaleString()}
              </p>
              <button
                onClick={() => deactivateAd(active.id)}
                className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-500"
              >
                Deactivate
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No ad currently active.</p>
        )}
      </div>

      {/* Create new */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Create new (Polly)</h3>
        <div className="space-y-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={MAX_LABEL_CHARS}
              placeholder="e.g. Q2 Beta Welcome"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Text <span className="text-gray-400">({text.length}/{MAX_TEXT_CHARS})</span>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={MAX_TEXT_CHARS}
              placeholder="Welcome to videonow — here's what's new this week…"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Voice</label>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Backdrop</label>
              <input
                type="color"
                value={backdropColor}
                onChange={(e) => setBackdropColor(e.target.value)}
                className="w-full h-10 px-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={startPreview}
              disabled={previewing || publishing}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {previewing ? 'Synthesizing…' : 'Preview'}
            </button>
            {previewStatus !== 'idle' && (
              <span className="text-xs text-gray-500 dark:text-gray-400">{previewStatus}</span>
            )}
          </div>

          {previewMediaUrl && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
              <video src={previewMediaUrl} controls playsInline className="w-40 h-auto rounded" />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={publishPreview}
                  disabled={publishing}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
                >
                  {publishing ? 'Publishing…' : 'Publish (activates immediately)'}
                </button>
                <button
                  onClick={resetPreview}
                  disabled={publishing}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent ads list */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">All ads</h3>
        {ads === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : inactive.length === 0 && !active ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No ads created yet.</p>
        ) : (
          <ul className="space-y-2">
            {inactive.map((ad) => (
              <li
                key={ad.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <video src={ad.mediaUrl} muted playsInline className="w-20 h-auto rounded" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{ad.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {ad.source} · {ad.durationSec}s · {new Date(ad.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => activateAd(ad.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500"
                  >
                    Activate
                  </button>
                  <button
                    onClick={() => deleteAd(ad.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
