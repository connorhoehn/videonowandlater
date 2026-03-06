/**
 * RecordingSlider.test.tsx - Unit tests for RecordingSlider component
 * Tests broadcast-only filter, scroll-snap container, card rendering, empty state, navigation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { RecordingSlider, type ActivitySession } from '../RecordingSlider';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock ReactionSummaryPills as passthrough
vi.mock('../ReactionSummaryPills', () => ({
  ReactionSummaryPills: ({ reactionSummary }: { reactionSummary?: Record<string, number> }) => (
    <div data-testid="reaction-pills">{reactionSummary ? JSON.stringify(reactionSummary) : 'none'}</div>
  ),
}));

const broadcastSession1: ActivitySession = {
  sessionId: 'broadcast-1',
  userId: 'alice',
  sessionType: 'BROADCAST',
  recordingDuration: 120000,
  createdAt: new Date(Date.now() - 7200000).toISOString(),
  endedAt: new Date(Date.now() - 7200000).toISOString(),
};

const broadcastSession2: ActivitySession = {
  sessionId: 'broadcast-2',
  userId: 'bob',
  sessionType: 'BROADCAST',
  recordingDuration: 300000,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  endedAt: new Date(Date.now() - 3600000).toISOString(),
};

const hangoutSession: ActivitySession = {
  sessionId: 'hangout-1',
  userId: 'charlie',
  sessionType: 'HANGOUT',
  createdAt: new Date(Date.now() - 1800000).toISOString(),
  endedAt: new Date(Date.now() - 1800000).toISOString(),
  participantCount: 3,
  messageCount: 10,
};

describe('RecordingSlider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "No recordings yet" when sessions is empty array', () => {
    render(
      <BrowserRouter>
        <RecordingSlider sessions={[]} />
      </BrowserRouter>
    );
    expect(screen.getByText('No recordings yet')).toBeDefined();
  });

  it('renders "No recordings yet" when all sessions are HANGOUT type', () => {
    render(
      <BrowserRouter>
        <RecordingSlider sessions={[hangoutSession]} />
      </BrowserRouter>
    );
    expect(screen.getByText('No recordings yet')).toBeDefined();
  });

  it('renders only BROADCAST sessions, filtering out HANGOUT', () => {
    render(
      <BrowserRouter>
        <RecordingSlider sessions={[broadcastSession1, broadcastSession2, hangoutSession]} />
      </BrowserRouter>
    );

    expect(screen.getByText('alice')).toBeDefined();
    expect(screen.getByText('bob')).toBeDefined();
    expect(screen.queryByText('charlie')).toBeNull();
  });

  it('renders "Recent Broadcasts" heading', () => {
    render(
      <BrowserRouter>
        <RecordingSlider sessions={[broadcastSession1]} />
      </BrowserRouter>
    );
    expect(screen.getByText('Recent Broadcasts')).toBeDefined();
  });

  it('renders userId and formatted duration for each broadcast card', () => {
    render(
      <BrowserRouter>
        <RecordingSlider sessions={[broadcastSession1]} />
      </BrowserRouter>
    );

    expect(screen.getByText('alice')).toBeDefined();
    expect(screen.getByText('2:00')).toBeDefined();
  });

  it('renders scroll-snap container classes', () => {
    const { container } = render(
      <BrowserRouter>
        <RecordingSlider sessions={[broadcastSession1]} />
      </BrowserRouter>
    );

    const scrollContainer = container.querySelector('.overflow-x-auto.snap-x');
    expect(scrollContainer).not.toBeNull();
  });

  it('navigates to replay on card click', async () => {
    const { container } = render(
      <BrowserRouter>
        <RecordingSlider sessions={[broadcastSession1]} />
      </BrowserRouter>
    );

    const card = container.querySelector('.cursor-pointer');
    card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mockNavigate).toHaveBeenCalledWith('/replay/broadcast-1');
  });
});
