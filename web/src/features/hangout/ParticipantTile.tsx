/**
 * ParticipantTile - individual video tile for hangout participant
 * Displays video stream with green ring when participant is speaking
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
      className={`relative aspect-video bg-gray-900 rounded-2xl overflow-hidden transition-all duration-300 ease-in-out ${
        isSpeaking
          ? 'ring-3 ring-emerald-500 ring-offset-2 ring-offset-gray-900 shadow-xl shadow-emerald-500/25'
          : 'ring-1 ring-gray-700/50 shadow-lg shadow-black/20'
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        className="w-full h-full object-cover"
      />
      {/* Subtle gradient overlay at bottom for name readability */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
      {/* Name badge */}
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-white text-xs font-medium px-3 py-1.5 rounded-full">
        {isSpeaking && (
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
        )}
        <span>{participant.userId}</span>
        {participant.isLocal && (
          <span className="text-white/50">(You)</span>
        )}
      </div>
    </div>
  );
};
