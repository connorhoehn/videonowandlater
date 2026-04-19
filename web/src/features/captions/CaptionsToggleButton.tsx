/**
 * CaptionsToggleButton — small host-facing "CC on/off" button shown near the
 * live video controls. Posts to /sessions/{id}/captions/toggle via the hook.
 *
 * Visual states:
 *   - off:   outlined "CC" badge, neutral colors
 *   - on:    solid "CC" badge, accent color
 *   - busy:  button disabled during the in-flight toggle request
 *
 * The button is only rendered for hosts. Viewers use the `CC` toggle built
 * into `CaptionsOverlay` for their own client-side show/hide preference.
 */

interface CaptionsToggleButtonProps {
  enabled: boolean;
  busy: boolean;
  onClick: () => void;
  /** Optional status hint rendered next to the button (e.g., 'unavailable') */
  statusHint?: string;
}

export function CaptionsToggleButton({ enabled, busy, onClick, statusHint }: CaptionsToggleButtonProps) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title={enabled ? 'Turn live captions off' : 'Turn live captions on'}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-sm transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
          enabled
            ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-600/25'
            : 'bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400'
        }`}
      >
        <span className="font-black tracking-wider text-xs">CC</span>
        <span className="hidden sm:inline">{enabled ? 'Captions On' : 'Captions Off'}</span>
      </button>
      {statusHint && (
        <span className="text-xs text-gray-500" title="Captions configuration status">
          {statusHint}
        </span>
      )}
    </div>
  );
}
