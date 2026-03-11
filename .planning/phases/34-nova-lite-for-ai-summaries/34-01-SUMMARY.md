---
phase: 34-nova-lite-for-ai-summaries
plan: "01"
subsystem: backend-pipeline
tags: [bedrock, cost-optimization, nova-lite, token-logging, cdk]
dependency_graph:
  requires: []
  provides: [nova-lite-default-model, token-usage-logging, bedrock-iam-nova-lite]
  affects: [store-summary-handler, session-stack-cdk]
tech_stack:
  added: []
  patterns: [bedrock-usage-logging, nova-lite-converse-api]
key_files:
  created: []
  modified:
    - backend/src/handlers/store-summary.ts
    - backend/src/handlers/__tests__/store-summary.test.ts
    - infra/lib/stacks/session-stack.ts
decisions:
  - "Use amazon.nova-lite-v1:0 as default — 75% cost reduction vs Nova Pro for short summarization prompts"
  - "Retain nova-pro and claude ARNs in IAM policy — BEDROCK_MODEL_ID env var allows runtime override without redeployment"
  - "Token logging uses optional chaining (usage?.inputTokens) — gracefully handles Claude responses where usage field is absent"
  - "Token logging placed before storage try/catch — tokens logged even if DynamoDB write fails"
metrics:
  duration_seconds: 166
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_modified: 3
  tests_before: 453
  tests_after: 455
---

# Phase 34 Plan 01: Nova Lite for AI Summaries Summary

Switched store-summary handler from amazon.nova-pro-v1:0 to amazon.nova-lite-v1:0 as the default Bedrock model, added BEDROCK_MODEL_ID env var override support via CDK, and added per-invocation token usage logging for CloudWatch cost tracking.

## What Changed in Each File

### backend/src/handlers/store-summary.ts

1. **Default model ID** (line 31): Changed fallback from `'amazon.nova-pro-v1:0'` to `'amazon.nova-lite-v1:0'`
2. **Comment update** (line 97): Updated `// Nova Pro format (new default)` to `// Nova Lite format (new default)`
3. **Token logging** (lines 138-144): Added after Nova summary extraction, before storage try/catch:
   ```typescript
   const usage = (responseBody as any).usage as { inputTokens?: number; outputTokens?: number } | undefined;
   logger.info('Bedrock invocation metrics', {
     modelId,
     inputTokens: usage?.inputTokens,
     outputTokens: usage?.outputTokens,
   });
   ```

### backend/src/handlers/__tests__/store-summary.test.ts

1. **Line 128**: Updated assertion from `'amazon.nova-pro-v1:0'` to `'amazon.nova-lite-v1:0'`
2. **Line 527**: Renamed test from `'should use Nova Pro model ID by default'` to `'should use Nova Lite model ID by default'`; updated inline comments and added `usage` field to Bedrock mock response
3. **Line 571**: Updated assertion from `'amazon.nova-pro-v1:0'` to `'amazon.nova-lite-v1:0'`
4. **New test**: `'should log inputTokens and outputTokens after successful Bedrock invocation'` — verifies code path executes without error when usage field is present
5. **New test**: `'should handle missing usage field gracefully (Claude model backward compat)'` — verifies `usage?.inputTokens` undefined does not throw when Claude model used (no usage field)

### infra/lib/stacks/session-stack.ts

1. **Line 702**: Changed `BEDROCK_MODEL_ID` env var value from `'amazon.nova-pro-v1:0'` to `'amazon.nova-lite-v1:0'`
2. **Lines 714-724**: Updated IAM policy comment and added nova-lite ARN as first resource:
   - New comment: `// Grant Bedrock InvokeModel permission for Nova Lite (default), Nova Pro, and Claude (backward compat via env var override)`
   - Resources (all 3 ARNs — see below)

## Token Logging Pattern

```typescript
// Log token usage for cost tracking (COST-03)
// Note: usage field is Nova-specific; Claude uses different field names (input_tokens with underscores)
const usage = (responseBody as any).usage as { inputTokens?: number; outputTokens?: number } | undefined;
logger.info('Bedrock invocation metrics', {
  modelId,
  inputTokens: usage?.inputTokens,
  outputTokens: usage?.outputTokens,
});
```

Logged as a structured JSON entry via `@aws-lambda-powertools/logger`. Queryable from CloudWatch Logs Insights:
```
fields modelId, inputTokens, outputTokens
| filter message = "Bedrock invocation metrics"
| stats sum(inputTokens) as totalIn, sum(outputTokens) as totalOut by modelId
```

## IAM Resources List (all 3 ARNs)

```typescript
resources: [
  `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,  // default model
  `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,   // backward compat
  `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,     // backward compat
],
```

Note: `amazon.nova-lite-v1:0` must be enabled in the AWS account's Bedrock model access settings (console action, not CDK-deployable). This is a one-time setup step.

## Test Count Before/After

- Before: 453 tests (56 suites)
- After: 455 tests (56 suites) — 2 new store-summary tests added

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files exist:
- [x] backend/src/handlers/store-summary.ts — contains `nova-lite-v1:0` and `usage?.inputTokens`
- [x] backend/src/handlers/__tests__/store-summary.test.ts — contains `inputTokens`
- [x] infra/lib/stacks/session-stack.ts — contains `nova-lite-v1:0` in both env var and IAM resources

### Commits exist:
- [x] 081fa1c — feat(34-01): switch store-summary to nova-lite default and add token logging
- [x] c021b1f — feat(34-01): update CDK env var and IAM policy for nova-lite

## Self-Check: PASSED
