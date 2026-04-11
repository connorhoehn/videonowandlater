import type { ReactNode } from 'react';

interface ImageGridProps {
  images: { src: string; alt?: string }[];
  maxVisible?: number;
  onImageClick?: (index: number) => void;
  onViewAll?: () => void;
  className?: string;
}

/**
 * Wraps an image in an accessible button when it is clickable.
 */
function ClickableImage({
  src,
  alt,
  className,
  onClick,
  ariaLabel,
}: {
  src: string;
  alt: string;
  className: string;
  onClick?: () => void;
  ariaLabel: string;
}) {
  if (!onClick) {
    return <img src={src} alt={alt} className={className} />;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="p-0 border-0 bg-transparent cursor-pointer w-full h-full"
    >
      <img
        src={src}
        alt={alt}
        className={className}
      />
    </button>
  );
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
    'w-full h-full object-cover hover:opacity-90 transition-opacity';

  const handleClick = (index: number) => onImageClick?.(index);

  if (images.length === 1) {
    return (
      <div className={`rounded-lg overflow-hidden ${className}`}>
        <ClickableImage
          src={images[0].src}
          alt={images[0].alt || 'Image 1'}
          className={`${imgClass} max-h-96`}
          onClick={onImageClick ? () => handleClick(0) : undefined}
          ariaLabel={images[0].alt || 'View image 1'}
        />
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className={`grid grid-cols-2 gap-1 rounded-lg overflow-hidden ${className}`}>
        {images.slice(0, 2).map((img, i) => (
          <ClickableImage
            key={i}
            src={img.src}
            alt={img.alt || `Image ${i + 1}`}
            className={`${imgClass} aspect-square`}
            onClick={onImageClick ? () => handleClick(i) : undefined}
            ariaLabel={img.alt || `View image ${i + 1}`}
          />
        ))}
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className={`grid grid-cols-2 gap-1 rounded-lg overflow-hidden ${className}`}>
        <ClickableImage
          src={images[0].src}
          alt={images[0].alt || 'Image 1'}
          className={`${imgClass} row-span-2`}
          onClick={onImageClick ? () => handleClick(0) : undefined}
          ariaLabel={images[0].alt || 'View image 1'}
        />
        <ClickableImage
          src={images[1].src}
          alt={images[1].alt || 'Image 2'}
          className={imgClass}
          onClick={onImageClick ? () => handleClick(1) : undefined}
          ariaLabel={images[1].alt || 'View image 2'}
        />
        <ClickableImage
          src={images[2].src}
          alt={images[2].alt || 'Image 3'}
          className={imgClass}
          onClick={onImageClick ? () => handleClick(2) : undefined}
          ariaLabel={images[2].alt || 'View image 3'}
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
            <ClickableImage
              src={img.src}
              alt={img.alt || `Image ${i + 1}`}
              className={`${imgClass} aspect-square`}
              onClick={
                showOverlay
                  ? onViewAll
                  : onImageClick
                    ? () => handleClick(i)
                    : undefined
              }
              ariaLabel={
                showOverlay
                  ? `View all ${images.length} images`
                  : img.alt || `View image ${i + 1}`
              }
            />
            {showOverlay && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none"
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
