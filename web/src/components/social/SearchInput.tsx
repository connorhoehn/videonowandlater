import { useState, useRef, useCallback, useEffect } from 'react';

interface SearchInputProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  size?: 'sm' | 'md';
}

export function SearchInput({
  value: controlledValue,
  onChange,
  onSubmit,
  placeholder = 'Search...',
  debounceMs = 300,
  className = '',
  size = 'md',
}: SearchInputProps) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState('');
  const displayValue = isControlled ? controlledValue : internalValue;

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      if (!isControlled) setInternalValue(next);

      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        onChangeRef.current?.(next);
      }, debounceMs);
    },
    [isControlled, debounceMs],
  );

  const handleClear = useCallback(() => {
    if (!isControlled) setInternalValue('');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    onChange?.('');
  }, [isControlled, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit?.(displayValue);
      }
    },
    [onSubmit, displayValue],
  );

  const isSm = size === 'sm';

  return (
    <div className={`relative ${className}`}>
      {/* Search icon */}
      <svg
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-400 ${isSm ? 'left-2.5 size-4' : 'left-3 size-4'}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>

      <input
        type="text"
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full rounded-full border-0 bg-gray-100 transition-colors focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-800 dark:focus:bg-gray-700 ${
          isSm ? 'h-8 pl-9 pr-8 text-sm' : 'h-10 pl-10 pr-9 text-sm'
        }`}
      />

      {/* Clear button */}
      {displayValue && (
        <button
          type="button"
          onClick={handleClear}
          className={`absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 ${isSm ? 'right-2' : 'right-2.5'}`}
          aria-label="Clear search"
        >
          <svg
            className="size-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
