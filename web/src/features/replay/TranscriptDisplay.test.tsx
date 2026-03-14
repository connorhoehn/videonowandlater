/**
 * TranscriptDisplay.test.tsx - Tests for click-to-seek behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TranscriptDisplay } from './TranscriptDisplay';

// Mock aws-config
vi.mock('../../config/aws-config', () => ({
  getConfig: () => ({ apiUrl: 'http://localhost:3000/api' }),
}));

// Helper to create a mock fetch response with plain transcript segments
function mockPlainTranscriptFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        results: {
          items: [
            {
              type: 'pronunciation',
              start_time: '1.0',
              end_time: '2.0',
              alternatives: [{ content: 'Hello' }],
            },
            {
              type: 'pronunciation',
              start_time: '1.5',
              end_time: '2.5',
              alternatives: [{ content: 'world' }],
            },
            // Second segment (gap > 1s)
            {
              type: 'pronunciation',
              start_time: '5.0',
              end_time: '6.0',
              alternatives: [{ content: 'Second' }],
            },
            {
              type: 'pronunciation',
              start_time: '5.5',
              end_time: '6.5',
              alternatives: [{ content: 'segment' }],
            },
          ],
        },
      }),
  });
}

// Helper to create a mock fetch response with speaker segments
function mockSpeakerTranscriptFetch() {
  // First call returns plain transcript, second call returns speaker segments
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // plain transcript
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: {
              items: [
                {
                  type: 'pronunciation',
                  start_time: '1.0',
                  end_time: '2.0',
                  alternatives: [{ content: 'Hello' }],
                },
              ],
            },
          }),
      });
    }
    // speaker segments
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          segments: [
            { speaker: 'Speaker 1', startTime: 1000, endTime: 2000, text: 'Hello from speaker 1' },
            { speaker: 'Speaker 2', startTime: 3000, endTime: 4000, text: 'Hello from speaker 2' },
          ],
        }),
    });
  });
}

describe('TranscriptDisplay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('click-to-seek with plain segments', () => {
    it('calls onSeek with segment startTime when clicking a plain segment', async () => {
      const mockFetch = mockPlainTranscriptFetch();
      global.fetch = mockFetch;
      const onSeek = vi.fn();

      render(
        <TranscriptDisplay
          sessionId="test-session"
          currentTime={0}
          authToken="test-token"
          onSeek={onSeek}
        />,
      );

      // Wait for transcript to load
      await waitFor(() => {
        expect(screen.getByText('0:01')).toBeDefined();
      });

      // Click the first segment (startTime = 1000ms)
      const firstSegmentTime = screen.getByText('0:01');
      const segmentDiv = firstSegmentTime.closest('[data-testid^="segment-"]');
      expect(segmentDiv).not.toBeNull();
      fireEvent.click(segmentDiv!);

      expect(onSeek).toHaveBeenCalledWith(1000);
    });

    it('segments have cursor-pointer class when onSeek is provided', async () => {
      const mockFetch = mockPlainTranscriptFetch();
      global.fetch = mockFetch;
      const onSeek = vi.fn();

      render(
        <TranscriptDisplay
          sessionId="test-session"
          currentTime={0}
          authToken="test-token"
          onSeek={onSeek}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('0:01')).toBeDefined();
      });

      const segmentDiv = screen.getByText('0:01').closest('[data-testid^="segment-"]');
      expect(segmentDiv?.className).toContain('cursor-pointer');
    });
  });

  describe('click-to-seek with speaker bubbles', () => {
    it('calls onSeek with speaker segment startTime when clicking a speaker bubble', async () => {
      const mockFetch = mockSpeakerTranscriptFetch();
      global.fetch = mockFetch;
      const onSeek = vi.fn();

      render(
        <TranscriptDisplay
          sessionId="test-session"
          currentTime={0}
          authToken="test-token"
          diarizedTranscriptS3Path="s3://bucket/path"
          onSeek={onSeek}
        />,
      );

      // Wait for speaker segments to load
      await waitFor(() => {
        expect(screen.getByText('Hello from speaker 1')).toBeDefined();
      });

      // Click the first speaker bubble (startTime = 1000ms)
      const bubble = screen.getByText('Hello from speaker 1').closest('[data-testid^="speaker-segment-"]');
      expect(bubble).not.toBeNull();
      fireEvent.click(bubble!);

      expect(onSeek).toHaveBeenCalledWith(1000);
    });
  });

  describe('optional callback', () => {
    it('does not throw when onSeek is not provided and a segment is clicked', async () => {
      const mockFetch = mockPlainTranscriptFetch();
      global.fetch = mockFetch;

      render(
        <TranscriptDisplay
          sessionId="test-session"
          currentTime={0}
          authToken="test-token"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('0:01')).toBeDefined();
      });

      const segmentDiv = screen.getByText('0:01').closest('[data-testid^="segment-"]');
      // Should not throw
      expect(() => fireEvent.click(segmentDiv!)).not.toThrow();
    });

    it('segments do not have cursor-pointer class when onSeek is not provided', async () => {
      const mockFetch = mockPlainTranscriptFetch();
      global.fetch = mockFetch;

      render(
        <TranscriptDisplay
          sessionId="test-session"
          currentTime={0}
          authToken="test-token"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('0:01')).toBeDefined();
      });

      const segmentDiv = screen.getByText('0:01').closest('[data-testid^="segment-"]');
      expect(segmentDiv?.className).not.toContain('cursor-pointer');
    });
  });
});
