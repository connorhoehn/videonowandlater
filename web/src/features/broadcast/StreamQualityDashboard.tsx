/**
 * StreamQualityDashboard - Real-time stream health visualization
 * Phase 23-02: Stream Quality Monitoring Dashboard UI
 */

import React, { useState } from 'react';
import { StreamMetrics, HealthScoreResult } from '../../domain/metrics';

interface DashboardProps {
  metrics: StreamMetrics;
  healthScore: HealthScoreResult;
  isLive: boolean;
}

/**
 * Helper component for metric rows in expanded view
 */
function MetricRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`flex justify-between text-xs ${alert ? 'text-yellow-400' : 'text-gray-300'}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

/**
 * Format bitrate from bytes to kbps
 * Note: The metrics.bitrate is already in bytes (cumulative bytesSent from WebRTC)
 * The useStreamMetrics hook converts this to instantaneous bitrate in bits/sec
 * We display it as kbps for readability
 */
function formatBitrate(bytes: number): string {
  // Convert bytes to kilobits per second
  const kbps = bytes / 1000;
  return `${Math.round(kbps)} kbps`;
}

/**
 * Stream quality dashboard component showing health score and metrics
 */
export function StreamQualityDashboard({ metrics, healthScore, isLive }: DashboardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Early return if not live or missing data
  if (!isLive || !metrics || !healthScore) {
    return null;
  }

  // Determine score color based on thresholds
  let scoreColor: string;
  if (healthScore.score >= 80) {
    scoreColor = 'bg-green-600/20 text-green-400 border-green-600';
  } else if (healthScore.score >= 60) {
    scoreColor = 'bg-yellow-600/20 text-yellow-400 border-yellow-600';
  } else {
    scoreColor = 'bg-red-600/20 text-red-400 border-red-600';
  }

  return (
    <div className="w-full transition-all duration-200">
      <div className="bg-black/85 backdrop-blur-md rounded-lg border border-gray-700 shadow-xl overflow-hidden">

        {/* Header row with live indicator and expand/collapse button */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
            <span className="text-xs font-semibold text-white">Stream Quality</span>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '−' : '+'}
          </button>
        </div>

        {/* Score circle and summary */}
        <div className="px-4 py-4 flex items-center gap-4">
          <div className={`flex-shrink-0 w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl border-2 ${scoreColor}`}>
            {healthScore.score}%
          </div>

          <div className="flex-1 space-y-2">
            <div className="text-xs font-semibold text-white">
              {healthScore.warning === 'none' ? '✓ Healthy Stream' : '⚠ Issue Detected'}
            </div>
            <div className="text-xs text-gray-400">
              Bitrate: {healthScore.bitrateHealth}% | FPS: {healthScore.fpsHealth}%
            </div>
            {healthScore.warning !== 'none' && (
              <div className="text-xs text-red-400 font-medium">
                {healthScore.warning === 'bitrate-drop' && '↓ Bitrate dropping'}
                {healthScore.warning === 'fps-drop' && '↓ Frame rate low'}
                {healthScore.warning === 'both' && '↓ Bitrate & FPS low'}
              </div>
            )}
          </div>
        </div>

        {/* Expandable detailed metrics */}
        {isExpanded && (
          <div className="border-t border-gray-700 px-4 py-3 space-y-3">
            <MetricRow label="Bitrate" value={formatBitrate(metrics.bitrate)} />
            <MetricRow label="Frame Rate" value={`${Math.round(metrics.framesPerSecond || 0)} fps`} />
            <MetricRow
              label="Resolution"
              value={`${metrics.resolution.width}×${metrics.resolution.height}`}
            />
            <MetricRow label="Network" value={metrics.networkType} />
            {metrics.qualityLimitation !== 'none' && (
              <MetricRow
                label="Limited By"
                value={metrics.qualityLimitation}
                alert
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}