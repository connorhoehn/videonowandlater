/**
 * PlaybackSpeedControl — small dropdown bound to a video element's
 * `playbackRate`. The component owns no state of its own beyond the
 * currently-selected speed so it can be rendered anywhere the video ref
 * is available.
 */

import { useState } from 'react';

export const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

interface PlaybackSpeedControlProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  defaultSpeed?: PlaybackSpeed;
  className?: string;
}

export function PlaybackSpeedControl({
  videoRef,
  defaultSpeed = 1,
  className,
}: PlaybackSpeedControlProps) {
  const [speed, setSpeed] = useState<PlaybackSpeed>(defaultSpeed);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = parseFloat(e.target.value) as PlaybackSpeed;
    setSpeed(next);
    const video = videoRef.current;
    if (video) {
      video.playbackRate = next;
    }
  };

  return (
    <label
      className={`inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 ${className ?? ''}`}
    >
      <span className="sr-only">Playback speed</span>
      <span aria-hidden="true" className="font-medium">
        Speed
      </span>
      <select
        aria-label="Playback speed"
        value={speed}
        onChange={handleChange}
        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {PLAYBACK_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s === 1 ? 'Normal' : `${s}x`}
          </option>
        ))}
      </select>
    </label>
  );
}
