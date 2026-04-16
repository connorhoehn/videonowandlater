/**
 * AiIntentProgress - overlay showing AI intent flow progress during a hangout call
 * Displays step progress bar, speaking status, and filled slots
 */

import React from 'react';

interface IntentProgressProps {
  isActive: boolean;
  currentStep?: { stepName: string; prompt: string; stepIndex: number; totalSteps: number };
  filledSlots: Record<string, string>;
  agentSpeaking: boolean;
}

export const AiIntentProgress: React.FC<IntentProgressProps> = ({
  isActive, currentStep, filledSlots, agentSpeaking,
}) => {
  if (!isActive) return null;

  const filledCount = Object.keys(filledSlots).length;

  return (
    <div className="absolute bottom-16 left-3 right-3 z-20 pointer-events-none">
      <div className="bg-gray-900/90 backdrop-blur-md rounded-xl border border-purple-500/30 p-3 pointer-events-auto">
        {/* Progress bar */}
        {currentStep && (
          <div className="mb-2">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Intent Capture</span>
              <span>Step {currentStep.stepIndex + 1} of {currentStep.totalSteps}</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${((currentStep.stepIndex + 1) / currentStep.totalSteps) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-2 text-sm">
          {agentSpeaking ? (
            <>
              <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
              <span className="text-purple-300">AI is speaking...</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-green-300">Your turn to respond</span>
            </>
          )}
        </div>

        {/* Filled slots */}
        {filledCount > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(filledSlots).map(([slot, value]) => (
              <span key={slot} className="inline-flex items-center gap-1 text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {slot}: {value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
