/**
 * ParticipantTile - individual video tile for hangout participant
 * Displays video stream with green border when participant is speaking
 */

import React, { useRef, useEffect } from 'react';

interface Participant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
  isSpeaking: boolean;
}

interface ParticipantTileProps {
  participant: Participant;
  isSpeaking: boolean;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  participant,
  isSpeaking,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to video element when it changes
  useEffect(() => {
    if (videoRef.current && participant.streams.length > 0) {
      videoRef.current.srcObject = participant.streams[0];
    }
  }, [participant.streams]);

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '16/9',
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        border: isSpeaking ? '3px solid #10b981' : '1px solid #374151',
        transition: 'border-color 200ms ease-in-out',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '0.875rem',
          fontWeight: '500',
        }}
      >
        {participant.userId} {participant.isLocal && '(You)'}
      </div>
    </div>
  );
};
