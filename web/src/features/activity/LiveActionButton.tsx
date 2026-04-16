import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessionRoute } from './utils';

interface LiveActionButtonProps {
  sessionId: string;
  sessionType: 'BROADCAST' | 'HANGOUT' | string;
  participantCount?: number;
}

export const LiveActionButton: React.FC<LiveActionButtonProps> = ({
  sessionId, sessionType, participantCount,
}) => {
  const navigate = useNavigate();
  const route = getSessionRoute({ sessionId, sessionType, status: 'live' });
  const isHangout = sessionType === 'HANGOUT';

  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(route); }}
      className={`mt-2 w-full px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors ${
        isHangout
          ? 'bg-purple-600 hover:bg-purple-700'
          : 'bg-red-600 hover:bg-red-700'
      }`}
    >
      {isHangout
        ? `Join Hangout (${participantCount || 0} ${(participantCount || 0) === 1 ? 'person' : 'people'})`
        : 'Watch Live'
      }
    </button>
  );
};
