import { z } from 'zod';

/**
 * Schema for MediaConvert clip-job completion events.
 * Mirrors MediaConvertCompleteDetailSchema but requires UserMetadata
 * that identifies the job as a clip job (type=clip) and carries clip context.
 */
export const OnClipCompleteDetailSchema = z.object({
  jobName: z.string().optional(),
  jobId: z.string().min(1, 'jobId is required'),
  status: z.enum(['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'CANCELED', 'ERROR']),
  outputGroupDetails: z.array(
    z.object({
      playlistFile: z.string().optional(),
      outputDetails: z.array(
        z.object({
          outputFilePaths: z.array(z.string()).optional(),
        })
      ).optional(),
      type: z.string().optional(),
    })
  ).optional(),
  userMetadata: z.object({
    type: z.literal('clip'),
    clipId: z.string().min(1),
    sessionId: z.string().min(1),
  }).passthrough(),
});

export type OnClipCompleteDetail = z.infer<typeof OnClipCompleteDetailSchema>;
