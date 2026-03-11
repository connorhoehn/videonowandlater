# Phase 34: Nova Lite for AI Summaries - Research

**Researched:** 2026-03-11
**Domain:** AWS Bedrock InvokeModel — Amazon Nova model family, Lambda env var config, token logging
**Confidence:** HIGH

## Summary

Phase 34 is a narrow, well-scoped change to `store-summary.ts`: swap the default Bedrock model from `amazon.nova-pro-v1:0` to `amazon.nova-lite-v1:0`, add token-count logging from the Nova response `usage` field, and update the CDK IAM policy to include the nova-lite ARN.

Nova Lite uses the identical request/response JSON schema as Nova Pro (the `messages-v1` format already wired in the handler). The response body for both Nova models includes a top-level `usage` object with `inputTokens`, `outputTokens`, and `totalTokens` — no API changes are required to read token counts, only new logging code.

One critical context from Phase 31: the `store-summary.ts` handler source still carries an `EventBridgeEvent` type signature. The Phase 31 plan updated the test file (uncommitted diff visible in the working tree) to use SQS-wrapped events and `SQSBatchResponse`, but the handler source was not updated. Phase 34 must update the handler's function signature from `EventBridgeEvent` to `SQSEvent` / `SQSBatchResponse` as part of the work, so the handler matches the SQS event source mapping that was already deployed in Phase 31.

**Primary recommendation:** Change the fallback string in `store-summary.ts` from `'amazon.nova-pro-v1:0'` to `'amazon.nova-lite-v1:0'`, read `responseBody.usage.inputTokens` and `responseBody.usage.outputTokens` after the Bedrock call, log them with `logger.info`, update the CDK env var and IAM policy, fix the handler signature to match SQS, and update the tests that assert the default model ID.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COST-01 | `store-summary.ts` uses `amazon.nova-lite-v1:0` as the default Bedrock model | Change fallback in handler; update CDK env var; nova-lite uses same Nova request/response format as nova-pro — no payload changes needed |
| COST-02 | Bedrock model ID read from `BEDROCK_MODEL_ID` env var (CDK passes the value) | Env var already exists in handler; CDK already sets `BEDROCK_MODEL_ID: 'amazon.nova-pro-v1:0'` — only change the value |
| COST-03 | Handler logs `inputTokens`, `outputTokens`, and `modelId` with every summarization | Nova InvokeModel response body has `usage.inputTokens` / `usage.outputTokens` at top level — read after JSON.parse, log with existing logger |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-bedrock-runtime` | (already installed) | `InvokeModelCommand` for Bedrock calls | Already used in handler; no new dependency |
| `@aws-lambda-powertools/logger` | ^2.31.0 | Structured JSON log output | Already installed and initialized in handler |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `aws-lambda` types | (already installed) | `SQSEvent`, `SQSBatchResponse` type defs | Needed to fix handler signature from EventBridge to SQS |

**Installation:** No new packages required.

---

## Architecture Patterns

### Nova Lite vs Nova Pro — Same Format, Different Cost

Nova Lite (`amazon.nova-lite-v1:0`) and Nova Pro (`amazon.nova-pro-v1:0`) share the identical `messages-v1` request/response schema. The handler already has the correct branch for Nova (the non-`isClaudeModel` path). No payload restructuring is needed.

**Existing request payload (works unchanged for nova-lite):**
```typescript
// Source: store-summary.ts lines 96-113 (existing production code)
payload = {
  messages: [
    {
      role: 'user',
      content: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
    },
  ],
  inferenceConfig: {
    maxTokens: 500,
    temperature: 0.7,
  },
};
```

### Nova Response Structure — Token Fields

The `InvokeModel` response body for any Nova model includes a `usage` object at the top level alongside `output`:

```typescript
// Source: AWS Bedrock docs (confirmed by WebSearch cross-reference)
// responseBody structure after JSON.parse(decodedResponseBody)
{
  output: {
    message: {
      role: 'assistant',
      content: [{ text: '...' }]
    }
  },
  stopReason: 'end_turn',
  usage: {
    inputTokens: 125,
    outputTokens: 60,
    totalTokens: 185
  },
  metrics: {
    latencyMs: 1175
  }
}
```

Token logging pattern to add after the existing summary extraction:
```typescript
// After: summary = responseBody.output.message.content[0].text;
const usage = responseBody.usage as { inputTokens: number; outputTokens: number } | undefined;
logger.info('Bedrock invocation metrics', {
  modelId,
  inputTokens: usage?.inputTokens,
  outputTokens: usage?.outputTokens,
});
```

### Handler Signature — SQS Fix (Required)

Phase 31 added an SQS event source mapping for `storeSummaryFn`. The handler must accept `SQSEvent` and return `SQSBatchResponse`. The test file was already updated to this contract (visible in the working tree diff). The handler source must be updated to match.

**Pattern used by other Phase 31 SQS handlers (from test diffs):**
```typescript
// SQS wrapper pattern — EventBridge event is in record.body as JSON string
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const ebEvent = JSON.parse(record.body);
      const { sessionId, transcriptS3Uri } = ebEvent.detail;
      // ... handler logic ...
    } catch (err) {
      // Do NOT push to batchItemFailures for non-retryable errors
      // Only throw / add failure for retryable infrastructure errors
    }
  }

  return { batchItemFailures };
};
```

**Key rule:** The store-summary handler currently catches all errors and does not re-throw (by design — COST-03 does not change this). Logical errors (empty transcript, bad S3 URI) are handled gracefully; only infrastructure errors that warrant SQS retry should go into `batchItemFailures`. The existing error-handling philosophy (non-blocking, preserve transcript) is unchanged.

### CDK Changes — Env Var and IAM

Two CDK changes in `session-stack.ts`:

1. **Env var value** (line 700): Change `'amazon.nova-pro-v1:0'` to `'amazon.nova-lite-v1:0'`

2. **IAM policy resources** (lines 716-719): Add nova-lite ARN. Keep nova-pro for backward compatibility (existing sessions that might be reprocessed):
```typescript
// Source: session-stack.ts lines 713-721 (existing, add nova-lite line)
storeSummaryFn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,  // ADD
      `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,   // KEEP
      `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,     // KEEP
    ],
    effect: iam.Effect.ALLOW,
  })
);
```

### Anti-Patterns to Avoid

- **Removing nova-pro from IAM:** Keep it in the policy. The env var override (COST-02) allows switching back at runtime; removing the IAM ARN would break any override to nova-pro.
- **Changing Claude payload format:** The `isClaudeModel` branch is backward compatibility. Do not touch it.
- **Adding `usage` logging inside the inner `try` block that has the non-blocking DynamoDB write:** Log tokens immediately after summary extraction, before the storage try/catch, so token counts are always logged even if DynamoDB fails.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Token counting | Custom tokenizer | Read `responseBody.usage.inputTokens` / `outputTokens` directly from Nova response |
| Model routing | Custom dispatch logic | `BEDROCK_MODEL_ID` env var + existing `isClaudeModel` branch |

---

## Common Pitfalls

### Pitfall 1: `usage` field absent for Claude models
**What goes wrong:** `responseBody.usage` is a Nova-specific field. If someone sets `BEDROCK_MODEL_ID` to `anthropic.claude-*`, the `usage` field will be absent (Claude uses `responseBody.usage.input_tokens` with underscores in a different location).
**How to avoid:** Guard with optional chaining (`responseBody.usage?.inputTokens`). Log undefined if absent rather than throwing. This matches the backward-compat philosophy already in the handler.
**Warning signs:** Token logging shows `undefined` for inputTokens — expected for Claude, not for Nova.

### Pitfall 2: Tests assert `modelId: 'amazon.nova-pro-v1:0'` as default
**What goes wrong:** Several tests (lines 128, 570 of the updated test file) assert `lastInvokeModelCommand.modelId === 'amazon.nova-pro-v1:0'`. After COST-01, these tests will fail.
**How to avoid:** Update any test that asserts the default model ID to `'amazon.nova-lite-v1:0'`.
**Warning signs:** Test failure `Expected: "amazon.nova-pro-v1:0" Received: "amazon.nova-lite-v1:0"`.

### Pitfall 3: Handler signature mismatch breaks tests
**What goes wrong:** The working-tree test file already calls `handler(makeSqsEvent(...))` and expects `SQSBatchResponse`. If the handler still exports `(event: EventBridgeEvent) => Promise<void>`, tests will fail to compile and return type assertions will break.
**How to avoid:** Update handler signature as part of Phase 34 (this is the Phase 31 handler-source gap).
**Warning signs:** TypeScript error `Argument of type 'SQSEvent' is not assignable to parameter of type 'EventBridgeEvent'`.

### Pitfall 4: SQS batch record iteration
**What goes wrong:** SQS event source sends `event.Records` array. The existing handler reads `event.detail` directly (EventBridge pattern), which is `undefined` on an SQS event.
**How to avoid:** Wrap in `for (const record of event.Records)` and parse `JSON.parse(record.body)` to get the EventBridge event, then access `.detail`.

---

## Code Examples

### Full token logging addition (after summary extraction)

```typescript
// Source: pattern derived from Nova response schema + existing handler structure
// Place immediately after: summary = responseBody.output.message.content[0].text;
const usage = (responseBody as any).usage as { inputTokens?: number; outputTokens?: number } | undefined;
logger.info('Bedrock invocation metrics', {
  modelId,
  inputTokens: usage?.inputTokens,
  outputTokens: usage?.outputTokens,
});
```

### Minimal default model change

```typescript
// In store-summary.ts (line 30 currently):
// BEFORE:
const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
// AFTER:
const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';
```

### CDK env var update

```typescript
// In session-stack.ts (line 700 currently):
// BEFORE:
BEDROCK_MODEL_ID: 'amazon.nova-pro-v1:0',
// AFTER:
BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `amazon.nova-pro-v1:0` default | `amazon.nova-lite-v1:0` default | Nova Lite is ~75% cheaper than Nova Pro for text-generation tasks; equivalent quality for short summarization prompts |
| No token logging | Log `inputTokens` + `outputTokens` per invocation | CloudWatch Logs Insights can aggregate cost per session |
| `EventBridgeEvent` handler signature | `SQSEvent` + `SQSBatchResponse` | Matches Phase 31 SQS event source mapping already deployed |

---

## Open Questions

1. **Nova Lite availability in all regions**
   - What we know: Nova Lite is available in `us-east-1` and other standard Bedrock regions
   - What's unclear: Whether the project's deployed region has Nova Lite enabled in Bedrock model access settings
   - Recommendation: The CDK plan should note that `amazon.nova-lite-v1:0` must be enabled in Bedrock model access for the target AWS account/region; this is a one-time console action, not CDK-deployable

2. **Claude model token logging**
   - What we know: Claude response uses `usage.input_tokens` / `usage.output_tokens` (underscores, different nesting)
   - What's unclear: Whether the project ever uses Claude via `BEDROCK_MODEL_ID` override
   - Recommendation: Log Nova-only token counts for now; add a comment noting Claude token field names differ; do not add Claude token extraction (COST-03 scope is Nova only)

---

## Sources

### Primary (HIGH confidence)
- AWS Bedrock InvokeModel API Reference — response body model-specific, points to model-specific docs
- Amazon Nova InvokeModel response structure — confirmed `usage.inputTokens` / `usage.outputTokens` fields via AWS documentation and AWS samples
- `backend/src/handlers/store-summary.ts` — direct inspection of current handler source
- `backend/src/handlers/__tests__/store-summary.test.ts` — working-tree diff confirms SQS migration contract
- `infra/lib/stacks/session-stack.ts` — direct inspection confirming existing `BEDROCK_MODEL_ID` env var and nova-pro IAM ARN

### Secondary (MEDIUM confidence)
- [AWS Bedrock InvokeModel docs](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html) — confirms response body is model-specific
- [Using the Invoke API - Amazon Nova](https://docs.aws.amazon.com/nova/latest/userguide/using-invoke-api.html) — Nova request/response format
- [Supported foundation models in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html) — confirmed `amazon.nova-lite-v1:0` model ID

### Tertiary (LOW confidence)
- WebSearch aggregate for `usage.inputTokens` / `usage.outputTokens` in Nova response — confirmed by multiple sources but no single canonical code sample found in official docs during this session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing handler already uses correct Nova format
- Architecture: HIGH — handler source and test diffs directly inspected; Nova response schema confirmed
- Pitfalls: HIGH — test assertions and type mismatches identified from direct file inspection

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable AWS SDK and Bedrock model schema)
