import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchToken } from '../auth/fetchToken';
import { useAuth } from '../auth/useAuth';
import { getConfig } from '../config/aws-config';
import { ActivityFeed } from '../features/activity/ActivityFeed';
import { VideoUploadForm } from '../features/upload/VideoUploadForm';
import { CreatePostCard } from '../components/social/CreatePostCard';
import { CameraIcon, UsersIcon, UploadIcon, PhotoIcon } from '../components/social/Icons';
import { StoriesSlider, StoryViewer, StoryCreator, Skeleton, TabNav, SearchInput, type Tab } from '../components/social';
import { useActivityData } from '../hooks/useActivityData';
import { useActiveAd } from '../hooks/useActiveAd';
import { useStories } from '../hooks/useStories';
import { useStoryViewState } from '../hooks/useStoryViewState';
import { SessionCardGrid } from '../features/common/SessionCard';
import { useFeed, type FeedTab } from '../features/common/useDiscovery';

/** Build an ISO string for an input[type=datetime-local] value ('YYYY-MM-DDTHH:MM'). */
function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

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
  const { storyUsers, reactToStory, replyToStory, refresh: refreshStories } = useStories();
  const { ad: activeAd } = useActiveAd();
  const [sponsoredOpen, setSponsoredOpen] = useState(false);
  useStoryViewState();
  const [, setIsCreating] = useState(false);
  const [isCreatingHangout, setIsCreatingHangout] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  // Phase 4: Hangout moderation configuration
  const [showHangoutOptions, setShowHangoutOptions] = useState(false);
  const [availableRulesets, setAvailableRulesets] = useState<Array<{ name: string; severity: string }>>([]);
  const [modEnabled, setModEnabled] = useState(false);
  const [modRulesetName, setModRulesetName] = useState<string>('hangout');
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  const [storyViewerStartIndex, setStoryViewerStartIndex] = useState(0);
  const [showStoryCreator, setShowStoryCreator] = useState(false);
  const [error, setError] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  // Phase 2: Hangout lobby options
  const [requireApproval, setRequireApproval] = useState(false);
  // Live captions (beta) — opt-in flag for both BROADCAST and HANGOUT creation
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  // Phase 2: Discovery tabs — tabs switch between /feed partitions.
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<FeedTab>('live');
  const { items: feedItems, loading: feedLoading, error: feedError } = useFeed(activeTab);
  const discoveryTabs = useMemo<Tab[]>(() => {
    const t: Tab[] = [
      { id: 'live', label: 'Live now' },
      { id: 'upcoming', label: 'Upcoming' },
      { id: 'recent', label: 'Recent' },
    ];
    if (isAuthenticated) t.push({ id: 'following', label: 'Following' });
    return t;
  }, [isAuthenticated]);

  // Phase 5: Scheduled events (Facebook/Meetup-style)
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleSessionType, setScheduleSessionType] = useState<'BROADCAST' | 'HANGOUT'>('BROADCAST');
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleDescription, setScheduleDescription] = useState('');
  const [scheduleWhen, setScheduleWhen] = useState('');
  const [scheduling, setScheduling] = useState(false);

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
        body: JSON.stringify({ sessionType: 'BROADCAST', captionsEnabled }),
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

  // Phase 4: open the Hangout options modal. Fetches admin rulesets so the user
  // can opt into moderation at session-create time. Falls back silently if the
  // list endpoint is unreachable (non-admins get 403) — users can still create
  // a plain hangout.
  const handleOpenHangout = async () => {
    setShowHangoutOptions(true);
    const config = getConfig();
    if (!config?.apiUrl || !authToken) return;
    try {
      const resp = await fetch(`${config.apiUrl}/admin/rulesets`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as { rulesets: Array<{ name: string; severity: string }> };
        setAvailableRulesets(data.rulesets);
      }
    } catch { /* non-blocking */ }
  };

  const confirmSchedule = async () => {
    const config = getConfig();
    if (!config?.apiUrl || !scheduleWhen || !scheduleTitle) return;
    setScheduling(true);
    setError('');
    try {
      const { token: authToken } = await fetchToken();
      const scheduledFor = datetimeLocalToIso(scheduleWhen);
      // Client-side validation: must be >= 15min in the future
      if (new Date(scheduledFor).getTime() - Date.now() < 15 * 60 * 1000) {
        setError('Schedule must be at least 15 minutes in the future.');
        setScheduling(false);
        return;
      }
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionType: scheduleSessionType,
          scheduledFor,
          title: scheduleTitle,
          description: scheduleDescription,
        }),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const sessionData = await response.json();
      setShowScheduleModal(false);
      setScheduleTitle('');
      setScheduleDescription('');
      setScheduleWhen('');
      navigate(`/events/${sessionData.sessionId}`);
    } catch {
      setError('Failed to schedule event. Try again.');
    } finally {
      setScheduling(false);
    }
  };

  const confirmCreateHangout = async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    setIsCreatingHangout(true);
    setError('');
    setShowHangoutOptions(false);
    try {
      const { token: authToken } = await fetchToken();
      const body: Record<string, unknown> = { sessionType: 'HANGOUT', requireApproval, captionsEnabled };
      if (modEnabled && modRulesetName) {
        body.moderationEnabled = true;
        body.rulesetName = modRulesetName;
      }
      const response = await fetch(`${config.apiUrl}/sessions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const sessionData = await response.json();
      setShowHangoutOptions(false);
      navigate(`/hangout/${sessionData.sessionId}`, { state: { session: sessionData } });
    } catch {
      setError('Failed to create session. Try again.');
    } finally {
      setIsCreatingHangout(false);
    }
  };

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
            { label: 'Go Live', icon: <CameraIcon size={16} />, color: 'text-red-500', onClick: handleCreateBroadcast, loading: isCreating, loadingLabel: 'Starting…', disabled: isCreating || isCreatingHangout },
            { label: 'Hangout', icon: <UsersIcon size={16} />, color: 'text-violet-600', onClick: handleOpenHangout, loading: isCreatingHangout, loadingLabel: 'Starting…', disabled: isCreating || isCreatingHangout },
            { label: 'Schedule', icon: <CameraIcon size={16} />, color: 'text-blue-600', onClick: () => setShowScheduleModal(true) },
            { label: 'Story', icon: <PhotoIcon size={16} />, color: 'text-orange-500', onClick: () => setShowStoryCreator(true) },
            { label: 'Upload', icon: <UploadIcon size={16} />, color: 'text-green-600', onClick: () => setShowUploadModal(true) },
          ]}
        />

        {/* Stories + "Add Story" sit above the search area so users can post a story
            without scrolling past the feed. */}
        {(() => {
          const recordings = sessions.filter(
            (s) => (s.sessionType === 'BROADCAST' || s.sessionType === 'UPLOAD') &&
              s.recordingStatus === 'available' && s.recordingHlsUrl
          );
          return (
            <div className="mb-4">
              <StoriesSlider
                stories={[
                  ...(activeAd ? [{
                    id: `ad:${activeAd.id}`,
                    name: 'Sponsored',
                    thumbnail: activeAd.thumbnailUrl || activeAd.mediaUrl,
                    onClick: () => setSponsoredOpen(true),
                  }] : []),
                  ...storyUsers.map(group => ({
                    id: group.userId,
                    name: group.userId,
                    thumbnail: group.stories[0]?.segments?.[0]?.url || '',
                  })),
                  ...recordings.map(session => ({
                    id: session.sessionId,
                    name: session.userId,
                    thumbnail: session.thumbnailUrl || session.posterFrameUrl || '',
                    onClick: () => navigate(`/replay/${session.sessionId}`),
                  })),
                ]}
                onCreateStory={() => setShowStoryCreator(true)}
                createLabel="Add Story"
                onStoryView={(index) => {
                  // The ad (if present) is rendered at index 0 via its own onClick,
                  // so StoriesSlider's onStoryView is only called for real user stories.
                  // Account for the ad occupying index 0 by shifting into storyUsers.
                  const adOffset = activeAd ? 1 : 0;
                  const storyIndex = index - adOffset;
                  if (storyIndex >= 0 && storyIndex < storyUsers.length) {
                    setStoryViewerStartIndex(storyIndex);
                    setStoryViewerOpen(true);
                  }
                }}
              />
            </div>
          );
        })()}

        {/* Phase 2: Discovery — search + tabbed feed */}
        <section className="bg-white dark:bg-gray-800 rounded-xl p-4 space-y-3">
          <SearchInput
            placeholder="Search sessions, creators, tags..."
            onSubmit={(q) => {
              const t = q.trim();
              if (t) navigate(`/search?q=${encodeURIComponent(t)}`);
            }}
          />
          <TabNav
            tabs={discoveryTabs}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as FeedTab)}
            variant="underline"
          />
          {feedError ? (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">{feedError}</div>
          ) : (
            <SessionCardGrid
              items={feedItems}
              loading={feedLoading}
              emptyMessage={
                activeTab === 'upcoming'
                  ? 'No scheduled sessions yet.'
                  : activeTab === 'following'
                  ? 'Nobody you follow is live right now.'
                  : 'Nothing here yet.'
              }
            />
          )}
        </section>

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
          <ActivityFeed
            sessions={sessions}
            onLoadMore={loadMore}
            hasMore={hasMore}
            loadingMore={loadingMore}
          />
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
            (story.segments || []).map(seg => ({
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

      {/* Phase 5: Schedule Event Modal */}
      {showScheduleModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowScheduleModal(false); }}
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl space-y-3">
            <h2 className="text-lg font-bold">Schedule an event</h2>
            <p className="text-xs text-gray-500">
              Create an event people can RSVP to. You can go live when it's time to start.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Event type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleSessionType('BROADCAST')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${
                    scheduleSessionType === 'BROADCAST'
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Broadcast
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleSessionType('HANGOUT')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium ${
                    scheduleSessionType === 'HANGOUT'
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Hangout
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={scheduleTitle}
                onChange={(e) => setScheduleTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm"
                placeholder="Weekly Q&A"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={scheduleDescription}
                onChange={(e) => setScheduleDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Starts at</label>
              <input
                type="datetime-local"
                value={scheduleWhen}
                onChange={(e) => setScheduleWhen(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm"
              />
              <div className="text-[11px] text-gray-500 mt-1">Must be at least 15 minutes in the future.</div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmSchedule}
                disabled={!scheduleTitle || !scheduleWhen || scheduling}
                className="px-5 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              >
                {scheduling ? 'Scheduling...' : 'Schedule Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 4: Hangout Options Modal (moderation toggle + ruleset picker) */}
      {showHangoutOptions && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 animate-backdrop-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowHangoutOptions(false); }}
        >
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 max-w-md w-full sm:mx-4 animate-dialog-in shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Start Hangout</h3>
            <label className="flex items-start gap-3 mb-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">Require host approval</span>
                <span className="block text-xs text-gray-500">
                  Non-host participants wait in a lobby until you approve them.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 mb-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={modEnabled}
                onChange={(e) => setModEnabled(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">Enable image moderation</span>
                <span className="block text-xs text-gray-500">
                  Captures a frame every 10s and runs it through a Nova Lite classifier.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 mb-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={captionsEnabled}
                onChange={(e) => setCaptionsEnabled(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">Enable live captions (beta)</span>
                <span className="block text-xs text-gray-500">
                  Real-time closed captions shown to all participants. Off by default.
                </span>
              </span>
            </label>
            {modEnabled && (
              <div className="mb-4 ml-7">
                <label className="block text-xs font-medium text-gray-700 mb-1">Ruleset</label>
                <select
                  className="w-full px-3 py-2 rounded-md border border-gray-300 bg-white text-sm text-gray-900"
                  value={modRulesetName}
                  onChange={(e) => setModRulesetName(e.target.value)}
                >
                  {availableRulesets.length === 0 ? (
                    <>
                      <option value="hangout">hangout</option>
                      <option value="classroom">classroom</option>
                      <option value="broadcast">broadcast</option>
                    </>
                  ) : (
                    availableRulesets.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name} ({r.severity})
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setShowHangoutOptions(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-50"
                onClick={confirmCreateHangout}
                disabled={isCreatingHangout}
              >
                {isCreatingHangout ? 'Starting…' : 'Start'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sponsored story viewer — full-screen playback of the active ad. */}
      {sponsoredOpen && activeAd && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={() => setSponsoredOpen(false)}
        >
          <div className="relative w-full h-full sm:w-auto sm:h-[90vh] sm:aspect-[9/16] sm:rounded-xl sm:overflow-hidden flex items-center justify-center">
            {activeAd.thumbnailUrl && (
              <img
                src={activeAd.thumbnailUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            <video
              src={activeAd.mediaUrl}
              poster={activeAd.thumbnailUrl}
              autoPlay
              playsInline
              muted
              onEnded={() => setSponsoredOpen(false)}
              className="relative w-full h-full object-cover"
            />
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-white/90 text-black rounded">
                Sponsored
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSponsoredOpen(false); }}
                className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="absolute bottom-4 left-4 right-4 text-center">
              <p className="text-sm text-white/90 font-medium">{activeAd.label}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
