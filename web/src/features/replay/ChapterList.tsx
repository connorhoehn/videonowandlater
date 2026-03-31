/**
 * ChapterList - Horizontal scrollable chapter navigation component
 * Shows chapter cards with thumbnails, titles, and timestamps.
 * Active chapter is highlighted based on current playback time.
 */

import { useRef, useEffect } from 'react';

export interface Chapter {
  title: string;
  startTimeMs: number;
  endTimeMs: number;
  thumbnailIndex?: number;
}

interface ChapterListProps {
  chapters: Chapter[];
  currentTimeMs: number;
  thumbnailBaseUrl?: string;
  onSeek: (timeMs: number) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getActiveChapterIndex(chapters: Chapter[], currentTimeMs: number): number {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (currentTimeMs >= chapters[i].startTimeMs) {
      return i;
    }
  }
  return 0;
}

export function ChapterList({ chapters, currentTimeMs, thumbnailBaseUrl, onSeek }: ChapterListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIndex = getActiveChapterIndex(chapters, currentTimeMs);

  // Smooth scroll to keep active chapter visible
  useEffect(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const activeCard = container.children[activeIndex] as HTMLElement | undefined;
    if (!activeCard) return;

    const containerRect = container.getBoundingClientRect();
    const cardRect = activeCard.getBoundingClientRect();

    // Only scroll if the active card is not fully visible
    if (cardRect.left < containerRect.left || cardRect.right > containerRect.right) {
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeIndex]);

  if (chapters.length === 0) return null;

  return (
    <div className="mt-3 animate-fade-in">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
        Chapters
      </h3>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scroll-snap-slider pb-2"
      >
        {chapters.map((chapter, index) => {
          const isActive = index === activeIndex;
          const thumbnailUrl =
            thumbnailBaseUrl && chapter.thumbnailIndex != null
              ? `${thumbnailBaseUrl}-thumb.${String(chapter.thumbnailIndex).padStart(7, '0')}.jpg`
              : undefined;

          return (
            <button
              key={`${chapter.startTimeMs}-${index}`}
              onClick={() => onSeek(chapter.startTimeMs)}
              className={`snap-center flex-shrink-0 w-40 rounded-xl overflow-hidden transition-all duration-300 text-left group ${
                isActive
                  ? 'ring-2 ring-blue-500 shadow-md scale-[1.02]'
                  : 'ring-1 ring-gray-200 hover:ring-gray-300 hover:shadow-sm'
              }`}
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-gray-800 relative overflow-hidden">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt={chapter.title}
                    className="w-full h-full object-cover group-hover:brightness-90 transition-all duration-200"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-800">
                    <svg
                      className="w-5 h-5 text-gray-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                      />
                    </svg>
                  </div>
                )}
                {/* Time badge */}
                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                  {formatTime(chapter.startTimeMs)}
                </div>
                {/* Active indicator */}
                {isActive && (
                  <div className="absolute top-1 left-1 bg-blue-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse-glow">
                    NOW
                  </div>
                )}
              </div>

              {/* Title */}
              <div className={`px-2.5 py-2 ${isActive ? 'bg-blue-50' : 'bg-white'}`}>
                <p
                  className={`text-xs font-medium truncate ${
                    isActive ? 'text-blue-700' : 'text-gray-700'
                  }`}
                >
                  {chapter.title}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
