import { useRef, useState, useEffect, useCallback } from 'react';
import Hls from 'hls.js';

export interface Quality {
  level: number;  // -1 = Auto, 0+ = specific HLS level index
  label: string;  // "Auto", "1080p", "720p", etc.
  height: number; // 0 for Auto
}

export function useHlsPlayer(hlsUrl: string | undefined) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [qualities, setQualities] = useState<Quality[]>([]);
  const [currentQuality, setCurrentQualityState] = useState<number>(-1);
  const [syncTime, setSyncTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isSafari, setIsSafari] = useState<boolean>(false);

  useEffect(() => {
    if (!hlsUrl || !videoRef.current) return;

    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;

      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const levels: Quality[] = [{ level: -1, label: 'Auto', height: 0 }];
        data.levels.forEach((lvl, i) => {
          levels.push({
            level: i,
            label: lvl.height ? `${lvl.height}p` : `Level ${i}`,
            height: lvl.height || 0,
          });
        });
        setQualities(levels);
      });

      hls.loadSource(hlsUrl);

      const onTimeUpdate = () => setSyncTime(video.currentTime * 1000);
      const onPlay = () => setIsPlaying(true);
      const onPause = () => setIsPlaying(false);

      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);

      return () => {
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS fallback
      video.src = hlsUrl;
      setIsSafari(true);

      const onTimeUpdate = () => setSyncTime(video.currentTime * 1000);
      const onPlay = () => setIsPlaying(true);
      const onPause = () => setIsPlaying(false);

      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);

      return () => {
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
      };
    }
  }, [hlsUrl]);

  const setQuality = useCallback((level: number) => {
    if (!hlsRef.current) return;
    // Use nextLevel (not currentLevel) to avoid buffer stall on mid-stream quality switch
    hlsRef.current.nextLevel = level;
    setCurrentQualityState(level);
  }, []);

  return {
    videoRef,
    syncTime,
    isPlaying,
    qualities,
    currentQuality,
    setQuality,
    isSafari,
  };
}
