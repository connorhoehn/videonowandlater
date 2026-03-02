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
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  // Initialize client on mount
  useEffect(() => {
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

        const broadcastClient = IVSBroadcastClient.create({
          streamConfig: BASIC_FULL_HD_LANDSCAPE,
          ingestEndpoint,
        });

        setClient(broadcastClient);

        if (previewRef.current) {
          broadcastClient.attachPreview(previewRef.current as any);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    initClient();

    return () => {
      if (client) {
        client.stopBroadcast();
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

      // Get camera and microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });

      client.addVideoInputDevice(stream, 'camera1', { index: 0 });

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const micStream = new MediaStream([audioTrack]);
        client.addAudioInputDevice(micStream, 'mic1');
      }

      // Fetch stream key from API
      const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to get stream key: ${response.statusText}`);
      }

      const { streamKey } = await response.json();

      await client.startBroadcast(streamKey);
      setIsLive(true);
    } catch (err: any) {
      setError(`Failed to start broadcast: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const stopBroadcast = async () => {
    if (client) {
      try {
        await client.stopBroadcast();
        setIsLive(false);
      } catch (err: any) {
        setError(`Failed to stop broadcast: ${err.message}`);
      }
    }
  };

  return {
    previewRef,
    startBroadcast,
    stopBroadcast,
    isLive,
    isLoading,
    error,
  };
}
