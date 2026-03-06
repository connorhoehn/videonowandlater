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

interface TranscriptDisplayProps {
  sessionId: string;
  currentTime: number; // in milliseconds
  authToken: string;
}

export function TranscriptDisplay({ sessionId, currentTime, authToken }: TranscriptDisplayProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

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

  // Update current segment based on playback time
  useEffect(() => {
    const currentTimeInMs = currentTime;
    const index = segments.findIndex(
      seg => currentTimeInMs >= seg.startTime && currentTimeInMs <= seg.endTime
    );
    setCurrentSegmentIndex(index);
  }, [currentTime, segments]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeSegmentRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const element = activeSegmentRef.current;
      const elementTop = element.offsetTop;
      const elementHeight = element.offsetHeight;
      const containerHeight = container.clientHeight;
      const scrollTop = container.scrollTop;

      // Check if element is not fully visible
      if (elementTop < scrollTop || elementTop + elementHeight > scrollTop + containerHeight) {
        // Scroll to center the element
        container.scrollTo({
          top: elementTop - containerHeight / 2 + elementHeight / 2,
          behavior: 'smooth'
        });
      }
    }
  }, [currentSegmentIndex]);

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
              className={`
                p-3 rounded-lg transition-all duration-200
                ${isActive
                  ? 'bg-blue-50 border-l-4 border-blue-500 shadow-sm'
                  : isPast
                    ? 'text-gray-500 opacity-75'
                    : 'text-gray-700 hover:bg-gray-50'
                }
              `}
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