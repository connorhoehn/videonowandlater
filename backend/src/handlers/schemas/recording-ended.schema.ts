import { z } from 'zod';

/**
 * Schema for IVS broadcast recording-ended events
 */
const BroadcastRecordingEndedSchema = z.object({
  channel_name: z.string(),
  stream_id: z.string(),
  recording_status: z.enum(['ACTIVE', 'STOPPED', 'FAILED']),
  recording_s3_bucket_name: z.string(),
  recording_s3_key_prefix: z.string(),
  recording_duration_ms: z.number().nonnegative(),
  event_name: z.never().optional(), // Broadcast doesn't have event_name
});

/**
 * Schema for IVS RealTime stage recording-ended events (hangout)
 */
const HangoutRecordingEndedSchema = z.object({
  event_name: z.literal('Recording End'),
  session_id: z.string(),
  participant_id: z.string(),
  recording_s3_bucket_name: z.string(),
  recording_s3_key_prefix: z.string(),
  recording_duration_ms: z.number().nonnegative(),
});

/**
 * Schema for recovery events (manual retry/recovery mechanism)
 */
const RecoveryRecordingEndedSchema = z.object({
  recoveryAttempt: z.literal(true),
  sessionId: z.string(),
  recoveryAttemptCount: z.number().positive(),
  event_name: z.never().optional(), // Recovery doesn't have event_name
});

/**
 * Union for all three recording-ended event shapes
 * Supports broadcast, hangout (with event_name discriminator), and recovery events
 */
export const RecordingEndedDetailSchema = z.union([
  HangoutRecordingEndedSchema,
  BroadcastRecordingEndedSchema,
  RecoveryRecordingEndedSchema,
]);

export type RecordingEndedDetail = z.infer<typeof RecordingEndedDetailSchema>;
