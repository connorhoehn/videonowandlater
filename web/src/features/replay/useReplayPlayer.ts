/**
 * useReplayPlayer hook - manages IVS Player SDK lifecycle for replay playback
 * Tracks syncTime for future chat replay synchronization
 */

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    IVSPlayer: any;
  }
}

export function useReplayPlayer(recordingHlsUrl: string | undefined) {
  const [syncTime, setSyncTime] = useState<number>(0); // UTC milliseconds from getSyncTime
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!videoRef.current || !window.IVSPlayer || !recordingHlsUrl) {
      return;
    }

    // Initialize IVS Player
    const player = window.IVSPlayer.create();
    player.attachHTMLVideoElement(videoRef.current);
    playerRef.current = player;

    // Event listeners for player state
    player.addEventListener(window.IVSPlayer.PlayerState.PLAYING, () => {
      setIsPlaying(true);
    });

    player.addEventListener(window.IVSPlayer.PlayerState.IDLE, () => {
      setIsPlaying(false);
    });

    // SYNC_TIME_UPDATE event for chat synchronization (future use in Plan 06-03)
    player.addEventListener(window.IVSPlayer.PlayerEventType.SYNC_TIME_UPDATE, (time: number) => {
      setSyncTime(time);
    });

    // Load HLS URL
    player.load(recordingHlsUrl);

    // Disable autoplay (mobile requires user interaction)
    player.setAutoplay(false);

    // Cleanup on unmount
    return () => {
      player.delete();
    };
  }, [recordingHlsUrl]);

  return {
    videoRef,
    syncTime,
    isPlaying,
    player: playerRef.current,
  };
}
