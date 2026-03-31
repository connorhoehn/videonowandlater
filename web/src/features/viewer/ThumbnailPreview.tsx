/**
 * ThumbnailPreview - Tooltip showing a thumbnail when hovering over the video progress bar
 * Displays a small 160x90 thumbnail image with a time label below.
 */

interface ThumbnailPreviewProps {
  thumbnailBaseUrl: string;
  thumbnailCount: number;
  durationMs: number;
  hoverTimeMs: number;
  visible: boolean;
  positionX: number; // pixel position for tooltip
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ThumbnailPreview({
  thumbnailBaseUrl,
  thumbnailCount,
  durationMs,
  hoverTimeMs,
  visible,
  positionX,
}: ThumbnailPreviewProps) {
  if (!visible || thumbnailCount <= 0 || durationMs <= 0) return null;

  // Calculate thumbnail index: one thumbnail per 5 seconds, clamped
  const rawIndex = Math.floor(hoverTimeMs / 5000);
  const index = Math.max(0, Math.min(rawIndex, thumbnailCount - 1));

  // Construct thumbnail URL
  const thumbnailUrl = `${thumbnailBaseUrl}-thumb.${String(index).padStart(7, '0')}.jpg`;

  // Clamp horizontal position to keep tooltip within viewport
  // Tooltip is 160px wide, center it on positionX
  const tooltipWidth = 160;
  const halfWidth = tooltipWidth / 2;
  const clampedX = Math.max(halfWidth + 8, Math.min(positionX, window.innerWidth - halfWidth - 8));

  return (
    <div
      className="absolute bottom-full mb-2 pointer-events-none z-20"
      style={{
        left: `${clampedX}px`,
        transform: 'translateX(-50%)',
      }}
    >
      <div
        className={`transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="rounded-lg overflow-hidden shadow-lg border border-gray-200 bg-black">
          <img
            src={thumbnailUrl}
            alt={`Preview at ${formatTime(hoverTimeMs)}`}
            width={160}
            height={90}
            className="w-[160px] h-[90px] object-cover"
          />
          <div className="bg-black/80 text-white text-[11px] font-medium text-center py-1">
            {formatTime(hoverTimeMs)}
          </div>
        </div>
      </div>
    </div>
  );
}
