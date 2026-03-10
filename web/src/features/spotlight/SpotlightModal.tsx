/**
 * SpotlightModal - Modal dialog for browsing and selecting live creators.
 * Uses React portal (no Radix dependency).
 */

import React from 'react';
import ReactDOM from 'react-dom';
import type { LiveSession } from './useSpotlight';

export interface SpotlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  liveSessions: LiveSession[];
  isLoading: boolean;
  onSelect: (sessionId: string, name: string) => Promise<void>;
  onRefresh: () => void;
}

function formatTimeSince(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just started';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function SpotlightModal({
  isOpen,
  onClose,
  liveSessions,
  isLoading,
  onSelect,
  onRefresh,
}: SpotlightModalProps) {
  const [selectingId, setSelectingId] = React.useState<string | null>(null);

  // Close on Escape key
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = async (session: LiveSession) => {
    setSelectingId(session.sessionId);
    try {
      await onSelect(session.sessionId, session.userId);
    } finally {
      setSelectingId(null);
    }
    onClose();
  };

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Content panel */}
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg p-6 w-full max-w-lg max-h-[70vh] overflow-y-auto z-50 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spotlight-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2
              id="spotlight-modal-title"
              className="text-lg font-bold text-gray-900"
            >
              Feature a Creator
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Select a live broadcaster to spotlight on your stream
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
              title="Refresh list"
              aria-label="Refresh live sessions"
            >
              <svg
                className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <svg
              className="w-6 h-6 text-purple-600 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            <span className="text-sm text-gray-500">Loading live broadcasters…</span>
          </div>
        ) : liveSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-600 font-medium">No other live broadcasters right now</p>
            <p className="text-xs text-gray-400">Check back later or refresh to see new streams</p>
            <button
              onClick={onRefresh}
              className="mt-2 text-sm text-purple-600 hover:text-purple-800 font-medium"
            >
              Refresh
            </button>
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {liveSessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-purple-200 hover:bg-purple-50 transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm shrink-0">
                  {session.userId.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {session.userId}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium shrink-0">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                      Live
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatTimeSince(session.createdAt)}
                  </span>
                </div>

                {/* Feature button */}
                <button
                  onClick={() => handleSelect(session)}
                  disabled={selectingId === session.sessionId}
                  className="shrink-0 px-3 py-1.5 rounded-md text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {selectingId === session.sessionId ? 'Featuring…' : 'Feature'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}
