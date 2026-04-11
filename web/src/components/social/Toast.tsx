import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckIcon, CloseIcon } from './Icons';

interface ToastProps {
  id: string;
  variant?: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
  duration?: number;
  onClose?: (id: string) => void;
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastProps, 'id' | 'onClose'>) => string;
  removeToast: (id: string) => void;
}

const variantStyles: Record<
  NonNullable<ToastProps['variant']>,
  { container: string; icon: string }
> = {
  success: {
    container: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    icon: 'text-green-600 dark:text-green-400',
  },
  error: {
    container: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    icon: 'text-red-600 dark:text-red-400',
  },
  info: {
    container: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    icon: 'text-blue-600 dark:text-blue-400',
  },
  warning: {
    container: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    icon: 'text-yellow-600 dark:text-yellow-400',
  },
};

const progressColors: Record<NonNullable<ToastProps['variant']>, string> = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  warning: 'bg-yellow-500',
};

function VariantIcon({ variant }: { variant: NonNullable<ToastProps['variant']> }) {
  const cls = variantStyles[variant].icon;
  switch (variant) {
    case 'success':
      return <CheckIcon size={18} className={cls} />;
    case 'error':
      return <CloseIcon size={18} className={cls} />;
    case 'info':
      return (
        <svg
          width={18}
          height={18}
          viewBox="0 0 16 16"
          fill="currentColor"
          className={cls}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.399l-.442.024-.084-.398 2.046-.318zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
        </svg>
      );
    case 'warning':
      return (
        <svg
          width={18}
          height={18}
          viewBox="0 0 16 16"
          fill="currentColor"
          className={cls}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
        </svg>
      );
  }
}

function Toast({ id, variant = 'info', title, description, duration = 5000, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose?.(id), 300);
  }, [id, onClose]);

  // Animate in on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Auto-dismiss timer + progress bar
  useEffect(() => {
    if (duration <= 0) return;

    startRef.current = performance.now();

    function tick() {
      const elapsed = performance.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    timerRef.current = setTimeout(handleClose, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [duration, handleClose]);

  const styles = variantStyles[variant];

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border relative overflow-hidden
        transition-all duration-300 ease-out
        ${styles.container}
        ${visible && !exiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
      role="alert"
    >
      <div className="shrink-0 mt-0.5">
        <VariantIcon variant={variant} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        {description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{description}</p>
        )}
      </div>

      <button
        onClick={handleClose}
        className="shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="Close notification"
      >
        <CloseIcon size={14} className="text-gray-500 dark:text-gray-400" />
      </button>

      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5">
          <div
            className={`h-full ${progressColors[variant]} transition-none`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastProps, 'id' | 'onClose'>): string => {
      const id = `toast-${++idCounter}-${Date.now()}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      return id;
    },
    [],
  );

  return (
    <ToastContext value={{ addToast, removeToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onClose={removeToast} />
        ))}
      </div>
    </ToastContext>
  );
}

function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export { Toast, ToastProvider, useToast };
export type { ToastProps, ToastContextValue };
