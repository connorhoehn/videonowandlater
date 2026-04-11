interface ImageGridProps {
  images: { src: string; alt?: string }[];
  maxVisible?: number;
  onImageClick?: (index: number) => void;
  onViewAll?: () => void;
  className?: string;
}

export function ImageGrid({
  images,
  maxVisible = 4,
  onImageClick,
  onViewAll,
  className = '',
}: ImageGridProps) {
  if (images.length === 0) return null;

  const visibleCount = Math.min(images.length, maxVisible);
  const extraCount = images.length - maxVisible;

  const imgClass =
    'w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity';

  const handleClick = (index: number) => onImageClick?.(index);

  if (images.length === 1) {
    return (
      <div className={`rounded-lg overflow-hidden ${className}`}>
        <img
          src={images[0].src}
          alt={images[0].alt ?? ''}
          className={`${imgClass} max-h-96`}
          onClick={() => handleClick(0)}
        />
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className={`grid grid-cols-2 gap-1 rounded-lg overflow-hidden ${className}`}>
        {images.slice(0, 2).map((img, i) => (
          <img
            key={i}
            src={img.src}
            alt={img.alt ?? ''}
            className={`${imgClass} aspect-square`}
            onClick={() => handleClick(i)}
          />
        ))}
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className={`grid grid-cols-2 gap-1 rounded-lg overflow-hidden ${className}`}>
        <img
          src={images[0].src}
          alt={images[0].alt ?? ''}
          className={`${imgClass} row-span-2`}
          onClick={() => handleClick(0)}
        />
        <img
          src={images[1].src}
          alt={images[1].alt ?? ''}
          className={imgClass}
          onClick={() => handleClick(1)}
        />
        <img
          src={images[2].src}
          alt={images[2].alt ?? ''}
          className={imgClass}
          onClick={() => handleClick(2)}
        />
      </div>
    );
  }

  // 4+ images: 2x2 grid
  const visible = images.slice(0, visibleCount);

  return (
    <div className={`grid grid-cols-2 gap-1 rounded-lg overflow-hidden ${className}`}>
      {visible.map((img, i) => {
        const isLast = i === visibleCount - 1;
        const showOverlay = isLast && extraCount > 0;

        return (
          <div key={i} className="relative">
            <img
              src={img.src}
              alt={img.alt ?? ''}
              className={`${imgClass} aspect-square`}
              onClick={() => (showOverlay ? onViewAll?.() : handleClick(i))}
            />
            {showOverlay && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer"
                onClick={() => onViewAll?.()}
              >
                <span className="text-lg font-semibold text-white">
                  +{extraCount} View all
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
