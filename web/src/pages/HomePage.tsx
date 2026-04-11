import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchToken } from '../auth/fetchToken';
import { useAuth } from '../auth/useAuth';
import { getConfig } from '../config/aws-config';
import { RecordingSlider } from '../features/activity/RecordingSlider';
import { ActivityFeed } from '../features/activity/ActivityFeed';
import { VideoUploadForm } from '../features/upload/VideoUploadForm';
import { CreatePostCard } from '../components/social/CreatePostCard';
import { CameraIcon, UsersIcon, UploadIcon, PhotoIcon } from '../components/social/Icons';
import { StoriesSlider, StoryViewer, StoryCreator, Skeleton } from '../components/social';
import { useActivityData } from '../hooks/useActivityData';
import { useStories } from '../hooks/useStories';
import { useStoryViewState } from '../hooks/useStoryViewState';

function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { sessions, loading: loadingActivity, loadMore, hasMore, loadingMore } = useActivityData();
  const { storyUsers, markViewed, reactToStory, replyToStory, refresh: refreshStories } = useStories();
  const { markViewed: markViewedLocal, hasViewed } = useStoryViewState();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingHangout, setIsCreatingHangout] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  const [storyViewerStartIndex, setStoryViewerStartIndex] = useState(0);
  const [showStoryCreator, setShowStoryCreator] = useState(false);
  const [error, setError] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { token } = await fetchToken();
        setAuthToken(token || null);
      } catch (err) {
        console.error('Error fetching auth session:', err);
      }
    };
    initAuth();
  }, []);

  const handleCreateBroadcast = async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    setIsCreating(true);
    setError('');
    try {
      const { token: authToken } = await fetchToken();
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionType: 'BROADCAST' }),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const sessionData = await response.json();
      navigate(`/broadcast/${sessionData.sessionId}`, { state: { session: sessionData } });
    } catch {
      setError('Failed to create session. Try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateHangout = async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    setIsCreatingHangout(true);
    setError('');
    try {
      const { token: authToken } = await fetchToken();
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionType: 'HANGOUT' }),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const sessionData = await response.json();
      navigate(`/hangout/${sessionData.sessionId}`, { state: { session: sessionData } });
    } catch {
      setError('Failed to create session. Try again.');
    } finally {
      setIsCreatingHangout(false);
    }
  };

  const busy = isCreating || isCreatingHangout;

  return (
    <>
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {error}
          </div>
        )}

        <CreatePostCard
          userName={user?.username}
          placeholder="What's on your mind?"
          actions={[
            { label: 'Go Live', icon: <CameraIcon size={16} />, color: 'text-red-500', onClick: handleCreateBroadcast },
            { label: 'Hangout', icon: <UsersIcon size={16} />, color: 'text-violet-600', onClick: handleCreateHangout },
            { label: 'Story', icon: <PhotoIcon size={16} />, color: 'text-orange-500', onClick: () => setShowStoryCreator(true) },
            { label: 'Upload', icon: <UploadIcon size={16} />, color: 'text-green-600', onClick: () => setShowUploadModal(true) },
          ]}
        />

        {loadingActivity ? (
          <>
            {/* Skeleton for recording slider */}
            <div className="border-b border-gray-100">
              <div className="py-6">
                <Skeleton.Line width="w-28" height="h-4" className="mb-4" />
                <div className="flex gap-4 overflow-hidden">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex-shrink-0 w-56 rounded-xl overflow-hidden">
                      <Skeleton.Rect height="h-auto" rounded="rounded-t-xl" className="aspect-video" />
                      <div className="p-3 bg-white">
                        <Skeleton.Line width="w-24" height="h-3" className="mb-2" />
                        <Skeleton.Line width="w-16" height="h-3" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Skeleton for activity feed */}
            <ActivityFeed sessions={[]} loading={true} />
          </>
        ) : (
          <>
            {/* Stories + Live Broadcasts combined slider */}
            {(() => {
              const liveBroadcasts = sessions.filter(
                (s) => s.sessionType === 'BROADCAST' && s.recordingStatus === 'processing'
              );
              const hasContent = storyUsers.length > 0 || liveBroadcasts.length > 0;
              if (!hasContent) return null;
              return (
                <div className="mb-4">
                  {liveBroadcasts.length > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                      <h2 className="text-sm font-semibold text-gray-900">Stories & Live</h2>
                    </div>
                  )}
                  {liveBroadcasts.length === 0 && storyUsers.length > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="text-sm font-semibold text-gray-900">Stories</h2>
                    </div>
                  )}
                  <StoriesSlider
                    stories={[
                      ...storyUsers.map(group => ({
                        id: group.userId,
                        name: group.userId,
                        thumbnail: group.stories[0]?.segments?.[0]?.url || '',
                      })),
                      ...liveBroadcasts.map(session => ({
                        id: session.sessionId,
                        name: session.userId,
                        thumbnail: session.thumbnailUrl || '',
                        onClick: () => navigate(`/viewer/${session.sessionId}`),
                      })),
                    ]}
                    onCreateStory={() => setShowStoryCreator(true)}
                    createLabel="Add Story"
                    onStoryView={(index) => {
                      if (index < storyUsers.length) {
                        setStoryViewerStartIndex(index);
                        setStoryViewerOpen(true);
                      }
                      // Live broadcasts use their own onClick handler
                    }}
                  />
                </div>
              );
            })()}
            <RecordingSlider sessions={sessions} />
            <ActivityFeed
              sessions={sessions}
              onLoadMore={loadMore}
              hasMore={hasMore}
              loadingMore={loadingMore}
            />
          </>
        )}
      </div>

      {/* Story Viewer */}
      <StoryViewer
        isOpen={storyViewerOpen}
        onClose={() => setStoryViewerOpen(false)}
        users={storyUsers.map(group => ({
          id: group.userId,
          name: group.userId,
          timestamp: formatRelativeTime(group.stories[0]?.createdAt),
        }))}
        initialUserIndex={storyViewerStartIndex}
        getSegments={(userId) => {
          const group = storyUsers.find(g => g.userId === userId);
          if (!group) return [];
          return group.stories.flatMap(story =>
            story.segments.map(seg => ({
              id: seg.segmentId,
              type: seg.type as 'image' | 'video',
              src: seg.url,
              duration: seg.duration,
            }))
          );
        }}
        onReact={(userId, segmentId, emoji) => {
          const group = storyUsers.find(g => g.userId === userId);
          const story = group?.stories[0];
          if (story) reactToStory(story.sessionId, segmentId, emoji);
        }}
        onReply={(userId, segmentId, message) => {
          const group = storyUsers.find(g => g.userId === userId);
          const story = group?.stories[0];
          if (story) replyToStory(story.sessionId, segmentId, message);
        }}
      />

      {/* Story Creator */}
      <StoryCreator
        isOpen={showStoryCreator}
        onClose={() => setShowStoryCreator(false)}
        onPublished={() => {
          setShowStoryCreator(false);
          refreshStories();
        }}
      />

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 animate-backdrop-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowUploadModal(false); }}
        >
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 max-w-md w-full sm:mx-4 animate-dialog-in shadow-2xl">
            <VideoUploadForm
              authToken={authToken}
              onClose={() => setShowUploadModal(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
