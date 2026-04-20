/**
 * ContentPicker - Grid picker for selecting existing recordings/broadcasts/uploads as story segments.
 */

import { useState, useEffect, useCallback } from 'react';
import { getConfig } from '../../config/aws-config';
import { fetchToken } from '../../auth/fetchToken';
import type { ActivitySession } from '../../features/activity/RecordingSlider';
import { CheckIcon, VideoIcon } from './Icons';

export interface SelectedContent {
  sessionId: string;
  type: 'image' | 'video';
  thumbnailUrl: string;
  label: string;
  duration?: number;
}

export interface ContentPickerProps {
  onSelect: (items: SelectedContent[]) => void;
  maxItems?: number;
  selectedIds?: string[];
}

const TYPE_COLORS: Record<string, string> = {
  BROADCAST: 'bg-red-500',
  UPLOAD: 'bg-blue-500',
  HANGOUT: 'bg-green-500',
};

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function hasAvailableContent(session: ActivitySession): boolean {
  const validType = session.sessionType === 'BROADCAST' || session.sessionType === 'UPLOAD' || session.sessionType === 'HANGOUT';
  const hasRecording = session.recordingStatus === 'available' || session.convertStatus === 'available' || !!session.recordingHlsUrl;
  return validType && hasRecording;
}

function getThumbUrl(session: ActivitySession): string {
  return session.thumbnailUrl || session.posterFrameUrl || '';
}

function getLabel(session: ActivitySession): string {
  return session.sourceFileName || session.userId || session.sessionId;
}

function toSelectedContent(session: ActivitySession): SelectedContent {
  return {
    sessionId: session.sessionId,
    type: 'video',
    thumbnailUrl: getThumbUrl(session),
    label: getLabel(session),
    duration: session.recordingDuration,
  };
}

export function ContentPicker({ onSelect, maxItems = 10, selectedIds: externalSelectedIds }: ContentPickerProps) {
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(externalSelectedIds ?? []));

  useEffect(() => {
    if (externalSelectedIds) setSelectedIds(new Set(externalSelectedIds));
  }, [externalSelectedIds]);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { token } = await fetchToken();
      const config = getConfig();
      if (!config?.apiUrl) throw new Error('API not configured');
      const res = await fetch(`${config.apiUrl}/activity`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setSessions((data.sessions as ActivitySession[]).filter(hasAvailableContent));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const toggleSelection = useCallback((session: ActivitySession) => {
    const next = new Set(selectedIds);
    if (next.has(session.sessionId)) {
      next.delete(session.sessionId);
    } else {
      if (next.size >= maxItems) return;
      next.add(session.sessionId);
    }
    setSelectedIds(next);
    const selected = sessions.filter(s => next.has(s.sessionId)).map(toSelectedContent);
    onSelect(selected);
  }, [selectedIds, sessions, maxItems, onSelect]);

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1.5 p-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-md bg-gray-700 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <button onClick={fetchContent} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer">Retry</button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div className="p-8 text-center text-sm text-gray-400">No recordings yet</div>;
  }

  return (
    <div className="p-2">
      <p className="text-xs text-gray-400 mb-2 px-1">{selectedIds.size} / {maxItems} selected</p>
      <div className="grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
        {sessions.map(session => {
          const isSelected = selectedIds.has(session.sessionId);
          const atLimit = selectedIds.size >= maxItems && !isSelected;
          const thumb = getThumbUrl(session);

          return (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => toggleSelection(session)}
              disabled={atLimit}
              className={`
                relative aspect-square rounded-md overflow-hidden cursor-pointer
                transition-all duration-100 focus:outline-none
                ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-gray-900' : ''}
                ${atLimit ? 'opacity-30 cursor-not-allowed' : ''}
              `}
            >
              {/* Thumbnail or fallback */}
              {thumb ? (
                <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                  <VideoIcon size={24} className="text-gray-500" />
                </div>
              )}

              {/* Bottom gradient with label + duration */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1.5 pt-4">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-white/90 truncate">{getLabel(session)}</span>
                  {session.recordingDuration != null && session.recordingDuration > 0 && (
                    <span className="text-[10px] text-white/80 flex-shrink-0">{formatDuration(session.recordingDuration)}</span>
                  )}
                </div>
              </div>

              {/* Type dot */}
              <span className={`absolute top-1 left-1 w-2 h-2 rounded-full ${TYPE_COLORS[session.sessionType] || 'bg-gray-500'}`} />

              {/* Selected overlay */}
              {isSelected && (
                <div className="absolute inset-0 bg-blue-500/30 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                    <CheckIcon size={14} className="text-white" />
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
