import { useRef, useState, useCallback } from 'react';
import { Card } from './Card';
import { PlayIcon } from './Icons';

export interface VideoPlayerCardProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  className?: string;
}

export function VideoPlayerCard({
  src,
  poster,
  autoPlay = false,
  muted = false,
  onPlay,
  onPause,
  onEnded,
  className = '',
}: VideoPlayerCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showOverlay, setShowOverlay] = useState(!autoPlay);

  const handlePlay = useCallback(() => {
    setShowOverlay(false);
    onPlay?.();
  }, [onPlay]);

  const handlePause = useCallback(() => {
    setShowOverlay(true);
    onPause?.();
  }, [onPause]);

  const handleOverlayClick = useCallback(() => {
    videoRef.current?.play();
  }, []);

  return (
    <Card className={className}>
      <div className="relative">
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          autoPlay={autoPlay}
          muted={muted}
          controls
          playsInline
          className="w-full object-cover"
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={onEnded}
        />

        {showOverlay && (
          <button
            type="button"
            onClick={handleOverlayClick}
            aria-label="Play video"
            className="absolute inset-0 flex items-center justify-center bg-transparent transition-opacity duration-300"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
              <PlayIcon className="h-8 w-8 text-white" />
            </span>
          </button>
        )}
      </div>
    </Card>
  );
}
