/**
 * BroadcastPage integration tests - stream quality dashboard integration
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BroadcastPage } from '../BroadcastPage';
import { MemoryRouter } from 'react-router-dom';
import * as amplifyAuth from 'aws-amplify/auth';

// Mock dependencies
vi.mock('aws-amplify/auth');
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ sessionId: 'test-session-123' }),
  };
});

vi.mock('../useBroadcast', () => ({
  useBroadcast: vi.fn(() => ({
    client: { mockClient: true }, // Mock IVS client
    previewRef: { current: null },
    startBroadcast: vi.fn(),
    stopBroadcast: vi.fn(),
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    startScreenShare: vi.fn(),
    stopScreenShare: vi.fn(),
    isLive: false,
    isLoading: false,
    isMuted: false,
    isCameraOn: true,
    isScreenSharing: false,
    error: null,
  })),
}));

vi.mock('../useViewerCount', () => ({
  useViewerCount: vi.fn(() => ({ viewerCount: 0 })),
}));

vi.mock('../../chat/useChatRoom', () => ({
  useChatRoom: vi.fn(() => ({
    room: null,
    connectionState: 'disconnected',
  })),
}));

vi.mock('../../chat/ChatPanel', () => ({
  ChatPanel: vi.fn(() => <div data-testid="chat-panel">Chat Panel</div>),
}));

vi.mock('../../chat/ChatRoomProvider', () => ({
  ChatRoomProvider: vi.fn(({ children }) => <>{children}</>),
}));

vi.mock('../CameraPreview', () => ({
  CameraPreview: vi.fn(() => <div data-testid="camera-preview">Camera Preview</div>),
}));

vi.mock('../../reactions/ReactionPicker', () => ({
  ReactionPicker: vi.fn(() => <div data-testid="reaction-picker">Reaction Picker</div>),
  EMOJI_MAP: {
    heart: '❤️',
    fire: '🔥',
    clap: '👏',
    laugh: '😂',
    star: '⭐',
  },
}));

vi.mock('../../reactions/FloatingReactions', () => ({
  FloatingReactions: vi.fn(() => <div data-testid="floating-reactions">Floating Reactions</div>),
}));

vi.mock('../../reactions/useReactionSender', () => ({
  useReactionSender: vi.fn(() => ({
    sendReaction: vi.fn(),
    sending: false,
  })),
}));

vi.mock('../../reactions/useReactionListener', () => ({
  useReactionListener: vi.fn(),
}));

vi.mock('../../config/aws-config', () => ({
  getConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3000/api' })),
}));

// Mock useStreamMetrics - will fail initially since it doesn't exist yet
vi.mock('../useStreamMetrics', () => ({
  useStreamMetrics: vi.fn(() => ({
    metrics: null,
    healthScore: null,
  })),
}));

// Mock StreamQualityOverlay - will fail initially since it's not imported
vi.mock('../StreamQualityOverlay', () => ({
  StreamQualityOverlay: vi.fn(() => <div data-testid="stream-quality-overlay">Stream Quality Overlay</div>),
}));

describe('BroadcastPage - Stream Quality Dashboard Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock auth session
    vi.mocked(amplifyAuth.fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: { 'cognito:username': 'testuser' },
          toString: () => 'fake-auth-token',
        },
      },
    } as any);
  });

  it('should import useStreamMetrics hook', async () => {
    // This test will fail until we add the import
    const { useStreamMetrics } = await import('../useStreamMetrics');
    expect(useStreamMetrics).toBeDefined();
  });

  it('should import StreamQualityOverlay component', async () => {
    // This test will fail until we add the import
    const { StreamQualityOverlay } = await import('../StreamQualityOverlay');
    expect(StreamQualityOverlay).toBeDefined();
  });

  it('should call useStreamMetrics with client and isLive', async () => {
    const { useBroadcast } = await import('../useBroadcast');
    const { useStreamMetrics } = await import('../useStreamMetrics');

    render(
      <MemoryRouter>
        <BroadcastPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Broadcasting')).toBeInTheDocument();
    });

    // Verify useStreamMetrics is called with correct parameters
    expect(useStreamMetrics).toHaveBeenCalled();
    const callArgs = vi.mocked(useStreamMetrics).mock.calls[0];
    expect(callArgs[0]).toEqual({ mockClient: true }); // client from useBroadcast
    expect(callArgs[1]).toBe(false); // isLive from useBroadcast
  });

  it('should render StreamQualityOverlay in camera preview section', async () => {
    render(
      <MemoryRouter>
        <BroadcastPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('camera-preview')).toBeInTheDocument();
    });

    // Verify StreamQualityOverlay is rendered
    expect(screen.getByTestId('stream-quality-overlay')).toBeInTheDocument();

    // Verify it's in the same container as FloatingReactions
    const floatingReactions = screen.getByTestId('floating-reactions');
    const qualityOverlay = screen.getByTestId('stream-quality-overlay');
    expect(floatingReactions.parentElement).toBe(qualityOverlay.parentElement);
  });

  it('should show dashboard when isLive=true', async () => {
    const { useBroadcast } = await import('../useBroadcast');
    const { StreamQualityOverlay } = await import('../StreamQualityOverlay');

    // Clear any previous calls
    vi.mocked(StreamQualityOverlay).mockClear();

    // Mock isLive=true
    vi.mocked(useBroadcast).mockReturnValue({
      client: { mockClient: true },
      previewRef: { current: null },
      startBroadcast: vi.fn(),
      stopBroadcast: vi.fn(),
      toggleMute: vi.fn(),
      toggleCamera: vi.fn(),
      startScreenShare: vi.fn(),
      stopScreenShare: vi.fn(),
      isLive: true, // Live state
      isLoading: false,
      isMuted: false,
      isCameraOn: true,
      isScreenSharing: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <BroadcastPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-quality-overlay')).toBeInTheDocument();
    });

    // Verify StreamQualityOverlay received isLive=true
    const overlayProps = vi.mocked(StreamQualityOverlay).mock.calls[0][0];
    expect(overlayProps.isLive).toBe(true);
  });

  it('should hide dashboard when isLive=false', async () => {
    const { useBroadcast } = await import('../useBroadcast');
    const { StreamQualityOverlay } = await import('../StreamQualityOverlay');

    // Clear any previous calls and reset mock to isLive=false
    vi.mocked(StreamQualityOverlay).mockClear();
    vi.mocked(useBroadcast).mockReturnValue({
      client: { mockClient: true },
      previewRef: { current: null },
      startBroadcast: vi.fn(),
      stopBroadcast: vi.fn(),
      toggleMute: vi.fn(),
      toggleCamera: vi.fn(),
      startScreenShare: vi.fn(),
      stopScreenShare: vi.fn(),
      isLive: false, // Not live state
      isLoading: false,
      isMuted: false,
      isCameraOn: true,
      isScreenSharing: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <BroadcastPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-quality-overlay')).toBeInTheDocument();
    });

    // Verify StreamQualityOverlay received isLive=false
    const lastCall = vi.mocked(StreamQualityOverlay).mock.calls[vi.mocked(StreamQualityOverlay).mock.calls.length - 1];
    expect(lastCall[0].isLive).toBe(false);
  });

  it('should pass metrics and healthScore from useStreamMetrics to StreamQualityOverlay', async () => {
    const { useStreamMetrics } = await import('../useStreamMetrics');
    const { StreamQualityOverlay } = await import('../StreamQualityOverlay');

    // Mock metrics data
    const mockMetrics = {
      streamId: 'test-stream',
      timestamp: Date.now(),
      video: { bitrate: 5000000, fps: 30, width: 1920, height: 1080 },
      audio: { bitrate: 128000 },
      network: { rtt: 20 },
    };

    const mockHealthScore = {
      score: 95,
      status: 'good' as const,
      factors: {
        bitrate: { score: 98, status: 'good' as const },
        fps: { score: 100, status: 'good' as const },
        network: { score: 88, status: 'good' as const },
      },
    };

    vi.mocked(useStreamMetrics).mockReturnValue({
      metrics: mockMetrics,
      healthScore: mockHealthScore,
    });

    render(
      <MemoryRouter>
        <BroadcastPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-quality-overlay')).toBeInTheDocument();
    });

    // Verify StreamQualityOverlay received correct props
    const overlayProps = vi.mocked(StreamQualityOverlay).mock.calls[0][0];
    expect(overlayProps.metrics).toEqual(mockMetrics);
    expect(overlayProps.healthScore).toEqual(mockHealthScore);
  });
});