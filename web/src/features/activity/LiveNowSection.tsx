import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../../components/social';

interface LiveSession {
  sessionId: string;
  userId: string;
  sessionType: 'BROADCAST' | 'HANGOUT';
  createdAt: string;
  participantCount: number;
  messageCount: number;
  thumbnailUrl: string | null;
  isPrivate: boolean;
}

interface LiveNowSectionProps {
  authToken: string;
  apiBaseUrl: string;
}

export function LiveNowSection({ authToken, apiBaseUrl }: LiveNowSectionProps) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<LiveSession[]>([]);

  const fetchLive = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/sessions/live`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      // silently ignore — section just won't show
    }
  }, [authToken, apiBaseUrl]);

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 10_000);
    return () => clearInterval(interval);
  }, [fetchLive]);

  if (sessions.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </span>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">
          Live Now
        </h2>
      </div>

      {/* Scrollable strip */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory md:flex-wrap md:overflow-x-visible md:pb-0">
        {sessions.map((session) => (
          <LiveCard key={session.sessionId} session={session} navigate={navigate} />
        ))}
      </div>
    </div>
  );
}

function LiveCard({
  session,
  navigate,
}: {
  session: LiveSession;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const isBroadcast = session.sessionType === 'BROADCAST';

  const handleClick = () => {
    if (isBroadcast) {
      navigate(`/viewer/${session.sessionId}`);
    } else {
      navigate(`/hangout/${session.sessionId}`);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`
        group relative flex-shrink-0 snap-start w-[180px] rounded-2xl overflow-hidden
        transition-all duration-300 hover:scale-[1.03] hover:shadow-xl
        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        ${isBroadcast
          ? 'bg-gradient-to-br from-red-500 via-pink-500 to-rose-600 focus-visible:ring-red-400'
          : 'bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 focus-visible:ring-violet-400'
        }
      `}
      style={{ aspectRatio: '4/5' }}
    >
      {/* Animated glow border */}
      <span
        className={`
          pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500
          ${isBroadcast
            ? 'shadow-[inset_0_0_20px_rgba(255,100,100,0.3)]'
            : 'shadow-[inset_0_0_20px_rgba(167,139,250,0.3)]'
          }
        `}
      />

      {/* Pulse ring */}
      <span
        className={`
          pointer-events-none absolute -inset-[1px] rounded-2xl
          animate-[pulse_2s_ease-in-out_infinite]
          ${isBroadcast ? 'ring-1 ring-red-300/40' : 'ring-1 ring-violet-300/40'}
        `}
      />

      <div className="relative flex flex-col items-center justify-center h-full px-4 py-5 text-white">
        {/* Type badge */}
        <span
          className={`
            text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full mb-3
            ${isBroadcast ? 'bg-white/20 backdrop-blur-sm' : 'bg-white/20 backdrop-blur-sm'}
          `}
        >
          {isBroadcast ? 'LIVE' : 'HANGOUT'}
        </span>

        {/* Avatar */}
        <Avatar name={session.userId} alt={session.userId} size="lg" isOnline />

        {/* Username */}
        <span className="mt-2.5 text-sm font-semibold truncate max-w-full">
          {session.userId}
        </span>

        {/* Participant count for hangouts */}
        {!isBroadcast && (
          <span className="mt-1 text-xs text-white/70 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            {session.participantCount || 1} {(session.participantCount || 1) === 1 ? 'person' : 'people'}
          </span>
        )}

        {/* CTA button */}
        <span
          className={`
            mt-auto text-xs font-bold uppercase tracking-wider px-5 py-1.5 rounded-full
            transition-all duration-200
            ${isBroadcast
              ? 'bg-white text-red-600 group-hover:bg-white/90 group-hover:shadow-lg'
              : 'bg-white text-violet-600 group-hover:bg-white/90 group-hover:shadow-lg'
            }
          `}
        >
          {isBroadcast ? 'Watch' : 'Join'}
        </span>
      </div>
    </button>
  );
}
