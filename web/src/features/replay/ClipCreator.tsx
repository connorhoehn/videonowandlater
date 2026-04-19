/**
 * ClipCreator — modal UI that lets a viewer extract a short (5-180s) clip
 * from an ended session recording. Submits to POST /sessions/:id/clips,
 * polls GET /clips/:id until status=ready, then navigates to /clip/:id.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/social';

interface ClipCreatorProps {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
  /** Recording duration in seconds (max bound for sliders) */
  durationSec: number;
  /** Current video time in seconds (used to seed default window) */
  currentTimeSec: number;
}

const MIN_DURATION = 5;
const MAX_DURATION = 180;
const DEFAULT_WINDOW = 15; // seconds on either side of cursor

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function ClipCreator({ sessionId, apiBaseUrl, authToken, durationSec, currentTimeSec }: ClipCreatorProps) {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pollingClipId, setPollingClipId] = useState<string | null>(null);

  // Seed defaults each time the modal opens from the current playback time.
  useEffect(() => {
    if (!open) return;
    const center = clamp(currentTimeSec, 0, Math.max(0, durationSec));
    const s = clamp(center - DEFAULT_WINDOW, 0, durationSec);
    const e = clamp(center + DEFAULT_WINDOW, s + MIN_DURATION, durationSec);
    setStartSec(Math.floor(s));
    setEndSec(Math.floor(e));
    if (!title) setTitle('Highlight');
    // intentionally no dep on currentTimeSec to avoid re-seeding on video tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clipLength = Math.max(0, endSec - startSec);
  const lengthInvalid = clipLength < MIN_DURATION || clipLength > MAX_DURATION;

  // Poll the clip status until ready/failed once we've submitted.
  useEffect(() => {
    if (!pollingClipId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/clips/${pollingClipId}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ready') {
            addToast({ variant: 'success', title: 'Clip ready', description: 'Opening clip…' });
            navigate(`/clip/${pollingClipId}`);
            setPollingClipId(null);
            return;
          }
          if (data.status === 'failed') {
            addToast({ variant: 'error', title: 'Clip failed', description: 'The encode job failed. Try a different window.' });
            setPollingClipId(null);
            return;
          }
        }
      } catch {
        // swallow transient errors and retry
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pollingClipId, apiBaseUrl, addToast, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lengthInvalid || !title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/clips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ title: title.trim(), startSec, endSec }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create clip' }));
        addToast({ variant: 'error', title: 'Could not clip', description: err.error ?? `Status ${res.status}` });
        return;
      }
      const data = await res.json();
      addToast({ variant: 'info', title: 'Clip processing', description: "We'll redirect when ready." });
      setPollingClipId(data.clipId);
      setOpen(false);
    } catch (err: any) {
      addToast({ variant: 'error', title: 'Could not clip', description: err?.message ?? 'Unknown error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        aria-label="Clip this moment"
      >
        <span aria-hidden="true">✂️</span>
        Clip this
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Create a clip
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="clip-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <input
                  id="clip-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  required
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="clip-start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start: {formatTime(startSec)}
                </label>
                <input
                  id="clip-start"
                  type="range"
                  min={0}
                  max={Math.max(0, Math.floor(durationSec) - MIN_DURATION)}
                  step={1}
                  value={startSec}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setStartSec(v);
                    if (endSec - v < MIN_DURATION) setEndSec(Math.min(durationSec, v + MIN_DURATION));
                    if (endSec - v > MAX_DURATION) setEndSec(v + MAX_DURATION);
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label htmlFor="clip-end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End: {formatTime(endSec)}
                </label>
                <input
                  id="clip-end"
                  type="range"
                  min={Math.min(durationSec, startSec + MIN_DURATION)}
                  max={Math.floor(durationSec)}
                  step={1}
                  value={endSec}
                  onChange={(e) => setEndSec(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="text-sm text-gray-600 dark:text-gray-400">
                Length: {clipLength.toFixed(0)}s
                {lengthInvalid && (
                  <span className="ml-2 text-red-600">(must be {MIN_DURATION}-{MAX_DURATION}s)</span>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={lengthInvalid || submitting || !title.trim()}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md"
                >
                  {submitting ? 'Submitting…' : 'Create clip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
