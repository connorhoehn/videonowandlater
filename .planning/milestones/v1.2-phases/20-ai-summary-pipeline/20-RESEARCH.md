# Phase 20: AI Summary Pipeline - Research

**Researched:** 2026-03-06
**Domain:** AWS Bedrock Claude integration for text summarization
**Confidence:** HIGH

## Summary

Phase 20 implements an automated AI-driven summary pipeline that generates one-paragraph summaries from session transcripts using AWS Bedrock's Claude API. The flow is event-driven: after Phase 19 completes transcription and stores the transcript text on a session record, a new Bedrock invocation Lambda is triggered to generate a summary via the Messages API, storing the result back to DynamoDB with status tracking.

This research covers the Bedrock integration pattern, Claude model selection and availability, IAM/CDK wiring, error handling (critical: preserve transcripts on failure), and display patterns (placeholder states during processing).

**Primary recommendation:** Use Claude Sonnet 4.5 or 4.6 with global model IDs for maximum regional flexibility. Implement summary generation in a dedicated `store-summary.ts` handler triggered by transcription completion, following the non-blocking error pattern established in `recording-ended.ts`. Document Bedrock FTU form as a mandatory pre-deployment step.

## User Constraints

*No CONTEXT.md exists for this phase — all research is exploratory.*

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AI-01 | AI summary automatically produced from transcript via Bedrock/Claude | Bedrock InvokeModel API, Claude Messages API documented; integration pattern shown |
| AI-02 | AI summary text stored on session record in DynamoDB | Repository function pattern established; uses existing `updateRecordingMetadata` or new `updateSessionAiSummary` |
| AI-03 | AI summary (truncated to 2 lines) displayed on recording cards | Frontend display pattern; uses aiSummary field with ellipsis/truncation |
| AI-04 | Full AI summary displayed in replay info panel | Frontend display pattern; uses full aiSummary field from session metadata |
| AI-05 | "Summary coming soon" placeholder shown while processing | Requires aiSummaryStatus field tracking: "pending", "available", "failed" |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-bedrock-runtime` | v3.700+ | Bedrock InvokeModel API client | Official AWS SDK; first-class TypeScript support |
| Claude (Bedrock) | Sonnet 4.5 or 4.6 | LLM for summarization | Best price/performance; widely available across regions; suitable for 1-paragraph summaries (<500 tokens) |

### Installation
```bash
npm install @aws-sdk/client-bedrock-runtime
```

**Note:** The project already uses `@aws-sdk/client-*` v3.700+ for DynamoDB/IVS, so Bedrock client adds minimal dependency bloat.

## Architecture Patterns

### Event Flow

```
Session in ENDED state with recordingStatus='available'
  ↓
Phase 19: Transcription Pipeline completes
  ↓
store-transcript handler writes transcriptText to session
  ↓
EventBridge rule triggered: transcriptStatus='available'
  ↓
store-summary handler invoked (NEW - Phase 20)
  ↓
Bedrock InvokeModel call to Claude
  ↓
Response parsed; aiSummary written to session
  ↓
aiSummaryStatus set to 'available' OR 'failed' on error
```

### Handler Pattern: store-summary.ts

```typescript
// Source: AWS Bedrock documentation + project pattern from recording-ended.ts
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

    // Mark summary as failed but preserve the transcript (CRITICAL: AI-04)
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
```

**Key design decisions:**
- **Non-blocking error handling:** Follows `recording-ended.ts` pattern (lines 145-148) — summary generation failures don't interrupt session cleanup or data integrity
- **Transcript preservation:** Bedrock failure explicitly avoids touching `aiSummary` field; uses separate `aiSummaryStatus` field (see Domain section)
- **Max tokens 500:** Sufficient for 2-3 sentence summaries; conservative to avoid overage charges
- **Prompt structure:** System prompt + user message format matches Bedrock Messages API v1.0

### Domain Model Extension

**New fields on Session:**

```typescript
export interface Session {
  // ... existing fields ...
  transcriptText?: string;           // Populated by Phase 19
  transcriptStatus?: 'available' | 'failed';  // Phase 19
  aiSummary?: string;                // NEW: One-paragraph summary from Bedrock
  aiSummaryStatus?: 'pending' | 'available' | 'failed';  // NEW: Pipeline state
}
```

**Why two fields?**
- `aiSummaryStatus: 'pending'` → "Summary coming soon" placeholder (AI-05)
- `aiSummaryStatus: 'available'` → Display aiSummary on cards/panels (AI-03, AI-04)
- `aiSummaryStatus: 'failed'` → Show transcript but no summary (error recovery)
- If Bedrock fails, `aiSummary` remains `undefined` but transcript (`transcriptText`) is preserved (AI-04 requirement)

### Repository Function: updateSessionAiSummary

```typescript
// Source: pattern from updateRecordingMetadata in session-repository.ts
export async function updateSessionAiSummary(
  tableName: string,
  sessionId: string,
  updates: {
    aiSummary?: string;
    aiSummaryStatus?: 'pending' | 'available' | 'failed';
  }
): Promise<void> {
  const docClient = getDocumentClient();
  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

  const expressionParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  if (updates.aiSummary !== undefined) {
    expressionParts.push('aiSummary = :aiSummary');
    expressionAttributeValues[':aiSummary'] = updates.aiSummary;
  }

  if (updates.aiSummaryStatus !== undefined) {
    expressionParts.push('aiSummaryStatus = :aiSummaryStatus');
    expressionAttributeValues[':aiSummaryStatus'] = updates.aiSummaryStatus;
  }

  if (expressionParts.length === 0) return; // Nothing to update

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: `SET ${expressionParts.join(', ')}`,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  }));
}
```

### Frontend Display Pattern

**Recording card (2-line truncation):**
```tsx
<div className="summary-section">
  {session.aiSummaryStatus === 'pending' && (
    <p className="text-gray-500 text-sm">Summary coming soon...</p>
  )}
  {session.aiSummaryStatus === 'available' && session.aiSummary && (
    <p className="text-sm line-clamp-2">{session.aiSummary}</p>
  )}
  {session.aiSummaryStatus === 'failed' && (
    <p className="text-gray-400 text-sm italic">Summary unavailable</p>
  )}
</div>
```

**Replay info panel (full text):**
```tsx
<div className="info-section">
  {session.aiSummaryStatus === 'available' && session.aiSummary && (
    <div>
      <h3>AI Summary</h3>
      <p>{session.aiSummary}</p>
    </div>
  )}
  {session.aiSummaryStatus === 'pending' && (
    <p className="text-sm text-gray-600">Summary is being generated...</p>
  )}
  {session.aiSummaryStatus === 'failed' && (
    <p className="text-sm text-gray-600">AI summary could not be generated. Full transcript is available on request.</p>
  )}
</div>
```

## Bedrock Integration Details

### Model Selection: Claude Sonnet 4.5 vs. Opus 4.6

| Model | Cost (per 1M tokens) | Latency | Use Case | Regional Availability |
|-------|---------------------|---------|----------|----------------------|
| Claude Sonnet 4.5 | $3 input / $15 output | ~1-2s | General summarization | Global (all regions) |
| Claude Opus 4.6 | $15 input / $75 output | ~2-3s | Complex reasoning | Global (all regions) |
| Claude Haiku 4.5 | $0.80 input / $4 output | ~0.5s | Very fast, short summaries | Global (all regions) |

**Recommendation:** Use Claude Sonnet 4.5 (model ID: `anthropic.claude-sonnet-4-5-20250929-v1:0`) as default.
- Price/performance optimal for 1-paragraph text generation
- Widely available across AWS regions
- Sufficient language quality for summarization tasks

**Global model ID format:** Prefix with `global.` for cross-region inference routing: `global.anthropic.claude-sonnet-4-5-20250929-v1:0` (optional 10% premium for guaranteed data residency; not required for Phase 20).

### Bedrock InvokeModel API Request/Response

**Request (per Messages API spec):**
```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 500,
  "system": "You are a helpful assistant...",
  "messages": [
    {
      "role": "user",
      "content": [{"type": "text", "text": "..."}]
    }
  ]
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "The session covered..."
    }
  ],
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 45
  }
}
```

**Cost estimation:**
- Average transcript: ~1000-1500 words → ~1500-2000 input tokens
- Average summary: ~50-100 output tokens
- Cost per summary: ~$0.005-0.008 (well under $0.01)
- For 1000 sessions/month: ~$5-8 total

### Authentication & IAM

**Lambda execution role must have:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:REGION::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0"
      ]
    }
  ]
}
```

**CDK wiring (in session-stack.ts):**
```typescript
const storeSummaryFn = new nodejs.NodejsFunction(this, 'StoreSummary', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/store-summary.ts'),
  timeout: Duration.seconds(60), // Bedrock may take 5-10s per call
  environment: {
    TABLE_NAME: this.table.tableName,
    BEDROCK_REGION: 'us-east-1', // Or detect from props
    BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  },
});

// Grant Bedrock InvokeModel
storeSummaryFn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: [
      `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
    ],
  })
);

// Grant DynamoDB
this.table.grantReadWriteData(storeSummaryFn);

// EventBridge rule: triggered when transcript is stored
const transcriptStoreRule = new events.Rule(this, 'TranscriptStoreRule', {
  eventPattern: {
    source: ['custom.vnl'],
    detailType: ['Transcript Stored'],
  },
  targets: [new targets.LambdaFunction(storeSummaryFn)],
});
storeSummaryFn.addPermission('AllowEBTranscriptStoreInvoke', {
  principal: new iam.ServicePrincipal('events.amazonaws.com'),
  sourceArn: transcriptStoreRule.ruleArn,
});
```

### Manual Prerequisite: Bedrock FTU Form

**CRITICAL BLOCKER:** Anthropic models on Bedrock require a one-time **First Time Use (FTU) form** to be submitted before `InvokeModel` succeeds. This cannot be automated via CDK or Lambda.

**Steps (must be done manually before Phase 20 deployment):**
1. Navigate to [AWS Console > Bedrock > Model Access](https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)
2. Find "Anthropic Claude" models in the catalog
3. Click "Request access" (if not already granted)
4. Click "Submit use case details"
5. Fill out the form:
   - Use case: "Video session summarization for replay discovery"
   - Expected usage: "Tier-1 (< 1M tokens/month)" or actual estimate
   - Organization type: (your organization)
   - Intended applications: "Automated video session summarization in video streaming platform"
6. Click "Submit form"
7. Access is **granted immediately** after submission

**Without FTU form:** InvokeModel calls will fail with `AccessDenied` (~15 min after form submission, FTU status is cached).

**Documentation:** This must be prominently documented in phase 20-01 PLAN.md as a pre-deployment task, with a checklist item to confirm FTU completion before CDK synthesis.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM text summarization | Custom regex/keyword extraction | AWS Bedrock Claude API | Claude handles context, coherence, edge cases (names, domains); regex fails on domain-specific terminology, loses semantic meaning |
| Prompt engineering | Hardcoded "summarize this" | Structured system prompt + user message | Messages API format ensures consistent parsing; system prompts allow instruction refinement without code changes |
| Token counting | Manual character-to-token estimation | Bedrock response `usage.input_tokens` | Token counts vary by model; estimation is error-prone; Bedrock response tells you actual usage (critical for cost tracking) |
| Error recovery | Retry loop with exponential backoff | EventBridge + DLQ for permanent failures | EventBridge built-in retry policy; DLQ for observability; Lambda-level retry can starve other concurrent sessions |

## Common Pitfalls

### Pitfall 1: Overwriting Transcript on Summary Failure
**What goes wrong:** Bedrock fails; handler tries to update aiSummary and accidentally clears transcriptText through a careless UpdateExpression.

**Why it happens:** Developers copy/paste from other repository functions without carefully specifying which fields to update. A generic update like `SET aiSummary = :aiSummary, transcriptText = :null` loses the transcript.

**How to avoid:**
- Use conditional update expressions that only SET the intended fields
- Test with mock Bedrock failures (inject error in test handler)
- Explicitly comment in updateSessionAiSummary: "// NEVER touch transcriptText field"

**Warning signs:**
- Session records appear with `transcriptText: undefined` after summary failure
- Backward compatibility breaks when replaying old sessions

### Pitfall 2: Bedrock Request Timeout
**What goes wrong:** Handler times out waiting for Bedrock response; function fails; summary is never attempted again.

**Why it happens:** Lambda timeout set to 30s (default); Bedrock can take 5-15s depending on transcript length and concurrent load. No retry happens.

**How to avoid:**
- Set Lambda timeout to **60 seconds** (session-stack.ts)
- EventBridge rule can be configured with retry policy (2-3 retries with exponential backoff)
- Monitor CloudWatch logs for `"context.getRemainingTimeInMillis() < 5000"` to detect timeouts early

**Warning signs:**
- Handler logs show successful Bedrock call but handler times out
- Logs cut off mid-execution with no error message
- Sessions stuck in `aiSummaryStatus: 'pending'` indefinitely

### Pitfall 3: FTU Form Not Submitted
**What goes wrong:** All summary generation fails with `AccessDenied`; API calls succeed in syntax but fail in authorization.

**Why it happens:** FTU form is a one-time manual step; easy to overlook in documentation; doesn't block CDK deploy, only runtime behavior.

**How to avoid:**
- Add FTU form submission to Phase 20-01 PLAN.md as **Task 0** before CDK synthesis
- Document screenshot of "Anthropic model access granted" page
- Add CloudWatch alarm on `bedrock:InvokeModel AccessDenied` errors
- Test with a manual `aws bedrock invoke-model` call before Phase 20 deployment

**Warning signs:**
- All summary requests fail immediately with HTTP 403 / AccessDenied
- No rate-limiting or quota errors (which would suggest access is granted but throttled)
- Issue appears in all regions where the account is deployed

### Pitfall 4: Summary Status Field Not Initialized
**What goes wrong:** Sessions created before Phase 20 have no `aiSummaryStatus` field; frontend checks `if (aiSummaryStatus === 'available')` and treats undefined as falsy, showing no summary state at all.

**Why it happens:** DynamoDB doesn't enforce schema; old sessions persist with partial fields. Frontend doesn't handle undefined gracefully.

**How to avoid:**
- Initialize `aiSummaryStatus: 'pending'` when recording becomes available (in recording-ended handler, or lazy-init in frontend)
- Frontend: Use `aiSummaryStatus ?? 'pending'` to default to "pending" for backward compatibility
- Batch job or migration to set aiSummaryStatus on all existing sessions with recordingStatus='available'

**Warning signs:**
- Recording cards show no summary section at all (neither "Summary coming soon" nor actual summary)
- aiSummary field exists but aiSummaryStatus is undefined
- Inconsistent UI state across old vs. new sessions

## Code Examples

### Example 1: Basic Bedrock Invocation
```typescript
// Source: AWS Bedrock documentation + project adaptation
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const summarizeTranscript = async (transcript: string, modelId: string) => {
  const client = new BedrockRuntimeClient({ region: 'us-east-1' });

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Summarize this video session transcript in one paragraph:\n\n${transcript}`,
          },
        ],
      },
    ],
  };

  const command = new InvokeModelCommand({
    contentType: 'application/json',
    body: JSON.stringify(payload),
    modelId,
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  return body.content[0].text;
};
```

### Example 2: Error-Safe Summary Update (Pattern from recording-ended.ts lines 142-148)
```typescript
// Source: project's established non-blocking error pattern
try {
  await updateSessionAiSummary(tableName, sessionId, {
    aiSummary: summary,
    aiSummaryStatus: 'available',
  });
  console.log('AI summary stored:', { sessionId, length: summary.length });
} catch (storeError: any) {
  console.error('Failed to store summary (non-blocking):', storeError.message);
  // Do not throw — transcript is safe, log for manual recovery if needed
}
```

### Example 3: Truncation for Card Display
```tsx
// Source: standard React pattern; TailwindCSS line-clamp
export const SummaryTruncated: React.FC<{ summary?: string; status?: string }> = ({
  summary,
  status,
}) => {
  if (status === 'pending') return <p className="text-gray-500">Summary coming soon...</p>;
  if (status === 'available' && summary) return <p className="line-clamp-2">{summary}</p>;
  if (status === 'failed') return <p className="text-gray-400">Summary unavailable</p>;
  return null;
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual session notes by broadcaster | Automated LLM summarization via Bedrock | v1.2 Phase 20 | No manual overhead; instant summaries for all sessions; consistent quality |
| Full transcript inline on replay page | AI summary on card + full transcript via transcript link | v1.2 Phase 20 | Faster page load; users scan summary first, then dive into transcript if needed |
| No pipeline orchestration | EventBridge + Phase 19 → Phase 20 flow | v1.2 Phases 19-20 | Decoupled, retryable pipeline; failures don't cascade |

**Deprecated/outdated:**
- Manual transcription entry: Replaced by Phase 19 AWS Transcribe automation
- External summarization API (e.g., OpenAI API): Replaced by Bedrock/Claude (AWS-managed, no external API keys, included in regional deployment)

## Open Questions

1. **Regional model availability at deployment time**
   - What we know: Claude Sonnet 4.5 and 4.6 are available globally as of Feb 2026
   - What's unclear: Whether Claude Opus 4.6 is available in all deployment regions, or only select regions
   - Recommendation: Confirm available models in target deployment region using `aws bedrock list-foundation-models --by-provider anthropic` before Phase 20-01 plan
   - How to handle: If Sonnet 4.5 unavailable in a region, gracefully fall back to Haiku 4.5 (lower quality but always available)

2. **FTU form inheritance across AWS Organization**
   - What we know: Form submission at root account is inherited by member accounts
   - What's unclear: Whether this requires explicit sharing of Bedrock access, or if it's automatic
   - Recommendation: Confirm with AWS account admin that Bedrock is shared across organization
   - How to handle: If form must be submitted per account, document in prerequisites

3. **Bedrock invocation logging**
   - What we know: Bedrock supports CloudWatch Logs integration for invocation tracking
   - What's unclear: Whether cost/usage logging is enabled by default, or must be manually configured
   - Recommendation: Enable Bedrock invocation logging in session-stack.ts CDK for cost observability
   - How to handle: Reference AWS Bedrock documentation on [invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)

## Validation Architecture

**Test framework:** Jest (existing infrastructure from Phase 5+)
**Config file:** `/Users/connorhoehn/Projects/videonowandlater/backend/jest.config.js`
**Quick run command:** `cd backend && npm test -- src/handlers/__tests__/store-summary.test.ts`
**Full suite command:** `cd backend && npm test`

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | Bedrock InvokeModel call succeeds; summary extracted from response | unit | `npm test -- store-summary.test.ts -t "invokes Bedrock"` | ❌ Wave 0 |
| AI-02 | Summary stored on session record with aiSummaryStatus='available' | unit | `npm test -- store-summary.test.ts -t "stores summary"` | ❌ Wave 0 |
| AI-03 | Frontend truncates 2-line summary on card | unit (React) | `npm test -- SummaryTruncated.test.tsx` | ❌ Wave 0 |
| AI-04 | Full summary displayed in replay panel | unit (React) | `npm test -- ReplayInfoPanel.test.tsx -t "summary"` | ❌ Wave 0 |
| AI-05 | "Summary coming soon" shown when aiSummaryStatus='pending' | unit (React) | `npm test -- SummaryTruncated.test.tsx -t "pending"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/handlers/__tests__/store-summary.test.ts` (handler tests)
- **Per wave merge:** `npm test` (all backend + frontend tests)
- **Phase gate:** All tests green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/handlers/__tests__/store-summary.test.ts` — EventBridge-triggered Bedrock invocation, error handling, transcript preservation on failure
- [ ] `src/handlers/store-summary.ts` — Handler implementation (main logic)
- [ ] `src/repositories/__tests__/session-repository.test.ts` — updateSessionAiSummary function tests
- [ ] `src/repositories/session-repository.ts` — updateSessionAiSummary function (new)
- [ ] `src/domain/session.ts` — Session interface updated with aiSummary, aiSummaryStatus fields
- [ ] `web/src/features/replay/SummaryDisplay.tsx` — React component for card truncation
- [ ] `web/src/features/replay/__tests__/SummaryDisplay.test.tsx` — Component snapshot + truncation tests
- [ ] `infra/lib/stacks/session-stack.ts` — EventBridge rule, Lambda function, IAM Bedrock:InvokeModel policy

*(Phase 20-01 is responsible for all implementation; all tests created as part of task execution)*

## Sources

### Primary (HIGH confidence)
- [Claude on Amazon Bedrock - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock) - Model IDs, global vs. regional endpoints, authentication
- [AWS Bedrock InvokeModel API Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-runtime_example_bedrock-runtime_InvokeModel_AnthropicClaude_section.html) - TypeScript request/response format, Messages API structure
- [Anthropic Claude Messages API - Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html) - Request/response schema, parameters, content types
- [Access Amazon Bedrock foundation models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) - FTU form, model access procedure
- Project codebase (`backend/src/handlers/recording-ended.ts`, `session-repository.ts`) - Error handling patterns, EventBridge handler structure, non-blocking repository operations

### Secondary (MEDIUM confidence)
- [Amazon Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/) - Claude Sonnet/Opus pricing, token-based billing
- [Claude Sonnet 4.6 now available in Amazon Bedrock](https://aws.amazon.com/about-aws/whats-new/2026/02/claude-sonnet-4.6-available-in-amazon-bedrock/) - Current model availability as of Feb 2026

## Metadata

**Confidence breakdown:**
- **Standard stack (HIGH):** Bedrock is official AWS service with stable API; Claude Sonnet pricing/availability confirmed in official docs
- **Architecture (HIGH):** Pattern mirrors existing `recording-ended.ts` handler; Bedrock API well-documented with TypeScript examples
- **Pitfalls (MEDIUM-HIGH):** Based on common serverless patterns; FTU form requirement verified in official AWS docs but edge cases (org inheritance) require confirmation
- **Validation (HIGH):** Jest infrastructure already established; test pattern mirrors existing handler tests

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (30 days; Bedrock pricing/models stable; refresh if major Claude release occurs)
**Bedrock FTU form requirement:** Verify still required at implementation time (as of Feb 2026, required; AWS may automate this in future)

---

*Research completed: 2026-03-06*
*Next step: `/gsd:plan-phase 20` to create Phase 20 plan (2 subplans: 20-01 Bedrock integration, 20-02 frontend display)*
