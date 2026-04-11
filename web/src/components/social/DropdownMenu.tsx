import { useState, useRef, useEffect } from 'react';

export interface DropdownItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: (DropdownItem | 'divider')[];
  align?: 'left' | 'right';
  width?: string;
  className?: string;
}

export function DropdownMenu({
  trigger,
  items,
  align = 'left',
  width = 'w-48',
  className = '',
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <div onClick={() => setOpen((prev) => !prev)} className="cursor-pointer">
        {trigger}
      </div>

      {open && (
        <div
          className={`absolute mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${width} bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 py-1 z-50 animate-in`}
          style={{
            animation: 'dropdown-in 150ms ease-out',
          }}
        >
          <style>{`
            @keyframes dropdown-in {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {items.map((item, i) => {
            if (item === 'divider') {
              return (
                <div
                  key={`divider-${i}`}
                  className="border-t border-gray-100 dark:border-gray-700 my-1"
                />
              );
            }

            const base =
              'px-4 py-2 text-sm flex items-center gap-2 transition-colors w-full text-left';
            const color = item.danger
              ? 'text-red-600 hover:bg-red-50'
              : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700';
            const disabled = item.disabled
              ? 'opacity-50 cursor-not-allowed pointer-events-none'
              : 'cursor-pointer';
            const cls = `${base} ${color} ${disabled}`;

            if (item.href) {
              return (
                <a
                  key={i}
                  href={item.href}
                  className={cls}
                  onClick={() => setOpen(false)}
                >
                  {item.icon}
                  {item.label}
                </a>
              );
            }

            return (
              <button
                key={i}
                className={cls}
                disabled={item.disabled}
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
