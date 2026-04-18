/**
 * Nova Lite text classifier for chat messages.
 *
 * Mirrors the image-oriented `nova-moderation.ts` but for text-only input.
 * Invokes amazon.nova-lite-v1:0 with a chat-specific prompt and parses the JSON
 * response into a `ChatClassification`. On any parse/model failure the caller
 * sees `{ flagged: false, ... }` — we never produce a false positive from a
 * model error. The sender's message has already been delivered to IVS Chat;
 * this path is audit/after-the-fact, so failing closed is safe.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-moderation', persistentKeys: { lib: 'nova-text-moderation' } });

let bedrockClient: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (!bedrockClient) bedrockClient = new BedrockRuntimeClient({});
  return bedrockClient;
}

export interface ChatClassification {
  flagged: boolean;
  categories: string[];
  confidence: number;
  reasoning: string;
}

const DEFAULT_MODEL_ID = 'amazon.nova-lite-v1:0';

const SYSTEM_PROMPT =
  'You are a chat-moderation classifier. Respond ONLY in JSON. No preamble, no code fences.';

function buildUserPrompt(text: string, rulesetName?: string): string {
  const rulesetHint = rulesetName
    ? `Apply the "${rulesetName}" community ruleset guidelines.`
    : 'Apply default community guidelines.';
  return [
    rulesetHint,
    'Classify the following chat message. Flag if it contains hate speech, harassment, threats, explicit sexual content, or spam.',
    'Return JSON: {"flagged": bool, "categories": [strings], "confidence": number 0-1, "reasoning": string}.',
    '',
    `Message: """${text}"""`,
  ].join('\n');
}

/**
 * Invoke Nova Lite to classify a chat message. Always resolves — on error the
 * caller sees an unflagged result (we log a warn and move on).
 */
export async function classifyChatMessage(
  text: string,
  rulesetName?: string,
  modelId: string = DEFAULT_MODEL_ID,
): Promise<ChatClassification> {
  const unflagged: ChatClassification = {
    flagged: false,
    categories: [],
    confidence: 0,
    reasoning: 'model-error-treated-as-unflagged',
  };

  // Defensive: empty string, short whitespace etc. — never waste a Bedrock call.
  if (!text || !text.trim()) return unflagged;

  try {
    const body = {
      schemaVersion: 'messages-v1',
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [{ text: buildUserPrompt(text, rulesetName) }],
        },
      ],
      inferenceConfig: {
        maxTokens: 300,
        temperature: 0.1,
        topP: 0.9,
      },
    };

    const response = await getClient().send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      }),
    );

    const rawText = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(rawText);

    // Nova response shape: { output: { message: { content: [ { text: "..." } ] } } }
    const modelText: string | undefined = parsed?.output?.message?.content?.[0]?.text;
    if (!modelText) {
      logger.warn('Nova response missing text content', { rulesetName });
      return unflagged;
    }

    const classification = parseChatClassificationJson(modelText);
    if (!classification) {
      logger.warn('Failed to parse chat classification JSON', {
        rulesetName,
        textPreview: modelText.slice(0, 200),
      });
      return unflagged;
    }

    return classification;
  } catch (err) {
    logger.warn('Nova text invocation failed — treating as unflagged', {
      rulesetName,
      error: err instanceof Error ? err.message : String(err),
    });
    return unflagged;
  }
}

/**
 * Extract a JSON object from model output. Handles stray prose or ``` fences
 * that sometimes leak through despite the system prompt.
 */
export function parseChatClassificationJson(text: string): ChatClassification | null {
  let candidate = text.trim();
  if (candidate.startsWith('```')) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }

  const tryParse = (s: string): ChatClassification | null => {
    try {
      const obj = JSON.parse(s);
      if (typeof obj !== 'object' || obj === null) return null;
      const flagged = obj.flagged === true;
      const categories = Array.isArray(obj.categories)
        ? obj.categories.filter((i: any) => typeof i === 'string')
        : [];
      const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : 0;
      const confidence = Math.max(0, Math.min(1, confidenceRaw));
      const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
      return { flagged, categories, confidence, reasoning };
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryParse(candidate.slice(start, end + 1));
  }
  return null;
}
