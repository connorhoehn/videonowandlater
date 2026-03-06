/**
 * Stream quality metrics domain models and health score calculation
 * Phase 23: Stream Quality Monitoring Dashboard
 */

export interface StreamMetrics {
  /** Unix timestamp in milliseconds when sample was taken */
  timestamp: number;
  /** Current bitrate in bytes (cumulative bytes sent from WebRTC) */
  bitrate: number;
  /** Current frames per second */
  framesPerSecond: number;
  /** Video resolution */
  resolution: {
    width: number;
    height: number;
  };
  /** Network type (wifi, 4g, etc) - default 'unknown' */
  networkType: string;
  /** Quality limitation reason (none, cpu, bandwidth, other) - default 'none' */
  qualityLimitation: string;
  /** Optional network jitter in milliseconds */
  jitter?: number;
  /** Optional packets lost count */
  packetsLost?: number;
}

export interface HealthScoreResult {
  /** Overall health score 0-100 */
  score: number;
  /** Bitrate health component 0-100 */
  bitrateHealth: number;
  /** FPS health component 0-100 */
  fpsHealth: number;
  /** Warning status based on thresholds */
  warning: 'none' | 'bitrate-drop' | 'fps-drop' | 'both';
}

export interface HealthScoreInputs {
  /** Current instantaneous bitrate in bits/sec */
  currentBitrate: number;
  /** Target bitrate in bits/sec */
  targetBitrate: number;
  /** Current FPS */
  currentFps: number;
  /** Target FPS (typically 30) */
  targetFps: number;
  /** Recent bitrate samples for stability calculation */
  recentBitrates: number[];
  /** Recent FPS samples for consistency calculation */
  recentFrameRates: number[];
}

/**
 * Calculate standard deviation of numeric samples
 * Used to measure jitter/variance in stream metrics
 */
export function stdDev(samples: number[]): number {
  if (samples.length <= 1) return 0;

  const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length;
  const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;
  return Math.sqrt(variance);
}

/**
 * Calculate stream health score based on bitrate stability (60%) and FPS consistency (40%)
 *
 * @param inputs Current and recent stream metrics
 * @returns Health score 0-100 with component breakdown and warnings
 */
export function calculateHealthScore(inputs: HealthScoreInputs): HealthScoreResult {
  const {
    currentBitrate,
    targetBitrate,
    currentFps,
    targetFps,
    recentBitrates,
    recentFrameRates
  } = inputs;

  // Calculate bitrate health (60% weight)
  let bitrateHealth = 100;

  if (recentBitrates.length > 0) {
    const avgBitrate = recentBitrates.reduce((sum, val) => sum + val, 0) / recentBitrates.length;

    // Penalize deviation from target (more aggressive penalties)
    const bitrateDifference = Math.abs(avgBitrate - targetBitrate) / targetBitrate;

    // Penalize variance/jitter
    const bitrateStdDev = stdDev(recentBitrates);
    const bitrateVariance = avgBitrate > 0 ? bitrateStdDev / avgBitrate : 0;

    // Calculate health: start at 100, subtract penalties
    // Increased penalties: 100x for difference, 100x for variance
    bitrateHealth = Math.max(0, 100 - bitrateDifference * 100 - bitrateVariance * 100);
  }

  // Calculate FPS health (40% weight)
  let fpsHealth = 100;

  if (recentFrameRates.length > 0) {
    // What percentage of samples meet the target (within 95% threshold)?
    const fpsThreshold = targetFps * 0.95;
    const samplesOnTarget = recentFrameRates.filter(fps => fps >= fpsThreshold).length;
    const fpsOnTarget = samplesOnTarget / recentFrameRates.length;

    // Penalize variance
    const fpsStdDev = stdDev(recentFrameRates);
    const fpsVariance = targetFps > 0 ? fpsStdDev / targetFps : 0;

    // Calculate health (increased multipliers for stronger penalties)
    fpsHealth = Math.max(0, fpsOnTarget * 100 - fpsVariance * 50);
  }

  // Combined score
  const score = Math.round(bitrateHealth * 0.6 + fpsHealth * 0.4);

  // Warning detection
  let warning: HealthScoreResult['warning'] = 'none';

  if (recentBitrates.length > 0 && recentFrameRates.length > 0) {
    const avgBitrate = recentBitrates.reduce((sum, val) => sum + val, 0) / recentBitrates.length;
    const bitrateDropped = avgBitrate < targetBitrate * 0.7; // >30% below target

    const fpsThreshold = targetFps * 0.95;
    const samplesOnTarget = recentFrameRates.filter(fps => fps >= fpsThreshold).length;
    const fpsOnTarget = samplesOnTarget / recentFrameRates.length;
    const fpsCritical = fpsOnTarget < 0.5; // Less than 50% of samples meet target

    if (bitrateDropped && fpsCritical) {
      warning = 'both';
    } else if (bitrateDropped) {
      warning = 'bitrate-drop';
    } else if (fpsCritical) {
      warning = 'fps-drop';
    }
  }

  return {
    score,
    bitrateHealth: Math.round(bitrateHealth),
    fpsHealth: Math.round(fpsHealth),
    warning
  };
}