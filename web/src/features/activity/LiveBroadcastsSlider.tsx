/**
 * LiveBroadcastsSlider - Horizontal scrollable slider for currently live broadcasts
 * Uses StoriesSlider component for consistent social-feed styling
 */

import { useNavigate } from 'react-router-dom';
import { StoriesSlider } from '../../components/social';
import type { Story } from '../../components/social';
import type { ActivitySession } from './RecordingSlider';

interface LiveBroadcastsSliderProps {
  sessions: ActivitySession[];
}

export function LiveBroadcastsSlider({ sessions }: LiveBroadcastsSliderProps) {
  const navigate = useNavigate();

  // Filter to live broadcasts only
  const liveBroadcasts = sessions.filter(
    (s) => s.sessionType === 'BROADCAST' && s.recordingStatus === 'processing'
  );

  if (liveBroadcasts.length === 0) {
    return null;
  }

  const stories: Story[] = liveBroadcasts.map((session) => ({
    id: session.sessionId,
    name: session.userId,
    thumbnail: session.thumbnailUrl || '',
    onClick: () => navigate(`/viewer/${session.sessionId}`),
  }));

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
        <h2 className="text-sm font-semibold text-gray-900">Live Now</h2>
      </div>
      <StoriesSlider
        stories={stories}
        createLabel="Go Live"
        onCreateStory={undefined}
      />
    </div>
  );
}
