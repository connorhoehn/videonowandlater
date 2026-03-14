/**
 * PipelineStatusBadge.test.tsx - Unit tests for PipelineStatusBadge component
 * Tests badge rendering for each pipeline state
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineStatusBadge } from '../PipelineStatusBadge';
import type { ActivitySession } from '../RecordingSlider';

const baseSession: ActivitySession = {
  sessionId: 'test-session-1',
  userId: 'testuser',
  sessionType: 'BROADCAST',
  createdAt: new Date().toISOString(),
};

describe('PipelineStatusBadge', () => {
  it('renders "Converting" with yellow badge when convertStatus is processing', () => {
    render(
      <PipelineStatusBadge session={{ ...baseSession, convertStatus: 'processing' }} />
    );

    const badge = screen.getByText('Converting');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('bg-yellow-100');
    expect(badge.className).toContain('text-yellow-700');
  });

  it('renders "Transcribing" with yellow badge when transcriptStatus is processing', () => {
    render(
      <PipelineStatusBadge session={{ ...baseSession, transcriptStatus: 'processing' }} />
    );

    const badge = screen.getByText('Transcribing');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('bg-yellow-100');
    expect(badge.className).toContain('text-yellow-700');
  });

  it('renders "Summarizing" with purple badge when aiSummaryStatus is pending and transcriptStatus is available', () => {
    render(
      <PipelineStatusBadge
        session={{ ...baseSession, aiSummaryStatus: 'pending', transcriptStatus: 'available' }}
      />
    );

    const badge = screen.getByText('Summarizing');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('bg-purple-100');
    expect(badge.className).toContain('text-purple-700');
  });

  it('renders "Complete" with green badge when aiSummaryStatus is available', () => {
    render(
      <PipelineStatusBadge session={{ ...baseSession, aiSummaryStatus: 'available' }} />
    );

    const badge = screen.getByText('Complete');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-700');
  });

  it('renders "Failed" with red badge when any status is failed', () => {
    render(
      <PipelineStatusBadge session={{ ...baseSession, convertStatus: 'failed' }} />
    );

    const badge = screen.getByText('Failed');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-700');
  });

  it('returns null when no pipeline fields are set', () => {
    const { container } = render(
      <PipelineStatusBadge session={baseSession} />
    );

    expect(container.innerHTML).toBe('');
  });
});
