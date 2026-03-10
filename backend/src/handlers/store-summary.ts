/**
 * EventBridge triggered Lambda handler for generating and storing AI summaries
 * Triggered when a transcript is stored on a session record (Phase 19 completion)
 * Fetches transcript text from S3 using the provided URI, invokes Bedrock Claude API
 * to generate a summary, then stores on session record
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import { updateSessionAiSummary } from '../repositories/session-repository';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'store-summary' },
});

interface TranscriptStoreDetail {
  sessionId: string;
  transcriptS3Uri: string;
}

export const handler = async (
  event: EventBridgeEvent<'Transcript Stored', TranscriptStoreDetail>
): Promise<void> => {
  const { sessionId, transcriptS3Uri } = event.detail;
  const tableName = process.env.TABLE_NAME!;
  const bedrockRegion = process.env.BEDROCK_REGION || process.env.AWS_REGION!;
  const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';

  const startMs = Date.now();
  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered', { transcriptS3Uri });

  const s3Client = new S3Client({ region: process.env.AWS_REGION });
  const bedrockClient = new BedrockRuntimeClient({ region: bedrockRegion });

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
      // Nova Pro format (new default)
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
      // Nova Pro response format
      summary = responseBody.output.message.content[0].text;
    }

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
};
