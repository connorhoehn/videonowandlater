/**
 * SummaryDisplay - Reusable component for displaying AI-generated summaries
 * Handles status-based rendering (pending/available/failed) with optional truncation
 * and smooth transitions between states
 */

import React from 'react';

export interface SummaryDisplayProps {
  summary?: string;
  status?: 'pending' | 'available' | 'failed';
  truncate?: boolean; // true for cards (2 lines), false for full text
  className?: string; // for styling flexibility
  visualAnalysis?: string; // AI-generated visual analysis from VLM
}

export const SummaryDisplay: React.FC<SummaryDisplayProps> = ({
  summary,
  status,
  truncate = false,
  className = '',
  visualAnalysis,
}) => {
  // Treat undefined status as 'pending' (pre-Phase 20 sessions)
  const displayStatus = status ?? 'pending';

  if (displayStatus === 'pending') {
    return (
      <div className={`flex items-center gap-2 animate-fade-in ${className}`}>
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-200 border-t-blue-600 flex-shrink-0" />
        <span className="text-gray-500 text-sm">Generating summary...</span>
      </div>
    );
  }

  if (displayStatus === 'available' && summary) {
    return (
      <div className={`bg-gradient-to-br from-blue-50 to-indigo-50/50 border border-blue-100 rounded-xl p-3.5 transition-all duration-300 ease-out animate-fade-in ${className}`}>
        <p className={`text-sm leading-relaxed ${truncate ? 'line-clamp-2' : ''}`}>
          {summary}
        </p>
        {visualAnalysis && !truncate && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Visual Analysis
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">{visualAnalysis}</p>
          </div>
        )}
      </div>
    );
  }

  if (displayStatus === 'failed') {
    return (
      <div className={`flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3.5 animate-fade-in ${className}`}>
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
