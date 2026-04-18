/**
 * LobbyPanel — shown to the host of a HANGOUT session with requireApproval=true.
 * Lists pending join requests and lets the host Approve/Deny each.
 *
 * Polls GET /sessions/{id}/lobby every 5s, and also listens to `lobby_update`
 * chat events for immediate updates.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';

interface LobbyRequest {
  sessionId: string;
  userId: string;
  displayName: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied';
}

interface LobbyPanelProps {
  sessionId: string;
  authToken: string;
  apiBaseUrl: string;
  room?: ChatRoom;
}

export function LobbyPanel({ sessionId, authToken, apiBaseUrl, room }: LobbyPanelProps) {
  const [requests, setRequests] = useState<LobbyRequest[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/lobby`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      /* ignore — polling loop will retry */
    }
  }, [sessionId, authToken, apiBaseUrl]);

  // Initial fetch + 5s polling
  useEffect(() => {
    fetchRequests();
    const id = window.setInterval(fetchRequests, 5000);
    return () => window.clearInterval(id);
  }, [fetchRequests]);

  // Chat event listener for instant updates
  useEffect(() => {
    if (!room) return;
    const handler = (event: any) => {
      if (event.eventName === 'lobby_update') {
        fetchRequests();
      }
    };
    const unsubscribe = room.addListener('event', handler);
    return unsubscribe;
  }, [room, fetchRequests]);

  const approve = async (userId: string) => {
    setBusyUserId(userId);
    try {
      await fetch(`${apiBaseUrl}/sessions/${sessionId}/lobby/${encodeURIComponent(userId)}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setRequests(prev => prev.filter(r => r.userId !== userId));
    } catch (err) {
      console.error('Failed to approve lobby request:', err);
    } finally {
      setBusyUserId(null);
    }
  };

  const deny = async (userId: string) => {
    setBusyUserId(userId);
    try {
      await fetch(`${apiBaseUrl}/sessions/${sessionId}/lobby/${encodeURIComponent(userId)}/deny`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setRequests(prev => prev.filter(r => r.userId !== userId));
    } catch (err) {
      console.error('Failed to deny lobby request:', err);
    } finally {
      setBusyUserId(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-30 w-72 bg-gray-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-700/50 text-white">
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2">
        <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
        <h3 className="text-sm font-semibold">Join requests ({requests.length})</h3>
      </div>
      <ul className="max-h-80 overflow-y-auto divide-y divide-gray-800">
        {requests.map(req => (
          <li key={req.userId} className="px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-violet-500/30 flex items-center justify-center text-xs font-bold shrink-0">
              {(req.displayName || req.userId).slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{req.displayName || req.userId}</div>
              <div className="text-xs text-gray-500">wants to join</div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => approve(req.userId)}
                disabled={busyUserId === req.userId}
                className="px-2.5 py-1 text-xs font-semibold rounded-md bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => deny(req.userId)}
                disabled={busyUserId === req.userId}
                className="px-2.5 py-1 text-xs font-semibold rounded-md bg-gray-700 hover:bg-red-600 active:bg-red-700 disabled:opacity-50 transition-colors"
              >
                Deny
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
