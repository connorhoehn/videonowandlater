/**
 * CameraPreview - video element wrapper for camera preview
 */

import type { RefObject } from 'react';

interface CameraPreviewProps {
  videoRef: RefObject<HTMLCanvasElement | null>;
}

export function CameraPreview({ videoRef }: CameraPreviewProps) {
  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-xl ring-1 ring-gray-800/50">
      {/* The IVS Broadcast SDK writes into this canvas element.
          Canvas does not support object-fit, so we size it absolutely to fill
          the container and let the SDK handle scaling internally. */}
      <canvas
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
