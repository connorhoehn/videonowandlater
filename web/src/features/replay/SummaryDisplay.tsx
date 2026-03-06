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
      <p className={`text-gray-500 text-sm ${className}`}>
        Summary coming soon...
      </p>
    );
  }

  if (displayStatus === 'available' && summary) {
    return (
      <p className={`text-sm ${truncate ? 'line-clamp-2' : ''} ${className}`}>
        {summary}
      </p>
    );
  }

  if (displayStatus === 'failed') {
    return (
      <p className={`text-gray-400 text-sm italic ${className}`}>
        Summary unavailable
      </p>
    );
  }

  // Fallback for undefined/unknown status
  return null;
};
