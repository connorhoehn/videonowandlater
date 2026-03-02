import React from 'react';

export const LoadingState: React.FC = () => {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="flex items-baseline space-x-2 mb-1">
            <div className="h-3 w-20 bg-gray-300 rounded"></div>
            <div className="h-2 w-12 bg-gray-200 rounded"></div>
          </div>
          <div className="h-3 w-full bg-gray-200 rounded"></div>
        </div>
      ))}
    </div>
  );
};
