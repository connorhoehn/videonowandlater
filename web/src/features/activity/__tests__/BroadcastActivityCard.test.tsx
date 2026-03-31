/**
 * BroadcastActivityCard.test.tsx - Unit tests for BroadcastActivityCard component
 * Tests userId, duration format, reaction pills, relative timestamp, click navigation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { BroadcastActivityCard } from '../BroadcastActivityCard';
import type { ActivitySession } from '../RecordingSlider';

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

// Mock SummaryDisplay as passthrough
vi.mock('../../replay/SummaryDisplay', () => ({
  SummaryDisplay: ({ summary }: { summary?: string }) => (
    <div data-testid="summary-display">{summary || 'no-summary'}</div>
  ),
}));

// Mock PipelineStatusBadge as passthrough
vi.mock('../PipelineStatusBadge', () => ({
  PipelineStatusBadge: () => <div data-testid="pipeline-status-badge" />,
}));

const mockSession: ActivitySession = {
  sessionId: 'test-session-123',
  userId: 'testbroadcaster',
  sessionType: 'BROADCAST',
  recordingDuration: 120000, // 2 minutes
  createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  endedAt: new Date(Date.now() - 3600000).toISOString(),
  reactionSummary: { heart: 5, fire: 3 },
};

describe('BroadcastActivityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session userId as heading text', () => {
    render(
      <BrowserRouter>
        <BroadcastActivityCard session={mockSession} />
      </BrowserRouter>
    );

    expect(screen.getByText('testbroadcaster')).toBeDefined();
  });

  it('renders formatted duration "2 min" for recordingDuration 120000', () => {
    render(
      <BrowserRouter>
        <BroadcastActivityCard session={mockSession} />
      </BrowserRouter>
    );

    expect(screen.getByText(/2 min/)).toBeDefined();
  });

  it('renders thumbnail img when session.thumbnailUrl is present', () => {
    const session: ActivitySession = {
      ...mockSession,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    const img = screen.getByTestId('thumbnail');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('https://example.com/thumb.jpg');
  });

  it('renders relative timestamp', () => {
    render(
      <BrowserRouter>
        <BroadcastActivityCard session={mockSession} />
      </BrowserRouter>
    );

    // 1 hour ago should render "1h ago"
    expect(screen.getByText(/1h ago/)).toBeDefined();
  });

  it('omits duration when recordingDuration is undefined', () => {
    const session: ActivitySession = {
      ...mockSession,
      recordingDuration: undefined,
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    // Should still show the timestamp but no duration text
    expect(screen.getByText(/1h ago/)).toBeDefined();
    expect(screen.queryByText(/min/)).toBeNull();
  });

  it('calls navigate to replay page on click', () => {
    render(
      <BrowserRouter>
        <BroadcastActivityCard session={mockSession} />
      </BrowserRouter>
    );

    const card = screen.getByText('testbroadcaster').closest('.cursor-pointer');
    fireEvent.click(card!);

    expect(mockNavigate).toHaveBeenCalledWith('/replay/test-session-123');
  });

  it('renders ReactionSummaryPills with session reactionSummary', () => {
    render(
      <BrowserRouter>
        <BroadcastActivityCard session={mockSession} />
      </BrowserRouter>
    );

    const pills = screen.getByTestId('reaction-pills');
    expect(pills.textContent).toContain('heart');
    expect(pills.textContent).toContain('fire');
  });
});
