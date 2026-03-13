import { z } from 'zod';

/**
 * Schema for transcript storage trigger event
 * Contains sessionId and S3 URI to fetch transcript from
 */
export const TranscriptStoreDetailSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  transcriptS3Uri: z.string()
    .min(1, 'transcriptS3Uri is required')
    .regex(/^s3:\/\//, 'transcriptS3Uri must start with s3://'),
});

export type TranscriptStoreDetail = z.infer<typeof TranscriptStoreDetailSchema>;
