import type { ReactNode } from 'react';

interface BadgeProps {
  variant?: 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'light';
  size?: 'sm' | 'md';
  pill?: boolean;
  dot?: boolean;
  children?: ReactNode;
  className?: string;
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  primary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  info: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  light: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const dotVariantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  primary: 'bg-blue-500',
  success: 'bg-green-500',
  danger: 'bg-red-500',
  warning: 'bg-yellow-500',
  info: 'bg-cyan-500',
  light: 'bg-gray-400',
};

const sizeStyles: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
};

export function Badge({
  variant = 'primary',
  size = 'sm',
  pill = true,
  dot = false,
  children,
  className = '',
}: BadgeProps) {
  if (dot) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotVariantStyles[variant]} ${className}`.trim()}
      />
    );
  }

  const rounding = pill ? 'rounded-full' : 'rounded';

  return (
    <span
      className={`inline-flex items-center font-medium ${rounding} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
