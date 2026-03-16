/**
 * CommentThread.test.tsx - Unit tests for CommentThread click-to-seek and submission (UI-09)
 * These tests are RED until plan 03 adds onSeek prop to CommentThread.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentThread } from '../CommentThread';

// Mock getConfig
vi.mock('../../config/aws-config', () => ({
  getConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3000/api' })),
}));

const sampleComment = {
  commentId: 'c1',
  sessionId: 's1',
  userId: 'u1',
  text: 'hello world',
  videoPositionMs: 5000,
  createdAt: '2026-01-01T00:00:00Z',
};

// Helper: mock fetch to return comments list
function mockFetchComments(comments = [sampleComment]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ comments }),
  }) as any;
}

describe('CommentThread — renders comments (UI-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchComments();
  });

  it('renders each comment in the list', async () => {
    render(
      <CommentThread
        sessionId="s1"
        authToken="token"
        syncTime={0}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeDefined();
    });

    expect(screen.getByText('u1')).toBeDefined();
  });
});

describe('CommentThread — click-to-seek (UI-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchComments();
  });

  it('clicking a comment row calls onSeek(comment.videoPositionMs) when onSeek prop is provided', async () => {
    const onSeek = vi.fn();

    render(
      <CommentThread
        sessionId="s1"
        authToken="token"
        syncTime={10000}
        onSeek={onSeek}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeDefined();
    });

    // Click the comment row
    const commentText = screen.getByText('hello world');
    fireEvent.click(commentText.closest('div[class*="px-4"]') || commentText);

    expect(onSeek).toHaveBeenCalledWith(5000);
  });

  it('clicking a comment row does nothing when onSeek prop is not provided (no error)', async () => {
    render(
      <CommentThread
        sessionId="s1"
        authToken="token"
        syncTime={10000}
        // onSeek intentionally not provided
      />
    );

    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeDefined();
    });

    // Should not throw
    const commentText = screen.getByText('hello world');
    expect(() =>
      fireEvent.click(commentText.closest('div[class*="px-4"]') || commentText)
    ).not.toThrow();
  });
});

describe('CommentThread — submission guard (UI-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchComments([]);
  });

  it('submit button is disabled when syncTime === 0', async () => {
    render(
      <CommentThread
        sessionId="s1"
        authToken="token"
        syncTime={0}
      />
    );

    await waitFor(() => {
      // Loading complete
      expect(screen.queryByText('Loading comments...')).toBeNull();
    });

    const submitButton = screen.getByRole('button', { name: /post/i });
    expect(submitButton).toBeDefined();
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('submit button is enabled when syncTime > 0 and text is non-empty', async () => {
    render(
      <CommentThread
        sessionId="s1"
        authToken="token"
        syncTime={5000}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText('Loading comments...')).toBeNull();
    });

    const input = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(input, { target: { value: 'my comment' } });

    const submitButton = screen.getByRole('button', { name: /post at/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
  });
});
