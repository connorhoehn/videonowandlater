/**
 * ConfirmDialog.test.tsx - Unit tests for ConfirmDialog component (UI-06)
 * These tests are RED until plan 02 creates web/src/components/ConfirmDialog.tsx
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <ConfirmDialog
        isOpen={false}
        title="Are you sure?"
        message="This action cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders title and message when isOpen=true', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Stop broadcast?"
        message="Your stream will end and viewers will be disconnected."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Stop broadcast?')).toBeDefined();
    expect(screen.getByText('Your stream will end and viewers will be disconnected.')).toBeDefined();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Stop broadcast?"
        message="This action cannot be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Stop broadcast?"
        message="This action cannot be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm button shows custom confirmLabel when provided', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Leave hangout?"
        message="You will be disconnected from the session."
        confirmLabel="Leave"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /leave/i })).toBeDefined();
    // Should NOT show the default "Confirm" text when custom label is provided
    expect(screen.queryByRole('button', { name: /^confirm$/i })).toBeNull();
  });

  it('confirm button defaults to "Confirm" when confirmLabel not provided', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Are you sure?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeDefined();
  });
});
