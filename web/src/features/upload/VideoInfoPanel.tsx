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
  visualAnalysis?: string;
  diarizedTranscriptS3Path?: string;
  onSeek?: (timeMs: number) => void;
}

export function VideoInfoPanel({
  sessionId,
  authToken,
  syncTime,
  aiSummary,
  aiSummaryStatus,
  visualAnalysis,
  diarizedTranscriptS3Path,
  onSeek,
}: VideoInfoPanelProps) {
  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* AI Summary section */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">AI Summary</h4>
        <SummaryDisplay summary={aiSummary} status={aiSummaryStatus} visualAnalysis={visualAnalysis} truncate={false} />
      </div>

      {/* Transcript section */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Transcript</h4>
        <div className="max-h-[500px] overflow-hidden rounded-lg border border-gray-100">
          <TranscriptDisplay
            sessionId={sessionId}
            currentTime={syncTime}
            authToken={authToken}
            diarizedTranscriptS3Path={diarizedTranscriptS3Path}
            onSeek={onSeek}
          />
        </div>
      </div>
    </div>
  );
}
