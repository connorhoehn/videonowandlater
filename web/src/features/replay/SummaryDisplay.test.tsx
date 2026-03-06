/**
 * SummaryDisplay.test.tsx - Unit tests for SummaryDisplay component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryDisplay } from './SummaryDisplay';

describe('SummaryDisplay', () => {
  it('should show "Summary coming soon..." when status is pending', () => {
    render(<SummaryDisplay status="pending" />);
    expect(screen.getByText('Summary coming soon...')).toBeDefined();
  });

  it('should treat undefined status as pending (backward compatibility)', () => {
    render(<SummaryDisplay status={undefined} summary="Test summary" />);
    // Should show pending message, not the summary
    expect(screen.getByText('Summary coming soon...')).toBeDefined();
    expect(screen.queryByText('Test summary')).toBeNull();
  });

  it('should display full summary when status is available', () => {
    render(<SummaryDisplay status="available" summary="This is a test summary." />);
    expect(screen.getByText('This is a test summary.')).toBeDefined();
  });

  it('should truncate summary to 2 lines when truncate={true}', () => {
    const { container } = render(
      <SummaryDisplay
        status="available"
        summary="Long summary text..."
        truncate={true}
      />
    );
    // Find the paragraph element and check for line-clamp-2 class
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

  it('should apply custom className', () => {
    const { container } = render(
      <SummaryDisplay status="pending" className="custom-class" />
    );
    const paragraph = container.querySelector('p');
    expect(paragraph?.className).toContain('custom-class');
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
    expect(paragraph?.className).toContain('text-gray-700');
  });
});
