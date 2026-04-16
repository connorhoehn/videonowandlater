import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Badge } from '../../components/social';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ContextEvent {
  contextId: string;
  sessionId: string;
  sourceAppId: string;
  eventType: string;
  timestamp: number;
  metadata: {
    documentId?: string;
    documentTitle?: string;
    editSummary?: string;
    editCount?: number;
    userId?: string;
    [key: string]: any;
  };
  createdAt: string;
}

interface DocumentReference {
  documentId: string;
  documentTitle: string;
  lastAccessedAt: string;
  accessCount: number;
}

interface ContextSidebarProps {
  sessionId: string;
  authToken: string;
  apiBaseUrl: string;
  currentTime: number; // session-relative ms
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function eventTypeBadgeVariant(eventType: string): 'warning' | 'info' | 'light' {
  switch (eventType) {
    case 'DOCUMENT_SWITCH': return 'warning';
    case 'DOCUMENT_EDIT': return 'info';
    default: return 'light';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContextSidebar({ sessionId, authToken, apiBaseUrl, currentTime }: ContextSidebarProps) {
  const [events, setEvents] = useState<ContextEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchContext = useCallback(async () => {
    if (!authToken || !apiBaseUrl || !sessionId) return;
    try {
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/context`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setEvents([]);
        return;
      }
      const data = await res.json();
      setEvents(data.events ?? data.contextEvents ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl, sessionId]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  // Derive unique documents
  const documents = useMemo<DocumentReference[]>(() => {
    const docMap = new Map<string, DocumentReference>();
    for (const evt of events) {
      const docId = evt.metadata?.documentId;
      const docTitle = evt.metadata?.documentTitle;
      if (!docId || !docTitle) continue;
      const existing = docMap.get(docId);
      if (existing) {
        existing.accessCount += 1;
        if (evt.createdAt > existing.lastAccessedAt) {
          existing.lastAccessedAt = evt.createdAt;
        }
      } else {
        docMap.set(docId, {
          documentId: docId,
          documentTitle: docTitle,
          lastAccessedAt: evt.createdAt,
          accessCount: 1,
        });
      }
    }
    return Array.from(docMap.values()).sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt));
  }, [events]);

  // Determine active event based on currentTime
  const activeEventIndex = useMemo(() => {
    let lastIdx = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].timestamp <= currentTime) {
        lastIdx = i;
      } else {
        break;
      }
    }
    return lastIdx;
  }, [events, currentTime]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <Card className="border border-gray-200 dark:border-gray-700">
          <Card.Body>
            <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-3 w-2/3 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (events.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Section 1: Documents Referenced */}
      {documents.length > 0 && (
        <Card className="border border-gray-200 dark:border-gray-700">
          <Card.Header className="dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Documents Referenced</h3>
            <span className="text-xs text-gray-400">{documents.length}</span>
          </Card.Header>
          <Card.Body>
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.documentId}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                      {doc.documentTitle}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {doc.accessCount} reference{doc.accessCount !== 1 ? 's' : ''} -- last at {formatTimestamp(doc.lastAccessedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card.Body>
        </Card>
      )}

      {/* Section 2: Context Timeline */}
      <Card className="border border-gray-200 dark:border-gray-700">
        <Card.Header className="dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Context Timeline</h3>
        </Card.Header>
        <Card.Body className="px-0 py-0">
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-[400px] overflow-y-auto">
            {events.map((evt, i) => {
              const isActive = i === activeEventIndex;
              return (
                <div
                  key={evt.contextId}
                  className={`flex items-start gap-3 px-4 py-2.5 transition-colors ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  {/* Timeline dot */}
                  <div className="mt-1.5 shrink-0">
                    <span
                      className={`block w-2 h-2 rounded-full ${
                        isActive
                          ? 'bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-900/50'
                          : evt.eventType === 'DOCUMENT_SWITCH'
                          ? 'bg-amber-400'
                          : 'bg-blue-400'
                      }`}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge variant={eventTypeBadgeVariant(evt.eventType)} size="sm">
                        {evt.eventType.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {evt.metadata?.documentTitle && (
                      <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                        {evt.metadata.documentTitle}
                      </p>
                    )}
                    {evt.metadata?.editSummary && (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {evt.metadata.editSummary}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums font-mono shrink-0 mt-0.5">
                    {formatMs(evt.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
