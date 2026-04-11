import type { ReactNode } from 'react';
import { Badge } from './Badge';

export interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: 'underline' | 'pills';
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'py-2 text-sm',
  md: 'py-3 text-sm',
};

export function TabNav({
  tabs,
  activeTab,
  onChange,
  variant = 'underline',
  fullWidth = false,
  size = 'md',
  className = '',
}: TabNavProps) {
  const isUnderline = variant === 'underline';

  return (
    <nav
      className={`flex ${isUnderline ? 'border-b border-gray-200' : 'gap-2'} ${className}`.trim()}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;

        const baseStyles = `flex items-center gap-1.5 px-4 cursor-pointer transition-all duration-200 ${sizeStyles[size]}`;
        const widthStyles = fullWidth ? 'flex-1 justify-center' : '';

        let variantStyles: string;
        if (isUnderline) {
          variantStyles = isActive
            ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
            : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent';
        } else {
          variantStyles = isActive
            ? 'bg-blue-600 text-white rounded-full'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-full';
        }

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`${baseStyles} ${widthStyles} ${variantStyles}`.trim()}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <Badge variant="primary" size="sm">
                {tab.badge}
              </Badge>
            )}
          </button>
        );
      })}
    </nav>
  );
}
