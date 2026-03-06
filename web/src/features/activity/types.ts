/**
 * Extended activity types for upload sessions
 */

import type { ActivitySession as BaseActivitySession } from './RecordingSlider';

// Re-export the base type and use it directly
export type ActivitySession = BaseActivitySession & {
  // Additional upload-specific fields (uploadStatus already exists in base)
  uploadProgress?: number; // 0-100 percentage
  fileSize?: number; // File size in bytes
  fileName?: string; // Original filename
};