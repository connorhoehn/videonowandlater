interface SkeletonProps {
  className?: string;
}

interface SkeletonLineProps extends SkeletonProps {
  width?: string;
  height?: string;
}

interface SkeletonCircleProps extends SkeletonProps {
  size?: string;
}

interface SkeletonRectProps extends SkeletonProps {
  width?: string;
  height?: string;
  rounded?: string;
}

export function SkeletonLine({
  width = 'w-full',
  height = 'h-4',
  className = '',
}: SkeletonLineProps) {
  return <div className={`animate-shimmer rounded ${height} ${width} ${className}`} />;
}

export function SkeletonCircle({
  size = 'w-10 h-10',
  className = '',
}: SkeletonCircleProps) {
  return <div className={`animate-shimmer rounded-full ${size} ${className}`} />;
}

export function SkeletonRect({
  width = 'w-full',
  height = 'h-32',
  rounded = 'rounded-lg',
  className = '',
}: SkeletonRectProps) {
  return <div className={`animate-shimmer ${rounded} ${width} ${height} ${className}`} />;
}

export const Skeleton = {
  Line: SkeletonLine,
  Circle: SkeletonCircle,
  Rect: SkeletonRect,
};
