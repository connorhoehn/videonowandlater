/**
 * TranscriptDisplay - Shows synchronized transcript during replay
 */

import { useState, useEffect, useRef } from 'react';
import { getConfig } from '../../config/aws-config';

interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
}

interface SpeakerSegment {
  speaker: string;   // 'Speaker 1' or 'Speaker 2'
  startTime: number; // ms
  endTime: number;   // ms
  text: string;
}

interface TranscriptDisplayProps {
  sessionId: string;
  currentTime: number; // in milliseconds
  authToken: string;
  diarizedTranscriptS3Path?: string;
  onSeek?: (timeMs: number) => void;
}

export function TranscriptDisplay({ sessionId, currentTime, authToken, diarizedTranscriptS3Path, onSeek }: TranscriptDisplayProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const [speakerSegments, setSpeakerSegments] = useState<SpeakerSegment[]>([]);
  const [currentSpeakerSegmentIndex, setCurrentSpeakerSegmentIndex] = useState(-1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const activeSpeakerSegmentRef = useRef<HTMLDivElement>(null);

  // Fetch transcript
  useEffect(() => {
    if (!sessionId || !authToken) return;

    const fetchTranscript = async () => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/transcript`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });

        if (response.status === 404) {
          setError('Transcript not available yet');
          setLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to load transcript: ${response.status}`);
        }

        const data = await response.json();

        // Parse transcript into segments
        if (data.results?.items) {
          const parsed: TranscriptSegment[] = [];
          let currentSegment: TranscriptSegment | null = null;

          data.results.items.forEach((item: any) => {
            if (item.type === 'pronunciation') {
              const startTime = parseFloat(item.start_time) * 1000; // Convert to ms
              const endTime = parseFloat(item.end_time) * 1000;
              const text = item.alternatives[0].content;

              if (currentSegment && startTime - currentSegment.endTime > 1000) {
                // New segment if there's a pause > 1 second
                parsed.push(currentSegment);
                currentSegment = { startTime, endTime, text };
              } else if (currentSegment) {
                // Append to current segment
                currentSegment.text += ' ' + text;
                currentSegment.endTime = endTime;
              } else {
                // Start first segment
                currentSegment = { startTime, endTime, text };
              }
            } else if (item.type === 'punctuation' && currentSegment) {
              currentSegment.text += item.alternatives[0].content;
            }
          });

          if (currentSegment) {
            parsed.push(currentSegment);
          }

          setSegments(parsed);
        } else if (data.transcript) {
          // Fallback for simple transcript text
          setSegments([{ startTime: 0, endTime: Infinity, text: data.transcript }]);
        }
      } catch (err: any) {
        console.error('Failed to fetch transcript:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTranscript();
  }, [sessionId, authToken]);

  // Fetch speaker segments when diarizedTranscriptS3Path is present
  useEffect(() => {
    if (!sessionId || !authToken || !diarizedTranscriptS3Path) return;

    const fetchSpeakerSegments = async () => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/speaker-segments`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });

        if (response.status === 404) {
          // Silently fall back to plain transcript view
          return;
        }

        if (!response.ok) {
          console.error(`Failed to load speaker segments: ${response.status}`);
          return;
        }

        const data = await response.json();
        setSpeakerSegments(data.segments ?? []);
      } catch (err: any) {
        // Non-blocking — log but do not set error state
        console.error('Failed to fetch speaker segments:', err);
      }
    };

    fetchSpeakerSegments();
  }, [sessionId, authToken, diarizedTranscriptS3Path]);

  // Update current plain segment based on playback time
  useEffect(() => {
    const index = segments.findIndex(
      seg => currentTime >= seg.startTime && currentTime <= seg.endTime
    );
    setCurrentSegmentIndex(index);
  }, [currentTime, segments]);

  // Update current speaker segment based on playback time
  useEffect(() => {
    const index = speakerSegments.findIndex(
      seg => currentTime >= seg.startTime && currentTime <= seg.endTime
    );
    setCurrentSpeakerSegmentIndex(index);
  }, [currentTime, speakerSegments]);

  // Auto-scroll to active plain segment
  useEffect(() => {
    if (activeSegmentRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = activeSegmentRef.current;
      const elementTop = element.offsetTop;
      const elementHeight = element.offsetHeight;
      const containerHeight = container.clientHeight;
      const scrollTop = container.scrollTop;

      if (elementTop < scrollTop || elementTop + elementHeight > scrollTop + containerHeight) {
        container.scrollTo({
          top: elementTop - containerHeight / 2 + elementHeight / 2,
          behavior: 'smooth'
        });
      }
    }
  }, [currentSegmentIndex]);

  // Auto-scroll to active speaker segment
  useEffect(() => {
    if (activeSpeakerSegmentRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = activeSpeakerSegmentRef.current;
      const elementTop = element.offsetTop;
      const elementHeight = element.offsetHeight;
      const containerHeight = container.clientHeight;
      const scrollTop = container.scrollTop;

      if (elementTop < scrollTop || elementTop + elementHeight > scrollTop + containerHeight) {
        container.scrollTo({
          top: elementTop - containerHeight / 2 + elementHeight / 2,
          behavior: 'smooth'
        });
      }
    }
  }, [currentSpeakerSegmentIndex]);

  if (loading) {
    return (
      <div className="h-full bg-white rounded-lg shadow-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Transcript</h3>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p className="text-sm text-gray-500">Loading transcript...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-white rounded-lg shadow-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Transcript</h3>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="text-gray-400 text-3xl mb-2">📝</div>
            <p className="text-sm text-gray-600">{error}</p>
            <p className="text-xs text-gray-500 mt-2">
              Transcript will be available once processing completes
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="h-full bg-white rounded-lg shadow-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Transcript</h3>
        <div className="flex items-center justify-center h-96">
          <p className="text-sm text-gray-500">No transcript available</p>
        </div>
      </div>
    );
  }

  // Bubble mode — shown when speaker segments are available
  if (speakerSegments.length > 0) {
    return (
      <div className="h-full bg-white rounded-lg shadow-lg flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">Transcript</h3>
        </div>
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {speakerSegments.map((seg, index) => {
            const isSpeaker1 = seg.speaker === 'Speaker 1';
            const isActive = index === currentSpeakerSegmentIndex;

            return (
              <div
                key={index}
                ref={isActive ? activeSpeakerSegmentRef : null}
                data-testid={`speaker-segment-${index}`}
                className={`flex ${isSpeaker1 ? 'justify-start' : 'justify-end'} ${onSeek ? 'cursor-pointer' : ''}`}
                onClick={() => onSeek?.(seg.startTime)}
              >
                <div
                  className={`
                    max-w-[80%] rounded-2xl px-4 py-3 border transition-all
                    ${isSpeaker1
                      ? `bg-blue-50 border-blue-200 rounded-tl-sm ${isActive ? 'ring-2 ring-blue-400' : ''}`
                      : `bg-gray-100 border-gray-200 rounded-tr-sm ${isActive ? 'ring-2 ring-gray-400' : ''}`
                    }
                  `}
                >
                  <div className={`text-xs font-semibold mb-1 ${isSpeaker1 ? 'text-blue-600' : 'text-gray-500 text-right'}`}>
                    {seg.speaker} · {formatTime(seg.startTime)}
                  </div>
                  <div className="text-sm text-gray-800">{seg.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Plain segment mode — shown when no speaker segments (backward compatible)
  return (
    <div className="h-full bg-white rounded-lg shadow-lg flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">Transcript</h3>
      </div>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {segments.map((segment, index) => {
          const isActive = index === currentSegmentIndex;
          const isPast = currentTime > segment.endTime;

          return (
            <div
              key={index}
              ref={isActive ? activeSegmentRef : null}
              data-testid={`segment-${index}`}
              className={`
                p-3 rounded-lg transition-all duration-200
                ${onSeek ? 'cursor-pointer' : ''}
                ${isActive
                  ? 'bg-blue-50 border-l-4 border-blue-500 shadow-sm'
                  : isPast
                    ? 'text-gray-500 opacity-75'
                    : `text-gray-700 ${onSeek ? 'hover:bg-blue-50' : 'hover:bg-gray-50'}`
                }
              `}
              onClick={() => onSeek?.(segment.startTime)}
            >
              <div className="text-xs text-gray-400 mb-1">
                {formatTime(segment.startTime)}
              </div>
              <div className={`text-sm ${isActive ? 'font-medium' : ''}`}>
                {segment.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
