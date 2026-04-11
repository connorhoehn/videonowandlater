/**
 * RecordingSlider - Horizontal scrollable recording slider with CSS scroll-snap
 * Displays broadcasts only (filters out hangout sessions)
 * Shows 3-4 cards visible with peek-scrolling effect
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReactionSummaryPills } from './ReactionSummaryPills';

export interface ActivitySession {
  sessionId: string;
  userId: string;
  sessionType: 'BROADCAST' | 'HANGOUT' | 'UPLOAD';
  thumbnailUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  endedAt?: string;
  reactionSummary?: Record<string, number>;
  participantCount?: number;
  messageCount?: number;
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
  recordingHlsUrl?: string;
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
  visualAnalysis?: string;
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  convertStatus?: 'pending' | 'processing' | 'available' | 'failed';
  mediaConvertJobName?: string;
  sourceFileName?: string;
  uploadStatus?: 'pending' | 'uploading' | 'processing' | 'available' | 'failed';
  posterFrameUrl?: string;
}

interface RecordingSliderProps {
  sessions: ActivitySession[];
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function RecordingCard({ session, navigate }: { session: ActivitySession; navigate: ReturnType<typeof useNavigate> }) {
  const [imgError, setImgError] = useState(false);
  const thumbnailSrc = session.thumbnailUrl || session.posterFrameUrl;
  const showThumbnail = thumbnailSrc && !imgError;

  return (
    <div
      className="snap-center flex-shrink-0 w-64 bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-300 cursor-pointer group"
      onClick={() => navigate(`/replay/${session.sessionId}`)}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-900 relative overflow-hidden">
        {showThumbnail ? (
          <img
            src={thumbnailSrc}
            alt=""
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:brightness-95 transition-all duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {session.sessionType === 'UPLOAD' && (
          <div className="absolute top-2 left-2 z-10 bg-green-600 text-white px-2 py-0.5 rounded-full text-[10px] font-semibold shadow-sm">
            Upload
          </div>
        )}
        {/* Duration overlay */}
        {session.recordingDuration && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
            {formatDuration(session.recordingDuration)}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="p-3">
        <p className="text-xs font-semibold text-gray-800 truncate">
          {session.sourceFileName || session.userId}
        </p>
        <div className="mt-2">
          <ReactionSummaryPills reactionSummary={session.reactionSummary} />
        </div>
      </div>
    </div>
  );
}

export function RecordingSlider({ sessions }: RecordingSliderProps) {
  const navigate = useNavigate();

  // Filter to broadcasts and completed uploads
  const broadcasts = sessions.filter(
    (s) => s.sessionType === 'BROADCAST' || s.sessionType === 'UPLOAD'
  );

  if (broadcasts.length === 0) {
    return (
      <div className="border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 flex items-center gap-3 text-gray-400 text-sm">
          <svg className="w-5 h-5 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          No recordings yet
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Videos</h2>
        <div className="overflow-x-auto snap-x snap-mandatory scroll-smooth scroll-snap-slider">
          <div className="flex gap-4 pb-2">
          {broadcasts.map((session) => (
            <RecordingCard key={session.sessionId} session={session} navigate={navigate} />
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
