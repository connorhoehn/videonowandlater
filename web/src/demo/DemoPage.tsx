/**
 * DemoPage — visual showcase of features at /demo (no auth required)
 * Shows ConfirmDialog, emoji reactions, pipeline status, and click-to-seek comments.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ReactionPicker, EMOJI_MAP, type EmojiType } from '../features/reactions/ReactionPicker';
import { FloatingReactions, type FloatingEmoji } from '../features/reactions/FloatingReactions';
import { SessionAuditLog } from '../features/activity/SessionAuditLog';
import { disableDemoMode } from './demoMode';

// ─── mock pipeline states for the audit log demo ─────────────────────────────

const PIPELINE_STATES = [
  {
    label: 'Processing — transcribing audio',
    session: {
      sessionId: 'demo', userId: 'demo_guest', sessionType: 'BROADCAST' as const,
      createdAt: '2026-03-16T12:00:00Z', endedAt: '2026-03-16T12:45:00Z',
      recordingStatus: 'available' as const, convertStatus: 'available' as const,
      transcriptStatus: 'processing' as const, aiSummaryStatus: 'pending' as const,
    },
  },
  {
    label: 'Processing — generating AI summary',
    session: {
      sessionId: 'demo', userId: 'demo_guest', sessionType: 'BROADCAST' as const,
      createdAt: '2026-03-16T12:00:00Z', endedAt: '2026-03-16T12:45:00Z',
      recordingStatus: 'available' as const, convertStatus: 'available' as const,
      transcriptStatus: 'available' as const, aiSummaryStatus: 'pending' as const,
    },
  },
  {
    label: 'Complete',
    session: {
      sessionId: 'demo', userId: 'demo_guest', sessionType: 'BROADCAST' as const,
      createdAt: '2026-03-16T12:00:00Z', endedAt: '2026-03-16T12:45:00Z',
      recordingStatus: 'available' as const, convertStatus: 'available' as const,
      transcriptStatus: 'available' as const, aiSummaryStatus: 'available' as const,
    },
  },
  {
    label: 'Partial failure',
    session: {
      sessionId: 'demo', userId: 'demo_guest', sessionType: 'BROADCAST' as const,
      createdAt: '2026-03-16T12:00:00Z', endedAt: '2026-03-16T12:45:00Z',
      recordingStatus: 'available' as const, convertStatus: 'available' as const,
      transcriptStatus: 'failed' as const, aiSummaryStatus: 'pending' as const,
    },
  },
];

// ─── mock comments for the seek demo ─────────────────────────────────────────

const MOCK_COMMENTS = [
  { id: 'c1', user: 'alice', text: 'Great intro to the platform!', posMs: 15000 },
  { id: 'c2', user: 'bob', text: 'The IVS integration looks seamless', posMs: 120000 },
  { id: 'c3', user: 'carol', text: 'Love the emoji reactions 🎉', posMs: 305000 },
  { id: 'c4', user: 'dave', text: 'AI summary is super helpful for long recordings', posMs: 1800000 },
];

function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── section wrapper ─────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function DemoPage() {
  const navigate = useNavigate();

  // ConfirmDialog state
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Reactions state
  const [floatingReactions, setFloatingReactions] = useState<FloatingEmoji[]>([]);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({ heart: 3, fire: 2 });

  const handleReaction = (emoji: EmojiType) => {
    const emojiChar = EMOJI_MAP[emoji];
    setFloatingReactions(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, emoji: emojiChar, timestamp: Date.now() }]);
    setReactionCounts(prev => ({ ...prev, [emoji]: (prev[emoji] || 0) + 1 }));
  };

  // Pipeline state selector
  const [pipelineIdx, setPipelineIdx] = useState(0);

  // Seek demo
  const [seekedTo, setSeekedTo] = useState<string | null>(null);

  const handleSeek = (posMs: number) => {
    setSeekedTo(formatMs(posMs));
    setTimeout(() => setSeekedTo(null), 2000);
  };

  const exitDemo = () => {
    disableDemoMode();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-gray-900 tracking-tight">videonow</span>
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">Demo Mode</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { navigate('/'); }}
              className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Explore Full App →
            </button>
            <button onClick={exitDemo} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Exit Demo
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Intro */}
        <div className="text-center py-2">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Feature Showcase</h1>
          <p className="text-sm text-gray-500">All UI components running with mock data — no AWS required</p>
        </div>

        {/* Row 1: Confirm Dialogs + Reactions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Confirm Dialogs */}
          <Section title="Confirmation Dialogs" subtitle="Destructive actions are now guarded by a confirmation step">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-800">Stop Broadcast</p>
                  <p className="text-xs text-gray-500">Ends the live stream</p>
                </div>
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Stop
                </button>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-800">Leave Hangout</p>
                  <p className="text-xs text-gray-500">Disconnects from session</p>
                </div>
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  className="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-300 transition-colors"
                >
                  Leave
                </button>
              </div>
              {lastAction && (
                <div className="px-3 py-2 rounded-lg bg-green-50 border border-green-100 text-green-700 text-sm text-center">
                  ✓ {lastAction}
                </div>
              )}
            </div>
          </Section>

          {/* Emoji Reactions */}
          <Section title="Emoji Reactions" subtitle="Real-time reactions float up from the video player">
            <div className="relative bg-gray-900 rounded-xl overflow-hidden h-40 flex items-center justify-center">
              <span className="text-gray-500 text-sm">Video player area</span>
              {/* Floating reactions layer */}
              <div className="absolute inset-0 pointer-events-none">
                <FloatingReactions reactions={floatingReactions} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex gap-2 flex-wrap">
                {Object.entries(reactionCounts).map(([emoji, count]) => (
                  <span key={emoji} className="px-2 py-1 rounded-full bg-gray-100 text-sm">
                    {EMOJI_MAP[emoji as EmojiType] ?? emoji} {count}
                  </span>
                ))}
              </div>
              <div className="relative">
                <ReactionPicker onReaction={handleReaction} />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">Click the ❤️ button to send a reaction</p>
          </Section>

        </div>

        {/* Row 2: Pipeline Status */}
        <Section title="Upload Pipeline Status" subtitle="Polls every 15→30→60s and updates automatically when processing completes">
          <div className="flex flex-wrap gap-2 mb-4">
            {PIPELINE_STATES.map((s, i) => (
              <button
                key={i}
                onClick={() => setPipelineIdx(i)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  pipelineIdx === i
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <SessionAuditLog session={PIPELINE_STATES[pipelineIdx].session} compact={false} />
          </div>
        </Section>

        {/* Row 3: Comments with Click-to-Seek */}
        <Section title="Comments with Click-to-Seek" subtitle="Clicking a timestamped comment seeks the video to that position (UI-09)">
          {seekedTo && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-sm text-center">
              ▶ Seeking video to {seekedTo}
            </div>
          )}
          <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Comments</span>
              <span className="text-xs text-gray-400">Click any row to seek</span>
            </div>
            {MOCK_COMMENTS.map(comment => (
              <button
                key={comment.id}
                onClick={() => handleSeek(comment.posMs)}
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-blue-50 transition-colors cursor-pointer group"
              >
                <span className="mt-0.5 px-2 py-0.5 rounded bg-gray-100 group-hover:bg-blue-100 text-gray-600 group-hover:text-blue-700 text-xs font-mono font-medium whitespace-nowrap transition-colors">
                  {formatMs(comment.posMs)}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-gray-500">{comment.user}</span>
                  <p className="text-sm text-gray-800 mt-0.5">{comment.text}</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-400 mt-1 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            ))}
          </div>
          <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-500">
            <strong>Note:</strong> Posting new comments requires a video playing — the "Post at X.Xs" button is enabled once sync time is established.
          </div>
        </Section>

        {/* Footer CTA */}
        <div className="bg-gray-900 rounded-2xl p-6 text-center text-white">
          <h3 className="text-lg font-semibold mb-1">Ready to explore the full app?</h3>
          <p className="text-sm text-gray-400 mb-4">Demo mode gives you access to all pages with mock data</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-xl bg-white text-gray-900 text-sm font-semibold hover:bg-gray-100 transition-colors"
          >
            Go to Home →
          </button>
        </div>

      </div>

      {/* Confirm Dialogs (rendered at root so they overlay everything) */}
      <ConfirmDialog
        isOpen={showStopConfirm}
        title="Stop broadcast?"
        message="Your stream will end and viewers will be disconnected."
        confirmLabel="Stop"
        onConfirm={() => { setLastAction('Broadcast stopped'); setShowStopConfirm(false); }}
        onCancel={() => setShowStopConfirm(false)}
      />
      <ConfirmDialog
        isOpen={showLeaveConfirm}
        title="Leave hangout?"
        message="You will be disconnected from the session."
        confirmLabel="Leave"
        onConfirm={() => { setLastAction('Left hangout'); setShowLeaveConfirm(false); }}
        onCancel={() => setShowLeaveConfirm(false)}
      />
    </div>
  );
}
