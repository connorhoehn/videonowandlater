# Stack Research

**Domain:** AI pipeline additions to AWS IVS video platform (v1.2 Activity Feed & Intelligence)
**Researched:** 2026-03-05
**Confidence:** HIGH (all claims verified against official AWS docs and npm registry)

---

## Scope: New Stack Only

The existing stack is validated and unchanged. This document covers only what is being added for v1.2:

**Existing (do not re-research):** IVS, IVS RealTime, IVS Chat, Lambda + API Gateway, DynamoDB single-table, CDK `^2.170.0`, React + Vite + Tailwind, Cognito, CloudFront + S3, EventBridge

**New for v1.2:** Amazon Transcribe (batch jobs), Amazon Bedrock (Claude InvokeModel), two new Lambda handlers, one new EventBridge rule, expanded IAM permissions

---

## New SDK Dependencies (Backend)

### Core New Packages

| Technology | Package | Version | Purpose | Why |
|------------|---------|---------|---------|-----|
| Amazon Transcribe | `@aws-sdk/client-transcribe` | `^3.1000.0` | Start batch transcription jobs from S3 recordings | Matches existing SDK v3 monorepo pattern (`^3.1000.0` already used for `client-dynamodb`, `client-ivs`, etc.). Batch jobs are fire-and-forget from Lambda — no long polling. npm latest: `3.916.0` |
| Amazon Bedrock Runtime | `@aws-sdk/client-bedrock-runtime` | `^3.1000.0` | Invoke Claude model for AI summary generation | Same SDK v3 monorepo. `bedrock-runtime` is the invocation client — `client-bedrock` is the separate control-plane client (model management) and must NOT be confused with it. npm latest: `3.1002.0` |

### Installation

```bash
cd backend
npm install @aws-sdk/client-transcribe @aws-sdk/client-bedrock-runtime
```

### No New Frontend Packages

Activity feed, recording slider, and AI summary display use existing React + Tailwind. No additional npm packages needed on the frontend.

---

## New Infrastructure (CDK)

No new CDK library packages. All v1.2 infrastructure uses primitives already imported from `aws-cdk-lib` in the existing stacks.

### CDK Components to Add

| Component | Type | Location | Purpose |
|-----------|------|----------|---------|
| `StartTranscription` NodejsFunction | New Lambda | `session-stack.ts` | Triggered by existing `recordingEndRule`; calls `transcribe:StartTranscriptionJob` |
| `GenerateSummary` NodejsFunction | New Lambda | `session-stack.ts` | Triggered by new `TranscribeCompletedRule`; calls Bedrock InvokeModel, writes summary to DynamoDB |
| `TranscribeCompletedRule` events.Rule | New EventBridge rule | `session-stack.ts` | Listens for `aws.transcribe` / `Transcribe Job State Change` with status `COMPLETED` or `FAILED` |

The `StartTranscription` Lambda is added as a second target on the **existing** `recordingEndRule` — no new IVS EventBridge rule needed.

---

## IAM Permissions

### StartTranscription Lambda

```typescript
// transcribe:StartTranscriptionJob — no resource-level scoping supported by Transcribe
startTranscriptionFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['transcribe:StartTranscriptionJob'],
  resources: ['*'],
}));

// S3: read the IVS recording MP4 (audio input to Transcribe)
recordingsBucket.grantRead(startTranscriptionFn);

// S3: write transcript JSON output to same bucket
// Transcribe uses the Lambda execution role to write output — grantPut is required
recordingsBucket.grantPut(startTranscriptionFn);
```

**Why `resources: ['*']` for Transcribe:** Transcribe does not support resource-level IAM conditions on `StartTranscriptionJob`. This is the same established pattern already used in this project for `ivs:CreateChannel`, `ivs:CreateStage`, and `ivs:CreateParticipantToken`.

### GenerateSummary Lambda

```typescript
// transcribe:GetTranscriptionJob — retrieve TranscriptFileUri after EventBridge fires
generateSummaryFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['transcribe:GetTranscriptionJob'],
  resources: ['*'],
}));

// bedrock:InvokeModel — scoped to specific model ARN (least privilege)
generateSummaryFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0`,
  ],
}));

// S3: read the transcript JSON that Transcribe wrote
recordingsBucket.grantRead(generateSummaryFn);

// DynamoDB: write AI summary back to the session record
table.grantReadWriteData(generateSummaryFn);
```

**Scoping `bedrock:InvokeModel` to the model ARN** is correct and follows least-privilege. A wildcard `resources: ['*']` works but grants access to every Bedrock model in the account.

---

## AI Model Selection

**Recommended model:** `anthropic.claude-3-5-haiku-20241022-v1:0`

| Model ID | Input Cost | Output Cost | Regions | Why |
|----------|-----------|-------------|---------|-----|
| `anthropic.claude-3-5-haiku-20241022-v1:0` | ~$0.80/M tokens | ~$4.00/M tokens | `us-east-1`, `us-east-2`, `us-west-2` | Best cost/quality for short summarization. Meaningfully smarter than Claude 3 Haiku for text comprehension tasks. |
| `anthropic.claude-3-haiku-20240307-v1:0` | ~$0.25/M tokens | ~$1.25/M tokens | Most regions | Cheaper fallback if cost becomes a concern at scale. |

**Per-session Bedrock cost:** A 30-minute session transcript is ~6,000 input tokens. A one-paragraph summary is ~250 output tokens. Total: **~$0.006 per session** — negligible.

**Bedrock model access requirement (critical manual step):** As of September 2025, AWS automatically enables serverless foundation models for all accounts without console enablement. However, **Anthropic models still require a one-time First Time Use (FTU) form** in the Bedrock console before `InvokeModel` will succeed. This cannot be automated via CDK. It is a pre-deployment manual step to document in the phase plan.

---

## Pipeline Architecture: Two-Lambda Event-Driven

```
IVS Recording Ends
  → EventBridge (aws.ivs: IVS Recording State Change, status=Recording End)
      → [existing] recording-ended Lambda  (marks session ENDED, stores recording URL)
      → [NEW] start-transcription Lambda   (submits Transcribe batch job, stores job name)

Transcribe Job Completes (~2-10 min later)
  → EventBridge (aws.transcribe: Transcribe Job State Change, status=COMPLETED)
      → [NEW] generate-summary Lambda     (fetches transcript from S3, calls Bedrock, writes summary)
```

**Why two Lambdas, not one polling Lambda:** IVS recordings for typical sessions (5-60 minutes) produce Transcribe jobs that take 1-10 minutes to complete. A single Lambda polling `GetTranscriptionJob` in a loop would either exceed the 15-minute Lambda timeout or burn execution time sleeping. The EventBridge `Transcribe Job State Change` pattern is the correct AWS-native approach — zero cost, zero latency, and no timeout risk.

### EventBridge Pattern for Transcribe Completion

```json
{
  "source": ["aws.transcribe"],
  "detail-type": ["Transcribe Job State Change"],
  "detail": {
    "TranscriptionJobStatus": ["COMPLETED", "FAILED"]
  }
}
```

Event detail fields:
- `detail.TranscriptionJobName` — the job name (embed `sessionId` here for lookup)
- `detail.TranscriptionJobStatus` — `COMPLETED` or `FAILED`

**Job naming convention:** `vnl-{sessionId}-{epochMs}` — allows the completion Lambda to parse `sessionId` directly from the event without additional DynamoDB reads.

---

## Code Patterns

### StartTranscriptionJob (Lambda)

```typescript
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

const transcribeClient = new TranscribeClient({});

// Called from recording-ended EventBridge handler
export async function startTranscription(sessionId: string, s3Key: string, bucketName: string) {
  const jobName = `vnl-${sessionId}-${Date.now()}`;

  await transcribeClient.send(new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: `s3://${bucketName}/${s3Key}` },
    MediaFormat: 'mp4',           // IVS records as MP4
    LanguageCode: 'en-US',        // or use IdentifyLanguage: true for multilingual
    OutputBucketName: bucketName,
    OutputKey: `transcripts/${sessionId}.json`,
  }));

  // Store jobName on DynamoDB session record for correlation
  await updateSessionTranscribeJob(sessionId, jobName);
}
```

### Bedrock InvokeModel (Lambda)

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({});

export async function generateSummary(transcript: string): Promise<string> {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 300,   // one paragraph ~150-250 tokens
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Summarize this video session transcript in one paragraph:\n\n${transcript}`,
      }],
    }],
  };

  const command = new InvokeModelCommand({
    modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await bedrockClient.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  return body.content[0].text;
}
```

Use `InvokeModelCommand` (synchronous, waits for full response) — not `InvokeModelWithResponseStreamCommand`. Lambda writes the complete summary to DynamoDB; streaming adds complexity with no benefit in this batch pipeline.

### Transcript Text Extraction

Transcribe writes a JSON file to S3. The plain text is at:

```typescript
const transcriptData = JSON.parse(rawJson);
const transcriptText = transcriptData.results.transcripts[0].transcript;
```

The `GenerateSummary` Lambda retrieves the S3 URI by calling `GetTranscriptionJob`, then fetches the JSON file using `@aws-sdk/client-s3` (already installed), then extracts the text before passing to Bedrock.

---

## Cost Model

### Per-Session Estimate

| Component | Assumption | Unit Cost | Per-Session Cost |
|-----------|-----------|-----------|-----------------|
| Transcribe batch | 30-min broadcast | $0.024/min | **$0.72** |
| Transcribe batch | 5-min hangout | $0.024/min | **$0.12** |
| Bedrock Claude 3.5 Haiku | ~6,250 tokens total | $0.80/M input + $4.00/M output | **~$0.006** |
| S3 transcript JSON storage | ~50KB per session | Negligible | <$0.001 |
| Lambda execution | ~500ms start + ~3s generate | Negligible | <$0.001 |

**Transcribe dominates cost.** Bedrock is effectively free at any realistic scale.

### Scale Projections

| Volume | Transcribe/Month | Bedrock/Month | Total AI/Month |
|--------|-----------------|---------------|----------------|
| 100 sessions (30 min avg) | ~$72 | ~$0.60 | **~$73** |
| 500 sessions | ~$360 | ~$3 | **~$363** |
| 1,000 sessions | ~$720 | ~$6 | **~$726** |

**Cost mitigation option:** If Transcribe cost becomes a concern, make transcription opt-in per session (user toggle) rather than always-on. The pipeline architecture supports this — simply skip `StartTranscriptionJob` if the session opted out.

---

## Alternatives Considered

| Our Choice | Alternative | Why Not |
|------------|-------------|---------|
| `@aws-sdk/client-bedrock-runtime` | `@anthropic-ai/sdk` direct | Direct Anthropic API requires a separate API key stored as a secret. Bedrock uses the Lambda IAM execution role — no secret management. Consistent with all existing AWS auth patterns in this project. |
| EventBridge `aws.transcribe` completion event | Polling `GetTranscriptionJob` in a loop | Polling wastes Lambda execution time (billed per ms), risks hitting the 15-minute timeout for long sessions, and adds unnecessary complexity. EventBridge is zero-cost and zero-latency. |
| Store transcripts in same `vnl-recordings-*` S3 bucket | Separate transcripts bucket | Fewer resources, simpler IAM grants, same CloudFront distribution available if transcripts need serving later. |
| Claude 3.5 Haiku | Claude 3.5 Sonnet | Haiku is 5-6x cheaper. One-paragraph summarization of a transcript does not require Sonnet-level capability. |
| `InvokeModelCommand` (sync) | `InvokeModelWithResponseStreamCommand` | Streaming has no benefit when the Lambda is writing the full summary to DynamoDB as a single string. Sync is simpler and correct here. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@aws-sdk/client-transcribe-streaming` | Streaming transcription is for real-time microphone input, not completed S3 files | `@aws-sdk/client-transcribe` (batch) |
| `@aws-sdk/client-bedrock` | Control-plane client for managing models; not needed for invocation | `@aws-sdk/client-bedrock-runtime` |
| AWS Step Functions | Adds operational overhead (console, IAM, state machine definition). The two-Lambda EventBridge chain is simpler and sufficient for this linear pipeline. | EventBridge chained Lambda pattern |
| SNS for Transcribe completion | EventBridge is already established throughout the codebase and more direct | EventBridge `aws.transcribe` rule |
| Lambda Destinations for chaining | Less transparent than explicit EventBridge rules; harder to debug; less consistent with existing patterns | Explicit EventBridge rule with Lambda target |
| `@aws-cdk/aws-transcribe-alpha` | Alpha stability package, not needed — all required Transcribe interaction is via SDK calls in Lambda, not CDK constructs | Direct SDK calls in Lambda handler |

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `@aws-sdk/client-transcribe@^3.1000.0` | `3.916.0` (npm latest Mar 2026) | `@aws-sdk/client-dynamodb@^3.1000.0` | Same SDK v3 monorepo release line — no peer dependency conflicts |
| `@aws-sdk/client-bedrock-runtime@^3.1000.0` | `3.1002.0` (npm latest Mar 2026) | `@aws-sdk/client-dynamodb@^3.1000.0` | Same SDK v3 monorepo release line — no peer dependency conflicts |
| Both new clients | — | `aws-cdk-lib@^2.170.0` | CDK uses esbuild (NodejsFunction) to bundle SDK clients from `node_modules`; no CDK version conflict |
| Both new clients | — | `Node.js 20.x` (Lambda runtime) | SDK v3 `^3.x` is fully compatible with Node.js 20.x |

---

## Sources

- [Amazon Transcribe StartTranscriptionJob API Reference](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html) — Required parameters, output bucket patterns, job name constraints (HIGH confidence)
- [Amazon Transcribe EventBridge monitoring](https://docs.aws.amazon.com/transcribe/latest/dg/monitoring-events.html) — Event structure for `Transcribe Job State Change`, detail fields including `TranscriptionJobName` (HIGH confidence)
- [Bedrock Runtime InvokeModel — Claude example](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-runtime_example_bedrock-runtime_InvokeModel_AnthropicClaude_section.html) — Complete TypeScript payload structure, `anthropic_version`, response parsing via `content[0].text` (HIGH confidence)
- [Amazon Bedrock supported models](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html) — Model IDs and supported regions for Claude 3.5 Haiku (`anthropic.claude-3-5-haiku-20241022-v1:0`) in `us-east-1`, `us-east-2`, `us-west-2` (HIGH confidence)
- [Simplified Bedrock model access](https://aws.amazon.com/blogs/security/simplified-amazon-bedrock-model-access/) — Auto-enablement of models as of Sept 2025; Anthropic FTU form requirement still applies (HIGH confidence)
- [@aws-sdk/client-transcribe npm](https://www.npmjs.com/package/@aws-sdk/client-transcribe) — Latest version `3.916.0`, actively maintained (HIGH confidence)
- [@aws-sdk/client-bedrock-runtime npm](https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime) — Latest version `3.1002.0`, actively maintained (HIGH confidence)
- [Amazon Transcribe pricing](https://aws.amazon.com/transcribe/pricing/) — $0.024/min standard batch, billed per second, 15-second minimum charge (HIGH confidence)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — Claude 3.5 Haiku ~$0.80/M input tokens, ~$4.00/M output tokens on-demand (MEDIUM confidence — verified from multiple sources, may change)

---

*Stack research for: v1.2 Activity Feed & Intelligence — Transcribe + Bedrock pipeline additions to VideoNowAndLater*
*Researched: 2026-03-05*
