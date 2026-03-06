/**
 * RecordingSlider - Horizontal scrollable recording slider with CSS scroll-snap
 * Displays broadcasts only (filters out hangout sessions)
 * Shows 3-4 cards visible with peek-scrolling effect
 */

import { useNavigate } from 'react-router-dom';
import { ReactionSummaryPills } from './ReactionSummaryPills';

export interface ActivitySession {
  sessionId: string;
  userId: string;
  sessionType: 'BROADCAST' | 'HANGOUT';
  thumbnailUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  endedAt?: string;
  reactionSummary?: Record<string, number>;
  participantCount?: number;
  messageCount?: number;
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
}

interface RecordingSliderProps {
  sessions: ActivitySession[];
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function RecordingSlider({ sessions }: RecordingSliderProps) {
  const navigate = useNavigate();

  // Filter to broadcasts only
  const broadcasts = sessions.filter((s) => s.sessionType === 'BROADCAST');

  if (broadcasts.length === 0) {
    return (
      <div className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-gray-400 text-sm">No recordings yet</div>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Broadcasts</h2>
        <div className="overflow-x-auto snap-x snap-mandatory scroll-smooth">
          <div className="flex gap-4 pb-2">
          {broadcasts.map((session) => (
            <div
              key={session.sessionId}
              className="snap-center flex-shrink-0 w-56 bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/replay/${session.sessionId}`)}
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-gray-900">
                {session.thumbnailUrl && (
                  <img
                    src={session.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>

              {/* Metadata */}
              <div className="p-3">
                <p className="text-xs font-semibold text-gray-800 truncate">
                  {session.userId}
                </p>
                {session.recordingDuration && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    {formatDuration(session.recordingDuration)}
                  </p>
                )}
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
