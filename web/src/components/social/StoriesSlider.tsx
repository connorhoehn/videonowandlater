import { useRef, useState, useCallback, useEffect } from 'react';
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons';

/* ------------------------------------------------------------------ */
/*  StoriesSlider — horizontally scrollable story cards               */
/* ------------------------------------------------------------------ */

export interface Story {
  id: string;
  name: string;
  thumbnail: string;
  onClick?: () => void;
}

interface StoriesSliderProps {
  stories: Story[];
  onCreateStory?: () => void;
  createLabel?: string;
  className?: string;
}

const CARD_WIDTH = 120;
const GAP = 8;

export function StoriesSlider({
  stories,
  onCreateStory,
  createLabel = 'Post a Story',
  className = '',
}: StoriesSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, [checkScroll]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = CARD_WIDTH + GAP;
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  return (
    <div className={`relative ${className}`}>
      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide"
        style={{
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'x mandatory',
        }}
      >
        {/* Create Story card */}
        <button
          type="button"
          onClick={onCreateStory}
          className="h-[150px] w-[120px] flex-shrink-0 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-gray-400 transition-colors bg-transparent"
          style={{ scrollSnapAlign: 'start' }}
        >
          <span className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500 text-white">
            <PlusIcon size={20} />
          </span>
          <span className="text-xs text-gray-600 font-medium text-center px-1">
            {createLabel}
          </span>
        </button>

        {/* Story cards */}
        {stories.map((story) => (
          <div
            key={story.id}
            role="button"
            tabIndex={0}
            onClick={story.onClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                story.onClick?.();
              }
            }}
            className="h-[150px] w-[120px] flex-shrink-0 rounded-xl overflow-hidden relative cursor-pointer"
            style={{
              scrollSnapAlign: 'start',
              backgroundImage: `url(${story.thumbnail})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
              <p className="text-white text-xs font-medium truncate">
                {story.name}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Prev arrow */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-gray-50 cursor-pointer z-10"
          aria-label="Scroll left"
        >
          <ChevronLeftIcon size={16} />
        </button>
      )}

      {/* Next arrow */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center hover:bg-gray-50 cursor-pointer z-10"
          aria-label="Scroll right"
        >
          <ChevronRightIcon size={16} />
        </button>
      )}
    </div>
  );
}
