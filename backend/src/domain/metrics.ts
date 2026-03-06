/**
 * Stream metrics domain model for backend
 * Phase 23: Stream Quality Monitoring Dashboard
 *
 * NOTE: This is an optional field on Session type.
 * Sessions created before Phase 23 will not have this field.
 * Always check for existence before accessing.
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

/**
 * Example usage in Session type:
 *
 * interface Session {
 *   id: string;
 *   // ... other fields
 *   streamMetrics?: StreamMetrics; // Optional for backward compatibility
 * }
 */