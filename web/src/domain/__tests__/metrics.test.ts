import { describe, it, expect } from 'vitest';
import {
  StreamMetrics,
  HealthScoreResult,
  calculateHealthScore,
  stdDev
} from '../metrics';

describe('StreamMetrics', () => {
  it('should have all required fields', () => {
    const metrics: StreamMetrics = {
      timestamp: Date.now(),
      bitrate: 2500000,
      framesPerSecond: 30,
      resolution: { width: 1920, height: 1080 },
      networkType: 'wifi',
      qualityLimitation: 'none',
      jitter: 0.5,
      packetsLost: 0
    };

    expect(metrics.timestamp).toBeGreaterThan(0);
    expect(metrics.bitrate).toBe(2500000);
    expect(metrics.framesPerSecond).toBe(30);
    expect(metrics.resolution.width).toBe(1920);
    expect(metrics.resolution.height).toBe(1080);
    expect(metrics.networkType).toBe('wifi');
    expect(metrics.qualityLimitation).toBe('none');
    expect(metrics.jitter).toBe(0.5);
    expect(metrics.packetsLost).toBe(0);
  });
});

describe('calculateHealthScore', () => {
  it('should return ~100 score with perfect metrics', () => {
    const result = calculateHealthScore({
      currentBitrate: 2500000 * 8, // 2500 kbps in bits/sec
      targetBitrate: 2500000 * 8,
      currentFps: 30,
      targetFps: 30,
      recentBitrates: Array(10).fill(2500000 * 8),
      recentFrameRates: Array(10).fill(30)
    });

    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.bitrateHealth).toBeGreaterThanOrEqual(95);
    expect(result.fpsHealth).toBeGreaterThanOrEqual(95);
    expect(result.warning).toBe('none');
  });

  it('should detect bitrate drop warning when >30% below target', () => {
    const targetBitrate = 2500000 * 8;
    const droppedBitrate = targetBitrate * 0.65; // 35% drop

    const result = calculateHealthScore({
      currentBitrate: droppedBitrate,
      targetBitrate: targetBitrate,
      currentFps: 30,
      targetFps: 30,
      recentBitrates: Array(10).fill(droppedBitrate),
      recentFrameRates: Array(10).fill(30)
    });

    expect(result.warning).toBe('bitrate-drop');
    expect(result.bitrateHealth).toBeLessThan(70);
  });

  it('should detect fps drop warning when FPS is critically low', () => {
    const result = calculateHealthScore({
      currentBitrate: 2500000 * 8,
      targetBitrate: 2500000 * 8,
      currentFps: 20,
      targetFps: 30,
      recentBitrates: Array(10).fill(2500000 * 8),
      recentFrameRates: Array(10).fill(20)
    });

    expect(result.warning).toBe('fps-drop');
    expect(result.fpsHealth).toBeLessThan(70);
  });

  it('should detect both warnings when both metrics are poor', () => {
    const targetBitrate = 2500000 * 8;
    const droppedBitrate = targetBitrate * 0.65;

    const result = calculateHealthScore({
      currentBitrate: droppedBitrate,
      targetBitrate: targetBitrate,
      currentFps: 15,
      targetFps: 30,
      recentBitrates: Array(10).fill(droppedBitrate),
      recentFrameRates: Array(10).fill(15)
    });

    expect(result.warning).toBe('both');
    expect(result.bitrateHealth).toBeLessThan(70);
    expect(result.fpsHealth).toBeLessThan(50);
  });

  it('should penalize high jitter/variance in bitrate', () => {
    const targetBitrate = 2500000 * 8;
    // Create highly variable bitrate samples
    const recentBitrates = [
      targetBitrate * 0.5,
      targetBitrate * 1.5,
      targetBitrate * 0.6,
      targetBitrate * 1.4,
      targetBitrate * 0.7,
      targetBitrate * 1.3,
      targetBitrate * 0.8,
      targetBitrate * 1.2,
      targetBitrate * 0.9,
      targetBitrate * 1.1
    ];

    const stableResult = calculateHealthScore({
      currentBitrate: targetBitrate,
      targetBitrate: targetBitrate,
      currentFps: 30,
      targetFps: 30,
      recentBitrates: Array(10).fill(targetBitrate),
      recentFrameRates: Array(10).fill(30)
    });

    const jitteryResult = calculateHealthScore({
      currentBitrate: targetBitrate,
      targetBitrate: targetBitrate,
      currentFps: 30,
      targetFps: 30,
      recentBitrates: recentBitrates,
      recentFrameRates: Array(10).fill(30)
    });

    // Jittery stream should have lower score than stable stream
    expect(jitteryResult.bitrateHealth).toBeLessThan(stableResult.bitrateHealth);
    expect(jitteryResult.score).toBeLessThan(stableResult.score);
  });
});

describe('stdDev', () => {
  it('should calculate standard deviation correctly', () => {
    const samples1 = [2, 4, 4, 4, 5, 5, 7, 9];
    // Mean = 5, Variance = 4, StdDev = 2
    expect(Math.abs(stdDev(samples1) - 2)).toBeLessThan(0.01);

    const samples2 = [10, 10, 10, 10, 10];
    // No variance
    expect(stdDev(samples2)).toBe(0);

    const samples3 = [1, 2, 3, 4, 5];
    // Mean = 3, Variance = 2, StdDev = sqrt(2) ≈ 1.414
    expect(Math.abs(stdDev(samples3) - Math.sqrt(2))).toBeLessThan(0.01);
  });

  it('should handle empty array', () => {
    expect(stdDev([])).toBe(0);
  });

  it('should handle single value', () => {
    expect(stdDev([42])).toBe(0);
  });
});