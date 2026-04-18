/**
 * Nova Lite multimodal moderation classifier.
 *
 * Invokes amazon.nova-lite-v1:0 with an image + ruleset prompt, parses the JSON
 * response into a structured classification. On any parse/model failure the
 * caller sees `{ flagged: false, ... }` — we never produce a false positive
 * from model errors.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import type { Ruleset } from '../domain/ruleset';

const logger = new Logger({ serviceName: 'vnl-moderation', persistentKeys: { lib: 'nova-moderation' } });

let bedrockClient: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (!bedrockClient) bedrockClient = new BedrockRuntimeClient({});
  return bedrockClient;
}

export interface NovaClassification {
  flagged: boolean;
  items: string[];
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT =
  'You are a moderation classifier. Respond ONLY in JSON. No preamble, no code fences.';

function buildUserPrompt(ruleset: Ruleset): string {
  const items = ruleset.disallowedItems.join(', ');
  return [
    `Context: ${ruleset.description}`,
    `Disallowed items/behaviors: ${items}`,
    'Analyze the attached image. Determine whether any disallowed items or behaviors are visible.',
    'Respond ONLY with this JSON shape: {"flagged": bool, "items": [strings], "confidence": number 0-1, "reasoning": string}',
  ].join('\n');
}

/**
 * Invoke Nova Lite against an image (JPEG) with the given ruleset prompt.
 * Always resolves — caller never sees a throw (unflagged on any error).
 */
export async function classifyImage(
  modelId: string,
  ruleset: Ruleset,
  imageBytes: Uint8Array,
): Promise<NovaClassification> {
  const unflagged: NovaClassification = {
    flagged: false,
    items: [],
    confidence: 0,
    reasoning: 'model-error-treated-as-unflagged',
  };

  try {
    // Nova uses Converse-style message format for multimodal input.
    // @aws-sdk/client-bedrock-runtime's InvokeModelCommand wants the raw body.
    const base64 = Buffer.from(imageBytes).toString('base64');

    const body = {
      schemaVersion: 'messages-v1',
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [
            { image: { format: 'jpeg', source: { bytes: base64 } } },
            { text: buildUserPrompt(ruleset) },
          ],
        },
      ],
      inferenceConfig: {
        maxTokens: 400,
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
    const text: string | undefined = parsed?.output?.message?.content?.[0]?.text;
    if (!text) {
      logger.warn('Nova response missing text content', { rulesetName: ruleset.name });
      return unflagged;
    }

    const classification = parseClassificationJson(text);
    if (!classification) {
      logger.warn('Failed to parse classification JSON', {
        rulesetName: ruleset.name,
        textPreview: text.slice(0, 200),
      });
      return unflagged;
    }

    return classification;
  } catch (err) {
    logger.warn('Nova invocation failed — treating as unflagged', {
      rulesetName: ruleset.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return unflagged;
  }
}

/**
 * Extract a JSON object from model output. Handles stray prose or ``` fences
 * that sometimes leak through despite the system prompt.
 */
export function parseClassificationJson(text: string): NovaClassification | null {
  // Strip markdown fences if present
  let candidate = text.trim();
  if (candidate.startsWith('```')) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }

  // Try whole string, then first {...} substring
  const tryParse = (s: string): NovaClassification | null => {
    try {
      const obj = JSON.parse(s);
      if (typeof obj !== 'object' || obj === null) return null;
      const flagged = obj.flagged === true;
      const items = Array.isArray(obj.items) ? obj.items.filter((i: any) => typeof i === 'string') : [];
      const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : 0;
      const confidence = Math.max(0, Math.min(1, confidenceRaw));
      const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
      return { flagged, items, confidence, reasoning };
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  // Look for the first {...} block
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryParse(candidate.slice(start, end + 1));
  }
  return null;
}
