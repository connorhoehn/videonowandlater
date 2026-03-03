/**
 * useHangout hook - manages IVS RealTime Stage lifecycle for multi-participant hangouts
 * Mirrors useBroadcast.ts pattern but uses Stage APIs instead of Channel APIs
 */

import { useState, useEffect, useRef } from 'react';
import { Stage, type StageStrategy, SubscribeType, StageEvents, LocalStageStream } from 'amazon-ivs-web-broadcast';

interface Participant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
  isSpeaking: boolean;
}

interface UseHangoutOptions {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
}

export function useHangout({ sessionId, apiBaseUrl, authToken }: UseHangoutOptions) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Join hangout on mount
  useEffect(() => {
    let mounted = true;
    let stageInstance: Stage | null = null;

    const joinHangout = async () => {
      try {
        // Fetch participant token from backend
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/join`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to join hangout: ${response.statusText}`);
        }

        const { token, participantId, userId } = await response.json();

        // Define Stage strategy - publish audio/video, subscribe to all participants
        const strategy: StageStrategy = {
          stageStreamsToPublish: (): LocalStageStream[] => [],
          shouldPublishParticipant: () => true,
          shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
        };

        // Create Stage instance
        stageInstance = new Stage(token, strategy);

        // Get local camera and microphone
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });

        localStreamRef.current = localStream;

        // Attach local stream to preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        // Set up Stage event listeners
        stageInstance.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
          if (!mounted) return;
          console.log('Participant joined:', participant);
          setParticipants((prev) => [
            ...prev,
            {
              participantId: participant.id,
              userId: participant.attributes?.userId || 'Unknown',
              isLocal: false,
              streams: [],
              isSpeaking: false,
            },
          ]);
        });

        stageInstance.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
          if (!mounted) return;
          console.log('Participant left:', participant);
          setParticipants((prev) =>
            prev.filter((p) => p.participantId !== participant.id)
          );
        });

        stageInstance.on(
          StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED,
          (participant: any, streams: any[]) => {
            if (!mounted) return;
            console.log('Participant streams changed:', participant, streams);
            setParticipants((prev) =>
              prev.map((p) =>
                p.participantId === participant.id ? { ...p, streams } : p
              )
            );
          }
        );

        // Join the Stage
        await stageInstance.join();

        if (!mounted) {
          stageInstance.leave();
          return;
        }

        // Add local participant to state
        setParticipants((prev) => [
          {
            participantId: participantId,
            userId: userId,
            isLocal: true,
            streams: [localStream],
            isSpeaking: false,
          },
          ...prev,
        ]);

        setIsJoined(true);
      } catch (err: any) {
        if (mounted) {
          setError(err.message);
          console.error('Failed to join hangout:', err);
        }
      }
    };

    joinHangout();

    return () => {
      mounted = false;
      if (stageInstance) {
        stageInstance.leave();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [sessionId, apiBaseUrl, authToken]);

  // Toggle mute
  const toggleMute = (muted: boolean) => {
    if (!localStreamRef.current) return;

    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !muted;
    }
  };

  // Toggle camera
  const toggleCamera = (enabled: boolean) => {
    if (!localStreamRef.current) return;

    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = enabled;
    }
  };

  return {
    localVideoRef,
    participants,
    isJoined,
    error,
    toggleMute,
    toggleCamera,
  };
}
