/**
 * SummaryDisplay.test.tsx - Unit tests for SummaryDisplay component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryDisplay } from './SummaryDisplay';

describe('SummaryDisplay', () => {
  it('should show "Generating summary..." when status is pending', () => {
    render(<SummaryDisplay status="pending" />);
    expect(screen.getByText('Generating summary...')).toBeDefined();
  });

  it('should render a spinner (animate-spin) when status is pending', () => {
    const { container } = render(<SummaryDisplay status="pending" />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('should treat undefined status as pending (backward compatibility)', () => {
    render(<SummaryDisplay status={undefined} summary="Test summary" />);
    // Should show pending message, not the summary
    expect(screen.getByText('Generating summary...')).toBeDefined();
    expect(screen.queryByText('Test summary')).toBeNull();
  });

  it('should display full summary when status is available', () => {
    render(<SummaryDisplay status="available" summary="This is a test summary." />);
    expect(screen.getByText('This is a test summary.')).toBeDefined();
  });

  it('should wrap available summary in a styled card with bg-blue-50', () => {
    const { container } = render(
      <SummaryDisplay status="available" summary="This is a test summary." />
    );
    const card = container.querySelector('.from-blue-50');
    expect(card).not.toBeNull();
  });

  it('should truncate summary to 2 lines when truncate={true}', () => {
    const { container } = render(
      <SummaryDisplay
        status="available"
        summary="Long summary text..."
        truncate={true}
      />
    );
    const paragraph = container.querySelector('p');
    expect(paragraph?.className).toContain('line-clamp-2');
  });

  it('should NOT truncate when truncate={false} (default)', () => {
    const { container } = render(
      <SummaryDisplay
        status="available"
        summary="Test"
        truncate={false}
      />
    );
    const paragraph = container.querySelector('p');
    expect(paragraph?.className).not.toContain('line-clamp-2');
  });

  it('should show "Summary unavailable" when status is failed', () => {
    render(<SummaryDisplay status="failed" />);
    expect(screen.getByText('Summary unavailable')).toBeDefined();
  });

  it('should wrap failed state in a div with bg-red-50', () => {
    const { container } = render(<SummaryDisplay status="failed" />);
    const errorCard = container.querySelector('.bg-red-50');
    expect(errorCard).not.toBeNull();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SummaryDisplay status="pending" className="custom-class" />
    );
    // className should be on the outermost rendered element
    expect(container.firstElementChild?.className).toContain('custom-class');
  });

  it('should return null for unknown status', () => {
    const { container } = render(
      <SummaryDisplay status="unknown" as any />
    );
    // Should have no text content (returns null)
    expect(container.firstChild).toBeNull();
  });

  it('should handle missing summary with available status gracefully', () => {
    const { container } = render(
      <SummaryDisplay status="available" summary={undefined} />
    );
    // Should return null when status is available but no summary provided
    expect(container.firstChild).toBeNull();
  });

  it('should combine truncate class with custom className', () => {
    const { container } = render(
      <SummaryDisplay
        status="available"
        summary="Test"
        truncate={true}
        className="text-gray-700"
      />
    );
    const paragraph = container.querySelector('p');
    expect(paragraph?.className).toContain('line-clamp-2');
    // className goes on the outer card div
    expect(container.firstElementChild?.className).toContain('text-gray-700');
  });
});
