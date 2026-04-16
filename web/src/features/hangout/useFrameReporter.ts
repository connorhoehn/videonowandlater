import { useEffect, useRef } from 'react';

export function useFrameReporter(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sessionId: string,
  apiBaseUrl: string,
  authToken: string,
  isActive: boolean,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isActive || !authToken || !sessionId) return;

    // Create offscreen canvas once
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let mounted = true;

    const captureAndReport = async () => {
      if (!mounted || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Only capture if video is playing and has dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        scheduleNext();
        return;
      }

      // Capture frame at reduced resolution (320x180) to minimize upload size
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) { scheduleNext(); return; }

      ctx.drawImage(video, 0, 0, 320, 180);

      try {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.6)
        );
        if (!blob || !mounted) { scheduleNext(); return; }

        // Convert to base64
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });

        await fetch(`${apiBaseUrl}/sessions/${sessionId}/moderation-frame`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ frame: base64 }),
        });
      } catch {
        // Non-blocking — moderation frame upload failure is silent
      }

      scheduleNext();
    };

    const scheduleNext = () => {
      if (!mounted) return;
      // Random 3-6 second interval
      const intervalMs = (3 + Math.random() * 3) * 1000;
      timeoutId = setTimeout(captureAndReport, intervalMs);
    };

    // Start after initial delay
    timeoutId = setTimeout(captureAndReport, 5000);

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [videoRef, sessionId, apiBaseUrl, authToken, isActive]);
}
