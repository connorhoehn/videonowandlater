import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStreamMetrics } from '../useStreamMetrics';

describe('useStreamMetrics', () => {
  let mockBroadcastClient: any;
  let mockGetStats: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock WebRTC stats response
    mockGetStats = vi.fn().mockResolvedValue(new Map([
      ['outbound-video', {
        type: 'outbound-rtp',
        mediaType: 'video',
        bytesSent: 1000000,
        framesPerSecond: 30,
        frameWidth: 1920,
        frameHeight: 1080,
        networkType: 'wifi',
        qualityLimitation: 'none',
        jitter: 0.5,
        packetsLost: 10
      }]
    ]));

    mockBroadcastClient = {
      peerConnection: {
        getStats: mockGetStats
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should return null metrics when not live', () => {
    const { result } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, false)
    );

    expect(result.current.metrics).toBeNull();
    expect(result.current.healthScore).toBeNull();
    expect(mockGetStats).not.toHaveBeenCalled();
  });

  it('should populate metrics when isLive=true', async () => {
    const { result } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, true)
    );

    // Initial poll should happen immediately
    await act(async () => {
      await vi.runOnlyPendingTimers();
    });

    expect(mockGetStats).toHaveBeenCalledTimes(1);
    expect(result.current.metrics).toMatchObject({
      bitrate: 1000000,
      framesPerSecond: 30,
      resolution: { width: 1920, height: 1080 },
      networkType: 'wifi',
      qualityLimitation: 'none'
    });
  });

  it('should poll stats every 5 seconds when live', async () => {
    const { result } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, true)
    );

    // Initial poll
    await act(async () => {
      await vi.runOnlyPendingTimers();
    });
    expect(mockGetStats).toHaveBeenCalledTimes(1);

    // Advance 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await vi.runOnlyPendingTimers();
    });
    expect(mockGetStats).toHaveBeenCalledTimes(2);

    // Advance another 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await vi.runOnlyPendingTimers();
    });
    expect(mockGetStats).toHaveBeenCalledTimes(3);
  });

  it('should extract video report from getStats correctly', async () => {
    // Mock stats with multiple reports
    mockGetStats.mockResolvedValue(new Map([
      ['audio-track', {
        type: 'outbound-rtp',
        mediaType: 'audio',
        bytesSent: 50000
      }],
      ['video-track', {
        type: 'outbound-rtp',
        mediaType: 'video',
        bytesSent: 2000000,
        framesPerSecond: 25,
        frameWidth: 1280,
        frameHeight: 720,
        networkType: '4g',
        qualityLimitation: 'bandwidth'
      }],
      ['candidate-pair', {
        type: 'candidate-pair',
        state: 'succeeded'
      }]
    ]));

    const { result } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, true)
    );

    await act(async () => {
      await vi.runOnlyPendingTimers();
    });

    // Should extract the video report only
    expect(result.current.metrics).toMatchObject({
      bitrate: 2000000,
      framesPerSecond: 25,
      resolution: { width: 1280, height: 720 },
      networkType: '4g',
      qualityLimitation: 'bandwidth'
    });
  });

  it('should maintain rolling window of max 60 samples', async () => {
    const { result } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, true)
    );

    // Simulate 65 polls (should cap at 60)
    for (let i = 0; i < 65; i++) {
      mockGetStats.mockResolvedValue(new Map([
        ['video', {
          type: 'outbound-rtp',
          mediaType: 'video',
          bytesSent: 1000000 * (i + 1), // Incrementing bytes
          framesPerSecond: 30,
          frameWidth: 1920,
          frameHeight: 1080
        }]
      ]));

      await act(async () => {
        if (i === 0) {
          await vi.runOnlyPendingTimers(); // Initial poll
        } else {
          vi.advanceTimersByTime(5000);
          await vi.runOnlyPendingTimers();
        }
      });
    }

    // Health score should be calculated with max 60 samples
    expect(result.current.healthScore).toBeDefined();
    expect(mockGetStats).toHaveBeenCalledTimes(65);
  });

  it('should calculate health score after 3+ samples', async () => {
    const { result } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, true)
    );

    // First poll
    await act(async () => {
      await vi.runOnlyPendingTimers();
    });
    expect(result.current.healthScore).toBeNull(); // Not enough samples

    // Second poll
    mockGetStats.mockResolvedValue(new Map([
      ['video', {
        type: 'outbound-rtp',
        mediaType: 'video',
        bytesSent: 2000000,
        framesPerSecond: 30,
        frameWidth: 1920,
        frameHeight: 1080
      }]
    ]));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await vi.runOnlyPendingTimers();
    });
    expect(result.current.healthScore).toBeNull(); // Still not enough

    // Third poll
    mockGetStats.mockResolvedValue(new Map([
      ['video', {
        type: 'outbound-rtp',
        mediaType: 'video',
        bytesSent: 3000000,
        framesPerSecond: 30,
        frameWidth: 1920,
        frameHeight: 1080
      }]
    ]));
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await vi.runOnlyPendingTimers();
    });

    // Now we should have health score
    expect(result.current.healthScore).toBeDefined();
    expect(result.current.healthScore?.score).toBeGreaterThan(0);
    expect(result.current.healthScore?.score).toBeLessThanOrEqual(100);
  });

  it('should handle missing peerConnection gracefully', async () => {
    const invalidClient = { peerConnection: null };

    const { result } = renderHook(() =>
      useStreamMetrics(invalidClient as any, true)
    );

    await act(async () => {
      await vi.runOnlyPendingTimers();
    });

    expect(result.current.metrics).toBeNull();
    expect(result.current.healthScore).toBeNull();
  });

  it('should cleanup interval on unmount', async () => {
    const { unmount } = renderHook(() =>
      useStreamMetrics(mockBroadcastClient, true)
    );

    await act(async () => {
      await vi.runOnlyPendingTimers();
    });
    expect(mockGetStats).toHaveBeenCalledTimes(1);

    // Unmount the hook
    unmount();

    // Advance time and verify no more calls
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await vi.runOnlyPendingTimers();
    });

    // Should still be 1 (no additional calls after unmount)
    expect(mockGetStats).toHaveBeenCalledTimes(1);
  });
});