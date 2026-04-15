/**
 * Embeddable hangout components for integration into external projects.
 *
 * These exports are decoupled from VNL routing, auth, and Tailwind CSS.
 * They use inline styles and accept raw IVS tokens instead of calling APIs.
 */

export { useHangoutEmbed } from './useHangoutEmbed';
export type { UseHangoutEmbedOptions, UseHangoutEmbedReturn } from './useHangoutEmbed';

export { VideoGridEmbed } from './VideoGridEmbed';
export { ParticipantTileEmbed } from './ParticipantTileEmbed';

export { useActiveSpeaker } from '../features/hangout/useActiveSpeaker';

export type { HangoutParticipant } from './types';
