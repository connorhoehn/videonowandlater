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
    <div className="bg-white rounded-lg shadow text-sm">
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
      <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
        {loading && (
          <div className="p-4 text-center text-gray-400 text-sm">Loading comments...</div>
        )}
        {!loading && fetchError && (
          <div className="p-4 text-center text-red-500 text-sm">{fetchError}</div>
        )}
        {!loading && !fetchError && sortedComments.length === 0 && (
          <div className="p-4 text-center text-gray-400 text-sm">
            No comments yet — be the first!
          </div>
        )}
        {!loading &&
          sortedComments.map((comment) => {
            const isHighlighted = highlighted.has(comment.commentId);
            return (
              <div
                key={comment.commentId}
                className={`px-4 py-3 border transition-colors cursor-pointer ${
                  isHighlighted
                    ? 'bg-yellow-100 border-yellow-300'
                    : 'border-transparent hover:bg-gray-50'
                }`}
                onClick={() => onSeek?.(comment.videoPositionMs)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-700">{comment.userId}</span>
                  <span className="text-gray-400 text-xs">
                    {Math.floor(comment.videoPositionMs / 1000)}s
                  </span>
                </div>
                <p className="text-gray-800">{comment.text}</p>
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
            className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSubmit}
            disabled={syncTime === 0 || submitting || !text.trim()}
            className="px-3 py-2 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {syncTime === 0 ? 'Post' : `Post at ${(syncTime / 1000).toFixed(1)}s`}
          </button>
        </div>
      </div>
    </div>
  );
}
