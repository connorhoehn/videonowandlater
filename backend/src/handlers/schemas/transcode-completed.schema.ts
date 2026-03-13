import { z } from 'zod';

/**
 * Schema for MediaConvert job completion detail
 * Contains job metadata and userMetadata with sessionId
 */
export const TranscodeCompletedDetailSchema = z.object({
  jobName: z.string(),
  jobId: z.string(),
  status: z.enum(['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'CANCELED', 'ERROR']),
  userMetadata: z.object({
    sessionId: z.string(),
  }).optional(),
  outputGroupDetails: z.array(
    z.object({
      playlistFile: z.string().optional(),
    })
  ).optional(),
});

export type TranscodeCompletedDetail = z.infer<typeof TranscodeCompletedDetailSchema>;
