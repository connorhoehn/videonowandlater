/**
 * LivePollOverlay — viewer-side card that appears when a live poll is open.
 * Shows the question and option buttons; flips to result bars after the
 * viewer votes or when the poll is closed.
 */

import { useState } from 'react';
import type { Poll } from './types';
import { votePoll } from './pollApi';
import { PollResults } from './PollsPanel';

interface Props {
  poll: Poll;
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
}

export function LivePollOverlay({ poll, sessionId, apiBaseUrl, authToken }: Props) {
  const storageKey = `vnl:poll-voted:${poll.pollId}`;
  const [votedOptionId, setVotedOptionId] = useState<string | null>(
    () => (typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null),
  );
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const onVote = async (optionId: string) => {
    if (busy || votedOptionId || poll.status !== 'open') return;
    setBusy(true);
    try {
      await votePoll(apiBaseUrl, sessionId, authToken, poll.pollId, optionId);
      localStorage.setItem(storageKey, optionId);
      setVotedOptionId(optionId);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('409')) {
        localStorage.setItem(storageKey, optionId);
        setVotedOptionId(optionId);
      }
    } finally {
      setBusy(false);
    }
  };

  const showResults = votedOptionId !== null || poll.status === 'closed';

  return (
    <div className="absolute top-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-3 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-green-600">
            {poll.status === 'closed' ? 'Poll ended' : '● Live poll'}
          </span>
          <h4 className="text-sm font-semibold mt-0.5">{poll.question}</h4>
        </div>
        <button type="button" onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="Dismiss">
          ✕
        </button>
      </div>

      {showResults ? (
        <PollResults poll={poll} />
      ) : (
        <div className="space-y-1.5">
          {poll.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onVote(opt.id)}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-50 hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-800 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
            >
              {opt.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
