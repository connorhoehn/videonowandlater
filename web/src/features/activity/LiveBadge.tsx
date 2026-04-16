import React from 'react';

interface LiveBadgeProps {
  variant?: 'broadcast' | 'hangout';
}

export const LiveBadge: React.FC<LiveBadgeProps> = ({ variant = 'broadcast' }) => {
  const bg = variant === 'hangout' ? 'bg-purple-600 shadow-purple-600/30' : 'bg-red-600 shadow-red-600/30';
  return (
    <div className={`absolute top-3 left-3 z-10 flex items-center gap-1.5 ${bg} text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg`}>
      <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
      LIVE
    </div>
  );
};
