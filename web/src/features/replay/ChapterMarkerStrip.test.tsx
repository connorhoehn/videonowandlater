/**
 * ChapterMarkerStrip unit tests — clicking seeks, empty-chapters renders nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChapterMarkerStrip, type ChapterMarker } from './ChapterMarkerStrip';

const chapters: ChapterMarker[] = [
  { id: 'a', title: 'Intro', startSec: 0, endSec: 30 },
  { id: 'b', title: 'Deep dive', startSec: 30, endSec: 120 },
];

describe('ChapterMarkerStrip', () => {
  it('renders nothing when chapters are empty', () => {
    const { container } = render(
      <ChapterMarkerStrip chapters={[]} currentTimeSec={0} durationSec={120} onSeek={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when duration is 0', () => {
    const { container } = render(
      <ChapterMarkerStrip chapters={chapters} currentTimeSec={0} durationSec={0} onSeek={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onSeek with chapter start (in seconds) when clicked', () => {
    const onSeek = vi.fn();
    render(
      <ChapterMarkerStrip
        chapters={chapters}
        currentTimeSec={5}
        durationSec={120}
        onSeek={onSeek}
      />,
    );

    // There are 2 buttons per chapter (timeline segment + text chip); clicking either should seek.
    const all = screen.getAllByRole('button', { name: /Deep dive/i });
    expect(all.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(all[0]);
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it('marks the currently-active chapter with aria-current', () => {
    render(
      <ChapterMarkerStrip
        chapters={chapters}
        currentTimeSec={60}
        durationSec={120}
        onSeek={() => {}}
      />,
    );

    // The bar segment for the active chapter has aria-current=true.
    const active = screen.getByRole('button', { name: /Jump to chapter Deep dive/i });
    expect(active.getAttribute('aria-current')).toBe('true');
  });
});
