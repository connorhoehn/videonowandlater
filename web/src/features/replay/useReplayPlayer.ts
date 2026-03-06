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
  const [syncTime, setSyncTime] = useState<number>(0); // Elapsed playback milliseconds from player.getPosition()
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!recordingHlsUrl) {
      console.log('[useReplayPlayer] skipped — no recordingHlsUrl');
      return;
    }
    if (!window.IVSPlayer) {
      console.warn('[useReplayPlayer] skipped — IVSPlayer SDK not on window');
      return;
    }
    if (!videoRef.current) {
      console.warn('[useReplayPlayer] skipped — videoRef not ready');
      return;
    }

    console.log('[useReplayPlayer] loading', recordingHlsUrl);

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

    // SYNC_TIME_UPDATE fires with UTC epoch ms; convert to relative ms using player.getPosition()
    // so syncTime matches sessionRelativeTime (ms since stream start) for chat/reaction sync
    player.addEventListener(window.IVSPlayer.PlayerEventType.SYNC_TIME_UPDATE, () => {
      setSyncTime(player.getPosition() * 1000);
    });

    player.addEventListener(window.IVSPlayer.PlayerEventType.ERROR, (err: any) => {
      console.error('[useReplayPlayer] player error', err);
    });

    // Load HLS URL
    console.log('[useReplayPlayer] player.load()');
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
