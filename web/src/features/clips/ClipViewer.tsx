/**
 * ClipViewer — public route at /clip/:clipId rendering a share-ready
 * page: the clip MP4 with a signed URL, a title, author, and a copy-link
 * share action. No authentication required when the clip's session is public.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getConfig } from '../../config/aws-config';

interface ClipResponse {
  clipId: string;
  sessionId: string;
  authorId: string;
  title: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  createdAt: string;
  status: 'processing' | 'ready' | 'failed' | 'deleted';
  signedUrl?: string;
  sessionUserId?: string;
  sessionTitle?: string;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function ClipViewer() {
  const { clipId } = useParams<{ clipId: string }>();
  const [clip, setClip] = useState<ClipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const config = getConfig();
  const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

  useEffect(() => {
    if (!clipId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/clips/${clipId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? 'Clip not found' : `Failed to load clip (${res.status})`);
          return;
        }
        const data: ClipResponse = await res.json();
        setClip(data);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load clip');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [clipId, apiBaseUrl]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 text-sm">Loading clip…</div>
      </div>
    );
  }
  if (error || !clip) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <p className="text-red-600 text-lg mb-2">{error ?? 'Clip unavailable'}</p>
          <Link to="/" className="text-blue-600 hover:underline text-sm">Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-full bg-black">
        <div className="relative aspect-video max-h-[75vh] mx-auto max-w-5xl">
          {clip.status === 'ready' && clip.signedUrl ? (
            <video
              src={clip.signedUrl}
              controls
              playsInline
              autoPlay
              className="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white">
              {clip.status === 'processing' && 'Clip is still processing…'}
              {clip.status === 'failed' && 'This clip failed to encode.'}
              {clip.status === 'deleted' && 'This clip has been removed.'}
              {clip.status === 'ready' && !clip.signedUrl && 'Clip URL unavailable'}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{clip.title}</h1>
            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-3">
              <span>by {clip.authorId}</span>
              <span>·</span>
              <span>{formatDuration(clip.durationSec)}</span>
              <span>·</span>
              <span>{new Date(clip.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="mt-2 text-sm">
              <Link
                to={`/replay/${clip.sessionId}`}
                className="text-blue-600 hover:underline"
              >
                From session: {clip.sessionTitle ?? clip.sessionUserId ?? clip.sessionId}
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={handleShare}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
}
