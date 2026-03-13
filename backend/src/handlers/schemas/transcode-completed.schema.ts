import { z } from 'zod';

/**
 * Schema for MediaConvert job completion detail
 * Contains job metadata and userMetadata with sessionId
 */
export const TranscodeCompletedDetailSchema = z.object({
  jobId: z.string(),
  status: z.enum(['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'CANCELED', 'ERROR']),
  userMetadata: z.object({
    sessionId: z.string().optional(),
  }).optional(),
  outputGroupDetails: z.array(
    z.object({
      outputDetails: z.array(
        z.object({
          outputFilePaths: z.array(z.string()).optional(),
        })
      ).optional(),
    })
  ).optional(),
});

export type TranscodeCompletedDetail = z.infer<typeof TranscodeCompletedDetailSchema>;
