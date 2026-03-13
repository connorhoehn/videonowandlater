import { z } from 'zod';

/**
 * Schema for MediaConvert job completion event
 * Validates job name and completion status
 */
export const MediaConvertCompleteDetailSchema = z.object({
  jobName: z.string().min(1, 'jobName is required'),
  jobId: z.string().min(1, 'jobId is required'),
  status: z.enum(['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'CANCELED', 'ERROR']),
  outputGroupDetails: z.array(
    z.object({
      playlistFile: z.string().optional(),
    })
  ).optional(),
});

export type MediaConvertCompleteDetail = z.infer<typeof MediaConvertCompleteDetailSchema>;
