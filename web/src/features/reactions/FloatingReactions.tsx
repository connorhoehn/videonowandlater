/**
 * FloatingReactions - CSS-animation-powered floating emoji overlay
 * Uses pure CSS transforms/animations for GPU-accelerated performance.
 * Batches reactions (100ms windows, max 10 per batch) and caps at 50 simultaneous.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

const MAX_SIMULTANEOUS = 50;
const BATCH_INTERVAL = 100;
const ANIMATION_DURATION = 3200; // Longest CSS animation duration (ms)

export interface FloatingEmoji {
  id: string;
  emoji: string;
  timestamp: number;
}

interface FloatingReactionsProps {
  reactions: FloatingEmoji[];
}

/** Assign a CSS animation class based on index for visual variety */
const ANIMATION_CLASSES = [
  'animate-float-up',
  'animate-float-up-left',
  'animate-float-up-right',
] as const;

export const FloatingReactions: React.FC<FloatingReactionsProps> = ({ reactions }) => {
  const [visible, setVisible] = useState<FloatingEmoji[]>([]);
  const queueRef = useRef<FloatingEmoji[]>([]);
  const processedIds = useRef(new Set<string>());

  // Add new reactions to queue (avoid duplicates)
  useEffect(() => {
    reactions.forEach((reaction) => {
      if (!processedIds.current.has(reaction.id)) {
        processedIds.current.add(reaction.id);
        queueRef.current.push(reaction);
      }
    });
  }, [reactions]);

  // Flush queue at intervals (batch processing)
  useEffect(() => {
    const interval = setInterval(() => {
      if (queueRef.current.length > 0) {
        setVisible((prev) => {
          const newItems = queueRef.current.splice(0, 10);
          const updated = [...prev, ...newItems];
          if (updated.length > MAX_SIMULTANEOUS) {
            return updated.slice(-MAX_SIMULTANEOUS);
          }
          return updated;
        });
      }
    }, BATCH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // Remove completed animations
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      setVisible((prev) => {
        const filtered = prev.filter(
          (item) => now - item.timestamp < ANIMATION_DURATION
        );
        prev.forEach((item) => {
          if (now - item.timestamp >= ANIMATION_DURATION) {
            processedIds.current.delete(item.id);
          }
        });
        return filtered;
      });
    }, 500);

    return () => clearInterval(cleanup);
  }, []);

  // Stable random-ish horizontal offset per emoji
  const getStyle = useCallback((id: string, index: number) => {
    // Simple hash from id for deterministic offset
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
    }
    const xOffset = (Math.abs(hash) % 60) - 30; // -30px to +30px

    return {
      left: `calc(50% + ${xOffset}px)`,
      bottom: '18%',
      fontSize: '2.5rem',
      animationDelay: `${(index % 5) * 40}ms`,
    } as React.CSSProperties;
  }, []);

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 10 }}
    >
      {visible.map((item, index) => (
        <div
          key={item.id}
          className={`absolute ${ANIMATION_CLASSES[index % ANIMATION_CLASSES.length]}`}
          style={getStyle(item.id, index)}
        >
          {item.emoji}
        </div>
      ))}
    </div>
  );
};
