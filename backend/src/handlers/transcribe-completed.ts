/**
 * SQS-wrapped handler for Transcribe job completion events
 * Processes successful Transcribe jobs, fetches transcripts from S3, and stores on session records
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand as UpdateCommandDirect } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import {
  getSessionById,
  updateSessionStatus,
  updateTranscriptStatus,
  updateDiarizedTranscriptPath,
  getParticipantsWithRecordings,
  updateParticipantTranscript,
} from '../repositories/session-repository';
import { SessionStatus, SessionType } from '../domain/session';
import { TranscribeJobDetailSchema, type TranscribeJobDetail } from './schemas/transcribe-completed.schema';
import { calculateTranscribeCost, CostService, PRICING_RATES } from '../domain/cost';
import { writeCostLineItem, upsertCostSummary } from '../repositories/cost-repository';
import { emitCostMetric } from '../lib/cost-metrics';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'transcribe-completed' },
});

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const ebClient = tracer.captureAWSv3Client(new EventBridgeClient({}));
const docClient = DynamoDBDocumentClient.from(
  tracer.captureAWSv3Client(new DynamoDBClient({})),
  { marshallOptions: { removeUndefinedValues: true } },
);

// TranscribeJobDetail is imported from schema

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
function buildSpeakerSegments(items: NonNullable<TranscribeOutput['results']['items']>, speakerNameOverride?: string): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  let currentSpeaker: string | null = null;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentWords: string[] = [];

  function flush(): void {
    if (currentSpeaker !== null && currentStart !== null && currentEnd !== null && currentWords.length > 0) {
      segments.push({
        speaker: speakerNameOverride ?? (SPEAKER_MAP[currentSpeaker] ?? currentSpeaker),
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
  event: EventBridgeEvent<string, TranscribeJobDetail>,
  tracer: Tracer
): Promise<void> {
  const startMs = Date.now();
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const detail = event.detail as TranscribeJobDetail;

  const jobName = detail.TranscriptionJobName;
  logger.info('Transcribe job event received:', { jobName, status: detail.TranscriptionJobStatus });

  // Parse sessionId (and optional userId for hangout per-participant jobs) from job name.
  // Formats:
  //   Broadcast:  vnl-{sessionId}-{epochMs}
  //   Hangout:    vnl-{sessionId}-{userId}-{epochMs}
  // We try the per-participant format first (has userId between sessionId and epoch).
  // UUID sessionId: 8-4-4-4-12 hex chars
  // Precise UUID pattern (8-4-4-4-12) prevents overconsumption when userId is also a UUID
  const perParticipantMatch = jobName.match(
    /^vnl-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-(.+)-(\d{13,})$/
  );
  const broadcastMatch = jobName.match(/^vnl-([a-z0-9-]+)-(\d{10,}(?:-[a-f0-9]+)?)$/);

  let sessionId: string;
  let participantUserId: string | undefined;

  if (perParticipantMatch) {
    sessionId = perParticipantMatch[1];
    participantUserId = perParticipantMatch[2];
    logger.info('Parsed per-participant transcript job', { sessionId, participantUserId });
  } else if (broadcastMatch) {
    sessionId = broadcastMatch[1];
    logger.info('Parsed broadcast transcript job', { sessionId });
  } else {
    logger.error('Failed to parse sessionId from Transcribe job name', {
      rawJobName: jobName,
      expectedPattern: 'vnl-{sessionId}-{epochMs} or vnl-{sessionId}-{userId}-{epochMs}',
    });
    return;
  }

  tracer.putAnnotation('sessionId', sessionId);
  tracer.putAnnotation('pipelineStage', 'transcribe-completed');

  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered', { jobName, transcriptionJobStatus: detail.TranscriptionJobStatus });

  // IDEM-01: Check if transcript already available (idempotent guard)
  try {
    const session = await getSessionById(tableName, sessionId);
    if (session?.transcriptStatus === 'available' && session?.transcript) {
      logger.info('Transcript already available (idempotent retry)', { sessionId });
      // No-op: SQS message acknowledged below (batchItemFailures empty)
      return;
    }
  } catch (error: any) {
    logger.warn('Failed to check session state (non-blocking, continue):', { errorMessage: error.message });
    // If we can't verify, proceed with normal flow — better to re-write than to silently skip
  }

  if (detail.TranscriptionJobStatus === 'FAILED') {
    logger.warn('Transcribe job failed for session:', {
      sessionId,
      failureReason: detail.TranscriptionJob?.FailureReason,
      participantUserId,
    });
    try {
      if (participantUserId) {
        await updateParticipantTranscript(tableName, sessionId, participantUserId, 'failed');
      } else {
        await updateTranscriptStatus(tableName, sessionId, 'failed');
      }
    } catch (error: any) {
      logger.error('Failed to update transcript status to failed:', { errorMessage: error.message });
    }

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId, eventType: SessionEventType.TRANSCRIBE_FAILED,
        timestamp: new Date().toISOString(), actorId: 'SYSTEM',
        actorType: 'system', details: { jobName },
      });
    } catch { /* non-blocking */ }

    return;
  }

  // ─── HANGOUT PER-PARTICIPANT: store individual transcript, merge when all done ───
  if (participantUserId) {
    try {
      const transcriptKey = `${sessionId}/participants/${participantUserId}/transcript.json`;
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: transcriptionBucket,
        Key: transcriptKey,
      }));

      const bodyString = await response.Body?.transformToString();
      const transcribeOutput: TranscribeOutput = JSON.parse(bodyString || '{}');
      const plainText = transcribeOutput.results?.transcripts?.[0]?.transcript || '';

      // Mark this participant's transcript as available
      await updateParticipantTranscript(tableName, sessionId, participantUserId, 'available', transcriptKey);
      logger.info('Participant transcript stored', { sessionId, participantUserId, textLength: plainText.length });

      // Record Transcribe cost for this participant (non-blocking)
      try {
        const pItems = transcribeOutput.results?.items;
        const lastItem = pItems?.[pItems.length - 1];
        const audioDurationSeconds = lastItem?.end_time ? parseFloat(lastItem.end_time) : 0;
        if (audioDurationSeconds > 0) {
          const session = await getSessionById(tableName, sessionId);
          const costUsd = calculateTranscribeCost(audioDurationSeconds);
          await writeCostLineItem(tableName, {
            sessionId, service: CostService.TRANSCRIBE, costUsd, quantity: audioDurationSeconds, unit: 'seconds',
            rateApplied: PRICING_RATES.TRANSCRIBE, sessionType: session?.sessionType || 'HANGOUT', userId: session?.userId || participantUserId,
            createdAt: new Date().toISOString(),
          });
          await upsertCostSummary(tableName, sessionId, CostService.TRANSCRIBE, costUsd, session?.sessionType || 'HANGOUT', session?.userId || participantUserId);
          logger.info('Cost recorded', { service: 'TRANSCRIBE', costUsd, sessionId, participantUserId });
          await emitCostMetric('TRANSCRIBE', costUsd, session?.sessionType || 'HANGOUT', sessionId);
        }
      } catch (costError: any) {
        logger.warn('Failed to record cost (non-blocking)', { error: costError.message });
      }

      // Atomically increment transcriptsReceived counter to avoid race conditions
      const participants = await getParticipantsWithRecordings(tableName, sessionId);
      const withRecordings = participants.filter(p => p.recordingStatus === 'available');

      const transcriptCounter = await docClient.send(new UpdateCommandDirect({
        TableName: tableName,
        Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        UpdateExpression: 'SET transcriptsReceived = if_not_exists(transcriptsReceived, :zero) + :inc',
        ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      }));
      const transcriptsReceived = (transcriptCounter.Attributes?.transcriptsReceived as number) ?? 0;

      logger.info('Participant transcript progress (atomic)', {
        sessionId,
        transcriptsReceived,
        totalWithRecordings: withRecordings.length,
      });

      if (transcriptsReceived < withRecordings.length) {
        logger.info('Waiting for remaining participant transcripts', { sessionId });
        return;
      }

      // All transcripts done — merge into unified speaker-segments.json with real usernames
      logger.info('All participant transcripts received, merging', { sessionId });

      const withTranscripts = participants.filter(p => p.transcriptStatus === 'available');
      const allSegments: SpeakerSegment[] = [];
      const plainTexts: string[] = [];

      for (const participant of withTranscripts) {
        const pTranscriptKey = participant.transcriptS3Path!;
        const pResponse = await s3Client.send(new GetObjectCommand({
          Bucket: transcriptionBucket,
          Key: pTranscriptKey,
        }));
        const pBody = await pResponse.Body?.transformToString();
        const pOutput: TranscribeOutput = JSON.parse(pBody || '{}');
        const pText = pOutput.results?.transcripts?.[0]?.transcript || '';
        const pItems = pOutput.results?.items;

        if (pText) {
          plainTexts.push(`[${participant.userId}]: ${pText}`);
        }

        // Build properly merged segments with punctuation using real username
        if (pItems && pItems.length > 0) {
          const participantSegments = buildSpeakerSegments(pItems, participant.userId);
          allSegments.push(...participantSegments);
        }
      }

      // Merge consecutive same-speaker words into turn segments, sorted by time
      allSegments.sort((a, b) => a.startTime - b.startTime);
      const mergedSegments: SpeakerSegment[] = [];
      let current: SpeakerSegment | null = null;

      for (const seg of allSegments) {
        if (current && current.speaker === seg.speaker && seg.startTime - current.endTime <= 1000) {
          current.endTime = seg.endTime;
          current.text += ' ' + seg.text;
        } else {
          if (current) mergedSegments.push(current);
          current = { ...seg };
        }
      }
      if (current) mergedSegments.push(current);

      // Write merged speaker segments
      const speakerSegmentsKey = `${sessionId}/speaker-segments.json`;
      await s3Client.send(new PutObjectCommand({
        Bucket: transcriptionBucket,
        Key: speakerSegmentsKey,
        Body: JSON.stringify(mergedSegments),
        ContentType: 'application/json',
      }));
      await updateDiarizedTranscriptPath(tableName, sessionId, speakerSegmentsKey);
      logger.info('Merged speaker segments written', { sessionId, segmentCount: mergedSegments.length });

      // Store combined plain text and mark session transcript as available
      const combinedText = plainTexts.join('\n\n');
      const s3Uri = `s3://${transcriptionBucket}/${speakerSegmentsKey}`;
      await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, combinedText);

      // Transition session ENDING → ENDED
      try {
        await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
        logger.info('Hangout session transitioned to ENDED', { sessionId });
      } catch (statusError: any) {
        logger.warn('Session may already be ENDED (idempotent)', { errorMessage: statusError.message });
      }

      // Pool resources already released by recording-ended handler

      // Emit "Transcript Stored" for AI summary
      await ebClient.send(new PutEventsCommand({
        Entries: [{
          Source: 'custom.vnl',
          DetailType: 'Transcript Stored',
          Detail: JSON.stringify({ sessionId, transcriptS3Uri: s3Uri }),
        }],
      }));
      logger.info('Transcript Stored event emitted for hangout', { sessionId });

      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(), sessionId, eventType: SessionEventType.TRANSCRIBE_COMPLETED,
          timestamp: new Date().toISOString(), actorId: 'SYSTEM',
          actorType: 'system', details: { jobName },
        });
      } catch { /* non-blocking */ }

      logger.info('Pipeline stage completed (hangout merge)', { status: 'success', durationMs: Date.now() - startMs });
    } catch (error: any) {
      logger.error('Failed to process per-participant transcript:', { errorMessage: error.message, sessionId, participantUserId });
      logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error.message });
      try {
        await updateParticipantTranscript(tableName, sessionId, participantUserId, 'failed');
      } catch (updateError: any) {
        logger.error('Failed to update participant transcript status:', { errorMessage: updateError.message });
      }
    }
    return;
  }

  // ─── BROADCAST: existing single-transcript flow ───────────────────────
  // Job completed — fetch transcript from S3
  logger.info('Fetching transcript for session:', { sessionId });

  try {
    const transcriptJsonPath = `${sessionId}/transcript.json`;

    const getObjectCommand = new GetObjectCommand({
      Bucket: transcriptionBucket,
      Key: transcriptJsonPath,
    });

    const response = await s3Client.send(getObjectCommand);
    const contentLength = response.ContentLength ?? 0;
    logger.info('Transcript S3 object size', { sessionId, contentLengthBytes: contentLength });

    if (contentLength > 50 * 1024 * 1024) {
      logger.warn('Large transcript detected — consider increasing Lambda memory', {
        sessionId,
        contentLengthMB: Math.round(contentLength / (1024 * 1024)),
      });
    }

    const bodyString = await response.Body?.transformToString();
    const transcribeOutput: TranscribeOutput = JSON.parse(bodyString || '{}');

    const plainText = transcribeOutput.results?.transcripts?.[0]?.transcript || '';

    // Build speaker segments from word-level items (non-blocking)
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
      }
    }

    if (!plainText) {
      logger.warn('Transcript text is empty for session:', { sessionId });
      const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
      await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, '');

      try {
        await ebClient.send(new PutEventsCommand({
          Entries: [{
            Source: 'custom.vnl',
            DetailType: 'Transcript Stored',
            Detail: JSON.stringify({ sessionId, transcriptS3Uri: s3Uri }),
          }],
        }));
        logger.info('Transcript Stored event emitted for session:', { sessionId });
      } catch (eventError: any) {
        logger.error('Failed to emit Transcript Stored event:', { errorMessage: eventError.message });
      }
      return;
    }

    logger.info('Parsed transcript:', {
      sessionId,
      textLength: plainText.length,
      wordCount: plainText.split(' ').length,
    });

    const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
    await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, plainText);

    logger.info('Transcript stored for session:', { sessionId, s3Uri });

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId, eventType: SessionEventType.TRANSCRIBE_COMPLETED,
        timestamp: new Date().toISOString(), actorId: 'SYSTEM',
        actorType: 'system', details: { jobName },
      });
    } catch { /* non-blocking */ }

    // Record Transcribe cost for broadcast (non-blocking)
    try {
      const lastItem = items?.[items.length - 1];
      const audioDurationSeconds = lastItem?.end_time ? parseFloat(lastItem.end_time) : 0;
      if (audioDurationSeconds > 0) {
        const session = await getSessionById(tableName, sessionId);
        const costUsd = calculateTranscribeCost(audioDurationSeconds);
        await writeCostLineItem(tableName, {
          sessionId, service: CostService.TRANSCRIBE, costUsd, quantity: audioDurationSeconds, unit: 'seconds',
          rateApplied: PRICING_RATES.TRANSCRIBE, sessionType: session?.sessionType || 'BROADCAST', userId: session?.userId || '',
          createdAt: new Date().toISOString(),
        });
        await upsertCostSummary(tableName, sessionId, CostService.TRANSCRIBE, costUsd, session?.sessionType || 'BROADCAST', session?.userId || '');
        logger.info('Cost recorded', { service: 'TRANSCRIBE', costUsd, sessionId });
        await emitCostMetric('TRANSCRIBE', costUsd, session?.sessionType || 'BROADCAST', sessionId);
      }
    } catch (costError: any) {
      logger.warn('Failed to record cost (non-blocking)', { error: costError.message });
    }

    try {
      await ebClient.send(new PutEventsCommand({
        Entries: [{
          Source: 'custom.vnl',
          DetailType: 'Transcript Stored',
          Detail: JSON.stringify({ sessionId, transcriptS3Uri: s3Uri }),
        }],
      }));
      logger.info('Transcript Stored event emitted for session:', { sessionId });
      logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
    } catch (eventError: any) {
      logger.error('Failed to emit Transcript Stored event:', { errorMessage: eventError.message });
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
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment(`## ${record.messageId}`) as Subsegment | undefined;
    if (subsegment) tracer.setSegment(subsegment);

    try {
      // Parse JSON from SQS record body
      let ebEvent: any;
      try {
        ebEvent = JSON.parse(record.body);
      } catch (parseError: any) {
        logger.error('Failed to parse SQS record body as JSON', {
          messageId: record.messageId,
          error: parseError.message,
          handler: 'transcribe-completed',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate EventBridge envelope
      if (!ebEvent.detail) {
        logger.error('EventBridge event missing detail field', {
          messageId: record.messageId,
          handler: 'transcribe-completed',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate TranscribeJobDetail schema
      const parseResult = TranscribeJobDetailSchema.safeParse(ebEvent.detail);
      if (!parseResult.success) {
        const fieldErrors = parseResult.error.flatten().fieldErrors;
        logger.error('Invalid Transcribe job detail', {
          messageId: record.messageId,
          handler: 'transcribe-completed',
          fieldErrors,
          detail: JSON.stringify(ebEvent.detail),
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validation passed — call processEvent with typed detail
      const typedEvent: EventBridgeEvent<string, TranscribeJobDetail> = {
        ...ebEvent,
        detail: parseResult.data,
      };
      await processEvent(typedEvent, tracer);
    } catch (err: any) {
      tracer.addErrorAsMetadata(err as Error);
      logger.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: err.message,
      });
      failures.push({ itemIdentifier: record.messageId });
    } finally {
      subsegment?.close();
      if (segment) tracer.setSegment(segment);
    }
  }

  return { batchItemFailures: failures };
};
