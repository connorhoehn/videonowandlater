/**
 * VideoPlayer - video element wrapper for IVS Player
 */

import type { RefObject } from 'react';

interface VideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  isMuted?: boolean;
  onToggleMute?: () => void;
  posterFrameUrl?: string;
  thumbnailBaseUrl?: string;
  thumbnailCount?: number;
  durationMs?: number;
}

export function VideoPlayer({ videoRef, isPlaying, isMuted, onToggleMute, posterFrameUrl }: VideoPlayerProps) {
  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-xl">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        poster={posterFrameUrl}
        className="w-full h-full object-cover"
      />

      {/* Unmute overlay — shown when playing but muted */}
      {isPlaying && isMuted && onToggleMute && (
        <button
          onClick={onToggleMute}
          className="absolute bottom-4 left-4 z-10 flex items-center gap-2 px-4 py-2 bg-black/70 hover:bg-black/90 text-white rounded-full text-sm font-medium transition-all backdrop-blur-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
          Tap to unmute
        </button>
      )}

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
