/**
 * VideoInfoPanel - Collapsible AI summary + transcript panel for uploaded videos
 */

import { SummaryDisplay } from '../replay/SummaryDisplay';
import { TranscriptDisplay } from '../replay/TranscriptDisplay';

interface VideoInfoPanelProps {
  sessionId: string;
  authToken: string;
  syncTime: number;
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
  diarizedTranscriptS3Path?: string;
}

export function VideoInfoPanel({
  sessionId,
  authToken,
  syncTime,
  aiSummary,
  aiSummaryStatus,
  diarizedTranscriptS3Path,
}: VideoInfoPanelProps) {
  return (
    <div className="p-4 space-y-4">
      <SummaryDisplay summary={aiSummary} status={aiSummaryStatus} truncate={false} />
      <div className="max-h-[500px] overflow-hidden">
        <TranscriptDisplay
          sessionId={sessionId}
          currentTime={syncTime}
          authToken={authToken}
          diarizedTranscriptS3Path={diarizedTranscriptS3Path}
        />
      </div>
    </div>
  );
}
