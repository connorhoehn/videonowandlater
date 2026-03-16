/**
 * VideoPage.test.tsx - Unit tests for VideoPage polling (UI-08)
 * These tests are RED until plan 03 adds polling to VideoPage.
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { VideoPage } from '../VideoPage';

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ sessionId: 'test-session-vid' }),
    useNavigate: () => vi.fn(),
  };
});

// Mock aws-amplify/auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        toString: () => 'mock-token',
        payload: { 'cognito:username': 'user1' },
      },
    },
  }),
}));

// Mock config
vi.mock('../../config/aws-config', () => ({
  getConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3000/api' })),
}));

// Mock HLS player
vi.mock('../useHlsPlayer', () => ({
  useHlsPlayer: vi.fn(() => ({
    videoRef: { current: null },
    qualities: [],
    currentQuality: null,
    setQuality: vi.fn(),
    isSafari: false,
    syncTime: 0,
  })),
}));

// Mock child components that VideoPage renders
vi.mock('../../activity/SessionAuditLog', () => ({
  SessionAuditLog: vi.fn(() => <div data-testid="session-audit-log" />),
}));

vi.mock('../../replay/SummaryDisplay', () => ({
  SummaryDisplay: vi.fn(() => <div data-testid="summary-display" />),
}));

vi.mock('../VideoInfoPanel', () => ({
  VideoInfoPanel: vi.fn(() => <div data-testid="video-info-panel" />),
}));

vi.mock('../CommentThread', () => ({
  CommentThread: vi.fn(() => <div data-testid="comment-thread" />),
}));

vi.mock('../QualitySelector', () => ({
  QualitySelector: vi.fn(() => <div data-testid="quality-selector" />),
}));

vi.mock('../../activity/ReactionSummaryPills', () => ({
  ReactionSummaryPills: vi.fn(() => <div data-testid="reaction-summary-pills" />),
}));

vi.mock('../../replay/ReplayReactionPicker', () => ({
  ReplayReactionPicker: vi.fn(() => <div data-testid="replay-reaction-picker" />),
}));

vi.mock('../../reactions/useReactionSender', () => ({
  useReactionSender: vi.fn(() => ({ sendReaction: vi.fn(), sending: false })),
}));

// Build a session response helper
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'test-session-vid',
    userId: 'user1',
    sessionType: 'UPLOAD',
    recordingHlsUrl: 'https://example.com/stream.m3u8',
    createdAt: '2026-01-01T00:00:00Z',
    aiSummaryStatus: 'available',
    transcriptStatus: 'available',
    convertStatus: 'available',
    recordingStatus: 'available',
    ...overrides,
  };
}

// Helper: mock fetch to return a given session (+ empty reactions for /reactions calls)
function mockFetchSession(session: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if ((url as string).includes('/reactions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ reactions: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(session),
    });
  }) as any;
}

describe('VideoPage — Polling starts for non-terminal sessions (UI-08)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.clearAllMocks();
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  it('starts polling (setInterval called) when session aiSummaryStatus is "pending"', async () => {
    mockFetchSession(makeSession({ aiSummaryStatus: 'pending' }));

    render(
      <MemoryRouter>
        <VideoPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const pollingCalls = setIntervalSpy.mock.calls.filter(
        ([, delay]) => typeof delay === 'number' && (delay as number) >= 5000
      );
      expect(pollingCalls.length).toBeGreaterThan(0);
    });
  });

  it('starts polling when session transcriptStatus is "processing"', async () => {
    mockFetchSession(
      makeSession({ aiSummaryStatus: 'pending', transcriptStatus: 'processing' })
    );

    render(
      <MemoryRouter>
        <VideoPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const pollingCalls = setIntervalSpy.mock.calls.filter(
        ([, delay]) => typeof delay === 'number' && (delay as number) >= 5000
      );
      expect(pollingCalls.length).toBeGreaterThan(0);
    });
  });
});

describe('VideoPage — Polling does NOT start for terminal sessions (UI-08)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.clearAllMocks();
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  it('does NOT start polling when aiSummaryStatus is "available" (terminal)', async () => {
    mockFetchSession(makeSession({ aiSummaryStatus: 'available' }));

    render(
      <MemoryRouter>
        <VideoPage />
      </MemoryRouter>
    );

    // Wait for auth + session fetch to settle
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // Allow any state updates to flush
    await new Promise(r => setTimeout(r, 50));

    // setInterval should NOT have been called with a polling delay
    const pollingCalls = setIntervalSpy.mock.calls.filter(
      ([, delay]) => typeof delay === 'number' && (delay as number) >= 5000
    );
    expect(pollingCalls.length).toBe(0);
  });

  it('does NOT start polling when any status is "failed" (terminal)', async () => {
    mockFetchSession(
      makeSession({ convertStatus: 'failed', aiSummaryStatus: 'pending' })
    );

    render(
      <MemoryRouter>
        <VideoPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    await new Promise(r => setTimeout(r, 50));

    const pollingCalls = setIntervalSpy.mock.calls.filter(
      ([, delay]) => typeof delay === 'number' && (delay as number) >= 5000
    );
    expect(pollingCalls.length).toBe(0);
  });
});
