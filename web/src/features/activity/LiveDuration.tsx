import React, { useState, useEffect } from 'react';

interface LiveDurationProps {
  createdAt: string;
}

export const LiveDuration: React.FC<LiveDurationProps> = ({ createdAt }) => {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - new Date(createdAt).getTime();
      const mins = Math.floor(elapsed / 60000);
      const hrs = Math.floor(mins / 60);
      setDisplay(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [createdAt]);

  return (
    <span className="text-xs text-white/70">
      Live for {display}
    </span>
  );
};
