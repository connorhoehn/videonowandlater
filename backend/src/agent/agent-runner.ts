/**
 * AI Agent Runner — ECS Fargate entrypoint
 * Joins an IVS stage, speaks via Polly TTS, captures responses, extracts intents
 */

import { IVSRealTimeClient, CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getIntentFlow, updateIntentFlowStep, updateIntentFlowStatus } from '../repositories/intent-repository';
import { updateAgentStatus, writeAgentAuditRecord } from '../repositories/agent-repository';
import { writeCostLineItem, upsertCostSummary } from '../repositories/cost-repository';
import { CostService, PRICING_RATES, calculatePollyCost, calculateEcsFargateCost, calculateBedrockCost } from '../domain/cost';

const SESSION_ID = process.env.SESSION_ID!;
const STAGE_ARN = process.env.STAGE_ARN!;
const CHAT_ROOM_ARN = process.env.CHAT_ROOM_ARN!;
const INTENT_FLOW_ID = process.env.INTENT_FLOW_ID!;
const TABLE_NAME = process.env.TABLE_NAME!;

const ivsRealtime = new IVSRealTimeClient({});
const ivsChat = new IvschatClient({});
const polly = new PollyClient({});
const bedrock = new BedrockRuntimeClient({});

const startTime = Date.now();

async function sendChatEvent(eventName: string, attributes: Record<string, string> = {}): Promise<void> {
  if (!CHAT_ROOM_ARN) return;
  try {
    await ivsChat.send(new SendEventCommand({
      roomIdentifier: CHAT_ROOM_ARN,
      eventName,
      attributes,
    }));
  } catch (err: any) {
    console.error(`Failed to send chat event ${eventName}:`, err.message);
  }
}

async function synthesizeSpeech(text: string): Promise<{ audioBytes: Uint8Array; characters: number }> {
  const response = await polly.send(new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: 'pcm',
    VoiceId: 'Matthew',
    Engine: 'neural',
    SampleRate: '24000',
  }));

  const audioBytes = await response.AudioStream!.transformToByteArray();
  return { audioBytes, characters: text.length };
}

async function extractIntent(transcript: string, slotName: string, slotType: string, prompt: string): Promise<{ value: string; confidence: number; inputTokens: number; outputTokens: number }> {
  const extractionPrompt = `You are extracting structured data from a conversation transcript.

The AI asked: "${prompt}"
The user responded: "${transcript}"

Extract the value for the slot "${slotName}" (type: ${slotType}).
Respond with ONLY a JSON object: {"value": "extracted value", "confidence": 0.0-1.0}
If you cannot extract a clear value, set confidence below 0.5.`;

  const response = await bedrock.send(new InvokeModelCommand({
    modelId: 'amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: extractionPrompt }] }],
      inferenceConfig: { maxTokens: 200, temperature: 0.1 },
    }),
  }));

  const body = JSON.parse(new TextDecoder().decode(response.body));
  const outputText = body.output?.message?.content?.[0]?.text || '{}';
  const inputTokens = body.usage?.inputTokens || 0;
  const outputTokens = body.usage?.outputTokens || 0;

  try {
    const parsed = JSON.parse(outputText);
    return { value: parsed.value || '', confidence: parsed.confidence || 0, inputTokens, outputTokens };
  } catch {
    return { value: '', confidence: 0, inputTokens, outputTokens };
  }
}

async function run(): Promise<void> {
  console.log(`Agent starting: session=${SESSION_ID}, flow=${INTENT_FLOW_ID}`);

  try {
    // Update status
    await updateAgentStatus(TABLE_NAME, SESSION_ID, 'joining');
    await writeAgentAuditRecord(TABLE_NAME, SESSION_ID, 'join', { intentFlowId: INTENT_FLOW_ID });

    // Create participant token
    const tokenResponse = await ivsRealtime.send(new CreateParticipantTokenCommand({
      stageArn: STAGE_ARN,
      userId: 'ai-agent',
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
      duration: 720,
      attributes: { userId: 'ai-agent', displayName: 'AI Assistant' },
    }));

    const participantToken = tokenResponse.participantToken?.token;
    if (!participantToken) throw new Error('Failed to create participant token');

    await updateAgentStatus(TABLE_NAME, SESSION_ID, 'speaking', tokenResponse.participantToken?.participantId);

    // Notify frontend
    await sendChatEvent('ai_joining');

    // Get intent flow
    const flow = await getIntentFlow(TABLE_NAME, SESSION_ID, INTENT_FLOW_ID);
    if (!flow) throw new Error(`Intent flow ${INTENT_FLOW_ID} not found`);

    await updateIntentFlowStatus(TABLE_NAME, SESSION_ID, INTENT_FLOW_ID, 'in_progress');

    let totalPollyChars = 0;
    let totalBedrockInputTokens = 0;
    let totalBedrockOutputTokens = 0;

    // Execute each step
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      console.log(`Step ${i + 1}/${flow.steps.length}: ${step.intentSlot}`);

      // Speak the prompt
      await sendChatEvent('ai_speaking', {
        meta: JSON.stringify({
          stepName: step.intentSlot,
          prompt: step.prompt,
          stepIndex: i,
          totalSteps: flow.steps.length,
        }),
      });

      const { characters } = await synthesizeSpeech(step.prompt);
      totalPollyChars += characters;

      // NOTE: In production, the audio would be streamed to the stage via FFmpeg WHIP.
      // For now, we synthesize and log — WHIP streaming requires the FFmpeg binary
      // running in the Docker container alongside this script.

      // Signal done speaking
      await sendChatEvent('ai_done_speaking', { stepName: step.intentSlot });

      // Wait for response (simulated — in production, Transcribe Streaming captures audio)
      // For now, we wait a fixed duration and then check for new transcript content
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10s wait

      // In production: capture audio from stage via WHEP, pipe to Transcribe Streaming
      // For now: use a placeholder indicating the intent flow is ready for manual transcript input
      const mockTranscript = ''; // Will be filled by the per-participant recording pipeline

      if (mockTranscript) {
        const { value, confidence, inputTokens, outputTokens } = await extractIntent(
          mockTranscript, step.intentSlot, step.slotType || 'text', step.prompt
        );
        totalBedrockInputTokens += inputTokens;
        totalBedrockOutputTokens += outputTokens;

        await updateIntentFlowStep(TABLE_NAME, SESSION_ID, INTENT_FLOW_ID, i, value, confidence);
        await writeAgentAuditRecord(TABLE_NAME, SESSION_ID, 'intent_extracted', {
          slot: step.intentSlot, value, confidence: String(confidence),
        });

        console.log(`  Extracted: ${step.intentSlot} = "${value}" (confidence: ${confidence})`);
      } else {
        console.log(`  No transcript captured for step ${i + 1} — slot will be filled post-call`);
      }
    }

    // Complete
    await updateIntentFlowStatus(TABLE_NAME, SESSION_ID, INTENT_FLOW_ID, 'completed');
    await updateAgentStatus(TABLE_NAME, SESSION_ID, 'completed');

    await sendChatEvent('ai_completed', {
      meta: JSON.stringify({ flowId: INTENT_FLOW_ID, status: 'completed' }),
    });

    // Record costs
    const durationSeconds = (Date.now() - startTime) / 1000;

    if (totalPollyChars > 0) {
      const pollyCost = calculatePollyCost(totalPollyChars);
      await writeCostLineItem(TABLE_NAME, {
        sessionId: SESSION_ID, service: CostService.POLLY_TTS, costUsd: pollyCost,
        quantity: totalPollyChars, unit: 'characters',
        rateApplied: PRICING_RATES.POLLY_TTS_NEURAL, sessionType: 'HANGOUT', userId: 'ai-agent',
        createdAt: new Date().toISOString(),
      });
      await upsertCostSummary(TABLE_NAME, SESSION_ID, CostService.POLLY_TTS, pollyCost, 'HANGOUT', 'ai-agent');
    }

    const ecsCost = calculateEcsFargateCost(durationSeconds);
    await writeCostLineItem(TABLE_NAME, {
      sessionId: SESSION_ID, service: CostService.ECS_FARGATE, costUsd: ecsCost,
      quantity: durationSeconds, unit: 'seconds',
      rateApplied: PRICING_RATES.ECS_FARGATE_VCPU_HOUR, sessionType: 'HANGOUT', userId: 'ai-agent',
      createdAt: new Date().toISOString(),
    });
    await upsertCostSummary(TABLE_NAME, SESSION_ID, CostService.ECS_FARGATE, ecsCost, 'HANGOUT', 'ai-agent');

    if (totalBedrockInputTokens > 0) {
      const bedrockCost = calculateBedrockCost('amazon.nova-lite-v1:0', totalBedrockInputTokens, totalBedrockOutputTokens);
      await writeCostLineItem(TABLE_NAME, {
        sessionId: SESSION_ID, service: CostService.BEDROCK_NOVA, costUsd: bedrockCost,
        quantity: totalBedrockInputTokens + totalBedrockOutputTokens, unit: 'tokens',
        rateApplied: PRICING_RATES.BEDROCK_NOVA_INPUT, sessionType: 'HANGOUT', userId: 'ai-agent',
        createdAt: new Date().toISOString(),
      });
      await upsertCostSummary(TABLE_NAME, SESSION_ID, CostService.BEDROCK_NOVA, bedrockCost, 'HANGOUT', 'ai-agent');
    }

    await writeAgentAuditRecord(TABLE_NAME, SESSION_ID, 'leave', {
      durationSeconds: String(Math.round(durationSeconds)),
      pollyCharacters: String(totalPollyChars),
    });

    console.log(`Agent completed in ${Math.round(durationSeconds)}s`);
  } catch (err: any) {
    console.error('Agent error:', err.message);
    await updateAgentStatus(TABLE_NAME, SESSION_ID, 'failed');
    await sendChatEvent('ai_error', { error: err.message });
    await writeAgentAuditRecord(TABLE_NAME, SESSION_ID, 'error', { error: err.message });
    process.exit(1);
  }
}

run().then(() => process.exit(0));
