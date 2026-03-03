/**
 * FloatingReactions - Motion-powered floating animation overlay
 * Implements batching (100ms windows, max 10 per batch) and performance optimizations
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const MAX_SIMULTANEOUS = 50; // Prevent UI lag
const BATCH_INTERVAL = 100; // Batch reactions every 100ms
const ANIMATION_DURATION = 3000; // 3 seconds

export interface FloatingEmoji {
  id: string;
  emoji: string;
  timestamp: number;
}

interface FloatingReactionsProps {
  reactions: FloatingEmoji[];
}

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
          // Take max 10 reactions from queue per batch
          const newItems = queueRef.current.splice(0, 10);
          const updated = [...prev, ...newItems];

          // Enforce max simultaneous limit
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
        const filtered = prev.filter((item) => now - item.timestamp < ANIMATION_DURATION);
        // Cleanup processedIds for removed items
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

  return (
    <div
      className="floating-reactions-container"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      <AnimatePresence>
        {visible.map((item, index) => {
          // Random horizontal offset for variety
          const xOffset = (index % 5) * 20 - 40;

          return (
            <motion.div
              key={item.id}
              initial={{
                opacity: 1,
                y: 0,
                x: xOffset,
                scale: 1,
              }}
              animate={{
                opacity: 0,
                y: -200,
                x: xOffset + Math.sin(Date.now() / 200) * 15, // Wiggle effect
                scale: 1.2,
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 3,
                ease: 'easeOut',
              }}
              style={{
                position: 'absolute',
                bottom: '20%',
                left: '50%',
                fontSize: '3rem',
                willChange: 'transform', // GPU hint
              }}
            >
              {item.emoji}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
