/**
 * VideoGrid - responsive CSS Grid layout for multi-participant video
 * Displays up to 5 participants on desktop, 3 on mobile
 * Optimized layouts for 1, 2, 3-4 participants with smooth transitions
 */

import React, { useState, useEffect } from 'react';
import { ParticipantTile } from './ParticipantTile';

interface Participant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
  isSpeaking: boolean;
}

interface VideoGridProps {
  participants: Participant[];
}

/**
 * Returns Tailwind grid classes optimized for participant count.
 * - 1 participant: single centered tile
 * - 2 participants: side-by-side
 * - 3-4 participants: 2x2 grid
 * - 5+ participants: 3-column grid
 */
function getGridClasses(count: number, isMobile: boolean): string {
  if (count <= 1) return 'grid-cols-1 max-w-xl mx-auto';
  if (count === 2) return isMobile ? 'grid-cols-1 max-w-sm mx-auto' : 'grid-cols-2 max-w-3xl mx-auto';
  if (count <= 4) return 'grid-cols-2 max-w-4xl mx-auto';
  return isMobile ? 'grid-cols-2' : 'grid-cols-3 max-w-5xl mx-auto';
}

export const VideoGrid: React.FC<VideoGridProps> = ({ participants }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Detect mobile viewport
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Limit visible participants based on device
  const visibleParticipants = isMobile
    ? participants.slice(0, 3)
    : participants.slice(0, 5);

  const gridClasses = getGridClasses(visibleParticipants.length, isMobile);

  return (
    <div
      className={`grid ${gridClasses} gap-3 sm:gap-4 w-full h-full p-3 sm:p-6 place-content-center transition-all duration-300 ease-in-out`}
    >
      {visibleParticipants.map((participant) => (
        <div key={participant.participantId} className="animate-tile-enter">
          <ParticipantTile
            participant={participant}
            isSpeaking={participant.isSpeaking}
          />
        </div>
      ))}
    </div>
  );
};
