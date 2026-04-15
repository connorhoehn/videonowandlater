/**
 * ParticipantTileEmbed — inline-styled video tile for embedding in non-Tailwind projects.
 * Shows participant video with speaking indicator ring and name badge.
 */

import React, { useRef, useEffect } from 'react';
import type { HangoutParticipant } from './types';

interface ParticipantTileEmbedProps {
  participant: HangoutParticipant;
  isSpeaking: boolean;
}

export const ParticipantTileEmbed: React.FC<ParticipantTileEmbedProps> = ({
  participant,
  isSpeaking,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.streams.length > 0) {
      videoRef.current.srcObject = participant.streams[0];
    }
  }, [participant.streams]);

  return (
    <div style={{
      position: 'relative',
      aspectRatio: '16 / 9',
      background: '#111827',
      borderRadius: 12,
      overflow: 'hidden',
      transition: 'box-shadow 0.3s ease',
      boxShadow: isSpeaking
        ? '0 0 0 3px #10b981, 0 10px 25px rgba(16, 185, 129, 0.25)'
        : '0 0 0 1px rgba(55, 65, 81, 0.5), 0 4px 12px rgba(0, 0, 0, 0.2)',
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {/* Gradient overlay */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
        pointerEvents: 'none',
      }} />
      {/* Name badge */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
        padding: '4px 10px',
        borderRadius: 999,
      }}>
        {isSpeaking && (
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#34d399',
            animation: 'pulse 1.5s infinite',
          }} />
        )}
        <span>{participant.userId}</span>
        {participant.isLocal && (
          <span style={{ opacity: 0.5 }}>(You)</span>
        )}
      </div>
    </div>
  );
};
