/**
 * HangoutActivityCard.test.tsx - Unit tests for HangoutActivityCard component
 * Tests userId, participantCount, messageCount, plural handling, duration, click navigation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HangoutActivityCard } from '../HangoutActivityCard';
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

// Mock SummaryDisplay as passthrough
vi.mock('../../replay/SummaryDisplay', () => ({
  SummaryDisplay: ({ summary }: { summary?: string }) => (
    <div data-testid="summary-display">{summary || 'no-summary'}</div>
  ),
}));

const mockSession: ActivitySession = {
  sessionId: 'test-session-123',
  userId: 'hangouthost',
  sessionType: 'HANGOUT',
  recordingDuration: 120000, // 2 minutes
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  endedAt: new Date(Date.now() - 3600000).toISOString(),
  participantCount: 3,
  messageCount: 5,
};

describe('HangoutActivityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session userId as heading text', () => {
    render(
      <BrowserRouter>
        <HangoutActivityCard session={mockSession} />
      </BrowserRouter>
    );

    expect(screen.getByText('hangouthost')).toBeDefined();
  });

  it('renders participantCount with plural: "3 participants"', () => {
    render(
      <BrowserRouter>
        <HangoutActivityCard session={mockSession} />
      </BrowserRouter>
    );

    expect(screen.getByText(/3 participants/)).toBeDefined();
  });

  it('renders participantCount singular: "1 participant"', () => {
    const session: ActivitySession = {
      ...mockSession,
      participantCount: 1,
    };

    render(
      <BrowserRouter>
        <HangoutActivityCard session={session} />
      </BrowserRouter>
    );

    expect(screen.getByText(/1 participant[^s]/)).toBeDefined();
  });

  it('renders messageCount with plural: "5 messages"', () => {
    render(
      <BrowserRouter>
        <HangoutActivityCard session={mockSession} />
      </BrowserRouter>
    );

    expect(screen.getByText(/5 messages/)).toBeDefined();
  });

  it('renders messageCount singular: "1 message"', () => {
    const session: ActivitySession = {
      ...mockSession,
      messageCount: 1,
    };

    render(
      <BrowserRouter>
        <HangoutActivityCard session={session} />
      </BrowserRouter>
    );

    expect(screen.getByText(/1 message[^s]/)).toBeDefined();
  });

  it('renders formatted duration and relative timestamp', () => {
    render(
      <BrowserRouter>
        <HangoutActivityCard session={mockSession} />
      </BrowserRouter>
    );

    expect(screen.getByText(/2:00/)).toBeDefined();
    expect(screen.getByText(/1h/)).toBeDefined();
  });

  it('defaults participantCount and messageCount to 0 when undefined', () => {
    const session: ActivitySession = {
      ...mockSession,
      participantCount: undefined,
      messageCount: undefined,
    };

    render(
      <BrowserRouter>
        <HangoutActivityCard session={session} />
      </BrowserRouter>
    );

    expect(screen.getByText(/0 participants/)).toBeDefined();
    expect(screen.getByText(/0 messages/)).toBeDefined();
  });

  it('calls navigate to replay page on click', () => {
    render(
      <BrowserRouter>
        <HangoutActivityCard session={mockSession} />
      </BrowserRouter>
    );

    const card = screen.getByText('hangouthost').closest('.cursor-pointer');
    fireEvent.click(card!);

    expect(mockNavigate).toHaveBeenCalledWith('/replay/test-session-123');
  });
});
