/**
 * HangoutPage.test.tsx - Unit tests for HangoutPage (UI-06 leave guard + UI-07 reaction parity)
 * These tests are RED until plan 02 wires ConfirmDialog and ReactionPicker into HangoutPage.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mock heavy deps
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        toString: () => 'mock-token',
        payload: { 'cognito:username': 'testuser' },
      },
    },
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ sessionId: 'test-session' }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../useHangout', () => ({
  useHangout: vi.fn(() => ({
    localVideoRef: { current: null },
    participants: [],
    isJoined: true,
    error: null,
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
  })),
}));

vi.mock('../../chat/useChatRoom', () => ({
  useChatRoom: vi.fn(() => ({
    room: null,
    connectionState: 'disconnected',
    error: null,
  })),
}));

vi.mock('../useActiveSpeaker', () => ({
  useActiveSpeaker: vi.fn(() => ({ activeSpeakerId: null })),
}));

vi.mock('../VideoGrid', () => ({
  VideoGrid: vi.fn(() => <div data-testid="video-grid" />),
}));

vi.mock('../../chat/ChatPanel', () => ({
  ChatPanel: vi.fn(() => <div data-testid="chat-panel" />),
}));

vi.mock('../../chat/ChatRoomProvider', () => ({
  ChatRoomProvider: vi.fn(({ children }) => <>{children}</>),
}));

const mockSendReaction = vi.fn();
vi.mock('../../reactions/useReactionSender', () => ({
  useReactionSender: vi.fn(() => ({
    sendReaction: mockSendReaction,
    sending: false,
  })),
}));

vi.mock('../../reactions/useReactionListener', () => ({
  useReactionListener: vi.fn(),
}));

vi.mock('../../reactions/ReactionPicker', () => ({
  ReactionPicker: vi.fn(({ onReaction }: { onReaction: (emoji: string) => void }) => (
    <div data-testid="reaction-picker">
      <button onClick={() => onReaction('heart')} data-testid="emoji-heart">
        ❤️
      </button>
    </div>
  )),
  EMOJI_MAP: {
    heart: '❤️',
    fire: '🔥',
    clap: '👏',
    laugh: '😂',
    star: '⭐',
  },
}));

vi.mock('../../reactions/FloatingReactions', () => ({
  FloatingReactions: vi.fn(() => <div data-testid="floating-reactions" />),
}));

vi.mock('../../config/aws-config', () => ({
  getConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3000/api' })),
}));

vi.mock('../../components/ConfirmDialog', () => ({
  ConfirmDialog: vi.fn(
    ({
      isOpen,
      onConfirm,
      onCancel,
    }: {
      isOpen: boolean;
      onConfirm: () => void;
      onCancel: () => void;
    }) =>
      isOpen ? (
        <div data-testid="confirm-dialog">
          <button onClick={onConfirm} data-testid="confirm-btn">
            Confirm
          </button>
          <button onClick={onCancel} data-testid="cancel-btn">
            Cancel
          </button>
        </div>
      ) : null
  ),
}));

import { HangoutPage } from '../HangoutPage';

describe('HangoutPage — Leave confirmation (UI-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clicking the header "← Leave" button shows ConfirmDialog, does NOT call navigate immediately', async () => {
    render(
      <MemoryRouter>
        <HangoutPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Hangout')).toBeDefined();
    });

    const leaveHeader = screen.getByText('← Leave');
    fireEvent.click(leaveHeader);

    expect(screen.getByTestId('confirm-dialog')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clicking the controls bar "Leave" button shows ConfirmDialog, does NOT call navigate immediately', async () => {
    render(
      <MemoryRouter>
        <HangoutPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('video-grid')).toBeDefined();
    });

    // The controls "Leave" button is inside the controls bar (not the header)
    const leaveButtons = screen.getAllByText('Leave');
    const controlsLeave = leaveButtons.find(btn => btn.tagName === 'BUTTON');
    expect(controlsLeave).toBeDefined();
    fireEvent.click(controlsLeave!);

    expect(screen.getByTestId('confirm-dialog')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clicking ConfirmDialog Confirm calls navigate("/")', async () => {
    render(
      <MemoryRouter>
        <HangoutPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('← Leave')).toBeDefined();
    });

    fireEvent.click(screen.getByText('← Leave'));
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('confirm-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('clicking ConfirmDialog Cancel dismisses dialog without navigating', async () => {
    render(
      <MemoryRouter>
        <HangoutPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('← Leave')).toBeDefined();
    });

    fireEvent.click(screen.getByText('← Leave'));
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('cancel-btn'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });
});

describe('HangoutPage — Reactions (UI-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ReactionPicker renders in controls bar when isJoined=true', async () => {
    render(
      <MemoryRouter>
        <HangoutPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('video-grid')).toBeDefined();
    });

    expect(screen.getByTestId('reaction-picker')).toBeDefined();
  });

  it('clicking an emoji in ReactionPicker calls sendReaction mock', async () => {
    render(
      <MemoryRouter>
        <HangoutPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reaction-picker')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('emoji-heart'));
    expect(mockSendReaction).toHaveBeenCalled();
  });
});
