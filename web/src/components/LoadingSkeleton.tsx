/**
 * LoadingSkeleton - Reusable shimmer loading placeholder
 * Variants: text, card, player (video player placeholder)
 */

import React from 'react';

type SkeletonVariant = 'text' | 'card' | 'player';

interface LoadingSkeletonProps {
  /** Shape variant: text (single line), card (rounded rect), player (16:9 video placeholder) */
  variant?: SkeletonVariant;
  /** Width override (CSS value). Defaults vary by variant. */
  width?: string;
  /** Height override (CSS value). Defaults vary by variant. */
  height?: string;
  /** Number of skeleton lines to render (only for variant="text") */
  lines?: number;
  /** Additional CSS class names */
  className?: string;
}

const shimmerStyle =
  'bg-[length:200%_100%] bg-gradient-to-r from-dark-list via-dark-button to-dark-list animate-shimmer rounded';

export function LoadingSkeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
  className = '',
}: LoadingSkeletonProps) {
  if (variant === 'player') {
    return (
      <div
        data-testid="skeleton-player"
        className={`${shimmerStyle} aspect-video w-full ${className}`}
        style={{ width, height }}
      />
    );
  }

  if (variant === 'card') {
    return (
      <div
        data-testid="skeleton-card"
        className={`${shimmerStyle} rounded-xl ${className}`}
        style={{ width: width ?? '100%', height: height ?? '120px' }}
      />
    );
  }

  // variant === 'text'
  if (lines > 1) {
    return (
      <div data-testid="skeleton-text-group" className={`flex flex-col gap-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={`${shimmerStyle} h-3`}
            style={{
              width: width ?? (i === lines - 1 ? '60%' : '100%'),
              height: height ?? undefined,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid="skeleton-text"
      className={`${shimmerStyle} h-3 ${className}`}
      style={{ width: width ?? '100%', height: height ?? undefined }}
    />
  );
}
