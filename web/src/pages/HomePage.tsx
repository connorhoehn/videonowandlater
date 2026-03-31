import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchToken } from '../auth/fetchToken';
import { useAuth } from '../auth/useAuth';
import { getConfig } from '../config/aws-config';
import { RecordingSlider, type ActivitySession } from '../features/activity/RecordingSlider';
import { LiveBroadcastsSlider } from '../features/activity/LiveBroadcastsSlider';
import { ActivityFeed } from '../features/activity/ActivityFeed';
import { VideoUploadForm } from '../features/upload/VideoUploadForm';

function hasNonTerminalSessions(sessions: ActivitySession[]): boolean {
  return sessions.some(
    (s) =>
      s.transcriptStatus === 'processing' ||
      s.transcriptStatus === 'pending' ||
      s.aiSummaryStatus === 'pending' ||
      s.convertStatus === 'processing' ||
      s.convertStatus === 'pending',
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingHangout, setIsCreatingHangout] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState(15000);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevHasNonTerminalRef = useRef(false);

  useEffect(() => {
    const fetchActivity = async () => {
      const config = getConfig();
      if (!config?.apiUrl) {
        setLoadingActivity(false);
        return;
      }
      try {
        const response = await fetch(`${config.apiUrl}/activity`);
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        setSessions(data.sessions || []);
      } catch (err) {
        console.error('Error fetching activity:', err);
      } finally {
        setLoadingActivity(false);
      }
    };
    fetchActivity();
  }, []);

  useEffect(() => {
    const nonTerminal = hasNonTerminalSessions(sessions);

    // Reset poll interval when transitioning from all-terminal to having non-terminal sessions
    if (nonTerminal && !prevHasNonTerminalRef.current) {
      setPollInterval(15000);
    }
    prevHasNonTerminalRef.current = nonTerminal;

    if (!nonTerminal) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const intervalId = setInterval(async () => {
      const config = getConfig();
      if (!config?.apiUrl) return;
      try {
        const response = await fetch(`${config.apiUrl}/activity`);
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        setSessions(data.sessions || []);
      } catch (err) {
        console.error('Error polling activity:', err);
      }
      setPollInterval(prev => Math.min(prev * 2, 60000));
    }, pollInterval);

    pollIntervalRef.current = intervalId;

    return () => {
      clearInterval(intervalId);
      pollIntervalRef.current = null;
    };
  }, [sessions, pollInterval]);

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

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

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
    <div className="min-h-screen bg-gray-50 animate-page-enter">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
          {/* Brand */}
          <span className="font-semibold text-gray-900 tracking-tight text-sm select-none">
            videonow
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCreateBroadcast}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500 text-white hover:bg-red-600 active:scale-[0.96] transition-all duration-150 disabled:opacity-50 disabled:active:scale-100 shadow-sm shadow-red-500/20"
            >
              {isCreating ? (
                <svg className="branded-spinner w-3 h-3" viewBox="0 0 50 50">
                  <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="6" />
                </svg>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse" />
              )}
              {isCreating ? 'Creating' : 'Go Live'}
            </button>
            <button
              onClick={handleCreateHangout}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.96] transition-all duration-150 disabled:opacity-50 disabled:active:scale-100 shadow-sm shadow-violet-600/20"
            >
              {isCreatingHangout ? (
                <>
                  <svg className="branded-spinner w-3 h-3" viewBox="0 0 50 50">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="6" />
                  </svg>
                  Creating
                </>
              ) : 'Hangout'}
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-600 text-white hover:bg-green-700 active:scale-[0.96] transition-all duration-150 disabled:opacity-50 disabled:active:scale-100 shadow-sm shadow-green-600/20"
            >
              Upload
            </button>
          </div>

          {/* User */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block truncate max-w-[100px]">
              {user?.username}
            </span>
            <button
              onClick={handleSignOut}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 pb-2 animate-fade-in">
            <div className="max-w-2xl mx-auto flex items-center justify-center gap-1.5 text-xs text-red-500">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          </div>
        )}
      </header>

      {/* Feed */}
      <main>
        {loadingActivity ? (
          <>
            {/* Skeleton for recording slider */}
            <div className="border-b border-gray-100">
              <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
                <div className="animate-shimmer h-4 w-28 rounded mb-4" />
                <div className="flex gap-4 overflow-hidden">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex-shrink-0 w-56 rounded-xl overflow-hidden">
                      <div className="animate-shimmer aspect-video rounded-t-xl" />
                      <div className="p-3 bg-white">
                        <div className="animate-shimmer h-3 w-24 rounded mb-2" />
                        <div className="animate-shimmer h-3 w-16 rounded" />
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
            <LiveBroadcastsSlider sessions={sessions} />
            <RecordingSlider sessions={sessions} />
            <ActivityFeed sessions={sessions} />
          </>
        )}
      </main>

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
    </div>
  );
}
