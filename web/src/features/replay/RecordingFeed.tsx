/**
 * RecordingFeed - Modern card grid of recorded sessions
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, VideoIcon } from '../../components/social';

export interface Recording {
  sessionId: string;
  thumbnailUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  userId: string;
  endedAt?: string;
  sessionType?: 'BROADCAST' | 'HANGOUT';
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
}

interface RecordingFeedProps {
  recordings: Recording[];
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RecordingFeed({ recordings }: RecordingFeedProps) {
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  if (recordings.length === 0) {
    return (
      <EmptyState
        title="No recordings yet"
        description="Go live to create your first recording"
        icon={<VideoIcon className="w-8 h-8 text-gray-300" />}
      />
    );
  }

  return (
    <div className="relative">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900/95 text-white text-xs px-4 py-2.5 rounded-full shadow-xl pointer-events-none backdrop-blur-sm">
          {toast}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {recordings.map((recording) => {
            const isAvailable = recording.recordingStatus === 'available';
            const isFailed = recording.recordingStatus === 'failed';
            const isProcessing = !isFailed && !isAvailable;
            const isHangout = recording.sessionType === 'HANGOUT';
            const date = recording.endedAt ?? recording.createdAt;

            const handleClick = () => {
              if (isAvailable) {
                navigate(`/replay/${recording.sessionId}`);
              } else if (isFailed) {
                showToast('Recording failed to process');
              } else {
                showToast('Still processing — check back soon');
              }
            };

            return (
              <div
                key={recording.sessionId}
                onClick={handleClick}
                className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group"
              >
                {/* Square thumbnail */}
                <div style={{ position: 'relative', width: '100%', paddingBottom: '100%' }} className="bg-gray-900">
                  {recording.thumbnailUrl && isAvailable ? (
                    <img
                      src={recording.thumbnailUrl}
                      alt=""
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                      className="group-hover:scale-[1.03] transition-transform duration-300"
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="bg-gray-800">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="9" />
                        <polygon points="10,8 16,12 10,16" fill="#4b5563" stroke="none" />
                      </svg>
                    </div>
                  )}

                  {/* Processing overlay */}
                  {isProcessing && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }} className="bg-black/50 backdrop-blur-[2px]">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-white/80 text-[10px] font-medium tracking-wider uppercase">Processing</span>
                    </div>
                  )}

                  {/* Failed overlay */}
                  {isFailed && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="bg-black/50">
                      <span className="text-red-400 text-xs font-medium">Failed</span>
                    </div>
                  )}

                  {/* Play overlay on hover */}
                  {isAvailable && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="bg-black/0 group-hover:bg-black/20 transition-colors duration-200">
                      <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 scale-90 group-hover:scale-100 bg-white/95 rounded-full p-3 shadow-lg">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#111">
                          <polygon points="6,4 20,12 6,20" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Hangout badge */}
                  {isHangout && (
                    <div className="absolute top-2 left-2">
                      <span className="text-[9px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full text-white" style={{ background: '#7c3aed' }}>
                        Hangout
                      </span>
                    </div>
                  )}

                  {/* Duration */}
                  {isAvailable && recording.recordingDuration !== undefined && (
                    <div className="absolute bottom-2 right-2 bg-black/70 rounded-lg px-1.5 py-0.5">
                      <span className="text-white text-[10px] font-medium tabular-nums">
                        {formatDuration(recording.recordingDuration)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="px-3 pt-2 pb-3">
                  <p className="text-xs font-semibold text-gray-800 truncate">{recording.userId}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(date)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
