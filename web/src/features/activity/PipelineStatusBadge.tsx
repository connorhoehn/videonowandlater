/**
 * PipelineStatusBadge - Displays the current pipeline processing state as a colored badge
 * Priority order: converting -> transcribing -> summarizing -> complete -> failed -> null
 */

import type { ActivitySession } from './RecordingSlider';

interface PipelineStatusBadgeProps {
  session: ActivitySession;
}

type BadgeConfig = {
  label: string;
  className: string;
};

function getBadgeConfig(session: ActivitySession): BadgeConfig | null {
  // Check for failures first (any status failed)
  if (
    session.convertStatus === 'failed' ||
    session.transcriptStatus === 'failed' ||
    session.aiSummaryStatus === 'failed' ||
    session.recordingStatus === 'failed'
  ) {
    return { label: 'Failed', className: 'bg-red-100 text-red-700' };
  }

  // Converting
  if (session.convertStatus === 'processing') {
    return { label: 'Converting', className: 'bg-yellow-100 text-yellow-700' };
  }

  // Transcribing
  if (session.transcriptStatus === 'processing') {
    return { label: 'Transcribing', className: 'bg-yellow-100 text-yellow-700' };
  }

  // Summarizing (AI summary pending after transcript is available)
  if (session.aiSummaryStatus === 'pending' && session.transcriptStatus === 'available') {
    return { label: 'Summarizing', className: 'bg-purple-100 text-purple-700' };
  }

  // Complete
  if (session.aiSummaryStatus === 'available') {
    return { label: 'Complete', className: 'bg-green-100 text-green-700' };
  }

  return null;
}

export function PipelineStatusBadge({ session }: PipelineStatusBadgeProps) {
  const config = getBadgeConfig(session);

  if (!config) return null;

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
