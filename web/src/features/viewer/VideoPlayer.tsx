/**
 * VideoPlayer - video element wrapper for IVS Player
 */

import type { RefObject } from 'react';

interface VideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  posterFrameUrl?: string;
  thumbnailBaseUrl?: string;
  thumbnailCount?: number;
  durationMs?: number;
}

export function VideoPlayer({ videoRef, isPlaying, posterFrameUrl }: VideoPlayerProps) {
  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-xl">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls
        poster={posterFrameUrl}
        className="w-full h-full object-cover"
      />

      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
          <div className="text-white text-center animate-fade-in">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
            <div className="text-lg font-semibold mb-1">Waiting for stream…</div>
            <div className="text-sm text-gray-400">The broadcast will start soon</div>
          </div>
        </div>
      )}
    </div>
  );
}
