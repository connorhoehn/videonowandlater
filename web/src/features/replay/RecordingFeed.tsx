/**
 * RecordingFeed - displays recently recorded sessions in a responsive grid
 */

import { useNavigate } from 'react-router-dom';

export interface Recording {
  sessionId: string;
  thumbnailUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  userId: string;
  endedAt?: string;
  sessionType?: 'BROADCAST' | 'HANGOUT';
}

interface RecordingFeedProps {
  recordings: Recording[];
}

/**
 * Format duration from milliseconds to MM:SS
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format date to relative time or absolute date
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 24) {
    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      if (diffMinutes < 1) return 'Just now';
      return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    }
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
  return date.toLocaleDateString();
}

export function RecordingFeed({ recordings }: RecordingFeedProps) {
  const navigate = useNavigate();

  if (recordings.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="text-lg">No recordings yet</p>
        <p className="text-sm mt-2">Recordings will appear here after broadcasts end</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4">
      {recordings.map((recording) => {
        const isHangout = recording.sessionType === 'HANGOUT';
        const destination = isHangout
          ? `/hangout/${recording.sessionId}`
          : `/replay/${recording.sessionId}`;

        return (
          <div
            key={recording.sessionId}
            onClick={() => navigate(destination)}
            className="group cursor-pointer"
          >
            {/* Thumbnail container */}
            <div className="aspect-video bg-gray-200 rounded-lg overflow-hidden relative">
            {recording.thumbnailUrl ? (
              <img
                src={recording.thumbnailUrl}
                alt="Recording thumbnail"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-300 to-gray-400">
                <svg
                  className="w-16 h-16 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            )}

            {/* Session type badge (top-right) */}
            {isHangout && (
              <div className="absolute top-2 right-2 bg-purple-600 text-white text-xs px-2 py-1 rounded font-medium">
                Hangout
              </div>
            )}

            {/* Duration badge (bottom-right) */}
            {recording.recordingDuration !== undefined && (
              <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                {formatDuration(recording.recordingDuration)}
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="mt-2">
            <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
              Recording {recording.sessionId.substring(0, 8)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {recording.endedAt ? formatDate(recording.endedAt) : formatDate(recording.createdAt)}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Broadcaster: {recording.userId.substring(0, 8)}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
