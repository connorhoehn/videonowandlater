import { z } from 'zod';

/**
 * Schema for AWS Transcribe job completion detail
 * Validates the structure of Transcribe job results
 */
export const TranscribeJobDetailSchema = z.object({
  TranscriptionJobStatus: z.enum(['QUEUED', 'IN_PROGRESS', 'FAILED', 'COMPLETED']),
  TranscriptionJobName: z.string(),
  TranscriptionJob: z.object({
    TranscriptFileUri: z.string().optional(),
    FailureReason: z.string().optional(),
    Results: z.record(z.any()).optional(),
  }).optional(),
});

export type TranscribeJobDetail = z.infer<typeof TranscribeJobDetailSchema>;
