/**
 * EventBridge triggered Lambda handler for generating and storing AI summaries
 * Triggered when a transcript is stored on a session record (Phase 19 completion)
 * Fetches transcript text from S3 using the provided URI, invokes Bedrock Claude API
 * to generate a summary, then stores on session record
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { updateSessionAiSummary } from '../repositories/session-repository';

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
  const modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-sonnet-4-5-20250929-v1:0';

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

    console.log('Fetching transcript from S3:', { sessionId, bucketName, key });

    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const s3Response = await s3Client.send(getObjectCommand);
    const transcriptText = await s3Response.Body?.transformToString();

    if (!transcriptText || transcriptText.trim().length === 0) {
      console.warn('Empty transcript from S3:', { sessionId, transcriptS3Uri });
      // Non-blocking: set failed status but don't throw
      try {
        await updateSessionAiSummary(tableName, sessionId, {
          aiSummaryStatus: 'failed',
        });
      } catch (updateError: any) {
        console.error('Failed to update session with failed summary status:', updateError.message);
      }
      return;
    }

    console.log('Transcript fetched successfully:', { sessionId, textLength: transcriptText.length });

    // Prepare summarization prompt
    const systemPrompt = 'Generate a concise one-paragraph summary (2-3 sentences) of the following video session transcript.';
    const userPrompt = `Transcript:\n\n${transcriptText}`;

    const payload = {
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

    const command = new InvokeModelCommand({
      contentType: 'application/json',
      body: JSON.stringify(payload),
      modelId,
    });

    const apiResponse = await bedrockClient.send(command);
    const decodedResponseBody = new TextDecoder().decode(apiResponse.body);
    const responseBody = JSON.parse(decodedResponseBody);
    const summary = responseBody.content[0].text;

    // Store summary on session record (non-blocking — don't fail entire handler on error)
    try {
      await updateSessionAiSummary(tableName, sessionId, {
        aiSummary: summary,
        aiSummaryStatus: 'available',
      });
      console.log('AI summary stored:', { sessionId, summaryLength: summary.length });
    } catch (storeError: any) {
      console.error('Failed to store AI summary (non-blocking):', storeError.message);
      // Don't throw — summarization succeeded but storage failed; this is logged for manual recovery
    }
  } catch (error: any) {
    console.error('Bedrock summarization failed:', error.message);

    // Mark summary as failed but preserve the transcript (CRITICAL)
    try {
      await updateSessionAiSummary(tableName, sessionId, {
        aiSummaryStatus: 'failed',
        // aiSummary is NOT touched — existing transcript remains intact
      });
    } catch (updateError: any) {
      console.error('Failed to mark summary as failed:', updateError.message);
    }

    // Don't throw — EventBridge can retry if configured; transcript is safe
  }
};
