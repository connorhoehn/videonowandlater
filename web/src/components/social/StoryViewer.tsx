import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Avatar } from './Avatar';
import { CloseIcon, EllipsisIcon, SendIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface StorySegment {
  id: string;
  type: 'image' | 'video';
  src: string;
  duration?: number; // ms, default 5000 for images, video duration for videos
}

export interface StoryUser {
  id: string;
  name: string;
  avatar?: string;
  timestamp?: string; // e.g., "5h"
}

export interface StoryViewerProps {
  isOpen: boolean;
  onClose: () => void;
  users: StoryUser[];
  initialUserIndex?: number;
  getSegments: (userId: string) => StorySegment[];
  onReact?: (userId: string, segmentId: string, emoji: string) => void;
  onReply?: (userId: string, segmentId: string, message: string) => void;
  onMenuClick?: (userId: string, segmentId: string) => void;
  quickReactions?: string[];
}

const DEFAULT_IMAGE_DURATION = 5000;
const DEFAULT_REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥'];

/* ------------------------------------------------------------------ */
/*  StoryViewer                                                        */
/* ------------------------------------------------------------------ */

export function StoryViewer({
  isOpen,
  onClose,
  users,
  initialUserIndex = 0,
  getSegments,
  onReact,
  onReply,
  onMenuClick,
  quickReactions = DEFAULT_REACTIONS,
}: StoryViewerProps) {
  /* ---- state ---- */
  const [userIndex, setUserIndex] = useState(initialUserIndex);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [visible, setVisible] = useState(false); // fade-in
  const [reactingEmoji, setReactingEmoji] = useState<string | null>(null);

  /* ---- refs ---- */
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const durationRef = useRef(DEFAULT_IMAGE_DURATION);
  const longPressRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ---- derived ---- */
  const user = users[userIndex];
  const segments = user ? getSegments(user.id) : [];
  const segment = segments[segmentIndex];

  /* ---- reset on open / initialUserIndex change ---- */
  useEffect(() => {
    if (isOpen) {
      setUserIndex(initialUserIndex);
      setSegmentIndex(0);
      setProgress(0);
      setPaused(false);
      setReplyText('');
      // trigger fade-in
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen, initialUserIndex]);

  /* ---- body scroll lock ---- */
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  /* ---- navigation helpers ---- */
  const goNext = useCallback(() => {
    if (segmentIndex < segments.length - 1) {
      setSegmentIndex((i) => i + 1);
      setProgress(0);
    } else if (userIndex < users.length - 1) {
      setUserIndex((i) => i + 1);
      setSegmentIndex(0);
      setProgress(0);
    } else {
      onClose();
    }
  }, [segmentIndex, segments.length, userIndex, users.length, onClose]);

  const goPrev = useCallback(() => {
    if (segmentIndex > 0) {
      setSegmentIndex((i) => i - 1);
      setProgress(0);
    } else if (userIndex > 0) {
      // go to previous user's last segment
      const prevUser = users[userIndex - 1];
      const prevSegments = prevUser ? getSegments(prevUser.id) : [];
      setUserIndex((i) => i - 1);
      setSegmentIndex(Math.max(0, prevSegments.length - 1));
      setProgress(0);
    }
  }, [segmentIndex, userIndex, users, getSegments]);

  /* ---- timer / progress animation ---- */
  const isPaused = paused || inputFocused || longPressRef.current;

  const startTimer = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    startTimeRef.current = performance.now();
    elapsedBeforePauseRef.current = 0;

    const tick = (now: number) => {
      if (longPressRef.current) {
        // while long-pressing, just keep looping without advancing
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed =
        elapsedBeforePauseRef.current + (now - startTimeRef.current);
      const pct = Math.min(elapsed / durationRef.current, 1);
      setProgress(pct);
      if (pct >= 1) {
        goNext();
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [goNext]);

  // Pause / resume effect
  useEffect(() => {
    if (!isOpen || !segment) return;

    if (isPaused) {
      // save elapsed time
      elapsedBeforePauseRef.current +=
        performance.now() - startTimeRef.current;
      cancelAnimationFrame(rafRef.current);
    } else {
      startTimeRef.current = performance.now();
      const tick = (now: number) => {
        if (longPressRef.current) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const elapsed =
          elapsedBeforePauseRef.current + (now - startTimeRef.current);
        const pct = Math.min(elapsed / durationRef.current, 1);
        setProgress(pct);
        if (pct >= 1) {
          goNext();
        } else {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, isOpen]);

  // Start timer when segment changes
  useEffect(() => {
    if (!isOpen || !segment) return;

    elapsedBeforePauseRef.current = 0;

    if (segment.type === 'image') {
      durationRef.current = segment.duration ?? DEFAULT_IMAGE_DURATION;
      startTimer();
    }
    // for video, timer starts on loadedmetadata

    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen, userIndex, segmentIndex, segment?.id, startTimer]);

  /* ---- video metadata handler ---- */
  const handleVideoLoaded = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    durationRef.current = segment?.duration ?? vid.duration * 1000;
    startTimer();
  }, [segment?.duration, startTimer]);

  /* ---- keyboard ---- */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          goPrev();
          break;
        case 'ArrowRight':
          goNext();
          break;
        case ' ':
          if (!inputFocused) {
            e.preventDefault();
            setPaused((p) => !p);
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, goPrev, goNext, inputFocused]);

  /* ---- long press ---- */
  const handlePressStart = useCallback(() => {
    longPressRef.current = true;
  }, []);

  const handlePressEnd = useCallback(() => {
    if (longPressRef.current) {
      longPressRef.current = false;
      // resume: recalculate start time
      startTimeRef.current = performance.now();
      const tick = (now: number) => {
        const elapsed =
          elapsedBeforePauseRef.current + (now - startTimeRef.current);
        const pct = Math.min(elapsed / durationRef.current, 1);
        setProgress(pct);
        if (pct >= 1) {
          goNext();
        } else {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [goNext]);

  /* ---- reactions ---- */
  const handleReact = useCallback(
    (emoji: string) => {
      if (!user || !segment) return;
      onReact?.(user.id, segment.id, emoji);
      setReactingEmoji(emoji);
      setTimeout(() => setReactingEmoji(null), 600);
    },
    [user, segment, onReact],
  );

  /* ---- reply ---- */
  const handleSendReply = useCallback(() => {
    if (!replyText.trim() || !user || !segment) return;
    onReply?.(user.id, segment.id, replyText.trim());
    setReplyText('');
    inputRef.current?.blur();
  }, [replyText, user, segment, onReply]);

  const handleReplyKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendReply();
      }
    },
    [handleSendReply],
  );

  /* ---- early return ---- */
  if (!isOpen || !user || !segment) return null;

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 bg-black transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="max-w-lg mx-auto h-full relative flex flex-col">
        {/* ---- Progress Bars ---- */}
        <div className="flex gap-1 px-2 pt-2">
          {segments.map((seg, i) => (
            <div
              key={seg.id}
              className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden"
            >
              <div
                className="h-full bg-white rounded-full"
                style={{
                  width:
                    i < segmentIndex
                      ? '100%'
                      : i === segmentIndex
                        ? `${progress * 100}%`
                        : '0%',
                  transition:
                    i === segmentIndex ? 'width 100ms linear' : 'none',
                }}
              />
            </div>
          ))}
        </div>

        {/* ---- User Header ---- */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Avatar
            src={user.avatar}
            alt={user.name}
            name={user.name}
            size="sm"
            hasStory
          />
          <span className="text-white text-sm font-semibold">{user.name}</span>
          {user.timestamp && (
            <span className="text-white/60 text-sm">{user.timestamp}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {onMenuClick && (
              <button
                type="button"
                onClick={() => onMenuClick(user.id, segment.id)}
                className="text-white p-1 cursor-pointer"
                aria-label="More options"
              >
                <EllipsisIcon size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-white p-1 cursor-pointer"
              aria-label="Close"
            >
              <CloseIcon size={20} />
            </button>
          </div>
        </div>

        {/* ---- Story Content ---- */}
        <div className="flex-1 flex items-center justify-center overflow-hidden relative">
          {/* Media */}
          {segment.type === 'image' ? (
            <img
              src={segment.src}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <video
              ref={videoRef}
              key={segment.id}
              src={segment.src}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={handleVideoLoaded}
              className="max-w-full max-h-full object-contain"
            />
          )}

          {/* Tap Zones */}
          <button
            type="button"
            className="absolute inset-y-0 left-0 w-[30%] cursor-pointer z-10"
            onClick={goPrev}
            onMouseDown={handlePressStart}
            onMouseUp={handlePressEnd}
            onMouseLeave={handlePressEnd}
            onTouchStart={handlePressStart}
            onTouchEnd={handlePressEnd}
            aria-label="Previous"
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 w-[70%] cursor-pointer z-10"
            onClick={goNext}
            onMouseDown={handlePressStart}
            onMouseUp={handlePressEnd}
            onMouseLeave={handlePressEnd}
            onTouchStart={handlePressStart}
            onTouchEnd={handlePressEnd}
            aria-label="Next"
          />

          {/* Desktop nav arrows */}
          {userIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 items-center justify-center text-white hover:bg-black/60 z-20 cursor-pointer"
              aria-label="Previous user"
            >
              <ChevronLeftIcon size={16} />
            </button>
          )}
          {userIndex < users.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 items-center justify-center text-white hover:bg-black/60 z-20 cursor-pointer"
              aria-label="Next user"
            >
              <ChevronRightIcon size={16} />
            </button>
          )}

          {/* Reaction animation */}
          {reactingEmoji && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <span className="text-7xl animate-ping">{reactingEmoji}</span>
            </div>
          )}
        </div>

        {/* ---- Quick Reactions ---- */}
        <div className="flex justify-center gap-4 px-4 py-2">
          {quickReactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleReact(emoji)}
              className="text-3xl cursor-pointer hover:scale-125 transition-transform active:scale-90"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* ---- Message Input ---- */}
        <div className="px-4 pb-4 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Send a message..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            className="flex-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2.5 text-white text-sm placeholder-white/50 focus:outline-none focus:border-white/40"
          />
          {replyText.trim() && (
            <button
              type="button"
              onClick={handleSendReply}
              className="text-white p-2 cursor-pointer"
              aria-label="Send"
            >
              <SendIcon size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
