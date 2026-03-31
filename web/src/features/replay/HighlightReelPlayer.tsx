/**
 * HighlightReelPlayer - Component for viewing auto-generated highlight reels
 * Supports landscape (16:9) and vertical (9:16) viewing modes with download and share
 */

import { useState, useCallback } from 'react';

interface HighlightReelPlayerProps {
  landscapeUrl?: string;
  verticalUrl?: string;
  status?: string; // 'pending' | 'processing' | 'available' | 'failed'
}

export function HighlightReelPlayer({ landscapeUrl, verticalUrl, status }: HighlightReelPlayerProps) {
  const [mode, setMode] = useState<'landscape' | 'vertical'>('landscape');

  const handleShare = useCallback(async () => {
    const url = mode === 'landscape' ? landscapeUrl : verticalUrl;
    if (!url) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Check out this highlight reel',
          url,
        });
      } catch {
        // User cancelled or share failed — fall back to clipboard
        await navigator.clipboard.writeText(url);
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
  }, [mode, landscapeUrl, verticalUrl]);

  // Don't render anything if no highlight reel data at all
  if (!status && !landscapeUrl && !verticalUrl) return null;

  // Processing state
  if (status === 'processing' || status === 'pending') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center animate-pulse">
            <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 4V2m0 2a2 2 0 00-2 2v1a2 2 0 002 2h0a2 2 0 002-2V6a2 2 0 00-2-2zm0 10v2m0-2a2 2 0 01-2-2v-1a2 2 0 012-2h0a2 2 0 012 2v1a2 2 0 01-2 2zM17 4V2m0 2a2 2 0 00-2 2v1a2 2 0 002 2h0a2 2 0 002-2V6a2 2 0 00-2-2zm0 10v2m0-2a2 2 0 01-2-2v-1a2 2 0 012-2h0a2 2 0 012 2v1a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Generating highlights<span className="animate-dots"></span></p>
            <p className="text-xs text-gray-500 mt-0.5">This may take a few minutes</p>
          </div>
        </div>
      </div>
    );
  }

  // Failed state
  if (status === 'failed') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Highlight generation failed</p>
            <p className="text-xs text-gray-500 mt-0.5">The highlight reel could not be created for this session</p>
          </div>
        </div>
      </div>
    );
  }

  // Available state — show player
  if (status !== 'available' || (!landscapeUrl && !verticalUrl)) return null;

  const activeUrl = mode === 'landscape' ? landscapeUrl : verticalUrl;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Video player area */}
      <div className="bg-black flex items-center justify-center">
        {mode === 'landscape' ? (
          <div className="w-full aspect-video">
            <video
              key={activeUrl}
              src={activeUrl}
              controls
              playsInline
              className="w-full h-full"
            />
          </div>
        ) : (
          /* Vertical mode with phone frame mockup */
          <div className="py-6 flex justify-center w-full">
            <div className="highlight-phone-frame">
              <video
                key={activeUrl}
                src={verticalUrl || landscapeUrl}
                controls
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="p-4 flex flex-wrap items-center gap-3">
        {/* Mode toggle */}
        {landscapeUrl && verticalUrl && (
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setMode('landscape')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                mode === 'landscape'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              16:9
            </button>
            <button
              onClick={() => setMode('vertical')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                mode === 'vertical'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              9:16
            </button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Download buttons */}
        {landscapeUrl && (
          <a
            href={landscapeUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Landscape
          </a>
        )}
        {verticalUrl && (
          <a
            href={verticalUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Vertical
          </a>
        )}

        {/* Share button */}
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share
        </button>
      </div>
    </div>
  );
}
