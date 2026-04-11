import { useEffect, useCallback, useState } from 'react';
import { CloseIcon } from './Icons';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface OffcanvasSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  side?: 'left' | 'right';
  width?: string;
  children: React.ReactNode;
  className?: string;
}

export function OffcanvasSidebar({
  isOpen,
  onClose,
  title,
  side = 'left',
  width = 'w-80',
  children,
  className = '',
}: OffcanvasSidebarProps) {
  const trapRef = useFocusTrap(isOpen);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  // Handle open/close with animation
  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      // Trigger animation on next frame so the initial hidden state renders first
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Escape key handler
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  if (!visible) return null;

  const panelTranslate = animating
    ? 'translate-x-0'
    : side === 'left'
      ? '-translate-x-full'
      : 'translate-x-full';

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${animating ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={trapRef}
        className={`fixed top-0 ${side === 'left' ? 'left-0' : 'right-0'} z-50 h-full ${width} max-w-[85vw] flex flex-col bg-white shadow-2xl dark:bg-gray-900 ${panelTranslate} transition-transform duration-300 ease-in-out ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          {title && (
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close sidebar"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </>
  );
}
