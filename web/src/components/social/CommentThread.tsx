import { useState } from 'react';
import { Avatar } from './Avatar';

export interface Comment {
  id: string;
  author: { name: string; avatar?: string };
  content: string;
  timestamp: string;
  likes?: number;
  replies?: Comment[];
}

export interface CommentThreadProps {
  comments: Comment[];
  maxDepth?: number;
  onLike?: (commentId: string) => void;
  onReply?: (commentId: string, text: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      className="w-3.5 h-3.5"
    >
      <path
        fillRule="evenodd"
        d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-3.5 h-3.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12M2.5 3.75v12.5l3.75-2.5h10a1.25 1.25 0 001.25-1.25v-7.5A1.25 1.25 0 0016.25 3.75h-12.5A1.25 1.25 0 002.5 3.75z"
      />
    </svg>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="w-1 h-1 rounded-full bg-current animate-[bounce_1s_ease-in-out_0ms_infinite]" />
      <span className="w-1 h-1 rounded-full bg-current animate-[bounce_1s_ease-in-out_150ms_infinite]" />
      <span className="w-1 h-1 rounded-full bg-current animate-[bounce_1s_ease-in-out_300ms_infinite]" />
    </span>
  );
}

interface CommentItemProps {
  comment: Comment;
  depth: number;
  maxDepth: number;
  onLike?: (commentId: string) => void;
  onReply?: (commentId: string, text: string) => void;
}

function CommentItem({
  comment,
  depth,
  maxDepth,
  onLike,
  onReply,
}: CommentItemProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showReplies, setShowReplies] = useState(true);
  const hasReplies = comment.replies && comment.replies.length > 0;
  const canNest = depth < maxDepth;

  function handleSubmitReply() {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    onReply?.(comment.id, trimmed);
    setReplyText('');
    setReplyOpen(false);
  }

  return (
    <div className="flex gap-2.5">
      <Avatar
        src={comment.author.avatar}
        alt={comment.author.name}
        name={comment.author.name}
        size="xs"
      />

      <div className="flex-1 min-w-0">
        {/* Content bubble */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg rounded-tl-none p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
              {comment.author.name}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {comment.timestamp}
            </span>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
            {comment.content}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mt-1 ml-1">
          <button
            type="button"
            onClick={() => onLike?.(comment.id)}
            className={`inline-flex items-center gap-1 text-xs hover:text-red-500 transition-colors ${
              (comment.likes ?? 0) > 0
                ? 'text-red-500'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <HeartIcon filled={(comment.likes ?? 0) > 0} />
            {(comment.likes ?? 0) > 0 && (
              <span>{comment.likes}</span>
            )}
            <span>Like</span>
          </button>

          <span className="text-gray-300 dark:text-gray-600 text-xs select-none">
            &middot;
          </span>

          {onReply && (
            <button
              type="button"
              onClick={() => setReplyOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 transition-colors"
            >
              <ReplyIcon />
              <span>Reply</span>
            </button>
          )}
        </div>

        {/* Reply input */}
        {replyOpen && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitReply();
              }}
              placeholder="Write a reply..."
              className="flex-1 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleSubmitReply}
              disabled={!replyText.trim()}
              className="rounded-full bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Post
            </button>
          </div>
        )}

        {/* Nested replies */}
        {hasReplies && canNest && (
          <div className="mt-2">
            {comment.replies!.length > 2 && (
              <button
                type="button"
                onClick={() => setShowReplies((v) => !v)}
                className="text-xs text-blue-500 hover:text-blue-600 mb-2 transition-colors"
              >
                {showReplies
                  ? 'Hide replies'
                  : `Show ${comment.replies!.length} replies`}
              </button>
            )}
            {showReplies && (
              <div className="pl-8 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
                {comment.replies!.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    depth={depth + 1}
                    maxDepth={maxDepth}
                    onLike={onLike}
                    onReply={onReply}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* At max depth, show collapsed reply count */}
        {hasReplies && !canNest && (
          <p className="mt-1 ml-1 text-xs text-gray-400 italic">
            {comment.replies!.length} more{' '}
            {comment.replies!.length === 1 ? 'reply' : 'replies'}
          </p>
        )}
      </div>
    </div>
  );
}

export function CommentThread({
  comments,
  maxDepth = 3,
  onLike,
  onReply,
  onLoadMore,
  hasMore = false,
}: CommentThreadProps) {
  return (
    <div className="space-y-4">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          depth={0}
          maxDepth={maxDepth}
          onLike={onLike}
          onReply={onReply}
        />
      ))}

      {hasMore && onLoadMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 transition-colors"
          >
            Load more comments <LoadingDots />
          </button>
        </div>
      )}

      {comments.length === 0 && (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-4">
          No comments yet.
        </p>
      )}
    </div>
  );
}
