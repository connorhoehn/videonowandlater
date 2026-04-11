import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';

/* ------------------------------------------------------------------ */
/*  SuggestedStoriesSlider — compact horizontally scrollable stories  */
/* ------------------------------------------------------------------ */

export interface SuggestedStory {
  id: string;
  name: string;
  thumbnail: string;
  onClick?: () => void;
}

interface SuggestedStoriesSliderProps {
  title?: string;
  stories: SuggestedStory[];
  className?: string;
}

const CARD_WIDTH = 100;
const GAP = 8;

export function SuggestedStoriesSlider({
  title = 'Suggested stories',
  stories,
  className = '',
}: SuggestedStoriesSliderProps) {
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
    <div className={className}>
      <h6 className="text-base font-semibold mb-3">{title}</h6>

      <div className="relative">
        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto scrollbar-hide"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
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
              className="h-[150px] w-[100px] flex-shrink-0 rounded-xl overflow-hidden relative cursor-pointer group"
            >
              {/* Background image with hover scale */}
              <div
                className="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-300"
                style={{ backgroundImage: `url(${story.thumbnail})` }}
              />

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

              {/* Name */}
              <p className="absolute bottom-0 inset-x-0 p-2 text-white text-xs font-medium truncate">
                {story.name}
              </p>
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
    </div>
  );
}
