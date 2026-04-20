/**
 * MyClipsPanel — list of the caller's recent clips (live + post-session) with
 * inline mp4 playback on click.
 *
 * Shell-less (renders a list + optional title); compose into whichever page
 * wants it. Fetches on mount from GET /me/clips.
 */

import { useCallback, useEffect, useState } from 'react';
import { listMyClips } from './liveClipApi';
import { isLiveClip, type Clip } from './types';

export interface MyClipsPanelProps {
  authToken: string | null;
  /** Optional title above the list (default: "My Clips"). Pass empty string to hide. */
  title?: string;
  /** Max number of clips to fetch (default 50). */
  limit?: number;
}

export function MyClipsPanel({ authToken, title = 'My Clips', limit = 50 }: MyClipsPanelProps) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authToken) {
      setLoading(false);
      return;
    }
    try {
      const next = await listMyClips(authToken, limit);
      setClips(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      setLoading(false);
    }
  }, [authToken, limit]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const selectedClip = clips.find((c) => c.clipId === selectedClipId) ?? null;
  const selectedUrl = selectedClip ? getPlaybackUrl(selectedClip) : null;

  return (
    <div className="w-full">
      {title && <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">{title}</h2>}

      {loading && <div className="text-sm text-gray-500">Loading clips…</div>}
      {error && !loading && (
        <div className="text-sm text-red-600">
          {error} &mdash;{' '}
          <button type="button" onClick={load} className="underline">
            retry
          </button>
        </div>
      )}

      {!loading && !error && clips.length === 0 && (
        <div className="text-sm text-gray-500">You haven't clipped anything yet.</div>
      )}

      {selectedClip && selectedUrl && (
        <div className="mb-4 bg-black rounded overflow-hidden">
          <video
            src={selectedUrl}
            controls
            autoPlay
            playsInline
            className="w-full aspect-video"
          />
          <div className="p-2 text-xs text-gray-300 flex items-center justify-between">
            <span>{clipLabel(selectedClip)}</span>
            <button
              type="button"
              className="underline"
              onClick={() => setSelectedClipId(null)}
            >
              close
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {clips.map((c) => (
          <li key={c.clipId}>
            <ClipRow
              clip={c}
              onSelect={() => {
                if (getPlaybackUrl(c)) setSelectedClipId(c.clipId);
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClipRow({ clip, onSelect }: { clip: Clip; onSelect: () => void }) {
  const isPending = clip.status === 'pending' || clip.status === 'processing';
  const playable = clip.status === 'ready' && !!getPlaybackUrl(clip);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!playable}
      className={[
        'w-full flex items-center justify-between gap-3 px-3 py-2 rounded border',
        'text-left text-sm transition',
        playable
          ? 'border-gray-200 hover:border-blue-500 hover:bg-blue-50 dark:border-gray-700 dark:hover:bg-gray-800 cursor-pointer'
          : 'border-gray-200 dark:border-gray-700 opacity-70 cursor-default',
      ].join(' ')}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 dark:text-white truncate">
          {clipLabel(clip)}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {new Date(clip.createdAt).toLocaleString()} · {isLiveClip(clip) ? 'live clip' : 'clip'}
        </div>
      </div>
      <StatusBadge status={clip.status} isPending={isPending} />
    </button>
  );
}

function StatusBadge({ status, isPending }: { status: Clip['status']; isPending: boolean }) {
  if (isPending) {
    return (
      <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">
        {status}
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-green-100 text-green-800">
        ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-red-100 text-red-800">failed</span>
    );
  }
  return (
    <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{status}</span>
  );
}

function clipLabel(clip: Clip): string {
  if (clip.title) return clip.title;
  if (isLiveClip(clip)) return 'Live clip';
  if (typeof clip.durationSec === 'number') return `Clip (${Math.round(clip.durationSec)}s)`;
  return 'Clip';
}

/**
 * Returns the best playback URL for the clip:
 *   - live clips: `mp4Url`
 *   - post-session clips: no direct URL field in the API shape returned by
 *     /me/clips — the viewer at /clip/{clipId} resolves a signed URL. We
 *     return null here so the row becomes non-playable-inline; callers can
 *     instead link to /clip/{clipId}.
 */
function getPlaybackUrl(clip: Clip): string | null {
  if (isLiveClip(clip)) return clip.mp4Url ?? null;
  return null;
}
