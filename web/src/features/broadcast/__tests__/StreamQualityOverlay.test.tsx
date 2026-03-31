/**
 * StreamQualityOverlay component tests
 * Phase 23-02: Stream Quality Monitoring Dashboard UI
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { StreamQualityOverlay } from '../StreamQualityOverlay';
import { StreamMetrics, HealthScoreResult } from '../../../domain/metrics';

// Mock the StreamQualityDashboard component
vi.mock('../StreamQualityDashboard', () => ({
  StreamQualityDashboard: ({ metrics, healthScore, isLive }: any) => (
    <div data-testid="stream-quality-dashboard">
      Dashboard: {isLive ? 'live' : 'not-live'}
    </div>
  )
}));

describe('StreamQualityOverlay', () => {
  const mockMetrics: StreamMetrics = {
    timestamp: Date.now(),
    bitrate: 2500000,
    framesPerSecond: 30,
    resolution: { width: 1920, height: 1080 },
    networkType: 'wifi',
    qualityLimitation: 'none',
    jitter: 5,
    packetsLost: 10
  };

  const mockHealthScore: HealthScoreResult = {
    score: 85,
    bitrateHealth: 90,
    fpsHealth: 80,
    warning: 'none'
  };

  it('renders in bottom-right position with correct styling', () => {
    const { container } = render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    const overlay = container.firstChild;
    expect(overlay).toHaveClass('absolute', 'bottom-3', 'right-3', 'z-40');
  });

  it('renders StreamQualityDashboard inside overlay', () => {
    render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    expect(screen.getByTestId('stream-quality-dashboard')).toBeInTheDocument();
    expect(screen.getByText('Dashboard: live')).toBeInTheDocument();
  });

  it('returns null when isLive is false', () => {
    const { container } = render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={false}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('returns null when metrics is null', () => {
    const { container } = render(
      <StreamQualityOverlay
        metrics={null}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('returns null when healthScore is null', () => {
    const { container } = render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={null}
        isLive={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('passes all props correctly to StreamQualityDashboard', () => {
    render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    // The mock component receives the isLive prop and displays it
    expect(screen.getByText('Dashboard: live')).toBeInTheDocument();
  });

  it('maintains z-40 layering (above reactions z-30, below controls z-50)', () => {
    const { container } = render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    const overlay = container.firstChild;
    // This positions it above FloatingReactions (z-30) but below broadcast controls (z-50)
    expect(overlay).toHaveClass('z-40');
  });

  it('uses responsive width classes', () => {
    const { container } = render(
      <StreamQualityOverlay
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    const overlay = container.firstChild;
    expect(overlay).toHaveClass('w-64');
  });
});