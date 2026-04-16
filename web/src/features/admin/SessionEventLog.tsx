import { useState } from 'react';
import { Badge } from '../../components/social';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SessionEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  actorId?: string;
  actorType?: string;
  details?: Record<string, any>;
}

interface SessionEventLogProps {
  events: SessionEvent[];
}

/* ------------------------------------------------------------------ */
/*  Category helpers                                                   */
/* ------------------------------------------------------------------ */

type EventCategory = 'lifecycle' | 'pipeline' | 'agent' | 'moderation' | 'participant';

const LIFECYCLE_PREFIXES = ['SESSION_CREATED', 'SESSION_STARTED', 'SESSION_ENDING', 'SESSION_ENDED'];
const PIPELINE_PREFIXES = ['RECORDING_', 'MEDIACONVERT_', 'TRANSCRIBE_', 'AI_SUMMARY_', 'HIGHLIGHT_REEL_'];
const AGENT_PREFIXES = ['AGENT_', 'INTENT_', 'CONTEXT_EVENT_RECEIVED'];
const MODERATION_PREFIXES = ['MODERATION_'];

function categorize(eventType: string): EventCategory {
  if (LIFECYCLE_PREFIXES.includes(eventType)) return 'lifecycle';
  if (PIPELINE_PREFIXES.some((p) => eventType.startsWith(p))) return 'pipeline';
  if (AGENT_PREFIXES.some((p) => eventType.startsWith(p)) || eventType === 'CONTEXT_EVENT_RECEIVED') return 'agent';
  if (MODERATION_PREFIXES.some((p) => eventType.startsWith(p))) return 'moderation';
  return 'participant';
}

const DOT_COLORS: Record<EventCategory, string> = {
  lifecycle: 'bg-green-500',
  pipeline: 'bg-blue-500',
  agent: 'bg-purple-500',
  moderation: 'bg-red-500',
  participant: 'bg-gray-400',
};

const BADGE_VARIANTS: Record<EventCategory, 'success' | 'info' | 'primary' | 'danger' | 'light'> = {
  lifecycle: 'success',
  pipeline: 'info',
  agent: 'primary',
  moderation: 'danger',
  participant: 'light',
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Event Row                                                          */
/* ------------------------------------------------------------------ */

function EventRow({ event }: { event: SessionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const category = categorize(event.eventType);
  const dotColor = DOT_COLORS[category];
  const badgeVariant = BADGE_VARIANTS[category];
  const hasDetails = event.details && Object.keys(event.details).length > 0;

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      {/* Left: colored dot */}
      <div className="mt-1.5 shrink-0">
        <span className={`block w-2.5 h-2.5 rounded-full ${dotColor} ring-4 ring-white dark:ring-gray-800`} />
      </div>

      {/* Center: event type + actor */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <button
            type="button"
            onClick={() => hasDetails && setExpanded(!expanded)}
            className={`inline-flex ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <Badge variant={badgeVariant} size="sm">
              {event.eventType.replace(/_/g, ' ')}
            </Badge>
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {event.actorId ?? 'SYSTEM'}
          </span>
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            >
              {expanded ? '[-]' : '[+]'}
            </button>
          )}
        </div>

        {/* Expandable details */}
        {expanded && hasDetails && (
          <pre className="mt-1.5 p-2 text-[11px] font-mono bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-600 dark:text-gray-300 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
            {JSON.stringify(event.details, null, 2)}
          </pre>
        )}
      </div>

      {/* Right: relative timestamp */}
      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums shrink-0 mt-0.5">
        {timeAgo(event.timestamp)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SessionEventLog({ events }: SessionEventLogProps) {
  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-gray-400 dark:text-gray-500 px-4 py-3">
        No events recorded
      </p>
    );
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
      {events.map((event) => (
        <EventRow key={event.eventId} event={event} />
      ))}
    </div>
  );
}
