/**
 * VideoGrid - responsive layout for multi-participant video
 * When someone is screen sharing, switches to a presentation layout:
 *   large screen share tile + camera strip on the side
 * Otherwise uses the standard CSS Grid for equal-sized tiles.
 */

import React, { useState, useEffect, useRef } from 'react';
import { ParticipantTile } from './ParticipantTile';
import { AiAgentTile } from './AiAgentTile';

interface Participant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
  isSpeaking: boolean;
  screenStream?: MediaStream;
}

interface VideoGridProps {
  participants: Participant[];
}

/**
 * Returns Tailwind grid classes optimized for participant count.
 */
function getGridClasses(count: number, isMobile: boolean): string {
  if (count <= 1) return 'grid-cols-1 max-w-xl mx-auto';
  if (count === 2) return isMobile ? 'grid-cols-1 max-w-sm mx-auto' : 'grid-cols-2 max-w-3xl mx-auto';
  if (count <= 4) return 'grid-cols-2 max-w-4xl mx-auto';
  return isMobile ? 'grid-cols-2' : 'grid-cols-3 max-w-5xl mx-auto';
}

/** Renders a screen share video element with optional PiP camera overlay */
const ScreenTile: React.FC<{
  stream: MediaStream;
  userId: string;
  cameraStream?: MediaStream;
  isLocal?: boolean;
}> = ({ stream, userId, cameraStream, isLocal }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (pipRef.current && cameraStream) {
      pipRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  return (
    <div className="relative bg-gray-900 rounded-2xl overflow-hidden ring-1 ring-blue-500/50 shadow-lg shadow-blue-500/10 h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain"
      />
      {/* PiP camera overlay — Google Meet style */}
      {cameraStream && (
        <div className="absolute bottom-12 right-3 w-36 sm:w-44 aspect-video rounded-xl overflow-hidden ring-2 ring-white/20 shadow-2xl shadow-black/50 transition-all duration-200 hover:ring-white/40 hover:scale-105 z-10">
          <video
            ref={pipRef}
            autoPlay
            playsInline
            muted={isLocal}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 bg-blue-600/80 backdrop-blur-md text-white text-xs font-medium px-3 py-1.5 rounded-full">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
        </svg>
        <span>{userId}'s screen</span>
      </div>
    </div>
  );
};

export const VideoGrid: React.FC<VideoGridProps> = ({ participants }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Find the participant who is screen sharing (first one wins)
  const screenSharer = participants.find((p) => p.screenStream);

  // Limit visible participants
  const visibleParticipants = isMobile
    ? participants.slice(0, 3)
    : participants.slice(0, 5);

  // Presentation layout: screen share is active
  if (screenSharer?.screenStream) {
    // The sharer's camera is shown as PiP on the screen tile, so exclude them from the strip
    const stripParticipants = visibleParticipants.filter(
      (p) => p.participantId !== screenSharer.participantId
    );
    // For local screen sharer, pass their camera stream for PiP overlay
    const sharerCameraStream = screenSharer.isLocal && screenSharer.streams.length > 0
      ? screenSharer.streams[0]
      : undefined;

    return (
      <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} w-full h-full p-3 sm:p-4 gap-3 sm:gap-4`}>
        {/* Main screen share tile with PiP camera */}
        <div className="flex-1 min-h-0 min-w-0 animate-tile-enter">
          <ScreenTile
            stream={screenSharer.screenStream}
            userId={screenSharer.userId}
            cameraStream={sharerCameraStream}
            isLocal={screenSharer.isLocal}
          />
        </div>
        {/* Other participants strip */}
        {stripParticipants.length > 0 && (
          <div className={`flex ${isMobile ? 'flex-row overflow-x-auto' : 'flex-col overflow-y-auto'} gap-2 sm:gap-3 ${isMobile ? 'h-28' : 'w-48 shrink-0'}`}>
            {stripParticipants.map((participant) => (
              <div
                key={participant.participantId}
                className={`${isMobile ? 'w-36 shrink-0' : 'w-full'} animate-tile-enter`}
              >
                {participant.userId === 'ai-agent' ? (
                  <AiAgentTile
                    isSpeaking={participant.isSpeaking}
                  />
                ) : (
                  <ParticipantTile
                    participant={participant}
                    isSpeaking={participant.isSpeaking}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Standard grid layout: no screen share
  const gridClasses = getGridClasses(visibleParticipants.length, isMobile);

  return (
    <div
      className={`grid ${gridClasses} gap-3 sm:gap-4 w-full h-full p-3 sm:p-6 place-content-center transition-all duration-300 ease-in-out`}
    >
      {visibleParticipants.map((participant) => (
        <div key={participant.participantId} className="animate-tile-enter">
          {participant.userId === 'ai-agent' ? (
            <AiAgentTile
              isSpeaking={participant.isSpeaking}
            />
          ) : (
            <ParticipantTile
              participant={participant}
              isSpeaking={participant.isSpeaking}
            />
          )}
        </div>
      ))}
    </div>
  );
};
