/**
 * ConfirmDialog - Reusable confirmation dialog for destructive actions
 * Used to guard "Stop Broadcast" and "Leave" actions against accidental clicks.
 */

import React from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div data-testid="confirm-dialog" className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-backdrop-in">
      <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 animate-dialog-in">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            data-testid="cancel-btn"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            data-testid="confirm-btn"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-sm hover:shadow-md transition-all duration-150"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
