# Phase 39: DLQ Re-drive Tooling - Research

**Researched:** 2026-03-14
**Domain:** AWS SQS Dead-Letter Queue management CLI tooling
**Confidence:** HIGH

## Summary

Phase 39 requires building a developer CLI tool for inspecting, re-driving, and purging messages from the 5 pipeline DLQs without using the AWS console. The project architecture provides 5 separate DLQs (vnl-recording-ended-dlq, vnl-transcode-completed-dlq, vnl-transcribe-completed-dlq, vnl-store-summary-dlq, vnl-start-transcribe-dlq), each with 14-day retention and a maxReceiveCount of 3 before messages are discarded.

AWS SQS provides native APIs for DLQ re-drive via `StartMessageMoveTask` (bulk async redrive) and `ListMessageMoveTasks` (task tracking). Message inspection requires `ReceiveMessage` with batch retrieval (note: VisibilityTimeout cannot peek without consuming, contrary to STATE.md line 72). The existing CLI infrastructure (Commander.js at `backend/src/cli/`) provides a proven pattern for adding new commands, and the test suite demonstrates straightforward Jest testing of CLI functions.

**Primary recommendation:** Use AWS SDK v3 `StartMessageMoveTask` for bulk redrive, `ListMessageMoveTasks` for status checking, `ReceiveMessage` with batch collection for inspection, and `DeleteMessage` for purging. Implement as three new CLI commands (dlq-list, dlq-redrive, dlq-purge) with a fourth health-check command, following the existing seed-sessions command pattern.

## User Constraints

No CONTEXT.md file exists for this phase. User decisions are derived from STATE.md Accumulated Context section and ROADMAP.md success criteria.

### Locked Decisions (from STATE.md)
- Use `StartMessageMoveTask` for bulk re-drive (not manual message copying) — lines 73
- Check `ListMessageMoveTasks` before starting to avoid `MessageMoveTaskAlreadyRunning` error — line 74
- Scope DLQ Lambda IAM to SQS management actions only — do not reuse pipeline handler execution roles — line 75

### Claude's Discretion
- CLI command structure and naming (dlq-list, dlq-redrive, dlq-purge, dlq-health)
- Inspection output format (JSON vs. table vs. custom)
- Batch sizes for message retrieval
- Error handling and retry strategy

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DLQ-01 | Developer can list all messages in any pipeline DLQ via CLI tool with decoded session context (sessionId, event type, error) | AWS SDK v3 `ReceiveMessage` with MaxNumberOfMessages=10 and MessageAttributeNames=["All"] enables batch inspection without consuming; messages must be individually reconstructed from SQS body format |
| DLQ-02 | Developer can re-drive individual messages or bulk re-drive all messages from a DLQ back to its source queue | AWS SDK v3 `StartMessageMoveTask` native async operation; supports optional DestinationArn or defaults to source queue; tracks via TaskHandle |
| DLQ-03 | Developer can delete a permanently-invalid message from a DLQ after investigation | AWS SDK v3 `DeleteMessage` with ReceiptHandle; delete via batch operation supported but single delete is simpler for CLI UX |
| DLQ-04 | CLI tool reports approximate message count per DLQ for quick health check across all 5 queues | AWS SDK v3 `GetQueueAttributes` with AttributeNames=["ApproximateNumberOfMessages"] provides metric; lightweight operation suitable for bulk report |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/client-sqs | ^3.1003.0 (add new) | SQS API client for DLQ operations | Native AWS service integration; already using SDK v3 across codebase |
| commander | ^12.1.0 (existing) | CLI framework and command parsing | Proven pattern in existing CLI commands (stream-broadcast, seed-sessions, etc.) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aws-sdk/lib-dynamodb | ^3.1000.0 (existing) | DynamoDB client (may need for session lookup if decoding message bodies) | Already in dependencies; can decode DLQ message bodies that contain sessionId |

### Installation
```bash
npm install @aws-sdk/client-sqs
```

## Architecture Patterns

### Recommended Project Structure
```
backend/src/cli/
├── commands/
│   ├── dlq-list.ts          # List/inspect messages in a DLQ
│   ├── dlq-redrive.ts       # Re-drive messages from DLQ to source queue
│   ├── dlq-purge.ts         # Delete individual DLQ message(s)
│   └── dlq-health.ts        # Health check across all 5 DLQs
├── lib/
│   └── dlq-client.ts        # Shared SQS client + utility functions (optional)
└── __tests__/
    ├── dlq-list.test.ts
    ├── dlq-redrive.test.ts
    ├── dlq-purge.test.ts
    └── dlq-health.test.ts
```

### Pattern 1: DLQ List Command (Inspect Messages)
**What:** Retrieve and display a sample of messages from a DLQ, decoding sessionId and error context without consuming them permanently.

**When to use:** Developer needs to understand what went wrong without diving into AWS console or CloudWatch logs.

**Implementation constraints:**
- ReceiveMessage does make messages temporarily invisible (30s default) — this is the only way to inspect bodies
- Must follow with DeleteMessage (if purging) or do nothing (message reappears after timeout)
- Cannot "peek" without consuming; this is an AWS SQS platform limitation
- Batch retrieve with MaxNumberOfMessages=10 to balance API calls vs. data transfer
- Include MessageAttributeNames=["All"] to capture any custom attributes

**Example:**
```typescript
import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

export async function dlqList(queueUrl: string): Promise<void> {
  const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });

  const command = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    MessageAttributeNames: ['All'],
    AttributeNames: ['All'], // Includes ApproximateReceiveCount
  });

  const response = await client.send(command);

  if (!response.Messages || response.Messages.length === 0) {
    console.log('No messages in DLQ');
    return;
  }

  response.Messages.forEach((msg) => {
    try {
      const body = JSON.parse(msg.Body || '{}');
      console.log(`MessageId: ${msg.MessageId}`);
      console.log(`ReceiptHandle: ${msg.ReceiptHandle}`);
      console.log(`SessionId: ${body.detail?.sessionId || 'N/A'}`);
      console.log(`Error: ${msg.Body}`);
      console.log('---');
    } catch (e) {
      console.log(`Raw message: ${msg.Body}`);
    }
  });
}
```

### Pattern 2: DLQ Redrive Command (Bulk Move)
**What:** Asynchronously move all (or filtered) messages from a DLQ back to their source queue using AWS's native `StartMessageMoveTask` API.

**When to use:** After identifying and fixing the root cause, redrive accumulated DLQ messages back through the pipeline.

**Implementation constraints:**
- Must call `ListMessageMoveTasks` first to check if task is already running (only one active task per queue)
- `StartMessageMoveTask` returns TaskHandle — use this to track the async operation
- Optional DestinationArn defaults to original source queue — correct for this phase
- MaxNumberOfMessagesPerSecond parameter is optional; omit to let AWS optimize based on backlog
- Task may take seconds/minutes to complete; must poll `ListMessageMoveTasks` to track progress

**Example:**
```typescript
import { SQSClient, StartMessageMoveTaskCommand, ListMessageMoveTasksCommand } from '@aws-sdk/client-sqs';

export async function dlqRedrive(dlqArn: string): Promise<void> {
  const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });

  // Check for existing running task
  const listCmd = new ListMessageMoveTasksCommand({ SourceArn: dlqArn });
  const listRes = await client.send(listCmd);

  const activeTask = listRes.Results?.find(t => t.Status === 'RUNNING');
  if (activeTask) {
    throw new Error(`Task already running on ${dlqArn}: ${activeTask.TaskHandle}`);
  }

  // Start redrive (destination defaults to source queue)
  const startCmd = new StartMessageMoveTaskCommand({
    SourceArn: dlqArn,
  });

  const startRes = await client.send(startCmd);
  console.log(`Redrive task started: ${startRes.TaskHandle}`);
  console.log(`Monitor with: dlq-health command`);
}
```

### Pattern 3: DLQ Purge Command (Delete Messages)
**What:** Delete a specific message from a DLQ by ReceiptHandle (obtained from dlq-list command).

**When to use:** After investigation, developer determines a message is permanently invalid and should not be retried.

**Implementation constraints:**
- Requires ReceiptHandle (not MessageId) — obtained from `ReceiveMessage` or `ListMessageMoveTasks`
- DeleteMessage operates on individual messages; batch delete is available but CLI UX is simpler with single deletes
- No confirmation dialog in this phase — add if needed in future

**Example:**
```typescript
import { SQSClient, DeleteMessageCommand } from '@aws-sdk/client-sqs';

export async function dlqPurge(queueUrl: string, receiptHandle: string): Promise<void> {
  const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });

  const command = new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  });

  await client.send(command);
  console.log(`Message deleted: ${receiptHandle}`);
}
```

### Pattern 4: DLQ Health Command
**What:** Report approximate message count for all 5 DLQs in one command for quick health check.

**When to use:** Operator wants to see if any pipeline stage is failing (DLQs accumulating messages).

**Implementation constraints:**
- Use `GetQueueAttributes` with AttributeNames=['ApproximateNumberOfMessages']
- Fetch all 5 DLQ URLs from environment variables or hardcode known queue names
- ApproximateNumberOfMessages is a metric, not exact — may be off by 1-2 for queues with high throughput

**Example:**
```typescript
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const DLQ_NAMES = [
  'vnl-recording-ended-dlq',
  'vnl-transcode-completed-dlq',
  'vnl-transcribe-completed-dlq',
  'vnl-store-summary-dlq',
  'vnl-start-transcribe-dlq',
];

export async function dlqHealth(): Promise<void> {
  const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
  const queueUrlPrefix = `https://sqs.${process.env.AWS_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}`;

  console.log('DLQ Health Report');
  console.log('-'.repeat(50));

  for (const name of DLQ_NAMES) {
    const queueUrl = `${queueUrlPrefix}/${name}`;
    try {
      const cmd = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      });
      const res = await client.send(cmd);
      const count = parseInt(res.Attributes?.ApproximateNumberOfMessages || '0', 10);
      const status = count > 0 ? '⚠️ ' : '✓ ';
      console.log(`${status} ${name}: ${count} messages`);
    } catch (e) {
      console.log(`✗ ${name}: Error fetching count`);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Manual message copying:** Do not use ReceiveMessage + SendMessage to simulate redrive. Use `StartMessageMoveTask` instead — it's atomic and tracks progress.
- **Polling without backoff:** If monitoring redrive task, implement exponential backoff when calling `ListMessageMoveTasks` frequently.
- **Assuming VisibilityTimeout=0 peeks:** AWS SQS does not support peeking — messages must be received (made invisible) to inspect their bodies. This is a platform constraint.
- **Reusing pipeline handler IAM roles:** DLQ management CLI must have its own IAM policy scoped to SQS actions only (sqs:SendMessage, sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes, sqs:ListMessageMoveTasks, sqs:StartMessageMoveTask).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async message bulk move with tracking | Custom Lambda + DynamoDB state machine | AWS SQS `StartMessageMoveTask` + `ListMessageMoveTasks` | AWS service handles idempotency, rate limiting, failure recovery; custom solutions risk lost messages or duplicate redrives |
| Queue health metrics | Manual polling all queues + custom dashboard | AWS CloudWatch metrics + `GetQueueAttributes` | ApproximateNumberOfMessages is already collected; custom collection adds polling overhead and latency |
| Message filtering for selective redrive | Custom CLI that receives all messages then sends filtered subset | `sqsdr` community tool with JMESPath/regex filtering (or implement in future phase) | Message filtering by sessionId or error type is common enough to warrant dedicated tooling; hand-rolling introduces bug surface |
| DLQ inspection UI | Custom React component in web/ | Extend this CLI tool with JSON output + monitoring dashboard in later phase | CLI is sufficient for v1.7 "operator tooling" goal; web UI can follow in v1.8 |

## Common Pitfalls

### Pitfall 1: MessageMoveTaskAlreadyRunning Error
**What goes wrong:** Developer runs `dlq-redrive` command twice in quick succession, second invocation fails with `MessageMoveTaskAlreadyRunning` error.

**Why it happens:** AWS SQS limits to one active message move task per queue. If task is still running, new requests are rejected.

**How to avoid:** Always call `ListMessageMoveTasks` before `StartMessageMoveTask`. Check if any task has Status="RUNNING". Log the existing TaskHandle and suggest polling for completion.

**Warning signs:** Error message includes "MessageMoveTaskAlreadyRunning" or "AlreadyInProgress".

### Pitfall 2: ReceiveMessage Blocks Redrive
**What goes wrong:** After running `dlq-list` to inspect messages, developer runs `dlq-redrive` immediately, but messages are still invisible (30s timeout) and don't get moved.

**Why it happens:** ReceiveMessage makes messages temporarily invisible by default (visibility timeout = queue's default, usually 30s). These invisible messages cannot be moved by StartMessageMoveTask until visibility timeout expires.

**How to avoid:** Document that `dlq-list` makes messages temporarily invisible. Recommend either: (a) wait 30s before redriving, or (b) implement `dlq-inspect` variant that uses smaller MaxNumberOfMessages=1 to minimize impact, or (c) immediately call `ChangeMessageVisibility` with VisibilityTimeout=0 after listing to return messages to queue.

**Warning signs:** Redrive task reports fewer messages moved than expected after list command was run.

### Pitfall 3: AWS Account ID and Region Unknown at CLI Runtime
**What goes wrong:** `dlq-health` command fails because it tries to construct queue URLs without knowing AWS account ID or region.

**Why it happens:** CLI commands run in developer's shell context where AWS_ACCOUNT_ID is not set.

**How to avoid:** Use SQS `ListQueues` to discover queue URLs dynamically, or require `AWS_ACCOUNT_ID` environment variable. For health check, construct queue names from known patterns (e.g., 'vnl-*-dlq') and use SQS `GetQueueUrl` API to resolve URLs dynamically.

**Warning signs:** "InvalidAddress" error when constructing queue URLs; queue URL format is wrong.

### Pitfall 4: Conflating ReceiptHandle with MessageId
**What goes wrong:** Developer runs `dlq-list`, copies MessageId from output, then tries to use it with `dlq-purge`, which expects ReceiptHandle.

**Why it happens:** Both values are present in ReceiveMessage response but serve different purposes. ReceiptHandle is unique per receive action; MessageId is permanent.

**How to avoid:** Always display ReceiptHandle prominently in `dlq-list` output (e.g., "Use this receipt handle to purge:"). Include ReceiptHandle in prompt or help text for `dlq-purge` command.

**Warning signs:** `dlq-purge` fails with "InvalidParameterValue" for the handle value.

## Code Examples

Verified patterns from AWS SDK v3 SQS documentation:

### Inspect DLQ Messages (No Consumption)
```typescript
// Source: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-sqs/
import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

async function inspectDLQ(queueUrl: string): Promise<void> {
  const client = new SQSClient({});

  const command = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    MessageAttributeNames: ['All'],
    AttributeNames: ['All', 'ApproximateReceiveCount'],
  });

  const response = await client.send(command);

  response.Messages?.forEach(msg => {
    console.log(`MessageId: ${msg.MessageId}`);
    console.log(`ReceiptHandle: ${msg.ReceiptHandle}`);
    console.log(`ApproximateReceiveCount: ${msg.Attributes?.ApproximateReceiveCount}`);
    try {
      const body = JSON.parse(msg.Body || '{}');
      console.log(`Body: ${JSON.stringify(body, null, 2)}`);
    } catch {
      console.log(`Body (raw): ${msg.Body}`);
    }
  });
}
```

### Redrive Messages from DLQ
```typescript
// Source: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html
import { SQSClient, StartMessageMoveTaskCommand, ListMessageMoveTasksCommand } from '@aws-sdk/client-sqs';

async function redriveMessages(dlqArn: string): Promise<void> {
  const client = new SQSClient({});

  // Check for existing task
  const listRes = await client.send(new ListMessageMoveTasksCommand({
    SourceArn: dlqArn,
    MaxResults: 1,
  }));

  const existingTask = listRes.Results?.find(t => t.Status === 'RUNNING');
  if (existingTask) {
    console.log(`Task already running: ${existingTask.TaskHandle}`);
    return;
  }

  // Start redrive to source queue (no DestinationArn = source queue)
  const startRes = await client.send(new StartMessageMoveTaskCommand({
    SourceArn: dlqArn,
    MaxNumberOfMessagesPerSecond: 50, // Optional: AWS optimizes if omitted
  }));

  console.log(`Redrive started. TaskHandle: ${startRes.TaskHandle}`);
}
```

### Health Check All DLQs
```typescript
// Source: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-sqs/
import { SQSClient, GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';

async function healthCheckDLQs(): Promise<void> {
  const client = new SQSClient({});
  const queueNames = [
    'vnl-recording-ended-dlq',
    'vnl-transcode-completed-dlq',
    'vnl-transcribe-completed-dlq',
    'vnl-store-summary-dlq',
    'vnl-start-transcribe-dlq',
  ];

  for (const queueName of queueNames) {
    try {
      const urlRes = await client.send(new GetQueueUrlCommand({
        QueueName: queueName,
      }));

      const attrRes = await client.send(new GetQueueAttributesCommand({
        QueueUrl: urlRes.QueueUrl!,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));

      const count = parseInt(attrRes.Attributes?.ApproximateNumberOfMessages || '0', 10);
      console.log(`${queueName}: ${count} messages`);
    } catch (e) {
      console.error(`Failed to check ${queueName}: ${e}`);
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual AWS console inspection + copy-paste redrive | AWS SQS `StartMessageMoveTask` + CLI tracking | AWS announced enhanced DLQ management (2023) | Eliminates manual error-prone UI operations; enables programmatic integration |
| Custom Lambda functions for DLQ processing | `StartMessageMoveTask` native async operation | AWS SQS API expansion (2023) | Reduces infrastructure overhead; AWS handles idempotency and rate limiting |
| Polling with VisibilityTimeout=0 "peek" | Accepted limitation: must receive to inspect | SQS design (permanent) | Developers must plan for 30s message invisibility window during inspection |

**Deprecated/outdated:**
- **Manual message copy pattern** (ReceiveMessage → SendMessage cycle): Replaced by `StartMessageMoveTask` which is atomic and prevents duplicate redrives.
- **Custom Lambda-based DLQ poller:** AWS SQS APIs now provide sufficient tooling; CLI wrapper is appropriate layer.

## Open Questions

1. **Queue URL Construction**
   - What we know: Queue names follow pattern `vnl-{stage}-dlq` (5 queues); environment may vary (dev/staging/prod)
   - What's unclear: Should URLs be constructed dynamically via `GetQueueUrl` or hardcoded per environment?
   - Recommendation: Use `GetQueueUrl` API for robustness; fallback to environment variable `AWS_SQS_DLQ_PREFIX` if needed

2. **Message Body Decoding**
   - What we know: DLQ messages are SQS-wrapped EventBridge events with sessionId in `detail.sessionId`
   - What's unclear: Should CLI decode and display sessionId/eventType automatically, or show raw JSON?
   - Recommendation: Decode automatically in `dlq-list` output for operator convenience; provide `--raw` flag for debugging

3. **Filtering for Selective Redrive**
   - What we know: `StartMessageMoveTask` is all-or-nothing; no built-in filtering
   - What's unclear: Should future phases support selective redrive by sessionId or error type?
   - Recommendation: Out of scope for Phase 39; community tools like `sqsdr` exist if needed; flag for Phase 40+ if pattern emerges

## Validation Architecture

Test infrastructure will use Jest (existing test suite pattern). DLQ operations require AWS SDK mocking to avoid hitting real queues during testing.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest with @aws-sdk/* mocks |
| Config file | `backend/jest.config.js` (existing) |
| Quick run command | `npm test -- src/cli/__tests__/dlq-*.test.ts --testPathPattern=dlq` |
| Full suite command | `npm test` (runs all 360+ tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DLQ-01 | `dlq-list` retrieves and displays messages from DLQ without permanent consumption | unit | `npm test -- dlq-list.test.ts` | ❌ Wave 0 |
| DLQ-02 | `dlq-redrive` checks for active task, then starts `StartMessageMoveTask` | unit | `npm test -- dlq-redrive.test.ts` | ❌ Wave 0 |
| DLQ-03 | `dlq-purge` deletes message by ReceiptHandle | unit | `npm test -- dlq-purge.test.ts` | ❌ Wave 0 |
| DLQ-04 | `dlq-health` reports approximate message count per all 5 DLQs | unit | `npm test -- dlq-health.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/cli/__tests__/dlq-*.test.ts`
- **Per wave merge:** `npm test` (full backend suite)
- **Phase gate:** Full backend test suite green (445 tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/src/cli/__tests__/dlq-list.test.ts` — covers DLQ-01; mock SQSClient.send(ReceiveMessageCommand)
- [ ] `backend/src/cli/__tests__/dlq-redrive.test.ts` — covers DLQ-02; mock ListMessageMoveTasks + StartMessageMoveTask
- [ ] `backend/src/cli/__tests__/dlq-purge.test.ts` — covers DLQ-03; mock DeleteMessageCommand
- [ ] `backend/src/cli/__tests__/dlq-health.test.ts` — covers DLQ-04; mock GetQueueUrlCommand + GetQueueAttributesCommand
- [ ] `backend/src/cli/commands/dlq-list.ts` — add ReceiveMessageCommand integration
- [ ] `backend/src/cli/commands/dlq-redrive.ts` — add StartMessageMoveTaskCommand integration
- [ ] `backend/src/cli/commands/dlq-purge.ts` — add DeleteMessageCommand integration
- [ ] `backend/src/cli/commands/dlq-health.ts` — add GetQueueUrlCommand + GetQueueAttributesCommand integration
- [ ] `backend/src/cli/index.ts` — register all 4 DLQ commands
- [ ] `backend/package.json` — add `@aws-sdk/client-sqs` dependency

## Sources

### Primary (HIGH confidence)
- [AWS SDK for JavaScript v3 SQS Client documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-sqs/) — ReceiveMessage, StartMessageMoveTask, ListMessageMoveTasks, DeleteMessage, GetQueueAttributes APIs and request/response formats
- [StartMessageMoveTask API Reference](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html) — exact request parameters (SourceArn, DestinationArn, MaxNumberOfMessagesPerSecond), response format (TaskHandle), error conditions (MessageMoveTaskAlreadyRunning)
- [ListMessageMoveTasks API Reference](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ListMessageMoveTasks.html) — request parameters, response format with status values (RUNNING, COMPLETED), one-task-per-queue constraint
- [ReceiveMessage API Reference](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html) — VisibilityTimeout constraints (no peek support), MessageAttributeNames parameter, batch retrieval with MaxNumberOfMessages

### Secondary (MEDIUM confidence)
- [Using dead-letter queues in Amazon SQS guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) — best practices for DLQ monitoring, redrive patterns
- [DLQ Redrive for Amazon SQS - DEV Community](https://dev.to/aws-builders/dlq-redrive-for-amazon-sqs-5dkm) — practical redrive workflow and velocity tuning
- [sqsdr GitHub project](https://github.com/iamatypeofwalrus/sqsdr) — community tool pattern for selective redrive with JMESPath/regex filtering

### Tertiary (LOW confidence - informational only)
- [dlq CLI tool (CumulusDS)](https://github.com/CumulusDS/dlq) — existing implementation pattern for batch operations, adaptive rate limiting
- [State-of-art SQS DLQ management blog posts](https://oneuptime.com/blog/post/2026-02-02-sqs-dlq-redrive/) — general DLQ best practices, similar to AWS official guidance

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — AWS SDK v3 SQS operations are documented APIs; Commander.js pattern proven in existing CLI
- Architecture: HIGH — 4 separate commands with clear responsibilities; pattern matches existing seed-* CLI structure
- Pitfalls: HIGH — AWS platform constraints (MessageMoveTaskAlreadyRunning, VisibilityTimeout behavior) are documented and tested by community
- Requirements mapping: HIGH — Each DLQ-01 through DLQ-04 maps directly to specific AWS SQS APIs with clear input/output contracts

**Research date:** 2026-03-14
**Valid until:** 2026-03-28 (14 days — AWS SQS API is stable; redrive feature launched 2023; no expected changes)

**Key decision divergence from STATE.md:**
- STATE.md line 72 mentions "VisibilityTimeout=0 to peek at DLQ messages without consuming them" — CORRECTED in this research. AWS SQS does not support peeking without visibility side effects. ReceiveMessage with default timeout makes messages invisible for 30s. This is documented in the official API reference and is not configurable to zero for peeking. Implementation must account for this constraint.
