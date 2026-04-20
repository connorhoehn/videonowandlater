/**
 * useLivePolls — listens for poll-created / poll-vote / poll-closed events on
 * the IVS chat room and maintains a local poll state that mirrors the server.
 *
 * Creators and viewers both subscribe to this. The backend emits events on
 * create / vote / close, so every client converges without polling.
 *
 * Initial state is seeded from `GET /sessions/:id/polls` on mount.
 */

import { useEffect, useState, useCallback } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import type { Poll, PollOption } from './types';

interface Args {
  room: ChatRoom | undefined;
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
}

export function useLivePolls({ room, sessionId, apiBaseUrl, authToken }: Args) {
  const [polls, setPolls] = useState<Poll[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId || !apiBaseUrl || !authToken) return;
    try {
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/polls`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { polls: Poll[] };
      setPolls(data.polls ?? []);
    } catch {
      // non-blocking
    }
  }, [sessionId, apiBaseUrl, authToken]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!room) return;
    const handleEvent = (event: any) => {
      const a = event?.attributes ?? {};
      if (event?.eventName === 'poll-created') {
        let options: PollOption[] = [];
        try { options = JSON.parse(a.options ?? '[]'); } catch {}
        const newPoll: Poll = {
          pollId: a.pollId,
          sessionId,
          createdBy: '',
          question: a.question ?? '',
          options,
          voteCounts: Object.fromEntries(options.map((o) => [o.id, 0])),
          totalVotes: 0,
          status: 'open',
          createdAt: a.createdAt ?? new Date().toISOString(),
        };
        setPolls((prev) => (prev.some((p) => p.pollId === newPoll.pollId) ? prev : [newPoll, ...prev]));
      } else if (event?.eventName === 'poll-vote') {
        let voteCounts: Record<string, number> = {};
        try { voteCounts = JSON.parse(a.voteCounts ?? '{}'); } catch {}
        const totalVotes = parseInt(a.totalVotes ?? '0', 10) || 0;
        setPolls((prev) => prev.map((p) => p.pollId === a.pollId ? { ...p, voteCounts, totalVotes } : p));
      } else if (event?.eventName === 'poll-closed') {
        let voteCounts: Record<string, number> = {};
        try { voteCounts = JSON.parse(a.voteCounts ?? '{}'); } catch {}
        const totalVotes = parseInt(a.totalVotes ?? '0', 10) || 0;
        setPolls((prev) => prev.map((p) => p.pollId === a.pollId ? { ...p, voteCounts, totalVotes, status: 'closed', closedAt: new Date().toISOString() } : p));
      }
    };
    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, sessionId]);

  const openPoll = polls.find((p) => p.status === 'open') ?? null;

  return { polls, openPoll, refresh };
}
