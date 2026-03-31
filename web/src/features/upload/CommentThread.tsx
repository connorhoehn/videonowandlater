/**
 * CommentThread - Comment list, sort toggle, and composer for uploaded video sessions
 */

import { useState, useEffect, useCallback } from 'react';
import { getConfig } from '../../config/aws-config';
import { useCommentHighlight } from './useCommentHighlight';

interface Comment {
  commentId: string;
  sessionId: string;
  userId: string;
  text: string;
  videoPositionMs: number;
  createdAt: string;
}

interface CommentThreadProps {
  sessionId: string;
  authToken: string;
  syncTime: number; // ms from useHlsPlayer
  onSeek?: (timeMs: number) => void;
}

export function CommentThread({ sessionId, authToken, syncTime, onSeek }: CommentThreadProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'position'>('newest');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const highlighted = useCommentHighlight(comments, syncTime);

  const fetchComments = useCallback(async () => {
    if (!sessionId || !authToken) return;
    const apiUrl = getConfig()?.apiUrl || 'http://localhost:3000/api';
    try {
      const res = await fetch(`${apiUrl}/sessions/${sessionId}/comments`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setFetchError(`Failed to load comments: ${res.status}`);
        return;
      }
      const data = await res.json();
      setComments(data.comments || []);
      setFetchError(null);
    } catch (err: any) {
      setFetchError(err.message || 'Error loading comments');
    } finally {
      setLoading(false);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    if (!text.trim() || syncTime === 0 || submitting) return;
    setSubmitting(true);
    const apiUrl = getConfig()?.apiUrl || 'http://localhost:3000/api';
    try {
      const res = await fetch(`${apiUrl}/sessions/${sessionId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text: text.trim(), videoPositionMs: syncTime }),
      });
      if (res.ok) {
        setText('');
        await fetchComments();
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const sortedComments =
    sortOrder === 'newest'
      ? [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : comments;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 text-sm">
      {/* Header + Sort toggle */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Comments</h3>
        <div className="flex gap-1">
          <button
            onClick={() => setSortOrder('newest')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              sortOrder === 'newest'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Newest
          </button>
          <button
            onClick={() => setSortOrder('position')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              sortOrder === 'position'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            By Position
          </button>
        </div>
      </div>

      {/* Comment list */}
      <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto scroll-smooth-container">
        {loading && (
          <div className="p-4 text-center text-gray-400 text-sm animate-fade-in">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-gray-500 mx-auto mb-2"></div>
            Loading comments...
          </div>
        )}
        {!loading && fetchError && (
          <div className="p-4 text-center text-red-500 text-sm animate-fade-in">{fetchError}</div>
        )}
        {!loading && !fetchError && sortedComments.length === 0 && (
          <div className="p-4 text-center text-gray-400 text-sm animate-fade-in">
            No comments yet -- be the first!
          </div>
        )}
        {!loading &&
          sortedComments.map((comment) => {
            const isHighlighted = highlighted.has(comment.commentId);
            return (
              <div
                key={comment.commentId}
                className={`px-4 py-3 border-l-3 transition-all duration-300 ease-out ${
                  onSeek ? 'cursor-pointer' : ''
                } ${
                  isHighlighted
                    ? 'bg-yellow-50 border-l-yellow-400 shadow-sm'
                    : 'border-l-transparent hover:bg-gray-50/80 hover:border-l-blue-300'
                } ${onSeek ? 'active:scale-[0.99] active:bg-blue-50' : ''}`}
                onClick={() => onSeek?.(comment.videoPositionMs)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-700">{comment.userId}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek?.(comment.videoPositionMs);
                    }}
                    className={`inline-flex items-center gap-1 text-[11px] tabular-nums rounded-full px-2 py-0.5 transition-colors duration-200 ${
                      isHighlighted
                        ? 'bg-yellow-200 text-yellow-800'
                        : 'bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600'
                    } ${onSeek ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                    {formatCommentTimestamp(comment.videoPositionMs)}
                  </button>
                </div>
                <p className="text-gray-800 leading-relaxed">{comment.text}</p>
              </div>
            );
          })}
      </div>

      {/* Composer */}
      <div className={`px-4 py-3 border-t border-gray-100 ${syncTime === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
        {syncTime === 0 && (
          <p className="text-xs text-gray-500 mb-2">Play the video to enable comments</p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={syncTime === 0 || submitting}
            placeholder="Add a comment..."
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 disabled:bg-gray-50 disabled:cursor-not-allowed transition-all"
          />
          <button
            onClick={handleSubmit}
            disabled={syncTime === 0 || submitting || !text.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap shadow-sm"
          >
            {syncTime === 0 ? 'Post' : `Post at ${formatCommentTimestamp(syncTime)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCommentTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
