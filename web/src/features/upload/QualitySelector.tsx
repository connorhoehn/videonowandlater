import { Quality } from './useHlsPlayer';

interface QualitySelectorProps {
  qualities: Quality[];
  currentQuality: number;
  onSelect: (level: number) => void;
  isSafari: boolean;
}

export function QualitySelector({ qualities, currentQuality, onSelect, isSafari }: QualitySelectorProps) {
  // Hide on Safari — native HLS has no quality switching API
  if (isSafari) return null;

  // Hide when single-rendition or not yet loaded
  if (qualities.length <= 1) return null;

  return (
    <select
      value={currentQuality}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="text-sm bg-black/60 text-white border border-white/20 rounded px-2 py-1 cursor-pointer"
    >
      {qualities.map((q) => (
        <option key={q.level} value={q.level}>
          {q.label}
        </option>
      ))}
    </select>
  );
}
