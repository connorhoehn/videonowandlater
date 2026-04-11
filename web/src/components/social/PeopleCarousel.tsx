import { useRef, useState, useCallback, useEffect } from 'react';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from './Icons';

export interface PersonCard {
  id: string;
  name: string;
  avatar?: string;
  subtitle?: string;
  hasStory?: boolean;
}

export interface PeopleCarouselProps {
  title?: string;
  people: PersonCard[];
  onAdd?: (personId: string) => void;
  onSeeAll?: () => void;
  className?: string;
}

const SCROLL_AMOUNT = 260;

export function PeopleCarousel({
  title = 'People you may know',
  people,
  onAdd,
  onSeeAll,
  className = '',
}: PeopleCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, people.length]);

  const scroll = (direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  };

  return (
    <Card className={className}>
      <Card.Header>
        <h5 className="text-base font-bold">{title}</h5>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="bg-blue-50 text-blue-600 text-sm px-3 py-1 rounded-lg hover:bg-blue-100 transition-colors"
          >
            See all
          </button>
        )}
      </Card.Header>

      <Card.Body className="relative">
        {/* Prev arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow-md flex items-center justify-center hover:bg-gray-50 z-10"
            aria-label="Scroll left"
          >
            <ChevronLeftIcon size={16} />
          </button>
        )}

        {/* Next arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow-md flex items-center justify-center hover:bg-gray-50 z-10"
            aria-label="Scroll right"
          >
            <ChevronRightIcon size={16} />
          </button>
        )}

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-hide flex gap-2"
        >
          {people.map((person) => (
            <div
              key={person.id}
              className="text-center p-3 min-w-[120px] shrink-0"
            >
              <div className="flex justify-center">
                <Avatar
                  src={person.avatar}
                  alt={person.name}
                  name={person.name}
                  size="xl"
                  hasStory={person.hasStory}
                />
              </div>
              <p className="text-sm font-semibold truncate mt-2">
                {person.name}
              </p>
              {person.subtitle && (
                <p className="text-xs text-gray-500 truncate">
                  {person.subtitle}
                </p>
              )}
              {onAdd && (
                <button
                  onClick={() => onAdd(person.id)}
                  className="w-full bg-blue-50 text-blue-600 hover:bg-blue-100 text-sm py-1.5 rounded-lg mt-2 inline-flex items-center justify-center gap-1 transition-colors"
                >
                  <PlusIcon size={14} />
                  Add friend
                </button>
              )}
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}
