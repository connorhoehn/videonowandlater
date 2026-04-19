/**
 * EventPage — /events/:sessionId
 *
 * Phase 5: scheduled sessions. Public-ish event page with:
 *   - Hero (title, host, countdown, cover image)
 *   - RSVP buttons (Going / Interested / Not going)
 *   - RSVP count
 *   - Add-to-calendar ICS download
 *   - Owner-only "Go Live" (once scheduledFor has passed) → navigates to broadcast/hangout
 *   - "Join" button when the session is already LIVE/ENDING
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
import { useAuth } from '../../auth/useAuth';
import { getConfig } from '../../config/aws-config';

type RsvpStatus = 'going' | 'interested' | null;

interface SessionDto {
  sessionId: string;
  userId: string;
  sessionType: 'BROADCAST' | 'HANGOUT' | 'UPLOAD' | 'STORY';
  status: string;
  scheduledFor?: string;
  scheduledEndsAt?: string;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  rsvpGoingCount?: number;
  rsvpInterestedCount?: number;
}

interface Attendee {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  status: string;
}

function formatCountdown(targetIso?: string): string {
  if (!targetIso) return '';
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return 'Starting now';
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function EventPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [session, setSession] = useState<SessionDto | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [goingCount, setGoingCount] = useState(0);
  const [interestedCount, setInterestedCount] = useState(0);
  const [myRsvp, setMyRsvp] = useState<RsvpStatus>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  // Tick every 30s to refresh countdown / owner-can-go-live gate
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const loadSession = useCallback(async () => {
    const config = getConfig();
    if (!config?.apiUrl || !sessionId) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await fetchToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const [sResp, rResp] = await Promise.all([
        fetch(`${config.apiUrl}/sessions/${sessionId}`, { headers }),
        fetch(`${config.apiUrl}/sessions/${sessionId}/rsvps?limit=50`, { headers }),
      ]);

      if (!sResp.ok) throw new Error(`Session fetch failed: ${sResp.status}`);
      const s = (await sResp.json()) as SessionDto;
      setSession(s);

      if (rResp.ok) {
        const r = await rResp.json();
        setAttendees(r.attendees ?? []);
        setGoingCount(r.going ?? 0);
        setInterestedCount(r.interested ?? 0);
        if (user?.username) {
          const mine = (r.attendees ?? []).find((a: Attendee) => a.userId === user.username);
          setMyRsvp((mine?.status as RsvpStatus) ?? null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, user?.username]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const setRsvp = async (status: 'going' | 'interested' | null) => {
    const config = getConfig();
    if (!config?.apiUrl || !sessionId) return;
    try {
      const { token } = await fetchToken();
      const url = `${config.apiUrl}/sessions/${sessionId}/rsvp`;
      if (status === null) {
        await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
      }
      setMyRsvp(status);
      await loadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadIcs = async () => {
    const config = getConfig();
    if (!config?.apiUrl || !sessionId) return;
    window.open(`${config.apiUrl}/sessions/${sessionId}/ics`, '_blank');
  };

  const goLive = async () => {
    const config = getConfig();
    if (!config?.apiUrl || !sessionId || !session) return;
    try {
      const { token } = await fetchToken();
      const resp = await fetch(`${config.apiUrl}/sessions/${sessionId}/go-live`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`Go-live failed: ${resp.status}`);
      const data = await resp.json();
      const dest = session.sessionType === 'HANGOUT'
        ? `/hangout/${sessionId}`
        : `/broadcast/${sessionId}`;
      navigate(dest, { state: { session: data } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-gray-500">Loading event...</div>
    );
  }
  if (!session) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-gray-500">
        Event not found. {error && <div className="text-red-500 text-sm mt-2">{error}</div>}
      </div>
    );
  }

  const isOwner = user?.username === session.userId;
  const isScheduled = session.status === 'scheduled';
  const isLive = session.status === 'live' || session.status === 'ending';
  const scheduledMs = session.scheduledFor ? new Date(session.scheduledFor).getTime() : 0;
  const canGoLive = isOwner && isScheduled && scheduledMs <= Date.now();
  // tick used to recompute canGoLive on a timer
  void tick;

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      {/* Hero */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white shadow-sm">
        {session.coverImageUrl ? (
          <img
            src={session.coverImageUrl}
            alt={session.title ?? 'Event cover'}
            className="w-full h-56 object-cover"
          />
        ) : (
          <div className="w-full h-56 bg-gradient-to-br from-violet-500 to-indigo-600" />
        )}
        <div className="p-5 space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">{session.title ?? 'Untitled Event'}</h1>
          <div className="text-sm text-gray-500">
            Hosted by <span className="font-medium text-gray-700">{session.userId}</span>
          </div>
          {isScheduled && session.scheduledFor && (
            <div className="text-sm text-gray-700">
              Starts in <span className="font-semibold">{formatCountdown(session.scheduledFor)}</span>
              {' · '}
              <span>{new Date(session.scheduledFor).toLocaleString()}</span>
            </div>
          )}
          {session.description && (
            <p className="text-sm text-gray-600 whitespace-pre-line pt-2">{session.description}</p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {isLive && (
          <button
            onClick={() => navigate(
              session.sessionType === 'HANGOUT'
                ? `/hangout/${session.sessionId}`
                : `/viewer/${session.sessionId}`,
            )}
            className="px-5 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-500"
          >
            Join Live
          </button>
        )}
        {canGoLive && (
          <button
            onClick={goLive}
            className="px-5 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-500"
          >
            Go Live
          </button>
        )}
        {isScheduled && (
          <>
            <button
              onClick={() => setRsvp('going')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                myRsvp === 'going'
                  ? 'bg-violet-600 text-white hover:bg-violet-500'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Going
            </button>
            <button
              onClick={() => setRsvp('interested')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                myRsvp === 'interested'
                  ? 'bg-violet-600 text-white hover:bg-violet-500'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Interested
            </button>
            {myRsvp && (
              <button
                onClick={() => setRsvp(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                Not going
              </button>
            )}
            <button
              onClick={downloadIcs}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-800 hover:bg-gray-50"
            >
              Add to calendar
            </button>
          </>
        )}
      </div>

      {/* RSVP counts */}
      {isScheduled && (
        <div className="text-sm text-gray-600">
          <span className="font-semibold">{goingCount}</span> going ·{' '}
          <span className="font-semibold">{interestedCount}</span> interested
        </div>
      )}

      {/* Attendees */}
      {attendees.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Attendees</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
            {attendees.map((a) => (
              <li key={a.userId} className="flex items-center gap-3 px-4 py-2">
                <div className="w-8 h-8 rounded-full bg-gray-200 text-xs font-bold flex items-center justify-center text-gray-600">
                  {a.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 text-sm text-gray-900">{a.displayName}</div>
                <span className="text-xs text-gray-500 capitalize">{a.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
