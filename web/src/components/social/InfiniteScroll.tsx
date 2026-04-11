import { useEffect, useRef } from 'react';
import { LoadMoreButton } from './LoadMoreButton';

interface InfiniteScrollProps {
  onLoadMore: () => void | Promise<void>;
  hasMore: boolean;
  loading?: boolean;
  threshold?: number;
  loadingText?: string;
  endText?: string;
  showEndText?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function InfiniteScroll({
  onLoadMore,
  hasMore,
  loading = false,
  threshold = 200,
  loadingText = 'Loading...',
  endText = 'No more items',
  showEndText = true,
  children,
  className = '',
}: InfiniteScrollProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { rootMargin: `${threshold}px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore, threshold]);

  return (
    <div className={className}>
      {children}

      {loading && (
        <div className="flex justify-center py-4">
          <LoadMoreButton loading variant="soft">
            {loadingText}
          </LoadMoreButton>
        </div>
      )}

      {!hasMore && showEndText && (
        <p className="text-center text-xs text-gray-400 py-4">{endText}</p>
      )}

      <div ref={sentinelRef} className="h-1" />
    </div>
  );
}
