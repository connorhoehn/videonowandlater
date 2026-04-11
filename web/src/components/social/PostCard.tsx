import React, { useState } from 'react';
import { Avatar } from './Avatar';
import { Card } from './Card';

/* ------------------------------------------------------------------ */
/*  Inline SVG icon helpers                                           */
/* ------------------------------------------------------------------ */

const IconThumbsUp = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-5 h-5"
  >
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
);

const IconChat = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-5 h-5"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const IconShare = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-5 h-5"
  >
    <circle cx={18} cy={5} r={3} />
    <circle cx={6} cy={12} r={3} />
    <circle cx={18} cy={19} r={3} />
    <line x1={8.59} y1={13.51} x2={15.42} y2={17.49} />
    <line x1={15.41} y1={6.51} x2={8.59} y2={10.49} />
  </svg>
);

const IconDots = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="w-5 h-5"
  >
    <circle cx={12} cy={5} r={1.5} />
    <circle cx={12} cy={12} r={1.5} />
    <circle cx={12} cy={19} r={1.5} />
  </svg>
);

const IconSend = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <line x1={22} y1={2} x2={11} y2={13} />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  PostCard                                                          */
/* ------------------------------------------------------------------ */

export interface PostCardAuthor {
  name: string;
  avatar?: string;
  subtitle?: string;
}

export interface PostCardMedia {
  type: 'image' | 'video';
  src: string;
  alt?: string;
}

export interface PostCardCommentInput {
  avatar?: string;
  placeholder?: string;
  onSubmit?: (text: string) => void;
}

export interface PostCardProps {
  author: PostCardAuthor;
  timestamp: string;
  content?: string;
  media?: PostCardMedia;
  likes?: number;
  comments?: number;
  shares?: number;
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onMenuClick?: () => void;
  children?: React.ReactNode;
  commentInput?: PostCardCommentInput;
  className?: string;
}

export function PostCard({
  author,
  timestamp,
  content,
  media,
  likes = 0,
  comments = 0,
  shares = 0,
  onLike,
  onComment,
  onShare,
  onMenuClick,
  children,
  commentInput,
  className = '',
}: PostCardProps) {
  const [commentText, setCommentText] = useState('');

  const handleCommentSubmit = () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    commentInput?.onSubmit?.(trimmed);
    setCommentText('');
  };

  return (
    <Card className={className}>
      {/* ---- Header ---- */}
      <Card.Header borderless>
        <div className="flex items-center gap-3">
          <Avatar src={author.avatar} alt={author.name} name={author.name} />
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-gray-900">
              {author.name}
            </span>
            {author.subtitle && (
              <span className="text-xs text-gray-500">{author.subtitle}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{timestamp}</span>
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="More options"
            >
              <IconDots />
            </button>
          )}
        </div>
      </Card.Header>

      {/* ---- Body ---- */}
      <Card.Body className="px-0 py-0">
        {content && (
          <p className="px-4 py-3 text-sm text-gray-800 whitespace-pre-line">
            {content}
          </p>
        )}

        {children && <div className="px-4 py-3">{children}</div>}

        {media && (
          <div className="w-full">
            {media.type === 'image' ? (
              <img
                src={media.src}
                alt={media.alt ?? ''}
                className="w-full object-cover"
              />
            ) : (
              <video
                src={media.src}
                controls
                className="w-full"
                aria-label={media.alt}
              />
            )}
          </div>
        )}
      </Card.Body>

      {/* ---- Engagement bar ---- */}
      <div className="flex items-center gap-6 px-4 py-2 border-t border-gray-100">
        <button
          onClick={onLike}
          className="flex items-center gap-1.5 text-gray-500 hover:text-blue-600 transition-colors text-sm"
        >
          <IconThumbsUp />
          {likes > 0 && <span>{likes}</span>}
        </button>

        <button
          onClick={onComment}
          className="flex items-center gap-1.5 text-gray-500 hover:text-blue-600 transition-colors text-sm"
        >
          <IconChat />
          {comments > 0 && <span>{comments}</span>}
        </button>

        <button
          onClick={onShare}
          className="flex items-center gap-1.5 text-gray-500 hover:text-blue-600 transition-colors text-sm"
        >
          <IconShare />
          {shares > 0 && <span>{shares}</span>}
        </button>
      </div>

      {/* ---- Comment input ---- */}
      {commentInput && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100">
          <Avatar
            src={commentInput.avatar}
            alt="You"
            name="You"
            size="sm"
          />
          <div className="relative flex-1">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommentSubmit();
              }}
              placeholder={commentInput.placeholder ?? 'Write a comment...'}
              className="w-full rounded-full bg-gray-100 px-4 py-2 pr-10 text-sm text-gray-800 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              onClick={handleCommentSubmit}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-700 transition-colors"
              aria-label="Send comment"
            >
              <IconSend />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
