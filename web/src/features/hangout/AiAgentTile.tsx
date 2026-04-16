/**
 * AiAgentTile - specialized tile for the AI agent participant
 * Renders a robot avatar instead of video, with speaking indicators
 */

import React from 'react';

interface AiAgentTileProps {
  isSpeaking: boolean;
  currentPrompt?: string;
  stepProgress?: string; // e.g., "Step 2 of 5"
}

export const AiAgentTile: React.FC<AiAgentTileProps> = ({ isSpeaking, currentPrompt, stepProgress }) => {
  return (
    <div className={`relative aspect-video bg-gray-900 rounded-2xl overflow-hidden transition-all duration-300 ${
      isSpeaking
        ? 'ring-3 ring-purple-500 ring-offset-2 ring-offset-gray-900 shadow-xl shadow-purple-500/25'
        : 'ring-1 ring-gray-700/50 shadow-lg shadow-black/20'
    }`}>
      {/* Robot avatar centered */}
      <div className="flex items-center justify-center h-full">
        <div className={`w-20 h-20 rounded-full bg-purple-600/20 flex items-center justify-center ${isSpeaking ? 'animate-pulse' : ''}`}>
          <svg className="w-10 h-10 text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </div>
      </div>

      {/* Speaking indicator */}
      {isSpeaking && currentPrompt && (
        <div className="absolute top-3 left-3 right-3">
          <div className="bg-purple-600/80 backdrop-blur-md text-white text-xs px-3 py-2 rounded-lg">
            <p className="font-medium">AI is speaking...</p>
            <p className="text-white/70 mt-0.5 truncate">{currentPrompt}</p>
          </div>
        </div>
      )}

      {/* Bottom gradient + name */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 bg-purple-600/60 backdrop-blur-md text-white text-xs font-medium px-3 py-1.5 rounded-full">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span>AI Assistant</span>
        {stepProgress && <span className="text-white/50">({stepProgress})</span>}
      </div>
    </div>
  );
};
