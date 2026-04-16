/**
 * UploadActivityCard - Activity card for upload sessions
 * Displays filename, file size, upload/processing progress, status badges, and relative timestamp
 */

import { useNavigate } from 'react-router-dom';
import { Card, Avatar } from '../../components/social';
import { formatDate, formatHumanDuration } from './utils';
import { SessionAuditLog } from './SessionAuditLog';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import type { ActivitySession } from './types';

interface UploadActivityCardProps {
  session: ActivitySession;
  compact?: boolean;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms: number): string {
  return formatHumanDuration(ms);
}

export function UploadActivityCard({ session, compact = false }: UploadActivityCardProps) {
  const navigate = useNavigate();
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration
    ? formatDuration(session.recordingDuration)
    : null;
  const fileSize = formatFileSize(session.fileSize);
  const fileName = session.fileName || 'Uploaded video';

  // Determine actual processing status
  const isUploading = session.uploadStatus === 'uploading';
  const isUploadProcessing = session.uploadStatus === 'processing';
  const isConverting = session.convertStatus === 'processing' ||
                      (session.convertStatus === 'pending' && session.uploadStatus === 'processing');
  const isTranscribing = session.transcriptStatus === 'processing';
  const isGeneratingSummary = session.aiSummaryStatus === 'pending' && session.transcriptStatus === 'available';
  const isFullyComplete = session.recordingStatus === 'available' &&
                          (session.aiSummaryStatus === 'available' || session.transcriptStatus === 'available');
  const isViewable = session.recordingStatus === 'available' ||
                    session.convertStatus === 'available';

  // Determine current processing step
  let currentStep = 'Idle';
  let progressPercent = 0;

  if (isUploading) {
    currentStep = 'Uploading';
    progressPercent = session.uploadProgress || 0;
  } else if (isUploadProcessing && !session.convertStatus) {
    currentStep = 'Processing upload';
    progressPercent = 25;
  } else if (isConverting) {
    currentStep = 'Converting video';
    progressPercent = 50;
  } else if (isTranscribing) {
    currentStep = 'Transcribing';
    progressPercent = 75;
  } else if (isGeneratingSummary) {
    currentStep = 'Generating summary';
    progressPercent = 90;
  } else if (isFullyComplete) {
    currentStep = 'Complete';
    progressPercent = 100;
  }

  const isProcessing = isUploading || isUploadProcessing || isConverting || isTranscribing || isGeneratingSummary;

  const handleClick = () => {
    if (isViewable) {
      navigate(`/video/${session.sessionId}`);
    }
  };

  return (
    <Card
      className={`group ${
        isViewable ? 'hover:shadow-lg cursor-pointer' : 'cursor-default'
      } transition-all duration-300`}
      onClick={handleClick}
    >
      {/* Processing overlay banner when not viewable */}
      {!isViewable && isProcessing && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-center gap-2">
          <svg className="w-5 h-5 text-amber-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-amber-700 text-sm font-medium">Processing — video will be available soon</span>
        </div>
      )}

      <Card.Body>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {/* Upload Avatar */}
          <div className="flex-shrink-0 mt-0.5">
            <Avatar name={session.userId} alt={session.userId || 'Uploader'} size="sm" />
          </div>

          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">{fileName}</h3>
            <p className="text-xs text-gray-500 mt-1">
              {session.userId} • {fileSize} • {duration ? `${duration} • ` : ''}{timestamp}
            </p>

            {/* Processing Status */}
            <div className="mt-2 flex items-center gap-2">
              {isProcessing && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {currentStep}
                </span>
              )}
              {isViewable && !isProcessing && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Ready to view
                </span>
              )}

              {/* Processing indicators */}
              <div className="flex items-center gap-1">
                {session.convertStatus === 'available' && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100" title="Video converted">
                    <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
                {session.transcriptStatus === 'available' && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100" title="Transcript ready">
                    <span className="text-xs">📝</span>
                  </span>
                )}
                {session.aiSummaryStatus === 'available' && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100" title="AI summary ready">
                    <span className="text-xs">🤖</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>{currentStep}</span>
            {isUploading && <span>{Math.round(progressPercent)}%</span>}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            {isUploading ? (
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            ) : (
              <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: `${progressPercent}%` }} />
            )}
          </div>
        </div>
      )}

      {/* AI Summary (when complete) */}
      {isFullyComplete && (
        <div className="mt-2">
          <SummaryDisplay
            summary={session.aiSummary}
            status={session.aiSummaryStatus}
            visualAnalysis={session.visualAnalysis}
            truncate={true}
            className="text-gray-700"
          />
        </div>
      )}

      {/* Highlights badge */}
      {(session as any).highlightReelStatus === 'available' && (
        <div className="mt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/video/${session.sessionId}?view=highlights`);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200 hover:bg-fuchsia-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 4V2m0 2a2 2 0 00-2 2v1a2 2 0 002 2h0a2 2 0 002-2V6a2 2 0 00-2-2zm0 10v2m0-2a2 2 0 01-2-2v-1a2 2 0 012-2h0a2 2 0 012 2v1a2 2 0 01-2 2zM17 4V2m0 2a2 2 0 00-2 2v1a2 2 0 002 2h0a2 2 0 002-2V6a2 2 0 00-2-2zm0 10v2m0-2a2 2 0 01-2-2v-1a2 2 0 012-2h0a2 2 0 012 2v1a2 2 0 01-2 2z" />
            </svg>
            Highlights
          </button>
        </div>
      )}

      {/* Audit Log - Processing Timeline */}
      {!compact && <SessionAuditLog session={session} compact={true} />}
      </Card.Body>
    </Card>
  );
}
