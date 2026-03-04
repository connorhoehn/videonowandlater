# Phase 10: Integration Wiring Fixes - Research

**Researched:** 2026-03-03
**Domain:** Cross-phase integration bugs — React frontend wiring, Lambda handler field access, CDK EventBridge deduplication
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPLAY-06 | Chat messages display alongside replay video in synchronized timeline | Fix identified: ReplayChat.tsx line 26 fetches wrong API path; correct path verified from api-stack.ts |
| REPLAY-07 | Chat auto-scrolls as video plays, matching video.currentTime to message timestamps | Blocked by REPLAY-06; once messages load, existing useSynchronizedChat hook handles this automatically |
| HANG-01 | Local participant in hangout displays correct username, not "undefined (You)" | Fix identified: join-hangout.ts response omits userId; useHangout.ts line 50 destructures it as undefined |
</phase_requirements>

---

## Summary

Phase 10 addresses three verified integration bugs found by the v1.1 milestone audit. All three bugs are small, surgical fixes — none require new architectural patterns or new infrastructure. The bugs were introduced when phases were built and tested in isolation; integration testing exposed the cross-cutting failures.

**Bug 1 (REPLAY-06/07):** `ReplayChat.tsx` line 26 fetches `/sessions/${sessionId}/messages` but the API Gateway route is `/sessions/{id}/chat/messages` (confirmed in `api-stack.ts` lines 176-242). Every replay page returns 404 for chat. Fix is a single-string change in one React component.

**Bug 2 (HANG-01):** `join-hangout.ts` lines 94-100 return `{ token, participantId, expirationTime }` but do NOT include `userId`. `useHangout.ts` line 50 destructures `userId` from the response — it is always `undefined`. The `username` variable is already present in the handler (line 50) and just needs to be added to the response JSON.

**Bug 3 (REC-05 tech debt — success criterion 3):** `session-stack.ts` defines two EventBridge rules that both match the same IVS `Recording State Change` event: `RecordingEndRule` (legacy, lines 292-302) and `RecordingEndRuleV2` (lines 187-196). Both target the same `recordingEndedFn` Lambda. The legacy rule is labeled "backward compatibility" but there is no consumer that requires it — removing it eliminates duplicate invocations and DynamoDB version-conflict errors.

**Primary recommendation:** Three targeted code edits across three files. No new infrastructure. No new libraries. No architectural changes. Estimated implementation: under 30 minutes of typing.

---

## Standard Stack

This phase makes no new library introductions. All relevant stack is already deployed.

### Core (Existing — no changes)
| Component | Version | Purpose |
|-----------|---------|---------|
| React (TypeScript) | Existing | `ReplayChat.tsx` fix |
| AWS Lambda (Node.js 20.x) | Existing | `join-hangout.ts` fix |
| AWS CDK | Existing | `session-stack.ts` EventBridge rule removal |
| Jest + ts-jest | 30.x / 29.x | Unit test updates for recording-ended handler |

### No New Installations Required
All dependencies are present. No `npm install` steps needed.

---

## Architecture Patterns

### Pattern 1: API Gateway Route Verification Against CDK Definition

The authoritative source for all API routes is `infra/lib/stacks/api-stack.ts`. The chat history GET route is defined at:

```typescript
// Source: infra/lib/stacks/api-stack.ts:176-242
const sessionChatResource = sessionIdResource.addResource('chat');    // → /sessions/{sessionId}/chat
const chatMessagesResource = sessionChatResource.addResource('messages'); // → /sessions/{sessionId}/chat/messages
chatMessagesResource.addMethod('GET', new apigateway.LambdaIntegration(getChatHistoryHandler), { ... });
```

The fix in `ReplayChat.tsx`:
```typescript
// BEFORE (broken — line 26):
const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`, { ... });

// AFTER (correct):
const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/messages`, { ... });
```

### Pattern 2: Lambda Response Field Addition

The `join-hangout.ts` handler already has `username` in scope (line 50). The fix adds it to the response:

```typescript
// BEFORE (broken — lines 96-100):
return {
  statusCode: 200,
  body: JSON.stringify({
    token: response.participantToken.token,
    participantId: response.participantToken.participantId,
    expirationTime: response.participantToken.expirationTime?.toISOString(),
  }),
};

// AFTER (correct):
return {
  statusCode: 200,
  body: JSON.stringify({
    token: response.participantToken.token,
    participantId: response.participantToken.participantId,
    expirationTime: response.participantToken.expirationTime?.toISOString(),
    userId: username,   // <-- add this line
  }),
};
```

The `useHangout.ts` consumer at line 50 already destructures `userId` and uses it correctly — no frontend changes needed for HANG-01.

### Pattern 3: CDK EventBridge Rule Removal (Duplicate Elimination)

The `session-stack.ts` has two `events.Rule` constructs that both match `IVS Recording State Change` + `event_name: ['Recording End']` and both target the same Lambda. The legacy rule (lines 291-302) must be removed:

```typescript
// REMOVE THIS ENTIRE BLOCK (session-stack.ts lines 291-302):
// EventBridge rule for IVS Recording End events (legacy, keeping for backward compatibility)
new events.Rule(this, 'RecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      recording_status: ['Recording End'],
    },
  },
  targets: [new targets.LambdaFunction(recordingEndedFn)],
  description: 'Transition session to ENDED and release pool resources when recording ends',
});
```

Note: `this.recordingEndRule` (the `RecordingEndRuleV2` at line 187) is the correct rule and already wired as a target at line 321. The public property `recordingEndRule` on the stack class refers to this V2 rule — verify no other stack references the removed rule ID `RecordingEndRule` before deleting.

### Anti-Patterns to Avoid

- **Do NOT modify `useSynchronizedChat.ts` or `useReplayPlayer.ts`** — once chat messages load (REPLAY-06 fix), REPLAY-07 auto-scroll works via the existing hook pattern.
- **Do NOT add `userId` return to the IVS RealTime SDK response** — `username` is already extracted from Cognito claims in the handler (line 50); just expose it in the JSON body.
- **Do NOT add a new EventBridge rule for Stage recording** — REC-05 tech debt (dual rules) is the problem to fix, not a missing rule. The existing `RecordingEndRuleV2` already handles broadcast recording-ended events correctly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Chat message sync after path fix | New sync mechanism | Existing `useSynchronizedChat` hook (Phase 6-03) — already tested |
| userId propagation from auth | New auth extraction | Cognito claims (`event.requestContext.authorizer.claims['cognito:username']`) already in handler |
| EventBridge dedup | Runtime dedup logic in Lambda | Remove the duplicate CDK rule — EventBridge fires once per rule |

---

## Common Pitfalls

### Pitfall 1: Assuming recording-ended.ts Needs Major Refactoring for Stage Events

**What goes wrong:** The audit says "wrong EventBridge field for Stage ARN detection" — a reader might assume recording-ended.ts needs a full rewrite for RealTime Stage events.

**What's actually true:** Looking at `recording-ended.ts` line 31-68, the handler ALREADY has Stage ARN detection logic (the `if resourceType === 'stage'` branch). The bug is that `event.detail.channel_name` is used as the ARN source — but for IVS Low-Latency events, the channel_name field contains the channel name (NOT the ARN). The channel ARN is in `event.resources[0]`.

**The actual IVS Low-Latency event field for `channel_name`:**
```json
"detail": {
  "channel_name": "Your Channel",   // This is a NAME, not an ARN
  ...
}
```
And `resources[0]` = `arn:aws:ivs:us-west-2:123456789012:channel/AbCdef1G2hij`

**The actual IVS RealTime Stage Recording event (detail-type: "IVS Participant Recording State Change"):**
```json
"resources": ["arn:aws:ivs:us-west-2:aws_account_id:stage/AbCdef1G2hij"],
"detail": {
  "session_id": "st-ZyXwvu1T2s",
  "event_name": "Recording End",
  "participant_id": "xYz1c2d3e4f",
  "recording_s3_bucket_name": "bucket-name",
  "recording_s3_key_prefix": "...",
  "recording_duration_ms": 547327
  // NO channel_name field at all
}
```

**Phase 10 scope clarification:** Phase 10's success criterion 3 is specifically about the **dual EventBridge rules** (REC-05 tech debt), NOT about fixing Stage ARN detection. The audit note "recording-ended reads wrong EventBridge field for Stage ARN detection" is a HANG-14 gap assigned to Phase 11. Phase 10 only removes the legacy `RecordingEndRule` to prevent double-invocation.

**How to avoid confusion:** Read the success criteria verbatim: "recording-ended Lambda is invoked exactly once per IVS Recording End event (legacy rule removed)." This is about deduplication, not Stage ARN field correction.

### Pitfall 2: Breaking the Chat History GET Auth

**What goes wrong:** The `GET /sessions/{sessionId}/chat/messages` endpoint uses a Cognito authorizer. If a developer tests the URL fix in the browser without an Authorization header, they get 401, not 200 — this could be mistaken for the path still being wrong.

**How to avoid:** Verify the fix by checking that the frontend already sends the Authorization header on chat history requests. Looking at `ReplayChat.tsx` lines 28-31:
```typescript
headers: {
  'Content-Type': 'application/json',
  // NOTE: No Authorization header here
}
```
The `GET /sessions/{sessionId}/chat/messages` route IS protected by Cognito authorizer (api-stack.ts line 238-242). ReplayChat.tsx does NOT send an Authorization header. This is a secondary bug that may block REPLAY-06 even after the path fix.

**Resolution:** Either (a) add the auth token to ReplayChat's fetch headers, or (b) confirm the replay viewer already has the token in scope and pass it as a prop. Check if the ReplayViewer page has auth context available — if yes, pass `authToken` prop to `ReplayChat`.

### Pitfall 3: CDK Stack References to Removed Rule ID

**What goes wrong:** Removing `new events.Rule(this, 'RecordingEndRule', ...)` from CDK, but another stack cross-references the CloudFormation logical ID `RecordingEndRule` — CDK deploy fails.

**How to avoid:** Check that `recordingEndRule` public property on `SessionStack` (line 26) refers to `RecordingEndRuleV2` (line 187), not the legacy rule. Verify no other CDK file imports or references `RecordingEndRule` by ID.

### Pitfall 4: Test File Still Uses Old Event Shape

**What goes wrong:** `recording-ended.test.ts` constructs events with `channel_name` in `detail` and `resources: []`. After any future fix to recording-ended.ts to use `resources[0]`, these tests will fail. Phase 10 doesn't touch recording-ended.ts business logic — but the tests are documenting the wrong event shape.

**Phase 10 scope:** The tests do not need updating for Phase 10 (since we're only removing the CDK rule, not changing handler logic). Flag this as tech debt for Phase 11.

---

## Code Examples

### Fix 1: ReplayChat.tsx path correction (+ auth header)
```typescript
// Source: Verified against api-stack.ts lines 226-242 (GET /sessions/{sessionId}/chat/messages)

// In ReplayChat.tsx, update fetch call:
const response = await fetch(
  `${API_BASE_URL}/sessions/${sessionId}/chat/messages`,
  {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      // Add if auth token is available in this component's scope:
      // 'Authorization': `Bearer ${authToken}`,
    },
  }
);
```

**Note on auth:** The GET `/sessions/{sessionId}/chat/messages` endpoint requires a Cognito JWT. If `ReplayChat.tsx` does not have access to the auth token, the parent `ReplayViewer` page must pass it as a prop. Check whether the replay viewer already has `authToken` from the auth context.

### Fix 2: join-hangout.ts response field addition
```typescript
// Source: Verified against useHangout.ts line 50 (destructures userId)
// In join-hangout.ts, line 99 — add userId to response body:
return {
  statusCode: 200,
  body: JSON.stringify({
    token: response.participantToken.token,
    participantId: response.participantToken.participantId,
    expirationTime: response.participantToken.expirationTime?.toISOString(),
    userId: username,
  }),
};
```

### Fix 3: session-stack.ts legacy rule removal
```typescript
// Source: Verified in session-stack.ts lines 291-302 (RecordingEndRule, labeled legacy)
// DELETE the following block entirely:

// EventBridge rule for IVS Recording End events (legacy, keeping for backward compatibility)
new events.Rule(this, 'RecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      recording_status: ['Recording End'],
    },
  },
  targets: [new targets.LambdaFunction(recordingEndedFn)],
  description: 'Transition session to ENDED and release pool resources when recording ends',
});

// The active rule (RecordingEndRuleV2) remains at lines 187-196
// and is wired to Lambda at line 321 via this.recordingEndRule.addTarget(...)
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `recording_status` field in EventBridge pattern | `event_name` field | Legacy rule uses wrong filter field; correct V2 rule uses `event_name` |

**Verified event structures (HIGH confidence, from official AWS docs):**

**IVS Low-Latency broadcast "Recording End" (detail-type: "IVS Recording State Change"):**
- Channel ARN in `event.resources[0]`
- `event.detail.channel_name` = human-readable channel NAME (not ARN)
- `event.detail.recording_status` = `"Recording End"`
- `event.detail.event_name` = `"Recording End"`

**IVS RealTime Stage individual participant recording (detail-type: "IVS Participant Recording State Change"):**
- Stage ARN in `event.resources[0]`
- No `channel_name` field in `detail`
- `event.detail.event_name` = `"Recording End"`
- `event.detail.participant_id` = participant who recorded

**IVS RealTime Composition (detail-type: "IVS Composition State Change"):**
- Composition ARN in `event.resources[0]`
- `event.detail.stage_arn` = stage ARN (in detail)
- `event.detail.event_name` = `"Session End"` (not "Recording End")

---

## Open Questions

1. **ReplayChat auth token availability**
   - What we know: `GET /sessions/{sessionId}/chat/messages` requires Cognito JWT. `ReplayChat.tsx` currently sends no Authorization header.
   - What's unclear: Whether the ReplayViewer page has the auth token in scope and whether it passes it to ReplayChat as a prop.
   - Recommendation: During planning, read `ReplayViewer.tsx` to check if `authToken` is available. If yes, add an `authToken` prop to `ReplayChat` and include it in the fetch. If the route needs to be public for replay viewers (not logged-in), consider whether the endpoint should drop auth requirement — but prefer adding auth header first.

2. **Scope of REC-05 fix in Phase 10 vs HANG-14 fix in Phase 11**
   - What we know: Phase 10 success criterion 3 = "Lambda invoked exactly once per IVS Recording End event (legacy rule removed)." Phase 11 = fix Stage ARN detection for hangout recording metadata.
   - What's unclear: Whether removing the legacy CDK rule requires a CDK `cdk deploy` with downtime.
   - Recommendation: Plan for a CDK deploy step. The rule removal is infrastructure-level. No application restart needed, but `cdk deploy SessionStack` must run.

---

## Sources

### Primary (HIGH confidence)
- AWS Official Docs: [Using Amazon EventBridge with IVS Real-Time Streaming](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/eventbridge.html) — full JSON schemas for "IVS Participant Recording State Change" Recording End and "IVS Composition State Change" Session End events verified
- AWS Official Docs: [Using Amazon EventBridge with IVS Low-Latency Streaming](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html) — full JSON schema for "IVS Recording State Change" Recording End confirmed `channel_name` is a NAME not ARN; channel ARN in `resources[0]`
- Project source: `infra/lib/stacks/api-stack.ts` lines 176-242 — GET `/sessions/{sessionId}/chat/messages` route definition confirmed
- Project source: `backend/src/handlers/join-hangout.ts` lines 94-100 — confirmed `userId` missing from response
- Project source: `infra/lib/stacks/session-stack.ts` lines 187-196 and 291-302 — dual EventBridge rules confirmed

### Secondary (MEDIUM confidence)
- Project audit: `.planning/v1.1-MILESTONE-AUDIT.md` — integration findings confirmed by cross-referencing source files

### Tertiary (LOW confidence)
- None — all findings verified against source code or official docs

---

## Metadata

**Confidence breakdown:**
- Fix locations: HIGH — verified directly in source code
- API route correctness: HIGH — verified against CDK api-stack.ts definition
- EventBridge event schemas: HIGH — verified from official AWS docs
- Auth requirement on chat history GET: HIGH — verified from api-stack.ts authorizer config; flagged as open question for planning
- Scope boundary (Phase 10 vs 11): HIGH — derived from phase success criteria verbatim

**Research date:** 2026-03-03
**Valid until:** N/A — all findings are based on project source code, not external APIs that change
