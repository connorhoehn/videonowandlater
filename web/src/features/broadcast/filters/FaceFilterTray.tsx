/**
 * FaceFilterTray — chips for face-sprite filters (dog ears, sunglasses,
 * mustache). MediaPipe Face Landmarker is loaded lazily the first time a
 * sprite is selected, so the tray is zero-cost until you tap something.
 */

import { FACE_SPRITES } from './face-sprites';

interface Props {
  currentSpriteId: string | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}

export function FaceFilterTray({ currentSpriteId, onSelect, disabled }: Props) {
  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'No Face FX' },
    ...FACE_SPRITES.map((s) => ({ id: s.id, label: s.label })),
  ];
  return (
    <div className="flex gap-1.5 overflow-x-auto py-1 px-1 scrollbar-hide">
      {options.map((opt) => {
        const active = opt.id === currentSpriteId;
        return (
          <button
            key={opt.id ?? 'none'}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.id)}
            className={
              'flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ' +
              (active
                ? 'bg-white text-black border-white shadow-md'
                : 'bg-black/40 text-white border-white/30 hover:bg-black/60') +
              ' disabled:opacity-40 disabled:cursor-not-allowed'
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
