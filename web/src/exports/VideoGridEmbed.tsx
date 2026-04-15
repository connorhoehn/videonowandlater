/**
 * VideoGridEmbed — inline-styled responsive video grid for embedding.
 * Adapts layout based on participant count. No Tailwind dependency.
 */

import React from 'react';
import { ParticipantTileEmbed } from './ParticipantTileEmbed';
import type { HangoutParticipant } from './types';

interface VideoGridEmbedProps {
  participants: HangoutParticipant[];
  /** Max width in pixels (defaults to unlimited). Useful for sidebar panels. */
  maxWidth?: number;
}

function getGridColumns(count: number, narrow: boolean): string {
  if (narrow || count <= 1) return '1fr';
  if (count === 2) return '1fr 1fr';
  if (count <= 4) return '1fr 1fr';
  return '1fr 1fr 1fr';
}

export const VideoGridEmbed: React.FC<VideoGridEmbedProps> = ({
  participants,
  maxWidth,
}) => {
  const narrow = maxWidth !== undefined && maxWidth < 500;
  const visible = participants.slice(0, narrow ? 4 : 6);
  const columns = getGridColumns(visible.length, narrow);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: columns,
      gap: 8,
      width: '100%',
      padding: 8,
    }}>
      {visible.map((p) => (
        <ParticipantTileEmbed
          key={p.participantId}
          participant={p}
          isSpeaking={p.isSpeaking}
        />
      ))}
    </div>
  );
};
