/**
 * StreamQualityOverlay - Non-intrusive floating wrapper for stream quality dashboard
 * Phase 23-02: Stream Quality Monitoring Dashboard UI
 *
 * Positioning rationale:
 * - fixed bottom-4 right-4: Bottom-right corner, non-intrusive to camera preview and controls
 * - z-40: Above FloatingReactions (z-30) and preview, below broadcast controls (z-50 if needed)
 * - w-80: Fixed 320px width for consistent metrics display
 */

import type { StreamMetrics, HealthScoreResult } from '../../domain/metrics';
import { StreamQualityDashboard } from './StreamQualityDashboard';

interface OverlayProps {
  metrics: StreamMetrics | null;
  healthScore: HealthScoreResult | null;
  isLive: boolean;
}

/**
 * Floating overlay wrapper for stream quality dashboard
 * Renders in bottom-right corner with non-intrusive positioning
 */
export function StreamQualityOverlay({ metrics, healthScore, isLive }: OverlayProps) {
  // Only render when live and data is available
  if (!isLive || !metrics || !healthScore) {
    return null;
  }

  return (
    <div className="absolute bottom-3 right-3 z-40 w-64 sm:w-72 animate-slide-up">
      <StreamQualityDashboard
        metrics={metrics}
        healthScore={healthScore}
        isLive={isLive}
      />
    </div>
  );
}