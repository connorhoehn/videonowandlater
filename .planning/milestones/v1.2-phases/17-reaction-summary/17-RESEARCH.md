# Phase 17: Reaction Summary at Session End - Research

**Researched:** 2026-03-05
**Domain:** Reaction aggregation, DynamoDB query patterns, EventBridge handler patterns
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RSUMM-01 | Per-emoji reaction counts are pre-computed and stored on session record when session ends | Design: computeAndStoreReactionSummary function queries all 100 reaction shards per emoji type, aggregates counts, updates session record in try/catch (non-blocking). Pattern: follow recording-ended.ts structure with same idempotency & error handling. |

</phase_requirements>

## Summary

Phase 17 pre-computes emoji reaction counts during the recording-ended Lambda handler and stores them directly on the session record in DynamoDB. This eliminates the need for the homepage (or any client) to perform expensive aggregation queries at read time.

The phase is a targeted extension to the existing `recording-ended.ts` handler: after the session transitions to ENDED and recording metadata is updated, a new step counts reactions by emoji type across all 100 shards and stores the summary on the session item. The aggregation is wrapped in try/catch so pool resource release (the critical operation) is never blocked by reaction counting.

**Key constraint:** Pool release must always complete, even if reaction summary computation fails. This is non-negotiable — blocking resource cleanup would cause cascading failures.

**Primary recommendation:** Create `computeAndStoreReactionSummary()` function in session-repository.ts that wraps the aggregation logic. Call it from recording-ended.ts in a try/catch block immediately after `updateRecordingMetadata()`. Store empty map `{}` on the session if no reactions exist, never `undefined` — ensures downstream code never needs null checks.

## Standard Stack

### Core (already in use — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/lib-dynamodb | ^3.1000.0 | DynamoDB DocumentClient — query sharded reactions, update session record | Already used in reaction-repository.ts (getReactionCounts) and session-repository.ts (updateRecordingMetadata) |
| aws-lambda types | ^8.10.0 | EventBridge handler typing | Already installed |

### Supporting

No new libraries required. This phase reuses existing query infrastructure (GSI and shard enumeration from reaction-repository.ts).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Query all 100 shards and sum counts | Use batch query with ProjectionExpression | Batch GetItem returns items; would need to count items per emoji within the result set. Shard enumeration + Count query simpler. |
| Store reactionSummary as nested object | Store as separate REACTION_SUMMARY# item with own lifecycle | Adds complexity to session lifecycle management; single item update atomic; nested object is standard pattern in this codebase. |
| Compute counts asynchronously in separate Lambda | Compute inline during recording-ended | Async adds operational overhead (scheduling, error handling, retry logic); inline is simpler, counts are cheap to compute (100 queries, not 100K). |
| Always compute counts even if no reactions | Return early if reaction count is zero | Early return saves queries; but consistent to always store the field (even if empty map) for downstream code — no null checks needed. |

## Architecture Patterns

### Reaction Aggregation Data Flow

```
recording-ended EventBridge event
  │
  ├─> Find session and update status to ENDED ✓ (existing)
  ├─> Update recordingMetadata ✓ (existing)
  │
  ├─> [NEW] computeAndStoreReactionSummary()
  │     ├─> For each emoji type (heart, fire, clap, laugh, surprised)
  │     │   ├─> Query GSI2: REACTION#sessionId
  │     │   └─> Select all reactions per emoji (no time range — entire session)
  │     └─> Count reactions per emoji across all 100 shards
  │
  ├─> Store reactionSummary on session item
  │
  ├─> Release pool resources ✓ (existing)
  └─> [REQUIRED] wrap computation in try/catch (non-blocking)
```

### Pattern 1: Reaction Summary Structure on Session Record

**What:** The session item in DynamoDB gains a new optional field: `reactionSummary`.

**Format:** Map of emoji type to count:
```typescript
reactionSummary?: {
  [key: string]: number;  // e.g., { heart: 42, fire: 17, clap: 8 }
};
```

**Important:** Always present (even if empty), never `undefined` — downstream consumers (Phase 18 activity feed) read this field without null checks.

**Storage:**
- Sessions with reactions: `reactionSummary: { heart: 42, fire: 17, ... }`
- Sessions with no reactions: `reactionSummary: {}` (empty map, not undefined)
- Sessions ended before Phase 17 deployed: field absent (accept as valid; Phase 18 must handle missing field gracefully with `session.reactionSummary ?? {}`)

### Pattern 2: Idempotent Aggregation

**What:** If `computeAndStoreReactionSummary()` is called twice on the same session (EventBridge retry, manual rerun), the second call produces identical results.

**Why idempotent:** Query across all reactions for a session always returns same set of reactions. Counting the same reactions twice yields same count. Update to DynamoDB is a SET operation (atomic), not an append.

**No special handling required:** Function is inherently idempotent. If EventBridge retries, second invocation computes and stores the same summary without conflict.

### Pattern 3: Non-Blocking Error Handling

**What:** If reaction aggregation fails (query timeout, DynamoDB throttle, code error), the exception is caught and logged, but handler continues to release pool resources.

**Example (recording-ended.ts):**
```typescript
// Update recording metadata (best-effort)
try {
  await updateRecordingMetadata(tableName, sessionId, { ... });
} catch (metadataError: any) {
  console.error('Failed to update recording metadata (non-blocking):', metadataError.message);
}

// [NEW] Compute and store reaction summary (best-effort, non-blocking)
try {
  await computeAndStoreReactionSummary(tableName, sessionId);
} catch (summaryError: any) {
  console.error('Failed to compute reaction summary (non-blocking):', summaryError.message);
}

// Release resources (critical — must complete)
await releasePoolResource(...);
```

**Pattern:** Same try/catch structure already used for metadata update. Metadata and summary are both "nice to have" — pool release is "must have".

### Pattern 4: Querying Reactions Without Time Range

**What:** `getReactionCounts()` in reaction-repository.ts already handles sharded queries. Phase 17 uses the same function to count per emoji, but without a time range (counts all reactions for the session).

**Current usage (Phase 7 replay viewer):**
```typescript
// Query reactions within a time window for video playback
const reactions = await getReactionsInTimeRange(
  tableName,
  sessionId,
  0,
  60000  // 0-60 seconds of video
);
```

**Phase 17 usage (aggregation at session end):**
```typescript
// Query ALL reactions for the session (no time bounds)
// The function already supports this implicitly
const allReactionsCount = await getReactionCounts(
  tableName,
  sessionId,
  'heart'  // count all HEART reactions regardless of when they were sent
);
```

**Why this works:** `getReactionCounts()` queries each shard with `PK = REACTION#{sessionId}#{emojiType}#SHARD{N}` and no time range filter. It naturally aggregates across all time.

### Anti-Patterns to Avoid

- **Do not** compute summary at read time (Phase 18 activity feed must not aggregate) — defeats the entire purpose of pre-computation
- **Do not** create a separate Lambda to compute summaries — adds operational complexity; inline is simpler and cheaper
- **Do not** block pool release if summary computation fails — resource starvation risk
- **Do not** store `undefined` for reactionSummary — always store even if empty map to avoid null checks downstream
- **Do not** query beyond the 100 shards — sharding is fixed at 100 per Phase 7 design; no scaling beyond this
- **Do not** use a TransactWriteItems to update reactions and session atomically — session update happens at session end; reactions are long-gone by that point

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query reactions per emoji | Custom QueryCommand loop per emoji | Call `getReactionCounts()` for each EmojiType | Already exists; handles shard enumeration; tested |
| Aggregate across shards | Manual loop summing counts | `Promise.all()` parallel query execution (already in getReactionCounts) | Avoids sequential latency; built-in pattern |
| Update session record | Write custom UpdateCommand with conditional expression | `updateRecordingMetadata()` with new `reactionSummary` parameter | Consistent with existing metadata update flow |
| Generate unique field keys | Manual object construction | Just iterate `Object.values(EmojiType)` and build map | EmojiType enum defines all valid emojis; no guessing |
| Handle aggregation errors | Let them propagate and crash handler | Wrap in try/catch matching recording-ended.ts pattern (metadata update already does this) | Pool release isolation; non-blocking pattern proven in Phase 5 |

**Key insight:** All infrastructure for reaction counting exists in Phase 7. Phase 17 is orchestration, not infrastructure.

## Common Pitfalls

### Pitfall 1: Blocking Pool Release on Reaction Summary Failure
**What goes wrong:** `computeAndStoreReactionSummary()` throws an exception, handler catches it, rethrows it, pool resource release never happens. Channel/Stage/ChatRoom remain claimed forever.
**Why it happens:** Developer wraps the entire "end session" flow in one try/catch, thinking "if anything fails, abort". But pool release is critical.
**How to avoid:** Wrap metadata update AND reaction summary in separate try/catch blocks nested AFTER `updateSessionStatus`. Pool release comes after both, in its own success path.
**Warning signs:** CloudWatch logs show pool RESOURCE_AVAILABLE count decreases over time without increasing (Channels/Stages never returned).

**Code pattern (correct):**
```typescript
try {
  await updateSessionStatus(...);        // Critical: transition to ENDED
  try {
    await updateRecordingMetadata(...);  // Non-blocking: metadata
  } catch (err) { console.error(...); }
  try {
    await computeAndStoreReactionSummary(...); // Non-blocking: summary
  } catch (err) { console.error(...); }
  // Pool release happens regardless of metadata/summary errors
  await releasePoolResource(...);
} catch (error) {
  console.error('Failed to end session:', error);
  // This catch is for status transition failure only
}
```

### Pitfall 2: Storing `undefined` Instead of Empty Map
**What goes wrong:** Sessions with no reactions have `reactionSummary: undefined`. Phase 18 activity feed code does `const counts = session.reactionSummary.heart` and throws "Cannot read property 'heart' of undefined".
**Why it happens:** Code checks `if (!reactionCount) return` and doesn't update the field, leaving it absent.
**How to avoid:** Always store a map, even if empty. `reactionSummary: {}` costs nothing in DynamoDB and prevents null checks everywhere.
**Warning signs:** Phase 18 integration tests fail with runtime TypeError in activity feed rendering.

### Pitfall 3: Forgetting to Import EmojiType Enum
**What goes wrong:** In `computeAndStoreReactionSummary()`, loop tries to iterate emoji types but EmojiType is not imported.
**Why it happens:** EmojiType defined in `domain/reaction.ts`, easy to forget to import it.
**How to avoid:** Add import: `import { EmojiType } from '../domain/reaction';` at top of session-repository.ts.
**Warning signs:** TypeScript compilation error: "Cannot find name 'EmojiType'".

### Pitfall 4: Querying Reactions That Don't Exist for a Session
**What goes wrong:** `getReactionCounts()` queries all 100 shards even for a session that had zero reactions. If shards have no items, the loop still iterates 100 times.
**Why it happens:** No early exit if session has no reactions detected.
**How to avoid:** This is acceptable — 100 parallel COUNT queries over empty shards is sub-100ms (query returns Count: 0 immediately). GSI2 range query could confirm "any reactions exist" first, but premature optimization. Let it run.
**Warning signs:** None — performance is fine. This is over-thinking it.

### Pitfall 5: Type Mismatch in reactionSummary Update
**What goes wrong:** Code tries to pass `reactionSummary: Object` to `updateRecordingMetadata()`, but function signature doesn't include this field.
**Why it happens:** Function was designed for recording fields only; needs extension.
**How to avoid:** Update `updateRecordingMetadata()` parameter type to include optional `reactionSummary?: Record<string, number>`.
**Warning signs:** TypeScript error: "Object literal may only specify known properties, and 'reactionSummary' does not exist".

### Pitfall 6: Counting Only Specific EmojiType Instead of All Types
**What goes wrong:** Code loops through reactions but only counts `heart` emoji, ignoring other 4 types.
**Why it happens:** Copy/paste error or incomplete loop.
**How to avoid:** Use `Object.values(EmojiType)` to iterate all types, not hardcoded string array.
**Warning signs:** Phase 18 UI shows only heart count; other emojis display 0 (but data exists in DynamoDB).

## Code Examples

Verified patterns from project source files:

### Pattern: getReactionCounts() from reaction-repository.ts (reused)
```typescript
// Source: backend/src/repositories/reaction-repository.ts lines 115-157
export async function getReactionCounts(
  tableName: string,
  sessionId: string,
  emojiType: EmojiType
): Promise<number> {
  const docClient = getDocumentClient();
  let totalCount = 0;

  try {
    const queryPromises = [];

    for (let shardId = 1; shardId <= SHARD_COUNT; shardId++) {
      const pk = `REACTION#${sessionId}#${emojiType}#SHARD${shardId}`;

      queryPromises.push(
        docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': pk,
            },
            Select: 'COUNT',
          })
        )
      );
    }

    const results = await Promise.all(queryPromises);

    for (const result of results) {
      totalCount += result.Count || 0;
    }

    return totalCount;
  } catch (error) {
    console.error('Error getting reaction counts:', error);
    throw error;
  }
}
```

### Pattern: Non-blocking error handling from recording-ended.ts (reference)
```typescript
// Source: backend/src/handlers/recording-ended.ts lines 102-137
try {
  // Update recording metadata
  const recordingS3KeyPrefix = event.detail.recording_s3_key_prefix;
  // ... construct URLs ...

  await updateRecordingMetadata(tableName, sessionId, {
    recordingDuration: event.detail.recording_duration_ms,
    recordingHlsUrl,
    thumbnailUrl,
    recordingStatus: finalStatus,
  });

  console.log('Recording metadata updated:', {
    sessionId,
    recordingDuration: event.detail.recording_duration_ms,
    recordingStatus: finalStatus,
  });
} catch (metadataError: any) {
  console.error('Failed to update recording metadata (non-blocking):', metadataError.message);
  // Don't throw - metadata update is best-effort, don't block session cleanup
}
```

### NEW: computeAndStoreReactionSummary() design

```typescript
// Location: backend/src/repositories/session-repository.ts (add to file)
// Imports at top of file (add if not present):
import { EmojiType, SHARD_COUNT } from '../domain/reaction';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Compute per-emoji reaction counts for a session and store on session record
 * Queries all shards for each emoji type and aggregates counts
 * Called at session end (recording-ended handler) to pre-compute summaries
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @returns Promise resolving to reactionSummary map { emojiType: count, ... }
 */
export async function computeAndStoreReactionSummary(
  tableName: string,
  sessionId: string
): Promise<Record<string, number>> {
  const docClient = getDocumentClient();
  const reactionSummary: Record<string, number> = {};

  try {
    // For each emoji type, count reactions across all shards
    for (const emojiType of Object.values(EmojiType)) {
      let emojiCount = 0;
      const queryPromises = [];

      for (let shardId = 1; shardId <= SHARD_COUNT; shardId++) {
        const pk = `REACTION#${sessionId}#${emojiType}#SHARD${shardId}`;
        queryPromises.push(
          docClient.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: 'PK = :pk',
              ExpressionAttributeValues: {
                ':pk': pk,
              },
              Select: 'COUNT',
            })
          )
        );
      }

      // Execute all shard queries in parallel
      const results = await Promise.all(queryPromises);

      // Sum up counts across all shards
      for (const result of results) {
        emojiCount += result.Count || 0;
      }

      // Store count in summary (include even if 0 for completeness)
      reactionSummary[emojiType] = emojiCount;
    }

    console.log('Computed reaction summary:', { sessionId, reactionSummary });

    // Update session record with reaction summary
    await updateRecordingMetadata(tableName, sessionId, {
      reactionSummary,
    });

    return reactionSummary;
  } catch (error) {
    console.error('Error computing reaction summary:', error);
    throw error;  // Caller (recording-ended) handles with try/catch
  }
}
```

### Integration point in recording-ended.ts

```typescript
// Source: backend/src/handlers/recording-ended.ts (after existing imports)
// Add import:
import {
  updateSessionStatus,
  updateRecordingMetadata,
  findSessionByStageArn,
  computeAndStoreReactionSummary,  // NEW
} from '../repositories/session-repository';

// In handler, after updateRecordingMetadata try/catch block, add:
// [NEW] Compute and store reaction summary (best-effort, non-blocking)
try {
  await computeAndStoreReactionSummary(tableName, sessionId);
} catch (summaryError: any) {
  console.error('Failed to compute reaction summary (non-blocking):', summaryError.message);
  // Don't throw - summary computation is best-effort, don't block session cleanup
}

// Pool release continues as normal (existing code)
```

### Update session-repository.ts updateRecordingMetadata() signature

```typescript
// Source: backend/src/repositories/session-repository.ts lines 131-141 (to be extended)
// Current signature:
export async function updateRecordingMetadata(
  tableName: string,
  sessionId: string,
  metadata: {
    recordingS3Path?: string;
    recordingDuration?: number;
    thumbnailUrl?: string;
    recordingHlsUrl?: string;
    recordingStatus?: RecordingStatus | 'processing' | 'available' | 'failed' | 'pending';
  }
): Promise<void>

// Extended signature (add reactionSummary parameter):
export async function updateRecordingMetadata(
  tableName: string,
  sessionId: string,
  metadata: {
    recordingS3Path?: string;
    recordingDuration?: number;
    thumbnailUrl?: string;
    recordingHlsUrl?: string;
    recordingStatus?: RecordingStatus | 'processing' | 'available' | 'failed' | 'pending';
    reactionSummary?: Record<string, number>;  // NEW
  }
): Promise<void>
```

Then add the field to the update logic:
```typescript
if (metadata.reactionSummary !== undefined) {
  updateParts.push('#reactionSummary = :reactionSummary');
  expressionAttributeNames['#reactionSummary'] = 'reactionSummary';
  expressionAttributeValues[':reactionSummary'] = metadata.reactionSummary;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | Per-emoji counts pre-computed at session end (Phase 17) | Phase 17 | Eliminates read-time aggregation cost; activity feed (Phase 18) gets counts from session.reactionSummary field |
| Read-time aggregation (hypothetical) | Write-time pre-computation | Phase 17 | Homepage never queries 100 shards per session; O(1) field read instead of O(100 queries) |

**Deprecated/outdated:**
- None. No APIs or patterns being replaced — new field being added to session record.

## Open Questions

1. **Should reactionSummary be initialized as empty map {} before any reactions exist?**
   - What we know: Phase 7 (reaction creation) doesn't initialize the field on sessions. Sessions only get reactionSummary when Phase 17 runs (recording ends).
   - What's unclear: Do sessions created before Phase 17 deployed still have `reactionSummary: undefined`? Should Phase 18 handle missing field?
   - Recommendation: Phase 17 is responsible for initializing the field. Sessions from before Phase 17 deployment are acceptable edge cases — Phase 18 code must use `session.reactionSummary ?? {}` for safety. No need for backfill migration.

2. **What if a session has reactions stored but they're all from shards that have been expunged (if TTL cleans up reactions)?**
   - What we know: Phase 7 does not implement TTL on reactions. Reactions are persisted indefinitely.
   - What's unclear: Future phases might add TTL. If Phase 17 runs and all reactions have expired, will counts be correct?
   - Recommendation: Out of scope for Phase 17. If TTL is added later, it's a data consistency issue at that time, not a Phase 17 concern. Count what exists in DynamoDB at session end.

3. **Should Phase 17 also count reactions that were sent during replay (not just live reactions)?**
   - What we know: Reactions have `reactionType: 'live' | 'replay'` field. Phase 7 stores both types separately.
   - What's unclear: Do activity feed cards (Phase 18) display combined counts, or just live reactions?
   - Recommendation: Phase 17 requirement RSUMM-01 says "per-emoji reaction counts" with no distinction of type. Aggregate across both LIVE and REPLAY reactions. Phase 18 requirements may refine this; for now, total count is safest.

## Validation Architecture

> nyquist_validation is not present in .planning/config.json, using project's existing Jest infrastructure.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest with ts-jest |
| Config file | `backend/jest.config.js` |
| Quick run command | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern=session-repository` |
| Full suite command | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RSUMM-01 | computeAndStoreReactionSummary queries 100 shards per emoji, sums counts, updates session | unit | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern="session-repository.*reaction-summary"` | Wave 0 |
| RSUMM-01 | Pool release completes even if reaction summary fails | unit | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern=recording-ended` | Exists — update needed |

### Sampling Rate
- **Per task commit:** `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern="session-repository|recording-ended"`
- **Per wave merge:** `cd backend && NODE_OPTIONS=--experimental-vm-modules jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/src/repositories/__tests__/session-repository.test.ts` — add test for `computeAndStoreReactionSummary`: mock getDocumentClient to return Count results for each shard query, assert reactionSummary is computed correctly, assert updateRecordingMetadata called with correct map
- [ ] `backend/src/repositories/__tests__/session-repository.test.ts` — test empty session (no reactions): assert reactionSummary returns `{}` not undefined
- [ ] `backend/src/repositories/__tests__/session-repository.test.ts` — update `updateRecordingMetadata` tests to cover the new reactionSummary parameter
- [ ] `backend/src/handlers/__tests__/recording-ended.test.ts` — mock computeAndStoreReactionSummary to verify it's called after updateRecordingMetadata; test that exception in computeAndStoreReactionSummary doesn't block pool release

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `backend/src/domain/reaction.ts` — confirmed EmojiType enum and SHARD_COUNT constant (100 shards)
- Direct code inspection: `backend/src/repositories/reaction-repository.ts` — confirmed getReactionCounts() pattern for shard enumeration and parallel COUNT queries
- Direct code inspection: `backend/src/handlers/recording-ended.ts` — confirmed non-blocking error handling pattern for metadata update (lines 102-137)
- Direct code inspection: `backend/src/repositories/session-repository.ts` — confirmed updateRecordingMetadata() dynamic field update pattern
- Direct code inspection: `backend/src/domain/session.ts` — confirmed Session interface structure (can add new optional field reactionSummary)
- Project memory — confirmed Phase 7 stores reactions with sharding; Phase 5 establishes try/catch error handling pattern

### Secondary (MEDIUM confidence)
- ROADMAP.md — confirmed Phase 17 goal and RSUMM-01 requirement
- REQUIREMENTS.md — confirmed success criteria: reactionSummary stored, pool release always completes, empty map stored for zero reactions

### Tertiary (LOW confidence)
- None required. All patterns are verified against actual source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies
- Architecture: HIGH — patterns are direct extractions from existing Phase 5 (recording-ended) and Phase 7 (reaction queries)
- Pitfalls: HIGH — derived from code inspection of error handling patterns and DynamoDB field management
- Implementation scope: HIGH — well-defined extension to existing handler; ~80-100 lines of new code

**Research date:** 2026-03-05
**Valid until:** Stable indefinitely — this is codebase-specific aggregation logic, not ecosystem research

---

## Implementation Summary (for Planner Reference)

| Component | File | Change | Scope |
|-----------|------|--------|-------|
| New function | `backend/src/repositories/session-repository.ts` | Add `computeAndStoreReactionSummary()` — 50-60 lines | Function design |
| Signature update | `backend/src/repositories/session-repository.ts` | Extend `updateRecordingMetadata()` to accept optional `reactionSummary?: Record<string, number>` | 5 lines added to signature + 5 lines in update logic |
| Handler integration | `backend/src/handlers/recording-ended.ts` | Add import; call `computeAndStoreReactionSummary()` in try/catch after metadata update | 8 lines added |
| New test | `backend/src/repositories/__tests__/session-repository.test.ts` | Test `computeAndStoreReactionSummary()` with mocked DynamoDB responses; test empty session case; test error handling | 100-120 lines new |
| Updated test | `backend/src/handlers/__tests__/recording-ended.test.ts` | Mock `computeAndStoreReactionSummary`; assert called; test pool release on failure | 20 lines modified |
| Domain update | `backend/src/domain/session.ts` | Add `reactionSummary?: Record<string, number>` to Session interface | 1 line added |

**Total estimated scope:** ~200 lines of new code (mostly tests), ~15 lines of production code changes to existing files
