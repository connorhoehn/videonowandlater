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
  icon?: 'spinner' | 'check' | 'error';
};

function getBadgeConfig(session: ActivitySession): BadgeConfig | null {
  // Check for failures first (any status failed)
  if (
    session.convertStatus === 'failed' ||
    session.transcriptStatus === 'failed' ||
    session.aiSummaryStatus === 'failed' ||
    session.recordingStatus === 'failed'
  ) {
    return {
      label: 'Failed',
      className: 'bg-red-50 text-red-600 ring-1 ring-red-200',
      icon: 'error',
    };
  }

  // Converting
  if (session.convertStatus === 'processing') {
    return {
      label: 'Converting',
      className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
      icon: 'spinner',
    };
  }

  // Transcribing
  if (session.transcriptStatus === 'processing') {
    return {
      label: 'Transcribing',
      className: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
      icon: 'spinner',
    };
  }

  // Summarizing (AI summary pending after transcript is available)
  if (session.aiSummaryStatus === 'pending' && session.transcriptStatus === 'available') {
    return {
      label: 'Summarizing',
      className: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
      icon: 'spinner',
    };
  }

  // Highlight reel processing (after summary)
  if ((session as any).highlightReelStatus === 'processing') {
    return {
      label: 'Generating highlights',
      className: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
      icon: 'spinner',
    };
  }

  // Highlights ready (final step complete)
  if ((session as any).highlightReelStatus === 'available') {
    return {
      label: 'Highlights ready',
      className: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200',
      icon: 'check',
    };
  }

  // Complete (summary ready, no highlights)
  if (session.aiSummaryStatus === 'available') {
    return {
      label: 'Summary ready',
      className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      icon: 'check',
    };
  }

  return null;
}

function BadgeIcon({ type }: { type: 'spinner' | 'check' | 'error' }) {
  switch (type) {
    case 'spinner':
      return (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      );
    case 'check':
      return (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'error':
      return (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
  }
}

export function PipelineStatusBadge({ session }: PipelineStatusBadgeProps) {
  const config = getBadgeConfig(session);

  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${config.className} transition-all duration-200`}
    >
      {config.icon && <BadgeIcon type={config.icon} />}
      {config.label}
    </span>
  );
}
