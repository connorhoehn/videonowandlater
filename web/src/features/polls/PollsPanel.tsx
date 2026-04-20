/**
 * PollsPanel — creator-side control panel for live polls. Shows the active
 * poll with live tallies + a close button, or a compact "Create poll" form
 * when no poll is open. Mounts in the broadcast page sidebar.
 */

import { useState } from 'react';
import type { Poll } from './types';
import { createPoll, closePoll } from './pollApi';

interface Props {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
  openPoll: Poll | null;
  recentPolls: Poll[];
}

export function PollsPanel({ sessionId, apiBaseUrl, authToken, openPoll, recentPolls }: Props) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setOption = (i: number, v: string) => setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((prev) => (prev.length >= 4 ? prev : [...prev, '']));
  const removeOption = (i: number) => setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setError('Question is required');
    if (trimmed.length < 2) return setError('At least 2 options required');
    setBusy(true);
    try {
      await createPoll(apiBaseUrl, sessionId, authToken, question.trim(), trimmed);
      setQuestion(''); setOptions(['', '']);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create poll');
    } finally {
      setBusy(false);
    }
  };

  const onClose = async () => {
    if (!openPoll) return;
    setBusy(true);
    try { await closePoll(apiBaseUrl, sessionId, authToken, openPoll.pollId); }
    catch (err: any) { setError(err?.message ?? 'Failed to close poll'); }
    finally { setBusy(false); }
  };

  if (openPoll) {
    return (
      <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-green-600">● Live Poll</span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            Close poll
          </button>
        </div>
        <h3 className="font-semibold mb-3">{openPoll.question}</h3>
        <PollResults poll={openPoll} />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <h3 className="text-sm font-semibold mb-3">Create a poll</h3>
      <form onSubmit={onSubmit} className="space-y-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask something…"
          maxLength={140}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
        />
        {options.map((opt, i) => (
          <div key={i} className="flex gap-1">
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              maxLength={60}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
            />
            {options.length > 2 && (
              <button type="button" onClick={() => removeOption(i)} className="px-2 text-gray-400 hover:text-red-500" aria-label="Remove">
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < 4 && (
          <button type="button" onClick={addOption} className="text-xs text-blue-600 hover:underline">
            + Add option
          </button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start poll'}
        </button>
      </form>

      {recentPolls.filter((p) => p.status === 'closed').length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Recent</h4>
          <div className="space-y-2">
            {recentPolls.filter((p) => p.status === 'closed').slice(0, 3).map((p) => (
              <details key={p.pollId} className="text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1">
                <summary className="cursor-pointer font-medium">{p.question}</summary>
                <div className="pt-2"><PollResults poll={p} /></div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PollResults({ poll }: { poll: Poll }) {
  const total = poll.totalVotes || 0;
  return (
    <div className="space-y-1.5">
      {poll.options.map((opt) => {
        const count = poll.voteCounts?.[opt.id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={opt.id}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="truncate">{opt.text}</span>
              <span className="text-gray-500 ml-2 flex-shrink-0">{count} · {pct}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-gray-500 pt-1">{total} {total === 1 ? 'vote' : 'votes'}</p>
    </div>
  );
}
