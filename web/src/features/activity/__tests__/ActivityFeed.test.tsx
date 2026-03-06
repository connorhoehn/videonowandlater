/**
 * ActivityFeed.test.tsx - Unit tests for ActivityFeed component
 * Tests reverse chronological sort, card type dispatch, empty state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ActivityFeed } from '../ActivityFeed';
import type { ActivitySession } from '../RecordingSlider';

// Mock useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

// Mock child card components to verify dispatch
vi.mock('../BroadcastActivityCard', () => ({
  BroadcastActivityCard: ({ session }: { session: ActivitySession }) => (
    <div data-testid={`broadcast-card-${session.sessionId}`}>{session.userId}</div>
  ),
}));

vi.mock('../HangoutActivityCard', () => ({
  HangoutActivityCard: ({ session }: { session: ActivitySession }) => (
    <div data-testid={`hangout-card-${session.sessionId}`}>{session.userId}</div>
  ),
}));

// Mock SummaryDisplay and ReactionSummaryPills since they are transitively imported
vi.mock('../../replay/SummaryDisplay', () => ({
  SummaryDisplay: () => <div data-testid="summary-display" />,
}));

vi.mock('../ReactionSummaryPills', () => ({
  ReactionSummaryPills: () => <div data-testid="reaction-pills" />,
}));

const olderBroadcast: ActivitySession = {
  sessionId: 'older-broadcast',
  userId: 'alice',
  sessionType: 'BROADCAST',
  createdAt: '2026-03-01T10:00:00Z',
  endedAt: '2026-03-01T11:00:00Z',
  recordingDuration: 60000,
};

const newerHangout: ActivitySession = {
  sessionId: 'newer-hangout',
  userId: 'bob',
  sessionType: 'HANGOUT',
  createdAt: '2026-03-02T10:00:00Z',
  endedAt: '2026-03-02T11:00:00Z',
  participantCount: 3,
  messageCount: 5,
};

const newestBroadcast: ActivitySession = {
  sessionId: 'newest-broadcast',
  userId: 'charlie',
  sessionType: 'BROADCAST',
  createdAt: '2026-03-03T10:00:00Z',
  endedAt: '2026-03-03T11:00:00Z',
  recordingDuration: 300000,
};

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "No activity yet" when sessions is empty array', () => {
    render(
      <BrowserRouter>
        <ActivityFeed sessions={[]} />
      </BrowserRouter>
    );
    expect(screen.getByText('No activity yet')).toBeDefined();
  });

  it('sorts sessions by endedAt DESC (most recent first)', () => {
    const { container } = render(
      <BrowserRouter>
        <ActivityFeed sessions={[olderBroadcast, newestBroadcast, newerHangout]} />
      </BrowserRouter>
    );

    // Get all rendered card text content in DOM order
    const cards = container.querySelectorAll('[data-testid^="broadcast-card-"], [data-testid^="hangout-card-"]');
    const userIds = Array.from(cards).map(c => c.textContent);

    // Should be: charlie (newest), bob (newer), alice (older)
    expect(userIds).toEqual(['charlie', 'bob', 'alice']);
  });

  it('renders BroadcastActivityCard for BROADCAST sessions', () => {
    render(
      <BrowserRouter>
        <ActivityFeed sessions={[olderBroadcast]} />
      </BrowserRouter>
    );

    expect(screen.getByTestId('broadcast-card-older-broadcast')).toBeDefined();
  });

  it('renders HangoutActivityCard for HANGOUT sessions', () => {
    render(
      <BrowserRouter>
        <ActivityFeed sessions={[newerHangout]} />
      </BrowserRouter>
    );

    expect(screen.getByTestId('hangout-card-newer-hangout')).toBeDefined();
  });

  it('dispatches correct card types for mixed sessions', () => {
    render(
      <BrowserRouter>
        <ActivityFeed sessions={[olderBroadcast, newerHangout]} />
      </BrowserRouter>
    );

    expect(screen.getByTestId('broadcast-card-older-broadcast')).toBeDefined();
    expect(screen.getByTestId('hangout-card-newer-hangout')).toBeDefined();
  });
});
