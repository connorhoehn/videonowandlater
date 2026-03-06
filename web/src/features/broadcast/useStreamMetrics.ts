/**
 * React hook for WebRTC stats polling and health score computation
 * Phase 23: Stream Quality Monitoring Dashboard
 */

import { useState, useEffect, useRef } from 'react';
import {
  StreamMetrics,
  HealthScoreResult,
  calculateHealthScore
} from '../../domain/metrics';

/**
 * Extract stream statistics from WebRTC peer connection
 * @param broadcastClient IVS broadcast client with peerConnection
 * @returns StreamMetrics or null if unavailable
 */
async function extractStreamStats(broadcastClient: any): Promise<StreamMetrics | null> {
  // Guard against missing peer connection
  if (!broadcastClient?.peerConnection) {
    return null;
  }

  try {
    // Get WebRTC stats
    const stats = await broadcastClient.peerConnection.getStats();

    // Find the outbound-rtp video report
    let videoReport: any = null;
    stats.forEach((report: any) => {
      if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
        videoReport = report;
      }
    });

    if (!videoReport) {
      return null;
    }

    // Build StreamMetrics from WebRTC stats
    return {
      timestamp: Date.now(),
      bitrate: videoReport.bytesSent || 0,
      framesPerSecond: videoReport.framesPerSecond || 0,
      resolution: {
        width: videoReport.frameWidth || 0,
        height: videoReport.frameHeight || 0
      },
      networkType: videoReport.networkType || 'unknown',
      qualityLimitation: videoReport.qualityLimitation || 'none',
      jitter: videoReport.jitter,
      packetsLost: videoReport.packetsLost
    };
  } catch (error) {
    console.error('Failed to extract stream stats:', error);
    return null;
  }
}

/**
 * Hook for monitoring stream quality metrics and health score
 * @param broadcastClient IVS broadcast client instance
 * @param isLive Whether the stream is currently live
 * @returns Current metrics and health score
 */
export function useStreamMetrics(broadcastClient: any, isLive: boolean) {
  const [metrics, setMetrics] = useState<StreamMetrics | null>(null);
  const [healthScore, setHealthScore] = useState<HealthScoreResult | null>(null);

  // Rolling window of samples for health calculation
  const samplesRef = useRef<{
    bitrates: number[];
    fpss: number[];
  }>({
    bitrates: [],
    fpss: []
  });

  // Polling interval reference
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Previous sample for bitrate calculation
  const previousSampleRef = useRef<{
    bytesSent: number;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    // Only poll when live and client is available
    if (!isLive || !broadcastClient) {
      // Clear any existing interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      // Reset state
      setMetrics(null);
      setHealthScore(null);
      samplesRef.current = { bitrates: [], fpss: [] };
      previousSampleRef.current = null;
      return;
    }

    // Polling function
    const poll = async () => {
      try {
        const newMetrics = await extractStreamStats(broadcastClient);

        if (!newMetrics) {
          return;
        }

        // Calculate instantaneous bitrate (bits per second)
        let instantaneousBitrate: number;

        if (previousSampleRef.current) {
          // Calculate delta since last sample
          const bytesDelta = newMetrics.bitrate - previousSampleRef.current.bytesSent;
          const timeDelta = (newMetrics.timestamp - previousSampleRef.current.timestamp) / 1000; // Convert to seconds

          // Convert bytes/sec to bits/sec
          instantaneousBitrate = timeDelta > 0 ? (bytesDelta / timeDelta) * 8 : 0;
        } else {
          // First sample - use raw value converted to bits
          instantaneousBitrate = newMetrics.bitrate * 8;
        }

        // Store current sample for next calculation
        previousSampleRef.current = {
          bytesSent: newMetrics.bitrate,
          timestamp: newMetrics.timestamp
        };

        // Update rolling window
        samplesRef.current.bitrates.push(instantaneousBitrate);
        samplesRef.current.fpss.push(newMetrics.framesPerSecond);

        // Maintain max 60 samples (5 minutes at 5-second intervals)
        if (samplesRef.current.bitrates.length > 60) {
          samplesRef.current.bitrates.shift();
        }
        if (samplesRef.current.fpss.length > 60) {
          samplesRef.current.fpss.shift();
        }

        // Calculate health score if we have enough samples
        if (samplesRef.current.bitrates.length >= 3) {
          const targetBitrate = 2500 * 1000 * 8; // 2500 kbps to bits/sec
          const targetFps = 30; // Standard BASIC_FULL_HD_LANDSCAPE

          const healthResult = calculateHealthScore({
            currentBitrate: instantaneousBitrate,
            targetBitrate,
            currentFps: newMetrics.framesPerSecond,
            targetFps,
            recentBitrates: samplesRef.current.bitrates,
            recentFrameRates: samplesRef.current.fpss
          });

          setHealthScore(healthResult);
        }

        // Update metrics state
        setMetrics(newMetrics);
      } catch (error) {
        console.error('Error polling stream metrics:', error);
      }
    };

    // Poll immediately on mount
    poll();

    // Set up polling interval (5 seconds)
    pollIntervalRef.current = setInterval(poll, 5000);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isLive, broadcastClient]);

  return { metrics, healthScore };
}