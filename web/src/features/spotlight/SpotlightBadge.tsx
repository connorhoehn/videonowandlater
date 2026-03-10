/**
 * SpotlightBadge - Elegant badge showing the featured creator.
 * Displayed at top-right for both broadcasters (with remove button) and viewers.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import type { FeaturedCreator } from './useSpotlight';

export interface SpotlightBadgeProps {
  featuredCreator: FeaturedCreator;
  onRemove?: () => void;
  isBroadcaster: boolean;
}

export function SpotlightBadge({ featuredCreator, onRemove, isBroadcaster }: SpotlightBadgeProps) {
  if (!featuredCreator) return null;

  const avatarInitial = featuredCreator.name.charAt(0).toUpperCase();

  return (
    <div
      className="fixed top-16 right-4 z-40 bg-white rounded-lg shadow-lg p-3 min-w-[200px] max-w-[300px] border border-gray-100"
      role="complementary"
      aria-label={`Featured creator: ${featuredCreator.name}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-purple-600 uppercase tracking-wider">
          Featured Creator
        </span>
        {isBroadcaster && onRemove && (
          <button
            onClick={onRemove}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Remove featured creator"
            title="Remove spotlight"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Creator info row */}
      <div className="flex items-center gap-2.5">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm shrink-0">
          {avatarInitial}
        </div>

        {/* Name + live indicator */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 bg-green-500 rounded-full shrink-0"
              aria-label="Live"
            />
            <span className="text-sm font-semibold text-gray-900 truncate">
              {featuredCreator.name}
            </span>
          </div>
          <span className="text-xs text-gray-500">Live now</span>
        </div>
      </div>

      {/* Watch link */}
      <div className="mt-2.5">
        <Link
          to={`/viewer/${featuredCreator.sessionId}`}
          className="block w-full text-center text-xs font-semibold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-md px-3 py-1.5 transition-colors"
        >
          Watch Stream
        </Link>
      </div>
    </div>
  );
}
