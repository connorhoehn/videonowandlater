/**
 * UploadActivityCard - Activity card for upload sessions
 * Displays filename, file size, upload/processing progress, status badges, and relative timestamp
 */

import { useNavigate } from 'react-router-dom';
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
    <div
      onClick={handleClick}
      className={`p-4 bg-white rounded-lg border border-gray-100 ${
        isViewable ? 'hover:border-gray-300 cursor-pointer' : 'cursor-default'
      } transition-colors`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {/* Upload Icon */}
          <div className="flex-shrink-0 mt-1">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">{fileName}</h3>
            <p className="text-xs text-gray-500 mt-1">
              {session.userId} • {fileSize} • {duration ? `${duration} • ` : ''}{timestamp}
            </p>

            {/* Processing Status */}
            <div className="mt-2 flex items-center gap-2">
              {isProcessing && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                  {currentStep}
                </span>
              )}
              {isViewable && !isProcessing && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
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
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            {isUploading ? (
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            ) : (
              <div className="h-full bg-yellow-600 animate-pulse" />
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
            truncate={true}
            className="text-gray-700"
          />
        </div>
      )}

      {/* Audit Log - Processing Timeline */}
      {!compact && <SessionAuditLog session={session} compact={true} />}
    </div>
  );
}