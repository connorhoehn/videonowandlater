/**
 * usePlayer hook - manages IVS Player SDK lifecycle
 * Handles playback URL fetching and video player initialization
 */

import { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    IVSPlayer: any;
  }
}

interface UsePlayerOptions {
  sessionId: string;
  apiBaseUrl: string;
}

export function usePlayer({ sessionId, apiBaseUrl }: UsePlayerOptions) {
  const [player, setPlayer] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current || !window.IVSPlayer) {
      return;
    }

    const initPlayer = async () => {
      try {
        // Fetch playback URL
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/playback`);

        if (!response.ok) {
          throw new Error(`Failed to get playback URL: ${response.statusText}`);
        }

        const { playbackUrl, status } = await response.json();
        setSessionStatus(status);

        if (!playbackUrl) {
          setError('No playback URL available - stream may not have started yet');
          return;
        }

        // Initialize IVS Player
        const ivsPlayer = window.IVSPlayer.create();
        ivsPlayer.attachHTMLVideoElement(videoRef.current);

        // Event listeners
        ivsPlayer.addEventListener(window.IVSPlayer.PlayerState.PLAYING, () => {
          setIsPlaying(true);
          setError(null);
        });

        ivsPlayer.addEventListener(window.IVSPlayer.PlayerState.IDLE, () => {
          setIsPlaying(false);
        });

        ivsPlayer.addEventListener(window.IVSPlayer.PlayerEventType.ERROR, (error: any) => {
          setError(`Player error: ${error}`);
          setIsPlaying(false);
        });

        // When the manifest is parsed, pin to a video rendition. The IVS ABR
        // can default to the audio-only track (~168 kbps variant in STANDARD
        // channel manifests) on startup, then reject every subsequent video
        // segment for "exceeding" that bandwidth — which seek-loops the player
        // indefinitely. We disable auto-quality mode up front, pick a video
        // quality on READY, then let ABR adapt from there.
        ivsPlayer.setAutoQualityMode(false);
        ivsPlayer.addEventListener(window.IVSPlayer.PlayerState.READY, () => {
          const qualities = ivsPlayer.getQualities() ?? [];
          const videoQualities = qualities.filter((q: any) => q.width > 0 && q.height > 0);
          if (videoQualities.length === 0) return;
          // Pick the highest video quality — we're on broadband, and pinning
          // high prevents ABR from dropping back to audio-only mid-stream.
          const best = videoQualities.reduce((a: any, b: any) => (a.bitrate > b.bitrate ? a : b));
          ivsPlayer.setQuality(best, true);
        });

        // Load and play — start muted to satisfy autoplay policies, then unmute
        ivsPlayer.setMuted(true);
        ivsPlayer.load(playbackUrl);
        ivsPlayer.play();

        setPlayer(ivsPlayer);
        setIsMuted(true);
      } catch (err: any) {
        setError(err.message);
      }
    };

    initPlayer();

    return () => {
      if (player) {
        player.pause();
        player.delete();
      }
    };
  }, [sessionId, apiBaseUrl]);

  const toggleMute = () => {
    if (!player) return;
    const newMuted = !isMuted;
    player.setMuted(newMuted);
    setIsMuted(newMuted);
  };

  return {
    videoRef,
    player,
    isPlaying,
    isMuted,
    toggleMute,
    sessionStatus,
    error,
  };
}
