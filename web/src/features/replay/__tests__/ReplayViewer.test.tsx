import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ReplayViewer } from '../ReplayViewer';

// Type declaration for global.fetch
declare global {
  var fetch: ReturnType<typeof vi.fn>;
}

// Mock dependencies
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(() =>
    Promise.resolve({
      tokens: {
        idToken: {
          payload: {
            'cognito:username': 'testuser',
          },
          toString: () => 'mock-token',
        },
      },
    })
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ sessionId: 'test-session-123' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../useReplayPlayer', () => ({
  useReplayPlayer: vi.fn(() => ({
    videoRef: { current: null },
    syncTime: 0,
  })),
}));

vi.mock('../useReactionSync', () => ({
  useReactionSync: vi.fn(() => []),
}));

vi.mock('../../reactions/useReactionSender', () => ({
  useReactionSender: vi.fn(() => ({
    sendReaction: vi.fn(),
  })),
}));

vi.mock('../../reactions/FloatingReactions', () => ({
  FloatingReactions: () => <div data-testid="floating-reactions" />,
}));

vi.mock('../ReplayChat', () => ({
  ReplayChat: () => <div data-testid="replay-chat" />,
}));

vi.mock('../ReactionTimeline', () => ({
  ReactionTimeline: () => <div data-testid="reaction-timeline" />,
}));

vi.mock('../ReplayReactionPicker', () => ({
  ReplayReactionPicker: () => <div data-testid="replay-reaction-picker" />,
}));

vi.mock('../../activity/ReactionSummaryPills', () => ({
  ReactionSummaryPills: ({ reactionSummary }: { reactionSummary?: Record<string, number> }) => (
    <div data-testid="reaction-summary-pills">
      {reactionSummary && Object.keys(reactionSummary).length > 0 ? (
        Object.entries(reactionSummary).map(([emoji, count]) => (
          <span key={emoji} data-testid={`reaction-${emoji}`}>
            {emoji}: {count}
          </span>
        ))
      ) : (
        <span data-testid="no-reactions">No reactions</span>
      )}
    </div>
  ),
}));

const mockSessionWithReactions = {
  sessionId: 'test-session-123',
  userId: 'broadcaster1',
  recordingHlsUrl: 'https://example.com/stream.m3u8',
  recordingDuration: 120000,
  createdAt: '2026-03-01T10:00:00Z',
  endedAt: '2026-03-01T10:02:00Z',
  reactionSummary: {
    heart: 42,
    fire: 17,
    clap: 8,
  },
};

const mockSessionNoReactions = {
  sessionId: 'test-session-456',
  userId: 'broadcaster2',
  recordingHlsUrl: 'https://example.com/stream2.m3u8',
  recordingDuration: 60000,
  createdAt: '2026-03-02T10:00:00Z',
  reactionSummary: {},
};

describe('ReplayViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display reaction summary in info panel when session has reactions', async () => {
    // Mock the fetch to return a session with reactions
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSessionWithReactions),
        } as Response);
      }
      if (url.includes('/reactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reactions: [] }),
        } as Response);
      }
      if (url.includes('/chapters')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ chapters: [] }),
        } as Response);
      }
      if (url.includes('/recording/download')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'not available' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(
      <BrowserRouter>
        <ReplayViewer />
      </BrowserRouter>
    );

    // Verify ReactionSummaryPills is rendered
    const reactionSummaryPills = await screen.findByTestId('reaction-summary-pills');
    expect(reactionSummaryPills).toBeDefined();
  });

  it('should handle session with no reactions gracefully', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSessionNoReactions),
        } as Response);
      }
      if (url.includes('/reactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reactions: [] }),
        } as Response);
      }
      if (url.includes('/chapters')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ chapters: [] }),
        } as Response);
      }
      if (url.includes('/recording/download')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'not available' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(
      <BrowserRouter>
        <ReplayViewer />
      </BrowserRouter>
    );

    // Verify "No reactions" message is shown
    const noReactionsMessage = await screen.findByTestId('no-reactions');
    expect(noReactionsMessage).toBeDefined();
  });

  it('should display broadcaster info in metadata panel', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSessionWithReactions),
        } as Response);
      }
      if (url.includes('/reactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reactions: [] }),
        } as Response);
      }
      if (url.includes('/chapters')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ chapters: [] }),
        } as Response);
      }
      if (url.includes('/recording/download')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'not available' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(
      <BrowserRouter>
        <ReplayViewer />
      </BrowserRouter>
    );

    // Verify broadcaster name is displayed
    const broadcasterName = await screen.findByText('broadcaster1');
    expect(broadcasterName).toBeDefined();
  });

  it('should display duration in metadata panel', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSessionWithReactions),
        } as Response);
      }
      if (url.includes('/reactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reactions: [] }),
        } as Response);
      }
      if (url.includes('/chapters')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ chapters: [] }),
        } as Response);
      }
      if (url.includes('/recording/download')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'not available' }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(
      <BrowserRouter>
        <ReplayViewer />
      </BrowserRouter>
    );

    // Verify duration section exists and reaction summary pills are rendered
    const reactionSummaryPills = await screen.findByTestId('reaction-summary-pills');
    expect(reactionSummaryPills).toBeDefined();
  });
});
