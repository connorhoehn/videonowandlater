/**
 * FilterTray — horizontal strip of filter preset chips below the camera
 * preview. Tapping a chip instantly switches the active filter (no broadcast
 * glitch — see useFilterPipeline.ts for the ref-based swap).
 */

import { FILTER_PRESETS, type FilterPreset } from './presets';

interface Props {
  currentFilterId: string;
  onSelect: (preset: FilterPreset) => void;
  disabled?: boolean;
}

export function FilterTray({ currentFilterId, onSelect, disabled }: Props) {
  return (
    <div className="flex gap-1.5 overflow-x-auto py-2 px-1 scrollbar-hide">
      {FILTER_PRESETS.map((preset) => {
        const active = preset.id === currentFilterId;
        return (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(preset)}
            className={
              'flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ' +
              (active
                ? 'bg-white text-black border-white shadow-md'
                : 'bg-black/40 text-white border-white/30 hover:bg-black/60') +
              ' disabled:opacity-40 disabled:cursor-not-allowed'
            }
            title={preset.label}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
