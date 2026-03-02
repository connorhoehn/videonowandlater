/**
 * VideoPlayer - video element wrapper for IVS Player
 */

import type { RefObject } from 'react';

interface VideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
}

export function VideoPlayer({ videoRef, isPlaying }: VideoPlayerProps) {
  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-lg overflow-hidden shadow-lg">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls
        className="w-full h-full object-cover"
      />

      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
          <div className="text-white text-center">
            <div className="text-lg font-semibold mb-2">Waiting for stream...</div>
            <div className="text-sm text-gray-400">The broadcast will start soon</div>
          </div>
        </div>
      )}
    </div>
  );
}
