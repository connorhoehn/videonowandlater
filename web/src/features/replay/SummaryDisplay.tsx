/**
 * SummaryDisplay - Reusable component for displaying AI-generated summaries
 * Handles status-based rendering (pending/available/failed) with optional truncation
 */

import React from 'react';

export interface SummaryDisplayProps {
  summary?: string;
  status?: 'pending' | 'available' | 'failed';
  truncate?: boolean; // true for cards (2 lines), false for full text
  className?: string; // for styling flexibility
}

export const SummaryDisplay: React.FC<SummaryDisplayProps> = ({
  summary,
  status,
  truncate = false,
  className = '',
}) => {
  // Treat undefined status as 'pending' (pre-Phase 20 sessions)
  const displayStatus = status ?? 'pending';

  if (displayStatus === 'pending') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-200 border-t-blue-600 flex-shrink-0" />
        <span className="text-gray-500 text-sm">Generating summary...</span>
      </div>
    );
  }

  if (displayStatus === 'available' && summary) {
    return (
      <div className={`bg-blue-50 border border-blue-100 rounded-lg p-3 ${className}`}>
        <p className={`text-sm ${truncate ? 'line-clamp-2' : ''}`}>
          {summary}
        </p>
      </div>
    );
  }

  if (displayStatus === 'failed') {
    return (
      <div className={`flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg p-3 ${className}`}>
        <svg className="h-4 w-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span className="text-gray-500 text-sm">Summary unavailable</span>
      </div>
    );
  }

  // Fallback for undefined/unknown status
  return null;
};
