/**
 * Phase 4: Image moderation frame capture hook.
 *
 * When `enabled` is true, captures a single frame from the provided video
 * element every 10 seconds, compresses it to JPEG, requests a presigned S3
 * PUT URL from the API, and uploads it. Server-side the S3 event triggers
 * Nova Lite classification against the session's pinned ruleset.
 *
 * Failures are silent (this is a background, best-effort channel).
 */

import { useEffect, useRef } from 'react';

interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

export function useModerationCapture(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sessionId: string,
  apiBaseUrl: string,
  authToken: string,
  enabled: boolean,
  intervalMs: number = 10_000,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || !authToken || !sessionId || !apiBaseUrl) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    let disposed = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const captureAndUpload = async () => {
      if (disposed) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) { schedule(); return; }

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        schedule();
        return;
      }

      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) { schedule(); return; }

      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.6),
        );
        if (!blob || disposed) { schedule(); return; }

        // 1. Request presigned PUT URL
        const presignResp = await fetch(
          `${apiBaseUrl}/sessions/${sessionId}/moderation-upload`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
          },
        );
        if (!presignResp.ok) { schedule(); return; }
        const data = (await presignResp.json()) as UploadUrlResponse;
        if (disposed) return;

        // 2. PUT the JPEG to S3
        await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
      } catch {
        // Silent — moderation frame upload is best-effort
      }

      schedule();
    };

    const schedule = () => {
      if (disposed) return;
      timerId = setTimeout(captureAndUpload, intervalMs);
    };

    // Initial delay (lets camera warm up and avoids capturing first pre-handshake frame)
    timerId = setTimeout(captureAndUpload, Math.min(intervalMs, 5000));

    return () => {
      disposed = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [videoRef, sessionId, apiBaseUrl, authToken, enabled, intervalMs]);
}
