# Phase 16: Hangout Participant Tracking - Research

**Researched:** 2026-03-05
**Domain:** DynamoDB co-located items, Lambda handler modification, repository pattern
**Confidence:** HIGH

## Summary

Phase 16 is a backend-only phase that adds participant tracking to the existing hangout join flow. The entire scope touches three files: `join-hangout.ts` (handler modification), `session-repository.ts` (two new functions + one modification to domain types), and `session.ts` (domain model extension). No new AWS services, no new CDK infrastructure, no new npm packages, and no frontend changes are required.

The core pattern is DynamoDB co-located items: each participant join writes a separate `SESSION#{sessionId} / PARTICIPANT#{userId}` item, avoiding write contention with the version-locked session METADATA item. The `participantCount` is denormalized to the session METADATA item when the session ends (in `recording-ended.ts`). The participant list is retrievable via a `Query` on the session PK with a `begins_with(SK, 'PARTICIPANT#')` key condition -- the same pattern used by `chat-repository.ts` for message queries, already established in this codebase.

**Primary recommendation:** Store each participant as a separate DynamoDB item under the session PK. Use `PutCommand` (not `UpdateCommand`) so re-joins are naturally idempotent -- the item is overwritten with an updated `joinedAt` timestamp. Add `participantCount` to the session METADATA at session end in `recording-ended.ts` using a Query + count approach.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PTCP-01 | Each hangout participant join is persisted to DynamoDB with userId, displayName, and joinedAt timestamp | Co-located `PARTICIPANT#{userId}` item pattern; `addHangoutParticipant()` repository function; displayName derived from `cognito:username` (no separate display name field exists in the join flow) |
| PTCP-02 | Hangout session record stores final participant count when session ends | `participantCount` field on session METADATA; computed in `recording-ended.ts` via Query + count on `PARTICIPANT#` items |
| PTCP-03 | Hangout participant list is retrievable by session ID via repository function | `getHangoutParticipants()` using `QueryCommand` with `begins_with(SK, 'PARTICIPANT#')` |
</phase_requirements>

## Standard Stack

### Core

No new packages required. All implementation uses existing dependencies.

| Library | Version | Purpose | Already in Project |
|---------|---------|---------|-------------------|
| `@aws-sdk/lib-dynamodb` | ^3.x | PutCommand, QueryCommand, UpdateCommand for participant items | Yes |
| `@aws-sdk/client-dynamodb` | ^3.x | DynamoDB base client (used via DocumentClient singleton) | Yes |

### Supporting

No supporting libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate PARTICIPANT items | `list_append` on session METADATA | **Do NOT use** -- causes `ConditionalCheckFailedException` due to optimistic locking on session version field |
| Query for participant count | DynamoDB Streams + atomic counter | Over-engineered for this use case; sessions have at most 12 participants (IVS RealTime limit) |

## Architecture Patterns

### DynamoDB Item Layout

```
Existing:
  PK: SESSION#{sessionId}  |  SK: METADATA       -> Session record (version-locked)

New:
  PK: SESSION#{sessionId}  |  SK: PARTICIPANT#{userId}  -> One item per participant join
```

### Pattern 1: Co-located Items on Shared PK

**What:** Store child entities (participants) under the same partition key as the parent entity (session), differentiated by sort key prefix.

**When to use:** When child entities always belong to exactly one parent and are always accessed through that parent. Avoids new GSI.

**Example:**
```typescript
// Source: Established pattern in this codebase (chat-repository.ts, reaction-repository.ts)
// Write participant item
await docClient.send(new PutCommand({
  TableName: tableName,
  Item: {
    PK: `SESSION#${sessionId}`,
    SK: `PARTICIPANT#${userId}`,
    entityType: 'PARTICIPANT',
    sessionId,
    userId,
    displayName,          // cognito:username (same as userId in this system)
    participantId,        // IVS RealTime participantId from token response
    joinedAt: new Date().toISOString(),
  },
}));

// Query all participants for a session
const result = await docClient.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
  ExpressionAttributeValues: {
    ':pk': `SESSION#${sessionId}`,
    ':skPrefix': 'PARTICIPANT#',
  },
}));
```

### Pattern 2: Idempotent Writes via PutCommand

**What:** Use `PutCommand` (not conditional `UpdateCommand`) so that re-joining a hangout simply overwrites the existing participant item with an updated `joinedAt` timestamp.

**When to use:** When the same user can trigger the same write multiple times (e.g., rejoining after a disconnect) and the latest write should win.

**Why:** `PutCommand` with the same PK+SK is an upsert. No `ConditionalCheckFailedException` risk, no retry logic needed.

### Pattern 3: Denormalized Count at Session End

**What:** When the session ends, query all `PARTICIPANT#` items under the session PK, count them, and write `participantCount` to the session METADATA item.

**When to use:** When the count is needed for fast reads on the homepage activity feed (Phase 18) and the count is finalized at a well-defined point (session end).

**Integration point:** `recording-ended.ts`, after `updateRecordingMetadata()` and before pool resource release. Wrapped in try/catch -- participant count computation must never block pool release.

### Recommended File Modifications

```
backend/src/domain/session.ts           -- Add optional participantCount field to Session interface
backend/src/repositories/session-repository.ts -- Add addHangoutParticipant(), getHangoutParticipants(), updateParticipantCount()
backend/src/handlers/join-hangout.ts     -- Call addHangoutParticipant() after token generation (line ~65)
backend/src/handlers/recording-ended.ts  -- Call getHangoutParticipants() + updateParticipantCount() for HANGOUT sessions at session end
```

### Anti-Patterns to Avoid

- **Storing participants as a list on the session METADATA item:** The session METADATA item uses optimistic locking (`#version = :currentVersion`). Any concurrent update (e.g., two participants joining at the same time) increments `version`, causing the second write to fail with `ConditionalCheckFailedException`. Separate items with shared PK avoid this entirely.

- **Using `UpdateCommand` with a condition for participant writes:** Adds unnecessary complexity. `PutCommand` is simpler and naturally idempotent for this use case. The SK (`PARTICIPANT#{userId}`) ensures uniqueness per user per session.

- **Blocking pool release on participant count computation:** The participant count query and write in `recording-ended.ts` must be wrapped in try/catch. Pool resource release (`releasePoolResource()`) must always run regardless of participant count computation success or failure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique participant tracking | Custom dedup logic with conditional writes | `PutCommand` with `PARTICIPANT#{userId}` SK | SK naturally enforces uniqueness per user per session; PutCommand is an upsert |
| Participant count | Atomic counter incremented on each join | Query + count at session end | At most 12 participants (IVS RealTime limit); a single query is trivial; counter would need decrement logic for leaves |
| DisplayName resolution | User profile service / separate lookup | Use `cognito:username` directly | The existing codebase consistently uses `cognito:username` as the display identifier (see chat-service.ts line 50: `displayName = request.displayName || request.userId`) |

**Key insight:** The maximum number of participants in a hangout is 12 (IVS RealTime publisher limit). All "scale" concerns (hot partitions, sharding, atomic counters) are irrelevant at this cardinality. Simple patterns win.

## Common Pitfalls

### Pitfall 1: Write Contention on Session METADATA

**What goes wrong:** Adding participant data to the session METADATA item (via `list_append` or any update) conflicts with the optimistic locking in `updateSessionStatus()`. When two users join simultaneously, one gets `ConditionalCheckFailedException`.

**Why it happens:** `updateSessionStatus()` uses `ConditionExpression: '#version = :currentVersion'` on the METADATA item. Any concurrent write that increments version causes the next conditional write to fail.

**How to avoid:** Store each participant as a separate item with SK=`PARTICIPANT#{userId}`. These items have no version field and no conditional expression.

**Warning signs:** `ConditionalCheckFailedException` in CloudWatch logs when multiple users join a hangout quickly.

### Pitfall 2: DisplayName Not Available in Join Request

**What goes wrong:** The success criteria mentions storing `displayName` with each participant, but `join-hangout.ts` does NOT parse `event.body` -- it only uses `pathParameters.sessionId` and `cognito:username` from the authorizer claims. There is no separate `displayName` field sent from the frontend.

**Why it happens:** The frontend `useHangout.ts` sends a POST to `/sessions/{sessionId}/join` with `Authorization: Bearer ${authToken}` but no request body (line 43-49 of `useHangout.ts`).

**How to avoid:** Use `cognito:username` as the `displayName` value. This is consistent with the existing pattern in `chat-service.ts` (line 50: `const displayName = request.displayName || request.userId`). The `cognito:username` IS the display name in this system -- there is no separate user profile service.

**Warning signs:** Storing `undefined` or empty string as displayName.

### Pitfall 3: Participant Count Blocking Pool Release

**What goes wrong:** If `getHangoutParticipants()` or `updateParticipantCount()` throws in `recording-ended.ts`, the pool resources (stage, chatRoom) are never released, making them unavailable for new sessions.

**Why it happens:** The participant count logic is added to `recording-ended.ts` in the same try block as pool release.

**How to avoid:** Wrap participant count computation in its own try/catch block, positioned BEFORE pool resource release. Or use a separate try/catch wrapper specifically for the participant count logic. The existing `recording-ended.ts` already demonstrates this pattern with recording metadata (lines 102-137 wrap metadata in try/catch with a comment "Don't throw - metadata update is best-effort").

**Warning signs:** Depleted pool resources after hangout sessions end with errors in participant count computation.

### Pitfall 4: Forgetting to Filter by Session Type

**What goes wrong:** The `participantCount` computation runs for BROADCAST sessions too, but broadcasts have no PARTICIPANT items. The query returns 0 items, and `participantCount: 0` is written to the broadcast session METADATA.

**Why it happens:** `recording-ended.ts` handles both BROADCAST and HANGOUT recording end events.

**How to avoid:** Check `session.sessionType === SessionType.HANGOUT` before running participant count logic. Broadcast sessions should not have a `participantCount` field at all (leave it undefined).

**Warning signs:** All broadcast sessions showing `participantCount: 0` on the homepage.

## Code Examples

### addHangoutParticipant (new repository function)

```typescript
// Source: Follows PutCommand pattern from chat-repository.ts persistMessage()
export async function addHangoutParticipant(
  tableName: string,
  sessionId: string,
  userId: string,
  displayName: string,
  participantId: string,
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `PARTICIPANT#${userId}`,
      entityType: 'PARTICIPANT',
      sessionId,
      userId,
      displayName,
      participantId,
      joinedAt: new Date().toISOString(),
    },
  }));
}
```

### getHangoutParticipants (new repository function)

```typescript
// Source: Follows QueryCommand pattern from chat-repository.ts getMessageHistory()
export interface HangoutParticipant {
  sessionId: string;
  userId: string;
  displayName: string;
  participantId: string;
  joinedAt: string;
}

export async function getHangoutParticipants(
  tableName: string,
  sessionId: string,
): Promise<HangoutParticipant[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'PARTICIPANT#',
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map(item => {
    const { PK, SK, entityType, ...participant } = item;
    return participant as HangoutParticipant;
  });
}
```

### updateParticipantCount (new repository function)

```typescript
// Source: Follows UpdateCommand pattern from updateRecordingMetadata()
export async function updateParticipantCount(
  tableName: string,
  sessionId: string,
  participantCount: number,
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #participantCount = :count, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#participantCount': 'participantCount',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':count': participantCount,
      ':inc': 1,
    },
  }));
}
```

### Integration in join-hangout.ts (after line 65)

```typescript
// After ivsRealTimeClient.send(command) returns successfully:
// Persist participant join -- best-effort, non-blocking
try {
  await addHangoutParticipant(
    tableName,
    sessionId,
    userId,         // cognito:username
    userId,         // displayName = cognito:username (same value)
    response.participantToken!.participantId!,
  );
} catch (participantErr: any) {
  // Log but don't fail the join -- participant tracking is supplementary
  console.error('[join-hangout] Failed to persist participant:', participantErr.message);
}
```

### Integration in recording-ended.ts (after recording metadata, before pool release)

```typescript
// Compute participant count for hangout sessions -- best-effort
if (session.sessionType === SessionType.HANGOUT) {
  try {
    const participants = await getHangoutParticipants(tableName, sessionId);
    if (participants.length > 0) {
      await updateParticipantCount(tableName, sessionId, participants.length);
      console.log('Participant count updated:', { sessionId, count: participants.length });
    }
  } catch (participantCountError: any) {
    console.error('Failed to update participant count (non-blocking):', participantCountError.message);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `list_append` on session item | Separate items per child entity | DynamoDB single-table design best practice | Eliminates write contention for concurrent operations |
| User profile + displayName lookup | `cognito:username` as display identifier | This project's v1.0 design decision | No user profile service needed; consistent across all handlers |

**Deprecated/outdated:**
- None. DynamoDB Document Client patterns (`PutCommand`, `QueryCommand`, `UpdateCommand` from `@aws-sdk/lib-dynamodb`) are current and stable.

## Open Questions

1. **Should participant tracking be best-effort or blocking in join-hangout.ts?**
   - What we know: The IVS token generation is the critical path. Participant tracking is supplementary data for activity cards.
   - What's unclear: Should a DynamoDB failure in `addHangoutParticipant()` cause the join to fail (user can't enter hangout) or should it be swallowed (user enters hangout but tracking is lost)?
   - Recommendation: **Best-effort (try/catch, log error, continue).** The user should always be able to join the hangout. A missing participant record is acceptable -- it only affects the activity card display, not the core hangout experience. This is consistent with how `recording-ended.ts` treats recording metadata updates (lines 134-137: "Don't throw - metadata update is best-effort, don't block session cleanup").

2. **Should the displayName field store `cognito:username` or be omitted?**
   - What we know: The success criteria says "userId, displayName, and joinedAt timestamp." But there is no distinct displayName in this system -- `cognito:username` is used everywhere as the display identifier.
   - What's unclear: Whether the planner should add a `displayName` field that duplicates `userId`, or if `userId` alone satisfies the requirement.
   - Recommendation: **Store `displayName` as a separate field set to `cognito:username`.** This satisfies the requirement literally, maintains forward compatibility if a user profile system is added later, and is consistent with `chat-service.ts` which stores `displayName` as a separate attribute (even though it defaults to `userId`).

## Sources

### Primary (HIGH confidence)
- **Direct codebase analysis** (all files read with Read tool):
  - `backend/src/handlers/join-hangout.ts` -- current handler implementation, integration point at line 65
  - `backend/src/repositories/session-repository.ts` -- existing repository pattern (PutCommand, GetCommand, UpdateCommand, ScanCommand)
  - `backend/src/repositories/chat-repository.ts` -- established QueryCommand + `begins_with` pattern for co-located items
  - `backend/src/domain/session.ts` -- current Session interface, SessionType enum, optimistic locking via `canTransition`
  - `backend/src/handlers/recording-ended.ts` -- integration point for participantCount, existing try/catch pattern
  - `backend/src/lib/dynamodb-client.ts` -- DocumentClient singleton with `removeUndefinedValues: true`
  - `backend/src/services/chat-service.ts` -- established `displayName = request.displayName || request.userId` pattern
  - `infra/lib/stacks/session-stack.ts` -- DynamoDB table schema (PK/SK, GSI1, GSI2), no new GSI needed
  - `infra/lib/stacks/api-stack.ts` -- join-hangout Lambda already has DynamoDB read/write permissions
  - `web/src/features/hangout/useHangout.ts` -- frontend sends POST with no body (confirms no displayName in request)

- **Project architecture research** (`.planning/research/ARCHITECTURE.md`):
  - PARTICIPANT item schema (lines 99-114)
  - Anti-pattern: storing participants as list on session METADATA (lines 695-706)
  - Co-located items pattern (lines 658-665)
  - Integration points identified to specific lines (lines 90-94, 327)

### Secondary (MEDIUM confidence)
- **Project research summary** (`.planning/research/SUMMARY.md`):
  - Phase ordering rationale (Phase 1 = Participant Tracking)
  - Pitfall identification (participant write contention, pool release blocking)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages, all existing DynamoDB patterns verified in codebase
- Architecture: HIGH -- co-located item pattern is established (chat-repository.ts uses identical QueryCommand pattern); integration points identified to specific lines in live code
- Pitfalls: HIGH -- write contention pitfall verified by reading `updateSessionStatus()` optimistic locking code; displayName absence confirmed by reading both handler and frontend code; pool release concern matches established pattern in `recording-ended.ts`

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- no external services or rapidly-changing APIs involved)
