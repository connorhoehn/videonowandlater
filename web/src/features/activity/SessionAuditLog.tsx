/**
 * SessionAuditLog - Timeline showing processing history for a session
 * Displays events like: session created, recording available, mediaconvert submitted, transcribed, AI processed, etc.
 */

import type { ActivitySession } from './RecordingSlider';

interface AuditEvent {
  title: string;
  timestamp?: string;
  status: 'completed' | 'processing' | 'failed' | 'pending';
}

function formatTime(dateString?: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function buildAuditLog(session: ActivitySession): AuditEvent[] {
  const events: AuditEvent[] = [];

  // Session created
  events.push({
    title: 'Session created',
    timestamp: session.createdAt,
    status: 'completed',
  });

  // Recording available (broadcast/hangout sessions)
  if (session.recordingStatus) {
    if (session.recordingStatus === 'available') {
      events.push({
        title: 'Recording available',
        timestamp: session.endedAt,
        status: 'completed',
      });
    } else if (session.recordingStatus === 'processing') {
      events.push({
        title: 'Recording in progress',
        timestamp: session.endedAt,
        status: 'processing',
      });
    } else if (session.recordingStatus === 'failed') {
      events.push({
        title: 'Recording failed',
        timestamp: session.endedAt,
        status: 'failed',
      });
    }
  }

  // MediaConvert processing (transcoding for playback)
  // This is inferred from convertStatus or presence of recordingHlsUrl
  if (session.recordingStatus === 'available') {
    // If recording is available, mediaconvert must have been submitted
    if (session.recordingHlsUrl) {
      events.push({
        title: 'MediaConvert complete',
        status: 'completed',
      });
    } else {
      events.push({
        title: 'MediaConvert submitted',
        status: 'processing',
      });
    }
  }

  // Transcription pipeline (only after recording is available)
  if (session.recordingStatus === 'available') {
    if (session.transcriptStatus === 'available') {
      events.push({
        title: 'Transcript available',
        status: 'completed',
      });
    } else if (session.transcriptStatus === 'processing') {
      events.push({
        title: 'Transcribing audio',
        status: 'processing',
      });
    } else if (session.transcriptStatus === 'failed') {
      events.push({
        title: 'Transcription failed',
        status: 'failed',
      });
    } else if (session.transcriptStatus === 'pending') {
      events.push({
        title: 'Waiting for transcription',
        status: 'pending',
      });
    }
  }

  // AI Summary generation (only after transcript is available)
  if (session.transcriptStatus === 'available') {
    if (session.aiSummaryStatus === 'available') {
      events.push({
        title: 'Summary generated',
        status: 'completed',
      });
    } else if (session.aiSummaryStatus === 'processing') {
      events.push({
        title: 'Generating summary',
        status: 'processing',
      });
    } else if (session.aiSummaryStatus === 'failed') {
      events.push({
        title: 'Summary generation failed',
        status: 'failed',
      });
    } else if (session.aiSummaryStatus === 'pending') {
      events.push({
        title: 'Waiting for summary',
        status: 'pending',
      });
    }
  }

  return events;
}

function getStatusIcon(status: AuditEvent['status']): JSX.Element {
  switch (status) {
    case 'completed':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100">
          <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case 'processing':
      return (
        <div className="flex items-center justify-center w-5 h-5">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100">
          <svg className="w-3 h-3 text-red-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728" strokeWidth={2} stroke="currentColor" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'pending':
      return (
        <div className="flex items-center justify-center w-5 h-5 rounded-full border border-gray-300">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
        </div>
      );
  }
}

interface SessionAuditLogProps {
  session: ActivitySession;
  compact?: boolean; // If true, only show key events
}

export function SessionAuditLog({ session, compact = false }: SessionAuditLogProps) {
  const events = buildAuditLog(session);

  if (events.length === 0) {
    return null;
  }

  // In compact mode, show only the last event
  const displayEvents = compact ? events.slice(-1) : events;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="space-y-2">
        {displayEvents.map((event, index) => (
          <div key={index} className="flex items-start gap-2 text-xs">
            {getStatusIcon(event.status)}
            <div className="flex-1 flex items-center justify-between">
              <span className="text-gray-700">
                {event.title}
              </span>
              {event.timestamp && !compact && (
                <span className="text-gray-400 text-[10px] ml-2">
                  {formatTime(event.timestamp)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
