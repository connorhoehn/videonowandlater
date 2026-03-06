/**
 * ReactionSummaryPills.test.tsx - Unit tests for ReactionSummaryPills component
 * Tests emoji pill rendering and empty state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactionSummaryPills } from '../ReactionSummaryPills';

// Mock the ReactionPicker EMOJI_MAP
vi.mock('../../reactions/ReactionPicker', () => ({
  EMOJI_MAP: {
    heart: '❤️',
    fire: '🔥',
    clap: '👏',
    laugh: '😂',
    surprised: '😮',
  } as Record<string, string>,
}));

describe('ReactionSummaryPills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "No reactions" when reactionSummary is undefined', () => {
    render(<ReactionSummaryPills />);
    expect(screen.getByText('No reactions')).toBeDefined();
  });

  it('renders "No reactions" when reactionSummary is empty object', () => {
    render(<ReactionSummaryPills reactionSummary={{}} />);
    expect(screen.getByText('No reactions')).toBeDefined();
  });

  it('renders correct number of pills for given reactions', () => {
    const { container } = render(
      <ReactionSummaryPills reactionSummary={{ heart: 42, fire: 17 }} />
    );

    // Should render 2 pills (one per emoji type)
    const pills = container.querySelectorAll('.rounded-full');
    expect(pills.length).toBe(2);
  });

  it('displays count numbers in pills', () => {
    render(
      <ReactionSummaryPills reactionSummary={{ heart: 42, fire: 17 }} />
    );

    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('17')).toBeDefined();
  });

  it('does not render "No reactions" when reactions exist', () => {
    render(
      <ReactionSummaryPills reactionSummary={{ heart: 1 }} />
    );

    expect(screen.queryByText('No reactions')).toBeNull();
  });
});
