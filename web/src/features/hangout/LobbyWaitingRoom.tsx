/**
 * LobbyWaitingRoom — shown to a non-host user whose join request is pending
 * host approval. Polls GET /sessions/{id}/lobby as a fallback and also listens
 * for `lobby_update` chat events (action='approved' or 'denied').
 *
 * On approval: calls onApproved(newToken) so HangoutPage can swap the pending
 * SUBSCRIBE-only token for the upgraded PUBLISH+SUBSCRIBE token and re-join.
 *
 * On denial: calls onDenied() so HangoutPage can navigate away.
 */

import { useEffect, useState } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import { Card } from '../../components/social';

interface LobbyWaitingRoomProps {
  sessionId: string;
  userId: string;
  authToken: string;
  apiBaseUrl: string;
  room?: ChatRoom;
  /** Called when the host approves. The new token has PUBLISH+SUBSCRIBE caps. */
  onApproved: (token: string, participantId: string) => void;
  /** Called when the host denies. */
  onDenied: () => void;
  /** Called when the user clicks cancel. */
  onCancel: () => void;
}

export function LobbyWaitingRoom({
  sessionId,
  userId,
  authToken,
  apiBaseUrl,
  room,
  onApproved,
  onDenied,
  onCancel,
}: LobbyWaitingRoomProps) {
  const [elapsedSec, setElapsedSec] = useState(0);

  // Tick a simple elapsed counter
  useEffect(() => {
    const id = window.setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Listen for lobby_update chat events (primary signalling path)
  useEffect(() => {
    if (!room) return;
    const handleEvent = (event: any) => {
      if (event.eventName !== 'lobby_update') return;
      const evtUserId = event.attributes?.userId;
      const action = event.attributes?.action;
      if (evtUserId !== userId) return;
      if (action === 'approved') {
        // The re-joining happens via a fresh POST /join on the client side —
        // the approve endpoint's token is delivered through this path rather
        // than through the chat event (which has no token attribute for security).
        // Re-poll the lobby row to confirm status, then trigger onApproved.
        // For simplicity, we just call a fresh /join which will now return a
        // PUBLISH+SUBSCRIBE token because the lobby row is now 'approved'.
        (async () => {
          try {
            const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/join`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            });
            if (res.ok) {
              const data = await res.json();
              if (data.status === 'joined' && data.token) {
                onApproved(data.token, data.participantId);
              }
            }
          } catch {
            /* ignore — polling loop below will retry */
          }
        })();
      } else if (action === 'denied') {
        onDenied();
      }
    };
    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, userId, sessionId, apiBaseUrl, authToken, onApproved, onDenied]);

  // Fallback polling — in case the chat event is missed
  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    const poll = async () => {
      try {
        // Re-request a /join — the backend will return either 'pending' (still waiting)
        // or 'joined' (the lobby row was flipped to 'approved' during the race window).
        // This is a conservative poll in case the chat event is dropped.
        const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/join`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (data.status === 'joined' && data.token) {
          onApproved(data.token, data.participantId);
        }
      } catch {
        /* ignore — will retry next tick */
      }
    };
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, apiBaseUrl, authToken, onApproved]);

  const mm = Math.floor(elapsedSec / 60);
  const ss = (elapsedSec % 60).toString().padStart(2, '0');

  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gray-900 text-white shadow-2xl">
        <Card.Body className="text-center p-8">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-violet-400 animate-pulse" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-1">Waiting for host approval</h2>
          <p className="text-sm text-gray-400 mb-4">
            The host has been notified of your request to join.
          </p>
          <p className="text-xs text-gray-500 mb-6">
            Waiting {mm}:{ss}
          </p>
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </Card.Body>
      </Card>
    </div>
  );
}
