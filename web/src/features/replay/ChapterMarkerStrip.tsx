/**
 * ChapterMarkerStrip — compact timeline strip showing colored segments
 * per chapter. Each segment is proportional to its duration within the
 * total recording; clicking seeks to the chapter start; the segment that
 * contains the current playback time is highlighted.
 *
 * This complements the existing `ChapterList` (thumbnail cards) by giving
 * a spatial, at-a-glance view of chapter structure — closer to what the
 * video scrubber looks like.
 *
 * Renders nothing when `chapters` is empty.
 */

export interface ChapterMarker {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
}

interface ChapterMarkerStripProps {
  chapters: ChapterMarker[];
  currentTimeSec: number;
  durationSec: number;
  onSeek: (sec: number) => void;
}

// Distinct, readable chapter colours for light + dark backgrounds.
const CHAPTER_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-emerald-500',
  'bg-cyan-500',
  'bg-rose-500',
  'bg-indigo-500',
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ChapterMarkerStrip({
  chapters,
  currentTimeSec,
  durationSec,
  onSeek,
}: ChapterMarkerStripProps) {
  if (!chapters || chapters.length === 0) return null;
  if (!durationSec || durationSec <= 0) return null;

  const activeIdx = (() => {
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTimeSec >= chapters[i].startSec) return i;
    }
    return 0;
  })();

  return (
    <div
      className="w-full"
      data-testid="chapter-marker-strip"
      aria-label="Chapter timeline"
    >
      <div className="flex items-center gap-1.5 h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
        {chapters.map((chapter, idx) => {
          const start = Math.max(0, chapter.startSec);
          const end = Math.min(durationSec, Math.max(chapter.endSec, chapter.startSec + 1));
          const widthPct = Math.max(0.5, ((end - start) / durationSec) * 100);
          const color = CHAPTER_COLORS[idx % CHAPTER_COLORS.length];
          const isActive = idx === activeIdx;

          return (
            <button
              key={chapter.id}
              type="button"
              onClick={() => onSeek(chapter.startSec)}
              title={`${chapter.title} — ${formatTime(chapter.startSec)}`}
              aria-label={`Jump to chapter ${chapter.title} at ${formatTime(chapter.startSec)}`}
              aria-current={isActive ? 'true' : undefined}
              className={`h-full rounded-sm transition-all duration-200 ${color} ${
                isActive
                  ? 'opacity-100 ring-2 ring-offset-1 ring-white dark:ring-gray-900 scale-y-150'
                  : 'opacity-70 hover:opacity-100'
              }`}
              style={{ width: `${widthPct}%` }}
            />
          );
        })}
      </div>
      {/* Chip row (titles) — wraps below the bar, clickable, mobile-friendly. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chapters.map((chapter, idx) => {
          const color = CHAPTER_COLORS[idx % CHAPTER_COLORS.length];
          const isActive = idx === activeIdx;
          return (
            <button
              key={chapter.id}
              type="button"
              onClick={() => onSeek(chapter.startSec)}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                isActive
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} aria-hidden />
              <span className="truncate max-w-[140px]">{chapter.title}</span>
              <span className="tabular-nums opacity-60">{formatTime(chapter.startSec)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
