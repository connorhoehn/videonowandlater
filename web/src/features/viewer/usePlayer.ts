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

        // Load and play
        ivsPlayer.load(playbackUrl);
        ivsPlayer.play();

        setPlayer(ivsPlayer);
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

  return {
    videoRef,
    player,
    isPlaying,
    sessionStatus,
    error,
  };
}
