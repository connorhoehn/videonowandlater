/**
 * SQS-wrapped Lambda handler for generating and storing AI summaries
 * Triggered when a transcript is stored on a session record (Phase 19 completion)
 * Fetches transcript text from S3 using the provided URI, invokes Bedrock Claude API
 * to generate a summary, then stores on session record.
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { getSessionById, updateSessionAiSummary, updateSessionChapters } from '../repositories/session-repository';
import type { Chapter } from '../domain/session';
import { TranscriptStoreDetailSchema, type TranscriptStoreDetail } from './schemas/store-summary.schema';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'store-summary' },
});

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const bedrockClient = tracer.captureAWSv3Client(new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION,
}));
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

// TranscriptStoreDetail is imported from schema

async function processEvent(
  event: EventBridgeEvent<string, TranscriptStoreDetail>,
  tracer: Tracer
): Promise<void> {
  const { sessionId, transcriptS3Uri } = event.detail;
  const tableName = process.env.TABLE_NAME!;
  const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';

  const startMs = Date.now();
  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered', { transcriptS3Uri });

  tracer.putAnnotation('sessionId', sessionId);
  tracer.putAnnotation('pipelineStage', 'store-summary');

  // IDEM-02: Check if summary already available (idempotent guard)
  try {
    const session = await getSessionById(tableName, sessionId);
    if (session?.aiSummaryStatus === 'available' && session?.aiSummary) {
      logger.info('AI summary already available (idempotent retry)', {
        sessionId,
        existingLength: session.aiSummary.length
      });
      // No-op: return success without Bedrock invocation
      return;
    }
  } catch (error: any) {
    logger.warn('Failed to check session state (non-blocking, continue):', { errorMessage: error.message });
    // If we can't verify, proceed — better to re-invoke Bedrock than silently skip with stale data
  }

  try {
    // Parse S3 URI and fetch transcript
    // URI format: s3://bucket/path/to/key
    const s3Match = transcriptS3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!s3Match) {
      throw new Error(`Invalid S3 URI format: ${transcriptS3Uri}`);
    }

    const [, bucketName, key] = s3Match;

    logger.info('Fetching transcript from S3:', { sessionId, bucketName, key });

    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const s3Response = await s3Client.send(getObjectCommand);
    const transcriptText = await s3Response.Body?.transformToString();

    if (!transcriptText || transcriptText.trim().length === 0) {
      logger.warn('Empty transcript from S3:', { sessionId, transcriptS3Uri });
      // Non-blocking: set failed status but don't throw
      try {
        await updateSessionAiSummary(tableName, sessionId, {
          aiSummaryStatus: 'failed',
        });
      } catch (updateError: any) {
        logger.error('Failed to update session with failed summary status:', { errorMessage: updateError.message });
      }
      return;
    }

    logger.info('Transcript fetched successfully:', { sessionId, textLength: transcriptText.length });

    // Prepare summarization prompt
    const systemPrompt = 'Generate a concise one-paragraph summary (2-3 sentences) of the following video session transcript.';
    const userPrompt = `Transcript:\n\n${transcriptText}`;

    // Determine if this is a Claude model or Nova model
    const isClaudeModel = modelId.startsWith('anthropic.');

    let payload: any;
    if (isClaudeModel) {
      // Claude model format (backward compatibility)
      payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userPrompt }],
          },
        ],
      };
    } else {
      // Nova Lite format (new default)
      payload = {
        messages: [
          {
            role: 'user',
            content: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens: 500,
          temperature: 0.7,
        },
      };
    }

    logger.info('Using model:', { modelId, isClaudeModel });

    const command = new InvokeModelCommand({
      contentType: 'application/json',
      body: JSON.stringify(payload),
      modelId,
    });

    const apiResponse = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(apiResponse.body);
    const responseBody = JSON.parse(decodedResponseBody);

    // Extract summary based on model response format
    let summary: string;
    if (isClaudeModel) {
      // Claude response format
      summary = responseBody.content[0].text;
    } else {
      // Nova Lite response format
      summary = responseBody.output.message.content[0].text;
    }

    // Log token usage for cost tracking (COST-03)
    // Note: usage field is Nova-specific; Claude uses different field names (input_tokens with underscores)
    const usage = (responseBody as any).usage as { inputTokens?: number; outputTokens?: number } | undefined;
    logger.info('Bedrock invocation metrics', {
      modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    });

    // Store summary on session record (non-blocking — don't fail entire handler on error)
    try {
      await updateSessionAiSummary(tableName, sessionId, {
        aiSummary: summary,
        aiSummaryStatus: 'available',
      });
      logger.info('AI summary stored:', { sessionId, summaryLength: summary.length });
      logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
    } catch (storeError: any) {
      logger.error('Failed to store AI summary (non-blocking):', { errorMessage: storeError.message });
      // Don't throw — summarization succeeded but storage failed; this is logged for manual recovery
    }

    // --- Chapter generation (non-blocking) ---
    try {
      const session = await getSessionById(tableName, sessionId);
      if (session?.diarizedTranscriptS3Path) {
        const diarizedMatch = session.diarizedTranscriptS3Path.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (diarizedMatch) {
          const [, diarizedBucket, diarizedKey] = diarizedMatch;
          const diarizedResponse = await s3Client.send(new GetObjectCommand({
            Bucket: diarizedBucket,
            Key: diarizedKey,
          }));
          const speakerSegmentsJson = await diarizedResponse.Body?.transformToString();

          if (speakerSegmentsJson && speakerSegmentsJson.trim().length > 0) {
            const chapterPrompt = `Given the following video transcript with speaker segments, divide it into 3-8 logical chapters. Each chapter should represent a distinct topic or segment of the conversation.

Return ONLY a JSON array with this exact format:
[{"title": "Chapter Title", "startTimeMs": 0, "endTimeMs": 60000}]

Speaker segments:
${speakerSegmentsJson}`;

            let chapterPayload: any;
            if (isClaudeModel) {
              chapterPayload = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 1000,
                messages: [
                  { role: 'user', content: [{ type: 'text', text: chapterPrompt }] },
                ],
              };
            } else {
              chapterPayload = {
                messages: [
                  { role: 'user', content: [{ text: chapterPrompt }] },
                ],
                inferenceConfig: { maxTokens: 1000, temperature: 0.3 },
              };
            }

            const chapterCommand = new InvokeModelCommand({
              contentType: 'application/json',
              body: JSON.stringify(chapterPayload),
              modelId,
            });

            const chapterApiResponse = await bedrockClient.send(chapterCommand);
            const chapterDecoded = new TextDecoder().decode(chapterApiResponse.body);
            const chapterBody = JSON.parse(chapterDecoded);

            let chapterText: string;
            if (isClaudeModel) {
              chapterText = chapterBody.content[0].text;
            } else {
              chapterText = chapterBody.output.message.content[0].text;
            }

            // Extract JSON array from response (may be wrapped in markdown code fences)
            const jsonMatch = chapterText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const rawChapters = JSON.parse(jsonMatch[0]) as any[];
              const chapters: Chapter[] = rawChapters
                .filter((c: any) => c.title && typeof c.startTimeMs === 'number' && typeof c.endTimeMs === 'number')
                .map((c: any) => ({
                  title: c.title,
                  startTimeMs: c.startTimeMs,
                  endTimeMs: c.endTimeMs,
                  thumbnailIndex: Math.round(c.startTimeMs / 5000),
                }));

              if (chapters.length > 0) {
                await updateSessionChapters(tableName, sessionId, chapters);
                logger.info('Chapters generated and stored', { sessionId, chapterCount: chapters.length });

                // Publish event to trigger highlight reel generation
                const eventBusName = process.env.EVENT_BUS_NAME;
                if (eventBusName) {
                  try {
                    await eventBridgeClient.send(new PutEventsCommand({
                      Entries: [{
                        Source: 'custom.vnl',
                        DetailType: 'Chapters Stored',
                        Detail: JSON.stringify({ sessionId }),
                        EventBusName: eventBusName,
                      }],
                    }));
                    logger.info('Highlight reel pipeline triggered', { sessionId });
                  } catch (ebError: any) {
                    logger.warn('Failed to publish Chapters Stored event (non-blocking)', {
                      sessionId,
                      error: ebError.message,
                    });
                  }
                }
              }
            }
          }
        }
      } else {
        logger.info('No diarized transcript available, skipping chapter generation', { sessionId });
      }
    } catch (chapterError: any) {
      logger.warn('Chapter generation failed (non-blocking):', { sessionId, errorMessage: chapterError.message });
      // Non-blocking: chapter failure should NOT fail the overall handler
    }
  } catch (error: any) {
    logger.error('Bedrock summarization failed:', { errorMessage: error.message });
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error instanceof Error ? error.message : String(error) });

    // Mark summary as failed but preserve the transcript (CRITICAL)
    try {
      await updateSessionAiSummary(tableName, sessionId, {
        aiSummaryStatus: 'failed',
        // aiSummary is NOT touched — existing transcript remains intact
      });
    } catch (updateError: any) {
      logger.error('Failed to mark summary as failed:', { errorMessage: updateError.message });
    }

    // Don't throw — EventBridge can retry if configured; transcript is safe
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
          handler: 'store-summary',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate EventBridge envelope
      if (!ebEvent.detail) {
        logger.error('EventBridge event missing detail field', {
          messageId: record.messageId,
          handler: 'store-summary',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate TranscriptStoreDetail schema
      const parseResult = TranscriptStoreDetailSchema.safeParse(ebEvent.detail);
      if (!parseResult.success) {
        const fieldErrors = parseResult.error.flatten().fieldErrors;
        logger.error('Invalid transcript store detail', {
          messageId: record.messageId,
          handler: 'store-summary',
          fieldErrors,
          detail: JSON.stringify(ebEvent.detail),
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validation passed — call processEvent with typed detail
      const typedEvent: EventBridgeEvent<string, TranscriptStoreDetail> = {
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
