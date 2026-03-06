/**
 * StreamQualityDashboard component tests
 * Phase 23-02: Stream Quality Monitoring Dashboard UI
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StreamQualityDashboard } from '../StreamQualityDashboard';
import { StreamMetrics, HealthScoreResult } from '../../../domain/metrics';

describe('StreamQualityDashboard', () => {
  const mockMetrics: StreamMetrics = {
    timestamp: Date.now(),
    bitrate: 2500000, // 2.5 Mbps in bytes
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

  it('renders health score circle with correct percentage', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('applies green color when score >= 80', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, score: 85 }}
        isLive={true}
      />
    );

    const scoreCircle = screen.getByText('85%').closest('div');
    expect(scoreCircle).toHaveClass('bg-green-600/20', 'text-green-400', 'border-green-600');
  });

  it('applies yellow color when score >= 60 and < 80', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, score: 70 }}
        isLive={true}
      />
    );

    const scoreCircle = screen.getByText('70%').closest('div');
    expect(scoreCircle).toHaveClass('bg-yellow-600/20', 'text-yellow-400', 'border-yellow-600');
  });

  it('applies red color when score < 60', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, score: 45 }}
        isLive={true}
      />
    );

    const scoreCircle = screen.getByText('45%').closest('div');
    expect(scoreCircle).toHaveClass('bg-red-600/20', 'text-red-400', 'border-red-600');
  });

  it('shows warning badge when warning is not none', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, warning: 'bitrate-drop' }}
        isLive={true}
      />
    );

    expect(screen.getByText('⚠ Issue Detected')).toBeInTheDocument();
    expect(screen.getByText('↓ Bitrate dropping')).toBeInTheDocument();
  });

  it('shows different warning messages based on warning type', () => {
    const { rerender } = render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, warning: 'fps-drop' }}
        isLive={true}
      />
    );

    expect(screen.getByText('↓ Frame rate low')).toBeInTheDocument();

    rerender(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, warning: 'both' }}
        isLive={true}
      />
    );

    expect(screen.getByText('↓ Bitrate & FPS low')).toBeInTheDocument();
  });

  it('shows detailed metrics when expanded', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    // Click expand button
    const expandButton = screen.getByLabelText('Expand');
    fireEvent.click(expandButton);

    // Check detailed metrics are visible
    expect(screen.getByText('Bitrate')).toBeInTheDocument();
    expect(screen.getByText('2500 kbps')).toBeInTheDocument();
    expect(screen.getByText('Frame Rate')).toBeInTheDocument();
    expect(screen.getByText('30 fps')).toBeInTheDocument();
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByText('1920×1080')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('wifi')).toBeInTheDocument();
  });

  it('hides detailed metrics when collapsed', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    // Initially collapsed - detailed metrics should not be visible
    expect(screen.queryByText('2500 kbps')).not.toBeInTheDocument();

    // Click expand button
    const expandButton = screen.getByLabelText('Expand');
    fireEvent.click(expandButton);

    // Now visible
    expect(screen.getByText('2500 kbps')).toBeInTheDocument();

    // Click collapse button
    const collapseButton = screen.getByLabelText('Collapse');
    fireEvent.click(collapseButton);

    // Hidden again
    expect(screen.queryByText('2500 kbps')).not.toBeInTheDocument();
  });

  it('shows quality limitation when not none', () => {
    render(
      <StreamQualityDashboard
        metrics={{ ...mockMetrics, qualityLimitation: 'bandwidth' }}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    // Click expand button
    const expandButton = screen.getByLabelText('Expand');
    fireEvent.click(expandButton);

    expect(screen.getByText('Limited By')).toBeInTheDocument();
    expect(screen.getByText('bandwidth')).toBeInTheDocument();
  });

  it('returns null when isLive is false', () => {
    const { container } = render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={false}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('returns null when metrics is null', () => {
    const { container } = render(
      <StreamQualityDashboard
        metrics={null as any}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('returns null when healthScore is null', () => {
    const { container } = render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={null as any}
        isLive={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('formats bitrate correctly using formatBitrate helper', () => {
    render(
      <StreamQualityDashboard
        metrics={{ ...mockMetrics, bitrate: 3750000 }} // 3.75 Mbps
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    // Click expand button
    const expandButton = screen.getByLabelText('Expand');
    fireEvent.click(expandButton);

    expect(screen.getByText('3750 kbps')).toBeInTheDocument();
  });

  it('shows healthy stream message when no warnings', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={{ ...mockHealthScore, warning: 'none' }}
        isLive={true}
      />
    );

    expect(screen.getByText('✓ Healthy Stream')).toBeInTheDocument();
  });

  it('shows bitrate and fps health percentages in summary', () => {
    render(
      <StreamQualityDashboard
        metrics={mockMetrics}
        healthScore={mockHealthScore}
        isLive={true}
      />
    );

    expect(screen.getByText('Bitrate: 90% | FPS: 80%')).toBeInTheDocument();
  });
});