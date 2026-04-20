/**
 * BackgroundTray — chips for background effect: None / Blur / any of the
 * built-in replacement images. Selecting an image implies mode='image' and
 * sets the image URL in one tap.
 */

import { BACKGROUND_IMAGES, type BackgroundMode } from './useFilterPipeline';

interface Props {
  currentMode: BackgroundMode;
  currentImageUrl: string | null;
  onModeChange: (mode: BackgroundMode) => void;
  onImageChange: (url: string | null) => void;
  disabled?: boolean;
}

export function BackgroundTray({ currentMode, currentImageUrl, onModeChange, onImageChange, disabled }: Props) {
  return (
    <div className="flex gap-1.5 overflow-x-auto py-1 px-1 scrollbar-hide">
      <Chip label="No BG" active={currentMode === 'none'} disabled={disabled}
            onClick={() => { onModeChange('none'); onImageChange(null); }} />
      <Chip label="Blur BG" active={currentMode === 'blur'} disabled={disabled}
            onClick={() => { onModeChange('blur'); onImageChange(null); }} />
      {BACKGROUND_IMAGES.map((bg) => (
        <Chip
          key={bg.id}
          label={bg.label}
          active={currentMode === 'image' && currentImageUrl === bg.url}
          disabled={disabled}
          onClick={() => { onImageChange(bg.url); onModeChange('image'); }}
        />
      ))}
    </div>
  );
}

function Chip({ label, active, disabled, onClick }: {
  label: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ' +
        (active
          ? 'bg-white text-black border-white shadow-md'
          : 'bg-black/40 text-white border-white/30 hover:bg-black/60') +
        ' disabled:opacity-40 disabled:cursor-not-allowed'
      }
    >
      {label}
    </button>
  );
}
