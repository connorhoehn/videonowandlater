/**
 * useBroadcast hook - manages IVS Web Broadcast SDK lifecycle
 * Handles camera setup, ingest configuration, and streaming
 */

import { useState, useEffect, useRef } from 'react';
import IVSBroadcastClient, { BASIC_FULL_HD_LANDSCAPE } from 'amazon-ivs-web-broadcast';

interface UseBroadcastOptions {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
}

export function useBroadcast({ sessionId, apiBaseUrl, authToken }: UseBroadcastOptions) {
  const [client, setClient] = useState<any>(null);
  // clientRef mirrors the client state so the useEffect cleanup always has a
  // current reference (state closures in cleanup capture the value at mount time).
  const clientRef = useRef<any>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Initialize client — guard against empty authToken to prevent double-init flicker
  useEffect(() => {
    if (!authToken) return;

    let cancelled = false;

    const initClient = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/start`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (!response.ok) {
          throw new Error(`Failed to get ingest config: ${response.statusText}`);
        }

        const { ingestEndpoint } = await response.json();

        if (cancelled) return;

        const broadcastClient = IVSBroadcastClient.create({
          streamConfig: BASIC_FULL_HD_LANDSCAPE,
          ingestEndpoint,
        });

        clientRef.current = broadcastClient;
        setClient(broadcastClient);

        if (previewRef.current) {
          broadcastClient.attachPreview(previewRef.current as any);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    initClient();

    return () => {
      cancelled = true;
      // Use ref so we reliably reach the client even if state hasn't flushed yet
      if (clientRef.current) {
        try { clientRef.current.stopBroadcast(); } catch {}
        clientRef.current = null;
      }
    };
  }, [sessionId, apiBaseUrl, authToken]);

  const startBroadcast = async () => {
    if (!client) {
      setError('Client not initialized');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      localStreamRef.current = stream;

      // Remove devices if already registered (prevents AddDeviceNameExistsError on retry)
      try { client.removeVideoInputDevice('camera1'); } catch {}
      try { client.removeAudioInputDevice('mic1'); } catch {}

      client.addVideoInputDevice(stream, 'camera1', { index: 0 });

      const audioTracks = stream.getAudioTracks();
      console.log('[useBroadcast] audio tracks:', audioTracks.length, audioTracks.map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
      const audioTrack = audioTracks[0];
      if (audioTrack) {
        const micStream = new MediaStream([audioTrack]);
        client.addAudioInputDevice(micStream, 'mic1');
        console.log('[useBroadcast] audio device added');
      } else {
        console.warn('[useBroadcast] No audio track found in stream');
      }

      const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ goLive: true }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get stream key: ${response.statusText}`);
      }

      const { streamKey } = await response.json();

      await client.startBroadcast(streamKey);
      setIsLive(true);
      setIsMuted(false);
      setIsCameraOn(true);
    } catch (err: any) {
      setError(`Failed to start broadcast: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const stopBroadcast = async () => {
    console.log('[stopBroadcast] initiated', { sessionId });
    if (!client) {
      console.warn('[stopBroadcast] no client instance');
      return;
    }
    try {
      // Stop screen share if active
      if (isScreenSharing) {
        await stopScreenShare();
      }
      await client.stopBroadcast();
      console.log('[stopBroadcast] SDK stopBroadcast complete');
      // Release camera/mic
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      setIsLive(false);
      setIsMuted(false);
      setIsCameraOn(true);
      setIsScreenSharing(false);
      // Notify backend immediately so feed shows "processing" without waiting for EventBridge
      try {
        const endResp = await fetch(`${apiBaseUrl}/sessions/${sessionId}/end`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        console.log('[stopBroadcast] end-session API', endResp.status);
      } catch (endErr) {
        console.warn('[stopBroadcast] end-session API failed (EventBridge will catch it):', endErr);
      }
    } catch (err: any) {
      console.error('[stopBroadcast] error:', err);
      setError(`Failed to stop broadcast: ${err.message}`);
    }
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = isMuted; // flip: if currently muted, re-enable
    setIsMuted(m => !m);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !isCameraOn; // flip
    setIsCameraOn(c => !c);
  };

  const startScreenShare = async () => {
    if (!client || !isLive) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      try { client.removeVideoInputDevice('screen1'); } catch {}
      client.addVideoInputDevice(screenStream, 'screen1', { index: 1 });
      setIsScreenSharing(true);
      // Auto-stop when user ends share via browser UI
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        setError(`Screen share failed: ${err.message}`);
      }
    }
  };

  const stopScreenShare = async () => {
    if (!client) return;
    try { client.removeVideoInputDevice('screen1'); } catch {}
    setIsScreenSharing(false);
  };

  return {
    client,
    previewRef,
    startBroadcast,
    stopBroadcast,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    isLive,
    isLoading,
    isMuted,
    isCameraOn,
    isScreenSharing,
    error,
  };
}
