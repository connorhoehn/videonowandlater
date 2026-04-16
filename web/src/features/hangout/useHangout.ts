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
  screenStream?: MediaStream;
}

interface UseHangoutOptions {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
}

export function useHangout({ sessionId, apiBaseUrl, authToken }: UseHangoutOptions) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const stageRef = useRef<Stage | null>(null);
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
        stageRef.current = stageInstance;

        // Set up Stage event listeners before joining
        stageInstance.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
          if (!mounted) return;
          // Skip local participant — added explicitly after join()
          if (participant.isLocal) return;
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
            // Skip local participant — its MediaStream is already set after join()
            if (participant.isLocal) return;
            console.log('[useHangout] Participant streams added:', participant, streams);

            // IVS only allows 1 video per participant, so check if the video
            // track is tagged as a screen share (contentHint 'detail').
            const tracks = streams.map((s: any) => s.mediaStreamTrack).filter(Boolean) as MediaStreamTrack[];
            const isScreenShare = tracks.some(
              (t) => t.kind === 'video' && (t.contentHint === 'detail' || t.label?.toLowerCase().includes('screen'))
            );

            const mediaStream = new MediaStream(tracks);

            setParticipants((prev) =>
              prev.map((p) => {
                if (p.participantId !== participant.id) return p;
                return {
                  ...p,
                  streams: [mediaStream],
                  screenStream: isScreenShare ? mediaStream : undefined,
                };
              })
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
      stageRef.current = null;
      localStageStreamsRef.current = [];
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
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

  // Start screen sharing — replaces camera video track with screen track
  // (IVS Stage SDK allows max 1 video + 1 audio stream per participant)
  const startScreenShare = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });

      screenStreamRef.current = screenStream;

      const screenVideoTrack = screenStream.getVideoTracks()[0];
      screenVideoTrack.contentHint = 'detail';

      // Replace the camera video LocalStageStream with the screen share one,
      // keeping the audio stream intact.
      const screenStageStream = new LocalStageStream(screenVideoTrack);
      localStageStreamsRef.current = localStageStreamsRef.current
        .filter((lss) => lss.mediaStreamTrack.kind !== 'video')
        .concat(screenStageStream);

      stageRef.current?.refreshStrategy();

      // Update local participant — keep camera in streams, add screenStream
      // Camera stays in streams[] for the PiP overlay; screenStream is the big tile
      setParticipants((prev) =>
        prev.map((p) => {
          if (!p.isLocal) return p;
          return { ...p, screenStream };
        })
      );
      setIsScreenSharing(true);

      // Handle browser "Stop sharing" button
      screenVideoTrack.addEventListener('ended', () => {
        stopScreenShare();
      });
    } catch (err: any) {
      // User cancelled the picker — not an error
      if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
      console.error('[useHangout] Screen share failed:', err);
      setError(`Screen share failed: ${err.message}`);
    }
  };

  // Stop screen sharing — restore camera video track
  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    // Restore camera video track from the original local stream
    const cameraVideoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraVideoTrack) {
      const cameraStageStream = new LocalStageStream(cameraVideoTrack);
      localStageStreamsRef.current = localStageStreamsRef.current
        .filter((lss) => lss.mediaStreamTrack.kind !== 'video')
        .concat(cameraStageStream);
    }
    stageRef.current?.refreshStrategy();

    // Restore local participant streams to original camera
    setParticipants((prev) =>
      prev.map((p) => {
        if (!p.isLocal || !localStreamRef.current) return p;
        return { ...p, streams: [localStreamRef.current], screenStream: undefined };
      })
    );
    setIsScreenSharing(false);
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
    isScreenSharing,
    error,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
  };
}
