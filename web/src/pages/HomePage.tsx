import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
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
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() || null;
        setAuthToken(token);
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
      const session = await fetchAuthSession();
      const authToken = session.tokens?.idToken?.toString() || '';
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
      const session = await fetchAuthSession();
      const authToken = session.tokens?.idToken?.toString() || '';
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
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
          {/* Brand */}
          <span className="font-semibold text-gray-900 tracking-tight text-sm select-none">
            videonow
          </span>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateBroadcast}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: '#ef4444', color: 'white' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse" />
              {isCreating ? 'Creating…' : 'Go Live'}
            </button>
            <button
              onClick={handleCreateHangout}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: '#7c3aed', color: 'white' }}
            >
              {isCreatingHangout ? 'Creating…' : 'Hangout'}
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-50"
              style={{ background: '#16a34a', color: 'white' }}
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
          <div className="px-4 pb-2 text-xs text-red-500 text-center">{error}</div>
        )}
      </header>

      {/* Feed */}
      <main>
        {loadingActivity ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
          </div>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
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
