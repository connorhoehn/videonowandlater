/**
 * BroadcastActivityCard.test.tsx - Unit tests for BroadcastActivityCard component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { BroadcastActivityCard } from './BroadcastActivityCard';
import type { ActivitySession } from './RecordingSlider';

// Mock useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const mockSession: ActivitySession = {
  sessionId: 'test-session-123',
  userId: 'testuser',
  sessionType: 'BROADCAST',
  recordingDuration: 120000, // 2 minutes
  createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  endedAt: new Date(Date.now() - 3600000).toISOString(),
  reactionSummary: { '❤️': 5, '👍': 3 },
};

describe('BroadcastActivityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display truncated AI summary when status is available', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: 'available',
      aiSummary: 'This is a test summary for the broadcast session.',
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    // Check if summary text is displayed
    expect(screen.getByText('This is a test summary for the broadcast session.')).toBeDefined();
  });

  it('should show "Generating summary..." placeholder when status is pending', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: 'pending',
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    expect(screen.getByText('Generating summary...')).toBeDefined();
  });

  it('should treat undefined aiSummaryStatus as pending (backward compatibility)', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: undefined,
      aiSummary: 'Test summary',
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    // Should show pending message, not the summary
    expect(screen.getByText('Generating summary...')).toBeDefined();
    expect(screen.queryByText('Test summary')).toBeNull();
  });

  it('should show "Summary unavailable" when status is failed', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: 'failed',
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    expect(screen.getByText('Summary unavailable')).toBeDefined();
  });

  it('should render line-clamp-2 class for truncated summary', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: 'available',
      aiSummary: 'Test summary',
    };

    const { container } = render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    // Find the summary paragraph and verify it has line-clamp-2
    const paragraphs = container.querySelectorAll('p');
    let hasLineClamp = false;
    paragraphs.forEach(p => {
      if (p.textContent?.includes('Test summary') && p.className?.includes('line-clamp-2')) {
        hasLineClamp = true;
      }
    });
    expect(hasLineClamp).toBe(true);
  });

  it('should not break existing card layout without summary fields', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: undefined,
      aiSummary: undefined,
    };

    const { container } = render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    // Should still render the card with userId and timestamp
    expect(screen.getByText('testuser')).toBeDefined();
    // Verify no console errors occur (implicitly tested by render not throwing)
    expect(container).toBeDefined();
  });

  it('should display userId and duration metadata', () => {
    const session: ActivitySession = {
      ...mockSession,
      aiSummaryStatus: 'available',
      aiSummary: 'Summary text',
    };

    render(
      <BrowserRouter>
        <BroadcastActivityCard session={session} />
      </BrowserRouter>
    );

    expect(screen.getByText('testuser')).toBeDefined();
    // Duration in human-readable format
    expect(screen.getByText(/2 min/)).toBeDefined();
  });
});
