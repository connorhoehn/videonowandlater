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

function getStatusBadge(status?: string): { label: string; className: string } {
  switch (status) {
    case 'uploading':
      return { label: 'Uploading', className: 'bg-blue-100 text-blue-700' };
    case 'processing':
      return { label: 'Processing', className: 'bg-yellow-100 text-yellow-700' };
    case 'available':
      return { label: 'Complete', className: 'bg-green-100 text-green-700' };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-100 text-red-700' };
    case 'pending':
      return { label: 'Pending', className: 'bg-gray-100 text-gray-700' };
    default:
      return { label: 'Idle', className: 'bg-gray-100 text-gray-700' };
  }
}

export function UploadActivityCard({ session, compact = false }: UploadActivityCardProps) {
  const navigate = useNavigate();
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration
    ? formatDuration(session.recordingDuration)
    : null;
  const fileSize = formatFileSize(session.fileSize);
  const fileName = session.fileName || 'Uploaded video';
  const progress = session.uploadProgress || 0;
  const statusBadge = getStatusBadge(session.uploadStatus);
  const isComplete = session.uploadStatus === 'available' && session.recordingStatus === 'available';
  const isProcessing = ['uploading', 'processing'].includes(session.uploadStatus || '');

  const handleClick = () => {
    if (isComplete) {
      navigate(`/replay/${session.sessionId}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`p-4 bg-white rounded-lg border border-gray-100 ${
        isComplete ? 'hover:border-gray-300 cursor-pointer' : 'cursor-default'
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

            {/* Status Badge */}
            <div className="mt-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
              {isComplete && (
                <svg
                  className="inline-block w-4 h-4 text-green-600 ml-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                session.uploadStatus === 'uploading'
                  ? 'bg-blue-600 bg-stripes animate-stripes'
                  : 'bg-yellow-600'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* AI Summary (when complete) */}
      {isComplete && (
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