import React from 'react';

export const EmptyState: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full text-gray-500 text-center p-4">
      <div>
        <p className="text-lg font-medium">Be the first to say hi!</p>
        <p className="text-sm mt-1">Start the conversation below</p>
      </div>
    </div>
  );
};
