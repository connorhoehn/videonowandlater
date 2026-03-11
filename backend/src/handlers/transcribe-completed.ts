/**
 * SQS-wrapped handler for Transcribe job completion events
 * Processes successful Transcribe jobs, fetches transcripts from S3, and stores on session records
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { updateTranscriptStatus, updateDiarizedTranscriptPath } from '../repositories/session-repository';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'transcribe-completed' },
});

interface TranscribeJobDetail {
  TranscriptionJobStatus: 'COMPLETED' | 'FAILED';
  TranscriptionJobName: string;
  TranscriptionJob?: {
    TranscriptFileUri?: string;
    FailureReason?: string;
  };
}

interface TranscribeOutput {
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
    items?: Array<{
      type: 'pronunciation' | 'punctuation';
      start_time?: string;
      end_time?: string;
      alternatives: Array<{
        content: string;
        confidence?: string;
        speaker_label?: string; // present when ShowSpeakerLabels: true
      }>;
    }>;
  };
}

interface SpeakerSegment {
  speaker: string;  // 'Speaker 1' or 'Speaker 2'
  startTime: number; // ms
  endTime: number;   // ms
  text: string;
}

const SPEAKER_MAP: Record<string, string> = { spk_0: 'Speaker 1', spk_1: 'Speaker 2' };

/**
 * Group word-level speaker labels from Transcribe results into turn segments.
 * Consecutive same-speaker words are merged; a flush occurs when speaker changes or gap > 1000ms.
 * Punctuation items are appended to the current segment text without affecting speaker/timing.
 */
function buildSpeakerSegments(items: NonNullable<TranscribeOutput['results']['items']>): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  let currentSpeaker: string | null = null;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentWords: string[] = [];

  function flush(): void {
    if (currentSpeaker !== null && currentStart !== null && currentEnd !== null && currentWords.length > 0) {
      segments.push({
        speaker: SPEAKER_MAP[currentSpeaker] ?? currentSpeaker,
        startTime: currentStart,
        endTime: currentEnd,
        text: currentWords.join(' '),
      });
    }
    currentSpeaker = null;
    currentStart = null;
    currentEnd = null;
    currentWords = [];
  }

  for (const item of items) {
    if (item.type === 'punctuation') {
      // Append punctuation to current segment text without a space
      if (currentWords.length > 0) {
        currentWords[currentWords.length - 1] += item.alternatives[0]?.content ?? '';
      }
      continue;
    }

    // Pronunciation item
    const speakerLabel = item.alternatives[0]?.speaker_label;
    if (!speakerLabel) {
      // No speaker label — skip
      continue;
    }

    const startMs = Math.round(parseFloat(item.start_time ?? '0') * 1000);
    const endMs = Math.round(parseFloat(item.end_time ?? '0') * 1000);
    const word = item.alternatives[0]?.content ?? '';

    // Flush if speaker changes or gap > 1000ms
    const gapExceeded = currentEnd !== null && startMs - currentEnd > 1000;
    if (currentSpeaker !== null && (speakerLabel !== currentSpeaker || gapExceeded)) {
      flush();
    }

    if (currentSpeaker === null) {
      currentSpeaker = speakerLabel;
      currentStart = startMs;
    }
    currentEnd = endMs;
    currentWords.push(word);
  }

  flush();
  return segments;
}

async function processEvent(
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> {
  const startMs = Date.now();
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const detail = event.detail as TranscribeJobDetail;

  const jobName = detail.TranscriptionJobName;
  logger.info('Transcribe job event received:', { jobName, status: detail.TranscriptionJobStatus });

  // Parse sessionId from job name (format: vnl-{sessionId}-{mediaconvertJobId})
  // Anchors on the epoch-ms prefix of the job ID (≥10 digits) so backtracking correctly
  // terminates at the sessionId boundary even when sessionId contains hyphens (UUIDs).
  // Accepts: vnl-{sessionId}-{epochMs} (legacy) and vnl-{sessionId}-{epochMs}-{hex} (new format)
  const jobNameMatch = jobName.match(/^vnl-([a-z0-9-]+)-(\d{10,}(?:-[a-f0-9]+)?)$/);
  if (!jobNameMatch) {
    logger.error('Failed to parse sessionId from Transcribe job name', {
      rawJobName: jobName,
      expectedPattern: 'vnl-{sessionId}-{mediaconvertJobId}',
    });
    return;
  }

  const sessionId = jobNameMatch[1];

  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered', { jobName, transcriptionJobStatus: detail.TranscriptionJobStatus });

  if (detail.TranscriptionJobStatus === 'FAILED') {
    logger.warn('Transcribe job failed for session:', {
      sessionId,
      failureReason: detail.TranscriptionJob?.FailureReason,
    });
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      logger.error('Failed to update transcript status to failed:', { errorMessage: error.message });
    }
    return;
  }

  // Job completed — fetch transcript from S3
  logger.info('Fetching transcript for session:', { sessionId });

  try {
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const transcriptJsonPath = `${sessionId}/transcript.json`;

    const getObjectCommand = new GetObjectCommand({
      Bucket: transcriptionBucket,
      Key: transcriptJsonPath,
    });

    const response = await s3Client.send(getObjectCommand);
    const bodyString = await response.Body?.transformToString();
    const transcribeOutput: TranscribeOutput = JSON.parse(bodyString || '{}');

    // Extract plain text transcript
    const plainText = transcribeOutput.results?.transcripts?.[0]?.transcript || '';

    // Build speaker segments from word-level items (non-blocking — failures do not block transcript storage)
    const items = transcribeOutput.results?.items;
    if (items && items.length > 0) {
      try {
        const speakerSegments = buildSpeakerSegments(items);
        if (speakerSegments.length > 0) {
          const speakerSegmentsKey = `${sessionId}/speaker-segments.json`;
          await s3Client.send(new PutObjectCommand({
            Bucket: transcriptionBucket,
            Key: speakerSegmentsKey,
            Body: JSON.stringify(speakerSegments),
            ContentType: 'application/json',
          }));
          await updateDiarizedTranscriptPath(tableName, sessionId, speakerSegmentsKey);
          logger.info('Speaker segments written to S3:', { sessionId, speakerSegmentsKey, segmentCount: speakerSegments.length });
        }
      } catch (speakerError: any) {
        logger.error('Failed to write speaker segments (non-blocking):', { sessionId, errorMessage: speakerError.message });
        // Non-blocking: transcript processing continues regardless
      }
    }

    if (!plainText) {
      logger.warn('Transcript text is empty for session:', { sessionId });
      const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
      await updateTranscriptStatus(
        tableName,
        sessionId,
        'available',
        s3Uri,
        ''
      );

      // Emit "Transcript Stored" event for Phase 20 (AI Summary Pipeline) even with empty text
      try {
        const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
        const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'custom.vnl',
                DetailType: 'Transcript Stored',
                Detail: JSON.stringify({
                  sessionId,
                  transcriptS3Uri: s3Uri,
                }),
              },
            ],
          })
        );
        logger.info('Transcript Stored event emitted for session:', { sessionId });
      } catch (eventError: any) {
        logger.error('Failed to emit Transcript Stored event:', { errorMessage: eventError.message });
        // Non-blocking: transcript is already stored, don't throw or prevent completion
      }
      return;
    }

    logger.info('Parsed transcript:', {
      sessionId,
      textLength: plainText.length,
      wordCount: plainText.split(' ').length,
    });

    // Update session with transcript
    const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
    await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, plainText);

    logger.info('Transcript stored for session:', { sessionId, s3Uri });

    // Emit "Transcript Stored" event for Phase 20 (AI Summary Pipeline)
    try {
      const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'custom.vnl',
              DetailType: 'Transcript Stored',
              Detail: JSON.stringify({
                sessionId,
                transcriptS3Uri: s3Uri,
              }),
            },
          ],
        })
      );
      logger.info('Transcript Stored event emitted for session:', { sessionId });
      logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
    } catch (eventError: any) {
      logger.error('Failed to emit Transcript Stored event:', { errorMessage: eventError.message });
      // Non-blocking: transcript is already stored, don't throw or prevent completion
    }
  } catch (error: any) {
    logger.error('Failed to fetch or store transcript:', { errorMessage: error.message });
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error.message });
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (updateError: any) {
      logger.error('Failed to update transcript status:', { errorMessage: updateError.message });
    }
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;
      await processEvent(ebEvent);
    } catch (err: any) {
      logger.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: err.message,
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
