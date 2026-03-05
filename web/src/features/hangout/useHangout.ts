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
  // Holds the LocalStageStream wrappers so the strategy closure can read them
  const localStageStreamsRef = useRef<LocalStageStream[]>([]);

  // Join hangout on mount — guard against empty authToken (same pattern as useBroadcast)
  useEffect(() => {
    if (!authToken) return;

    let mounted = true;
    let stageInstance: Stage | null = null;

    const joinHangout = async () => {
      setError(null);
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

        // Acquire camera + microphone BEFORE creating the Stage so the
        // stageStreamsToPublish closure has the tracks ready to return.
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });

        if (!mounted) {
          localStream.getTracks().forEach(t => t.stop());
          return;
        }

        localStreamRef.current = localStream;

        // Wrap each track as a LocalStageStream for the IVS Stage SDK
        const stageStreams = localStream.getTracks().map(
          (track) => new LocalStageStream(track)
        );
        localStageStreamsRef.current = stageStreams;

        // Attach local stream to preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        // Define Stage strategy — publish audio/video, subscribe to all participants.
        // stageStreamsToPublish reads from the ref so it always has the current tracks.
        const strategy: StageStrategy = {
          stageStreamsToPublish: (): LocalStageStream[] => localStageStreamsRef.current,
          shouldPublishParticipant: () => true,
          shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
        };

        // Create Stage instance
        stageInstance = new Stage(token, strategy);

        // Set up Stage event listeners before joining
        stageInstance.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
          if (!mounted) return;
          console.log('[useHangout] Participant joined:', participant);
          setParticipants((prev) => [
            ...prev,
            {
              participantId: participant.id,
              userId: participant.attributes?.userId || participant.id,
              isLocal: false,
              streams: [],
              isSpeaking: false,
            },
          ]);
        });

        stageInstance.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
          if (!mounted) return;
          console.log('[useHangout] Participant left:', participant);
          setParticipants((prev) =>
            prev.filter((p) => p.participantId !== participant.id)
          );
        });

        stageInstance.on(
          StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED,
          (participant: any, streams: any[]) => {
            if (!mounted) return;
            console.log('[useHangout] Participant streams added:', participant, streams);
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

        // Add local participant first in the list
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
          console.error('[useHangout] Failed to join hangout:', err);
        }
      }
    };

    joinHangout();

    return () => {
      mounted = false;
      if (stageInstance) {
        stageInstance.leave();
      }
      localStageStreamsRef.current = [];
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [sessionId, apiBaseUrl, authToken]);

  // Toggle mute — disable the audio track on the live stream and update
  // the LocalStageStream wrapper so the Stage SDK sees the change.
  const toggleMute = (muted: boolean) => {
    if (!localStreamRef.current) return;

    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      // When muted=true we want the track disabled, and vice-versa
      audioTrack.enabled = !muted;
    }

    // Reflect on LocalStageStream wrappers
    localStageStreamsRef.current.forEach((lss) => {
      if (lss.mediaStreamTrack.kind === 'audio') {
        lss.setMuted(muted);
      }
    });
  };

  // Toggle camera
  const toggleCamera = (enabled: boolean) => {
    if (!localStreamRef.current) return;

    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = enabled;
    }

    // Reflect on LocalStageStream wrappers
    localStageStreamsRef.current.forEach((lss) => {
      if (lss.mediaStreamTrack.kind === 'video') {
        lss.setMuted(!enabled);
      }
    });
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
