/**
 * CaptionsOverlay — renders rolling live captions at the bottom of the video
 * frame (Netflix-style, 2-line max). Listens to IVS Chat `caption` events via
 * `useCaptionsListener`. Viewer can hide via the inline toggle (client-side
 * preference, persisted to localStorage).
 */

import React from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import { useCaptionsListener } from './useCaptionsListener';

interface CaptionsOverlayProps {
  room: ChatRoom | undefined;
  /**
   * Server-known initial state for `captionsEnabled`. Allows the overlay to
   * render correctly before the first `captions_toggled` event arrives.
   */
  initialEnabled?: boolean | null;
  /**
   * Viewer can hide captions via the overlay's small toggle. We persist the
   * preference to localStorage keyed by sessionId so it survives reloads.
   */
  sessionId: string;
}

const PREF_KEY_PREFIX = 'vnl:captions:hide:';

export function CaptionsOverlay({ room, initialEnabled = null, sessionId }: CaptionsOverlayProps) {
  const { captions, hostCaptionsEnabled } = useCaptionsListener(room, initialEnabled);

  const prefKey = `${PREF_KEY_PREFIX}${sessionId}`;
  const [viewerHidden, setViewerHidden] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(prefKey) === '1';
    } catch {
      return false;
    }
  });

  const toggleViewerHidden = () => {
    setViewerHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(prefKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const hostEnabled = hostCaptionsEnabled ?? initialEnabled ?? false;

  // Host disabled: render nothing (don't even show the toggle — feature is off).
  if (!hostEnabled) {
    return null;
  }

  return (
    <>
      {/* Small CC on/off toggle — top-right of the video. */}
      <button
        type="button"
        onClick={toggleViewerHidden}
        aria-label={viewerHidden ? 'Show captions' : 'Hide captions'}
        title={viewerHidden ? 'Show captions' : 'Hide captions'}
        className={`absolute top-2 right-2 z-20 px-2 py-1 rounded text-xs font-bold tracking-wider transition-colors ${
          viewerHidden
            ? 'bg-black/40 text-white/60 hover:bg-black/60'
            : 'bg-white/90 text-black hover:bg-white'
        }`}
      >
        CC
      </button>

      {/* Rolling caption lines — bottom center. */}
      {!viewerHidden && captions.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-10 flex flex-col items-center gap-1 px-4">
          {captions.map((cap) => (
            <div
              key={cap.id}
              className="max-w-[90%] bg-black/75 text-white text-sm sm:text-base font-medium px-3 py-1 rounded shadow-lg leading-snug"
            >
              {cap.speakerLabel ? (
                <span className="mr-2 text-xs font-bold uppercase tracking-wider text-white/70">
                  {cap.speakerLabel}:
                </span>
              ) : null}
              <span>{cap.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
