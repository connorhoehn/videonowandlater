/**
 * EventBridge triggered Lambda handler for generating and storing AI summaries
 * Triggered when a transcript is stored on a session record (Phase 19 completion)
 * Invokes AWS Bedrock Claude API to generate a summary, then stores on session record
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { updateSessionAiSummary } from '../repositories/session-repository';

interface TranscriptStoreDetail {
  sessionId: string;
  transcriptText: string;
}

export const handler = async (
  event: EventBridgeEvent<'Transcript Stored', TranscriptStoreDetail>
): Promise<void> => {
  const { sessionId, transcriptText } = event.detail;
  const tableName = process.env.TABLE_NAME!;
  const bedrockRegion = process.env.BEDROCK_REGION || process.env.AWS_REGION!;
  const modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-sonnet-4-5-20250929-v1:0';

  const client = new BedrockRuntimeClient({ region: bedrockRegion });

  try {
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

    const apiResponse = await client.send(command);
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
