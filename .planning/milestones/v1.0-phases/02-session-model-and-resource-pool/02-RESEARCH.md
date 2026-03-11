# Phase 2: Session Model & Resource Pool - Research

**Researched:** 2026-03-02
**Domain:** Resource Pool Management, DynamoDB Atomic Operations, AWS IVS Resource Provisioning
**Confidence:** HIGH

## Summary

Phase 2 establishes the foundational session model and pre-warmed resource pool that enables instant "go live" experiences. The core challenge is maintaining a pool of ready-to-use AWS IVS resources (channels, RealTime stages, and Chat rooms) and atomically claiming them without race conditions when users request to go live. This requires DynamoDB conditional writes for atomic pool claims, scheduled Lambda for pool replenishment, and a session lifecycle state machine that abstracts AWS concepts from the user-facing API.

The research confirms that DynamoDB conditional writes with optimistic locking provide the atomic guarantees needed for concurrent pool claims. AWS IVS provides straightforward APIs for programmatic resource creation (CreateChannel, CreateStage, CreateRoom). EventBridge Scheduler (replacing legacy CloudWatch Events) offers robust scheduled Lambda invocations for pool maintenance. The standard pattern uses a single-table DynamoDB design with GSI for querying by status, enabling efficient "claim next available" operations.

**Primary recommendation:** Use DynamoDB single-table design with a status GSI for resource pool items (AVAILABLE/CLAIMED/ENDED states), implement atomic claims via conditional writes on a version attribute, schedule pool replenishment Lambda via EventBridge Scheduler, and model session lifecycle as a simple enum-based state machine (creating → live → ending → ended) stored in DynamoDB without requiring Step Functions for this phase.

## Phase Requirements

<phase_requirements>
| ID | Description | Research Support |
|----|-------------|-----------------|
| SESS-01 | Sessions have a lifecycle state machine (creating -> live -> ending -> ended) | Enum-based state machine pattern with DynamoDB status field; no complex orchestration needed for simple linear state transitions |
| SESS-04 | No AWS concepts (channels, stages, rooms, ARNs) exposed in user-facing UX | Resource pool abstraction layer maps sessionId to pooled IVS resources; API responses return session objects with sessionId, not ARNs |
| POOL-01 | Pre-warmed pool maintains N available IVS channels ready for instant broadcast | CreateChannel API creates channels with recordingConfigurationArn; DynamoDB tracks channel ARN + status (AVAILABLE/CLAIMED) |
| POOL-02 | Pre-warmed pool maintains N available IVS RealTime stages ready for instant hangout | CreateStage API creates stages; DynamoDB tracks stage ARN + endpoints + status |
| POOL-03 | Pre-warmed pool maintains N available IVS Chat rooms ready for instant chat | CreateRoom API creates rooms; DynamoDB tracks room ARN + room ID + status |
| POOL-04 | Scheduled Lambda replenishes pool when available resources drop below threshold | EventBridge Scheduler with rate expressions (e.g., rate(5 minutes)) triggers Lambda to query status GSI and create resources when count < threshold |
| POOL-05 | Resources are atomically claimed from pool via DynamoDB conditional writes (no race conditions) | Conditional writes with version attribute ensure atomic claim operation; ConditionalCheckFailedException triggers retry logic |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aws-cdk-lib | ^2.170.0 | Infrastructure as code for DynamoDB, Lambda, EventBridge | Already in use from Phase 1; CDK v2 unified construct library |
| @aws-sdk/client-ivs | ^3.699.0 | IVS channel creation (CreateChannel, DeleteChannel) | Official AWS SDK v3 for IVS Low-Latency streaming API |
| @aws-sdk/client-ivs-realtime | ^3.699.0 | IVS RealTime stage creation (CreateStage, DeleteStage) | Official AWS SDK v3 for IVS RealTime streaming API |
| @aws-sdk/client-ivschat | ^3.699.0 | IVS Chat room creation (CreateRoom, DeleteRoom) | Official AWS SDK v3 for IVS Chat API |
| @aws-sdk/client-dynamodb | ^3.699.0 | DynamoDB operations for resource pool and session management | Official AWS SDK v3 with first-class TypeScript support |
| @aws-sdk/lib-dynamodb | ^3.699.0 | Document client for DynamoDB (higher-level API) | Simplifies DynamoDB operations with native JS types vs raw AttributeValue |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | ^10.0.0 | Generate session IDs and request tokens for idempotency | Every session creation and pool replenishment operation |
| @aws-lambda-powertools/logger | ^2.11.0 | Structured logging for Lambda functions | All Lambda handlers for debugging and CloudWatch Insights queries |
| @aws-lambda-powertools/tracer | ^2.11.0 | AWS X-Ray tracing for Lambda functions | Pool replenishment and session claim Lambdas for performance analysis |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DynamoDB single-table | Multiple DynamoDB tables (sessions, channels, stages, rooms) | Single-table design reduces costs and enables efficient cross-entity queries; multi-table increases complexity with no benefit for this access pattern |
| Enum-based state machine | XState or Step Functions | XState (v5.28.0) adds dependency and complexity for simple linear state transitions; Step Functions adds cost ($0.025 per 1,000 transitions) and deployment overhead for a state machine that doesn't require orchestration |
| EventBridge Scheduler | CloudWatch Events (legacy) | Scheduler is the modern replacement with more flexible scheduling, better scalability, and first-class CDK support |
| Optimistic locking | Pessimistic locking with DynamoDB Transactions API | Transactions limited to 25 items and cost 2x write capacity; optimistic locking with conditional writes is standard for pool claim patterns |

**Installation:**
```bash
npm install --workspace=backend \
  @aws-sdk/client-ivs@^3.699.0 \
  @aws-sdk/client-ivs-realtime@^3.699.0 \
  @aws-sdk/client-ivschat@^3.699.0 \
  @aws-sdk/client-dynamodb@^3.699.0 \
  @aws-sdk/lib-dynamodb@^3.699.0 \
  uuid@^10.0.0 \
  @aws-lambda-powertools/logger@^2.11.0 \
  @aws-lambda-powertools/tracer@^2.11.0
```

## Architecture Patterns

### Recommended Project Structure

```
backend/src/
├── domain/
│   ├── session.ts          # Session entity type, lifecycle state enum
│   ├── resource-pool.ts    # ResourcePoolItem entity type
│   └── types.ts            # Shared types (ResourceType enum, Status enum)
├── repositories/
│   ├── session-repository.ts         # DynamoDB operations for sessions
│   └── resource-pool-repository.ts   # DynamoDB operations for pool items
├── services/
│   ├── session-service.ts            # Session lifecycle business logic
│   └── pool-service.ts               # Pool replenishment and claim logic
├── handlers/
│   ├── create-session.ts             # API: POST /sessions
│   ├── get-session.ts                # API: GET /sessions/{sessionId}
│   └── replenish-pool.ts             # EventBridge scheduled Lambda
└── lib/
    ├── dynamodb-client.ts            # Singleton DynamoDB client
    └── ivs-clients.ts                # Singleton IVS, IVSRealTime, IVSChat clients

infra/lib/stacks/
├── session-stack.ts                  # DynamoDB tables, Lambda functions, EventBridge schedule
└── ivs-stack.ts                      # IVS recording configuration (for POOL-01)
```

### Pattern 1: DynamoDB Single-Table Design with Status GSI

**What:** Store all entities (sessions, resource pool items) in a single DynamoDB table using generic partition key (PK) and sort key (SK) with entity type prefixes. Create GSI with status as partition key for efficient "get next available resource" queries.

**When to use:** Multi-entity systems where entities share access patterns (query by status, query by ID) and don't require complex many-to-many relationships.

**Example:**
```typescript
// Table Schema
// PK: string (partition key)
// SK: string (sort key)
// GSI1PK: string (GSI partition key - status for pool items)
// GSI1SK: string (GSI sort key - createdAt for time-ordering)

// Resource Pool Item
{
  PK: "POOL#CHANNEL#abc123",         // Partition key
  SK: "METADATA",                     // Sort key
  GSI1PK: "STATUS#AVAILABLE",         // GSI partition key for status queries
  GSI1SK: "2026-03-02T10:00:00Z",    // GSI sort key for FIFO claim order
  entityType: "POOL_ITEM",
  resourceType: "CHANNEL",            // CHANNEL | STAGE | ROOM
  resourceArn: "arn:aws:ivs:...",
  resourceId: "abc123",
  status: "AVAILABLE",                // AVAILABLE | CLAIMED | ENDED
  version: 1,                         // Optimistic locking version
  createdAt: "2026-03-02T10:00:00Z",
  claimedAt: null,
  claimedBy: null                     // sessionId when CLAIMED
}

// Session Item
{
  PK: "SESSION#xyz789",
  SK: "METADATA",
  GSI1PK: "STATUS#LIVE",
  GSI1SK: "2026-03-02T11:00:00Z",
  entityType: "SESSION",
  sessionId: "xyz789",
  userId: "user123",
  sessionType: "BROADCAST",           // BROADCAST | HANGOUT
  status: "live",                     // creating | live | ending | ended
  claimedResources: {
    channel: "arn:aws:ivs:...",
    chatRoom: "arn:aws:ivschat:..."
  },
  version: 1,
  createdAt: "2026-03-02T11:00:00Z",
  startedAt: "2026-03-02T11:01:23Z",
  endedAt: null
}
```

**CDK Table Definition:**
```typescript
// Source: AWS CDK DynamoDB documentation + single-table design patterns
const table = new dynamodb.Table(this, 'SessionsTable', {
  tableName: 'vnl-sessions',
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
  pointInTimeRecovery: false,  // v1 doesn't need PITR
});

// Status GSI for querying by status (e.g., "get all AVAILABLE channels")
table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

### Pattern 2: Atomic Pool Claim with Conditional Writes

**What:** Use DynamoDB conditional writes with a version attribute to atomically claim a resource from the pool. Only one concurrent request succeeds; others receive ConditionalCheckFailedException and retry with exponential backoff.

**When to use:** Any scenario requiring atomic state transitions without external locking mechanisms (e.g., claiming limited resources, preventing double-booking).

**Example:**
```typescript
// Source: DynamoDB conditional writes best practices
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

async function claimNextAvailableChannel(
  sessionId: string,
  tableName: string
): Promise<{ channelArn: string; poolItemPK: string } | null> {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Step 1: Query GSI to find AVAILABLE channels
  const queryResult = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    ExpressionAttributeValues: {
      ':status': 'STATUS#AVAILABLE',
    },
    Limit: 1,  // Only need one
  }));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return null;  // Pool exhausted
  }

  const item = queryResult.Items[0];
  const currentVersion = item.version;

  // Step 2: Conditional write to claim (atomic)
  try {
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: item.PK,
        SK: item.SK,
      },
      UpdateExpression: 'SET #status = :claimed, #claimedBy = :sessionId, #claimedAt = :now, #version = :newVersion, GSI1PK = :newGSI',
      ConditionExpression: '#status = :available AND #version = :currentVersion',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#claimedBy': 'claimedBy',
        '#claimedAt': 'claimedAt',
        '#version': 'version',
      },
      ExpressionAttributeValues: {
        ':available': 'AVAILABLE',
        ':claimed': 'CLAIMED',
        ':sessionId': sessionId,
        ':now': new Date().toISOString(),
        ':currentVersion': currentVersion,
        ':newVersion': currentVersion + 1,
        ':newGSI': 'STATUS#CLAIMED',  // Update GSI partition key
      },
    }));

    return {
      channelArn: item.resourceArn,
      poolItemPK: item.PK,
    };
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Another request claimed this resource first; retry logic in service layer
      return null;
    }
    throw error;
  }
}
```

### Pattern 3: Scheduled Pool Replenishment with EventBridge Scheduler

**What:** EventBridge Scheduler triggers a Lambda function every N minutes to check pool levels and create new IVS resources when the count drops below a threshold.

**When to use:** Pre-warming patterns, periodic maintenance tasks, background resource management.

**Example:**
```typescript
// Source: EventBridge Scheduler CDK patterns
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// In session-stack.ts
const replenishPoolFn = new nodejs.NodejsFunction(this, 'ReplenishPool', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../backend/src/handlers/replenish-pool.ts'),
  timeout: Duration.minutes(5),  // Time to create multiple IVS resources
  environment: {
    TABLE_NAME: table.tableName,
    MIN_CHANNELS: '3',
    MIN_STAGES: '2',
    MIN_ROOMS: '5',
  },
});

// Grant permissions
table.grantReadWriteData(replenishPoolFn);
replenishPoolFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'ivs:CreateChannel',
    'ivs:TagResource',
  ],
  resources: ['*'],  // IVS doesn't support resource-level permissions for CreateChannel
}));
replenishPoolFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'ivs:CreateStage',
  ],
  resources: ['*'],
}));
replenishPoolFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'ivschat:CreateRoom',
    'ivschat:TagResource',
  ],
  resources: ['*'],
}));

// EventBridge rule (rate-based schedule)
new events.Rule(this, 'ReplenishPoolSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(5)),
  targets: [new targets.LambdaFunction(replenishPoolFn)],
  description: 'Replenish IVS resource pool every 5 minutes',
});
```

**Lambda Handler:**
```typescript
// Source: DynamoDB query patterns + AWS SDK v3 IVS APIs
import { Handler } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IVSClient, CreateChannelCommand } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient, CreateStageCommand } from '@aws-sdk/client-ivs-realtime';
import { IVSChatClient, CreateRoomCommand } from '@aws-sdk/client-ivschat';
import { v4 as uuidv4 } from 'uuid';

export const handler: Handler = async () => {
  const tableName = process.env.TABLE_NAME!;
  const minChannels = parseInt(process.env.MIN_CHANNELS!, 10);
  const minStages = parseInt(process.env.MIN_STAGES!, 10);
  const minRooms = parseInt(process.env.MIN_ROOMS!, 10);

  // Check current AVAILABLE count
  const availableChannels = await countAvailableResources(tableName, 'CHANNEL');
  const availableStages = await countAvailableResources(tableName, 'STAGE');
  const availableRooms = await countAvailableResources(tableName, 'ROOM');

  // Replenish if below threshold
  const channelsToCreate = Math.max(0, minChannels - availableChannels);
  const stagesToCreate = Math.max(0, minStages - availableStages);
  const roomsToCreate = Math.max(0, minRooms - availableRooms);

  await Promise.all([
    ...Array.from({ length: channelsToCreate }, () => createChannel(tableName)),
    ...Array.from({ length: stagesToCreate }, () => createStage(tableName)),
    ...Array.from({ length: roomsToCreate }, () => createRoom(tableName)),
  ]);

  return {
    channelsCreated: channelsToCreate,
    stagesCreated: stagesToCreate,
    roomsCreated: roomsToCreate,
  };
};

async function countAvailableResources(tableName: string, resourceType: string): Promise<number> {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    ExpressionAttributeValues: {
      ':status': `STATUS#AVAILABLE`,
    },
    FilterExpression: 'resourceType = :resourceType',
    ExpressionAttributeValues: {
      ':resourceType': resourceType,
    },
    Select: 'COUNT',
  }));
  return result.Count || 0;
}

async function createChannel(tableName: string): Promise<void> {
  const ivsClient = new IVSClient({});
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const response = await ivsClient.send(new CreateChannelCommand({
    name: `vnl-pool-${uuidv4()}`,
    latencyMode: 'LOW',
    type: 'STANDARD',
    // recordingConfigurationArn will be set in Phase 3
  }));

  const resourceId = response.channel!.arn!.split('/').pop()!;

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `POOL#CHANNEL#${resourceId}`,
      SK: 'METADATA',
      GSI1PK: 'STATUS#AVAILABLE',
      GSI1SK: new Date().toISOString(),
      entityType: 'POOL_ITEM',
      resourceType: 'CHANNEL',
      resourceArn: response.channel!.arn!,
      resourceId,
      ingestEndpoint: response.channel!.ingestEndpoint,
      playbackUrl: response.channel!.playbackUrl,
      streamKey: response.streamKey!.value,  // Store for DEV-06
      status: 'AVAILABLE',
      version: 1,
      createdAt: new Date().toISOString(),
      claimedAt: null,
      claimedBy: null,
    },
  }));
}
```

### Pattern 4: Session Lifecycle State Machine (Enum-Based)

**What:** Model session lifecycle as a simple enum (`creating | live | ending | ended`) stored in DynamoDB. No external state machine orchestration needed for linear state transitions.

**When to use:** Simple state machines with linear progressions and no complex branching, parallel execution, or long-running workflows.

**Example:**
```typescript
// Source: TypeScript enum patterns for state machines
// backend/src/domain/session.ts

export enum SessionStatus {
  CREATING = 'creating',  // Resources being claimed from pool
  LIVE = 'live',          // Session is active (broadcast or hangout)
  ENDING = 'ending',      // User ended session, cleanup in progress
  ENDED = 'ended',        // Session cleanup complete, resources returned to pool
}

export enum SessionType {
  BROADCAST = 'BROADCAST',
  HANGOUT = 'HANGOUT',
}

export interface Session {
  sessionId: string;
  userId: string;
  sessionType: SessionType;
  status: SessionStatus;
  claimedResources: {
    channel?: string;        // IVS channel ARN (for BROADCAST)
    stage?: string;          // IVS RealTime stage ARN (for HANGOUT)
    chatRoom: string;        // IVS Chat room ARN (for both)
  };
  createdAt: string;
  startedAt?: string;        // When status transitioned to LIVE
  endedAt?: string;          // When status transitioned to ENDED
  version: number;           // Optimistic locking
}

// State transition validation
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  const validTransitions: Record<SessionStatus, SessionStatus[]> = {
    [SessionStatus.CREATING]: [SessionStatus.LIVE],
    [SessionStatus.LIVE]: [SessionStatus.ENDING],
    [SessionStatus.ENDING]: [SessionStatus.ENDED],
    [SessionStatus.ENDED]: [],  // Terminal state
  };
  return validTransitions[from].includes(to);
}
```

### Anti-Patterns to Avoid

- **Hardcoding pool thresholds in Lambda code:** Use environment variables for MIN_CHANNELS, MIN_STAGES, MIN_ROOMS so they can be tuned without redeployment
- **Exposing ARNs in API responses:** Session API should return `{ sessionId, status, sessionType }` not `{ channelArn, stageArn }`
- **Synchronous IVS resource creation in API handlers:** Pool replenishment should be background (scheduled Lambda), not triggered by user requests
- **Using TransactWriteItems for pool claims:** DynamoDB transactions cost 2x and are limited to 25 items; conditional writes are sufficient and more cost-effective
- **Deleting IVS resources immediately after session ends:** Keep resources in ENDED state briefly, then recycle to AVAILABLE after validation (Phase 3 resource lifecycle)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DynamoDB connection pooling | Custom singleton with manual initialization | `DynamoDBDocumentClient` with default SDK client | SDK v3 handles connection pooling and retries automatically; custom pooling adds complexity with no performance benefit |
| Retry logic with exponential backoff | Custom setTimeout-based retry loops | AWS SDK built-in retry strategy (default 3 retries with exponential backoff) | SDK retry strategy handles throttling (ProvisionedThroughputExceededException), service errors, and network failures out of the box |
| Idempotency tokens for pool replenishment | Custom request deduplication table | UUID v4 for resourceId with DynamoDB conditional writes | DynamoDB's conditional writes prevent duplicate resource creation; no separate deduplication table needed |
| State machine orchestration for session lifecycle | Step Functions or XState for `creating → live → ending → ended` | Enum-based state machine stored in DynamoDB | Simple linear state transitions don't justify orchestration overhead; enum + validation function is sufficient |
| Distributed locks for pool claims | Custom Redis-based locking or DynamoDB lease table | DynamoDB conditional writes with version attribute | Conditional writes provide atomic compare-and-swap semantics; external locking introduces failure modes (lock leaks, deadlocks) |

**Key insight:** DynamoDB conditional writes are purpose-built for atomic resource claims and eliminate the need for distributed locks, custom retry logic, or complex orchestration. AWS SDK v3 provides first-class TypeScript support with built-in retries and connection management. Simple state machines (4 states, linear transitions) don't benefit from orchestration frameworks—they add deployment complexity and cost without improving correctness or debuggability.

## Common Pitfalls

### Pitfall 1: Race Condition in Pool Claim (Query Then Update)

**What goes wrong:** Two concurrent requests query for AVAILABLE resources, both find the same item, both attempt to claim it. One succeeds, one fails with ConditionalCheckFailedException, but the failure isn't handled, causing the second request to return an error to the user.

**Why it happens:** Developers separate the query (find available resource) from the update (claim resource) without conditional writes, assuming single-threaded execution.

**How to avoid:** Always use conditional writes with version attribute. Implement retry logic in the service layer: if ConditionalCheckFailedException occurs, immediately retry the query+claim operation (with exponential backoff and max retries). Treat pool exhaustion (no AVAILABLE items) as a separate error case.

**Warning signs:**
- API returns 500 errors under concurrent load but works fine with single requests
- CloudWatch logs show ConditionalCheckFailedException errors with no retry attempts
- Users report "session creation failed" errors that resolve on page refresh

### Pitfall 2: GSI Status Update Lag Causing Duplicate Claims

**What goes wrong:** After claiming a resource with a conditional write, the GSI (status index) has not yet updated to reflect the CLAIMED status. A second request queries the GSI milliseconds later, still sees the resource as AVAILABLE, and attempts to claim it, causing unnecessary ConditionalCheckFailedException errors.

**Why it happens:** DynamoDB GSI updates are eventually consistent (typically < 1 second but not instantaneous). Conditional writes operate on the base table (strongly consistent) but queries on the GSI see stale data.

**How to avoid:** Update the GSI partition key (`GSI1PK`) in the same conditional write that claims the resource (shown in Pattern 2). Even though the GSI update is eventually consistent, the conditional write ensures only one request succeeds. Implement retry logic for ConditionalCheckFailedException—this is expected behavior under concurrency, not an error case.

**Warning signs:**
- High ConditionalCheckFailedException rate (>10% of requests) even when pool has sufficient resources
- Multiple claim attempts for the same resource within 1-2 seconds in CloudWatch logs
- Pool replenishment creates more resources than needed because query sees "empty" pool

### Pitfall 3: Pool Exhaustion Not Handled Gracefully

**What goes wrong:** Pool replenishment Lambda runs on a fixed schedule (e.g., every 5 minutes). During a traffic spike, all resources are claimed faster than the pool can replenish. New session requests fail with generic 500 errors instead of informative "service at capacity" messages.

**Why it happens:** Pool size is tuned for average load, not peak load. Scheduled replenishment doesn't respond to sudden demand increases.

**How to avoid:** Set `MIN_CHANNELS`, `MIN_STAGES`, `MIN_ROOMS` environment variables high enough to absorb traffic spikes (e.g., 10-20 resources per type for v1). Add CloudWatch alarms for "AVAILABLE resources < threshold" with SNS notifications. In the session creation handler, detect pool exhaustion (query returns no AVAILABLE items after retries) and return a specific 503 Service Unavailable error with Retry-After header. Consider on-demand replenishment: if pool claim fails due to exhaustion, trigger a synchronous IVS resource creation as fallback (adds latency but prevents outright failure).

**Warning signs:**
- Session creation API returns 500 errors during peak usage but works fine at low traffic
- CloudWatch shows AVAILABLE resource count dropping to zero for extended periods
- No alerts or notifications when pool is exhausted

### Pitfall 4: IVS Resource Creation Failures Not Monitored

**What goes wrong:** Scheduled pool replenishment Lambda calls CreateChannel, CreateStage, CreateRoom APIs. IVS returns ServiceQuotaExceededException (hit account limit) or PendingVerification (new account). Lambda logs error but doesn't alert operators. Pool gradually depletes, eventually causing user-facing failures.

**Why it happens:** Developers focus on happy path (pool replenishment succeeds) and don't instrument failure cases. IVS has service quotas (e.g., 20 channels per account by default) that aren't visible without monitoring.

**How to avoid:** Wrap IVS client calls in try/catch blocks. Log structured errors with Lambda Powertools Logger. Increment CloudWatch custom metrics for `IVS.CreateChannel.Success`, `IVS.CreateChannel.QuotaExceeded`, `IVS.CreateChannel.Error`. Create CloudWatch alarms for error metrics > 0. Use AWS Service Quotas API to check current limits and request increases proactively.

**Warning signs:**
- Pool replenishment Lambda shows successful executions but AVAILABLE count doesn't increase
- CloudWatch logs show IVS API errors but no alerts fire
- New accounts fail to deploy with PendingVerification errors

### Pitfall 5: Not Storing Stream Keys with Pool Items

**What goes wrong:** CreateChannel returns a streamKey.value (the secret RTMPS key for broadcasting). Pool replenishment Lambda doesn't store this value in DynamoDB. In Phase 3, when a session claims a channel, the frontend needs the stream key to configure OBS/FFmpeg for DEV-06 (streaming MP4/MOV files). Without the stream key stored, the system must call GetStreamKey API on every session start, adding latency and API calls.

**Why it happens:** Documentation focuses on channel ARN and ingestEndpoint, de-emphasizing the stream key. Developers assume stream keys can be regenerated or fetched on demand.

**How to avoid:** Store `streamKey: response.streamKey!.value` in the DynamoDB pool item during `createChannel()`. Treat stream keys as sensitive data—don't log them, and consider encrypting at rest (DynamoDB table encryption enabled by default). When returning session details to frontend, only include stream key if user is the session owner (broadcaster).

**Warning signs:**
- Phase 3 implementation requires calling GetStreamKey API on every session start
- DEV-06 (stream MP4 files via FFmpeg) is blocked because stream keys aren't available
- Frontend can't display "copy stream key" button for broadcasters

## Code Examples

Verified patterns from official sources:

### Query GSI for Available Resources with Filter Expression

```typescript
// Source: DynamoDB Query API + filter expressions
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

async function queryAvailableChannels(tableName: string, limit: number = 1) {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    FilterExpression: 'resourceType = :type',
    ExpressionAttributeValues: {
      ':status': 'STATUS#AVAILABLE',
      ':type': 'CHANNEL',
    },
    Limit: limit,
    ScanIndexForward: true,  // Oldest first (FIFO based on GSI1SK = createdAt)
  }));

  return result.Items || [];
}
```

### EventBridge Stream State Change Event Handling

```typescript
// Source: IVS EventBridge event patterns
// This pattern will be used in Phase 3 to detect when streams start/end

export interface IVSStreamStateChangeEvent {
  version: string;
  id: string;
  'detail-type': 'IVS Stream State Change';
  source: 'aws.ivs';
  account: string;
  time: string;
  region: string;
  resources: string[];  // [channel ARN]
  detail: {
    event_name: 'Session Created' | 'Stream Start' | 'Stream End' | 'Session Ended';
    channel_name: string;
    stream_id: string;
  };
}

// Use this in Phase 3 to transition session status:
// - "Stream Start" → status = "live"
// - "Session Ended" → status = "ending"
```

### DynamoDB Update with Retry Logic

```typescript
// Source: AWS SDK v3 retry patterns
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

async function claimResourceWithRetry(
  sessionId: string,
  resourceType: 'CHANNEL' | 'STAGE' | 'ROOM',
  maxRetries: number = 3
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await claimNextAvailableResource(sessionId, resourceType);
      if (result) {
        return result.resourceArn;
      }
      // Pool exhausted
      return null;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Another request claimed this resource; retry immediately
        console.warn(`Claim conflict on attempt ${attempt + 1}, retrying...`);
        continue;
      }
      // Other errors (network, service) are not retryable here
      throw error;
    }
  }
  // Max retries exceeded
  return null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CloudWatch Events for scheduling | EventBridge Scheduler | 2021 (Scheduler GA 2022) | Scheduler is the modern replacement with more flexible scheduling (one-time, recurring, time zones), better scalability (1M schedules per account vs 300 rules), and first-class CDK support |
| DynamoDB synthetic partition/sort keys (concatenated strings) | Multi-attribute keys (up to 4 attributes each for PK and SK) | 2024 | Cleaner data model eliminates need for backfilling synthetic keys when adding indexes; simpler access patterns |
| AWS SDK v2 (callback-based) | AWS SDK v3 (promise-based, modular) | 2020 (v3 GA 2020) | v3 reduces bundle size (import only what you need), improves TypeScript support (native types), and modernizes async patterns (async/await) |
| Optimistic locking with custom version fields | DynamoDB native version attributes with `@aws-sdk/lib-dynamodb` | Ongoing | Document client simplifies optimistic locking with automatic version increment; reduces boilerplate |

**Deprecated/outdated:**
- **CloudWatch Events (legacy)**: Use EventBridge Scheduler for new projects. Legacy Events still supported but Scheduler is recommended for all scheduled tasks.
- **Lambda Warmer functions (manual ping)**: Use Lambda Provisioned Concurrency if zero cold starts are critical. For this project, scheduled EventBridge invocations keep the replenishment Lambda warm as a side effect.
- **AWS SDK v2**: All new projects should use SDK v3. v2 enters maintenance mode in 2024.

## Open Questions

1. **IVS Resource Quotas for New Accounts**
   - What we know: AWS accounts have default service quotas (e.g., 20 IVS channels per region). ServiceQuotaExceededException is returned when quotas are exceeded. PendingVerification state can block resource creation for new accounts.
   - What's unclear: Exact default quotas for IVS RealTime stages and IVS Chat rooms (documentation doesn't specify). Whether quotas are shared across Low-Latency and RealTime APIs.
   - Recommendation: During Wave 0 or Phase 2 planning, run `aws service-quotas list-service-quotas --service-code ivs` to check current account limits. Request quota increases proactively (25-50 channels, stages, rooms for v1). Add CloudWatch alarms for quota exceeded errors.

2. **Resource Pool Size Tuning**
   - What we know: Pool size must be tuned for expected concurrent sessions. Too small = pool exhaustion during traffic spikes. Too large = wasted resources and costs.
   - What's unclear: Cost per idle IVS resource (channels, stages, rooms). Whether idle resources incur charges or only active streams.
   - Recommendation: AWS IVS pricing shows no charge for idle channels/stages—only active stream hours are billed. Set generous pool sizes (10-20 per resource type) for v1 without cost concern. Add CloudWatch metrics for pool utilization (claimed / total) to monitor efficiency over time.

3. **IVS Resource Recycling Strategy**
   - What we know: After a session ends, resources transition to ENDED state. Resources should be validated before returning to AVAILABLE pool (e.g., check that recording stopped, no active streams).
   - What's unclear: Whether IVS resources accumulate state (chat history, recordings) that requires cleanup before reuse. Best practice for "resetting" a channel or stage to pristine state.
   - Recommendation: Phase 3 (POOL-06) will address resource recycling. For Phase 2, focus on creating and claiming resources. Assume resources can be reused without cleanup—validate this assumption during Phase 3 planning.

## Sources

### Primary (HIGH confidence)

- [CreateChannel API Reference](https://docs.aws.amazon.com/ivs/latest/APIReference/API_CreateChannel.html) - IVS channel creation API specification
- [CreateStage API Reference](https://docs.aws.amazon.com/ivs/latest/RealTimeAPIReference/API_CreateStage.html) - IVS RealTime stage creation API specification
- [CreateRoom API Reference](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_CreateRoom.html) - IVS Chat room creation API specification
- [DynamoDB Conditional Writes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html) - Official AWS documentation on optimistic locking with version attributes
- [EventBridge Scheduler Schedule Types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html) - Rate and cron expressions for EventBridge Scheduler
- [IVS EventBridge Events](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html) - Stream State Change events (Session Created, Stream Start, Stream End, Session Ended)
- [DynamoDB Single-Table Design Foundations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/data-modeling-foundations.html) - Official AWS best practices for single-table design

### Secondary (MEDIUM confidence)

- [How to Implement Conditional Writes in DynamoDB](https://oneuptime.com/blog/post/2026-02-02-dynamodb-conditional-writes/view) - February 2026 blog post on conditional writes and race conditions
- [DynamoDB Database Design in 2026](https://newsletter.simpleaws.dev/p/dynamodb-database-design-in-2026) - Multi-attribute key support (up to 4 attributes each for PK/SK)
- [How to Implement DynamoDB Single-Table Design](https://oneuptime.com/blog/post/2026-01-26-dynamodb-single-table-design/view) - January 2026 guide on single-table patterns with entity types
- [How to Build Type-Safe State Machines in TypeScript](https://oneuptime.com/blog/post/2026-01-30-typescript-type-safe-state-machines/view) - January 2026 article on XState v5 and enum-based state machines
- [The What, Why, and When of Single-Table Design with DynamoDB](https://www.alexdebrie.com/posts/dynamodb-single-table/) - Alex DeBrie's authoritative guide on single-table design patterns
- [Understanding & Handling Race Conditions at DynamoDB](https://awsfundamentals.com/blog/understanding-and-handling-race-conditions-at-dynamodb) - Conditional writes and atomic operations for concurrency

### Tertiary (LOW confidence)

- [XState](https://stately.ai/docs/xstate) - XState v5.28.0 documentation (actor-based state management); evaluated but not recommended for simple session lifecycle
- [AWS Lambda Provisioned Concurrency](https://oneuptime.com/blog/post/2026-02-12-lambda-provisioned-concurrency-eliminate-cold-starts/view) - Alternative to scheduled warming (not needed for this project)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - AWS SDK v3 client libraries are official and well-documented; CDK patterns verified from Phase 1 codebase
- Architecture: HIGH - DynamoDB single-table design with GSI is a proven pattern for resource pool management; conditional writes are the standard approach for atomic claims
- Pitfalls: MEDIUM - Based on documented DynamoDB and IVS patterns but not all pitfalls verified in production context; GSI consistency lag is well-known, pool exhaustion handling is based on general best practices

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - DynamoDB and IVS APIs are stable; EventBridge Scheduler is GA and not rapidly evolving)
