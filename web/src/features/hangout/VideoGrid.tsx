/**
 * VideoGrid - responsive CSS Grid layout for multi-participant video
 * Displays up to 5 participants on desktop, 3 on mobile
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

  // Calculate dynamic grid columns (2 for 1-2 participants, 3 for 3+)
  const gridCols = visibleParticipants.length <= 2 ? 2 : 3;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: '16px',
        width: '100%',
        height: '100%',
        padding: '16px',
      }}
    >
      {visibleParticipants.map((participant) => (
        <ParticipantTile
          key={participant.participantId}
          participant={participant}
          isSpeaking={participant.isSpeaking}
        />
      ))}
    </div>
  );
};
