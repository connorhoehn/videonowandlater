/**
 * LiveBroadcastsSlider - Horizontal scrollable slider for currently live broadcasts
 * Displays broadcasts with 'live' status, with thumbnail or placeholder
 */

import { useNavigate } from 'react-router-dom';
import { ReactionSummaryPills } from './ReactionSummaryPills';
import type { ActivitySession } from './RecordingSlider';

interface LiveBroadcastsSliderProps {
  sessions: ActivitySession[];
}

export function LiveBroadcastsSlider({ sessions }: LiveBroadcastsSliderProps) {
  const navigate = useNavigate();

  // Filter to live broadcasts only
  const liveBroadcasts = sessions.filter(
    (s) => s.sessionType === 'BROADCAST' && s.recordingStatus === 'processing'
  );

  if (liveBroadcasts.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-100 bg-red-50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
          Live Now
        </h2>
        <div className="overflow-x-auto snap-x snap-mandatory scroll-smooth scroll-snap-slider">
          <div className="flex gap-4 pb-2">
          {liveBroadcasts.map((session) => (
            <div
              key={session.sessionId}
              className="snap-center flex-shrink-0 w-64 bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer relative"
              onClick={() => navigate(`/viewer/${session.sessionId}`)}
            >
              {/* LIVE Badge */}
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-red-600 text-white px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider shadow-lg animate-pulse-glow">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                LIVE
              </div>

              {/* Thumbnail */}
              <div className="aspect-video bg-gray-900 flex items-center justify-center">
                {session.thumbnailUrl ? (
                  <img
                    src={session.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400">
                    <svg
                      className="w-12 h-12 mb-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="text-xs">Broadcasting now</span>
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="p-3">
                <p className="text-xs font-semibold text-gray-800 truncate">
                  {session.userId}
                </p>
                <div className="mt-2">
                  <ReactionSummaryPills reactionSummary={session.reactionSummary} />
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
