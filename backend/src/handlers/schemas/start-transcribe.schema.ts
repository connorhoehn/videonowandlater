import { z } from 'zod';

/**
 * Schema for upload recording available event
 * Triggered when MediaConvert encoding completes and recording is ready for transcription
 */
export const UploadRecordingAvailableDetailSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  recordingHlsUrl: z.string()
    .min(1, 'recordingHlsUrl is required')
    .regex(/\.m3u8$/, 'recordingHlsUrl must end with .m3u8'),
});

export type UploadRecordingAvailableDetail = z.infer<typeof UploadRecordingAvailableDetailSchema>;
