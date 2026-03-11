---
phase: 35-pipeline-debug-cli
verified: 2026-03-11T22:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 35: Pipeline Debug CLI Verification Report

**Phase Goal:** Ship two developer CLI tools: debug-pipeline.js reads DynamoDB and prints a full human-readable pipeline status report for a session; replay-pipeline.js publishes the correct EventBridge event to resume the pipeline from any stage for a given sessionId.
**Verified:** 2026-03-11T22:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                              | Status     | Evidence                                                                                                    |
|----|----------------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------------|
| 1  | Developer can run `node tools/debug-pipeline.js --sessionId <id>` and see all pipeline fields     | VERIFIED   | File exists (105 lines), prints Identity/Recording/Pipeline State/Upload Pipeline sections via GetCommand   |
| 2  | Developer can run `node tools/replay-pipeline.js --sessionId <id> --from <stage>` and correct EventBridge event is published | VERIFIED | File exists (154 lines), buildEntry() handles all 4 stages with correct Source/DetailType/Detail payloads |
| 3  | Both tools print a clear error and exit 1 for missing sessionId, unknown stage, or session not found | VERIFIED | Confirmed live: no-arg runs exit 1 with usage; `--from badstage` exits 1 with "Unknown stage" error        |
| 4  | Both tools work with AWS SDK default credential chain; no credentials hardcoded                    | VERIFIED   | Both use `DynamoDBClient({ region })` / `EventBridgeClient({ region })` with `process.env.AWS_REGION ?? 'us-east-1'`; no hardcoded creds |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                    | Expected                                    | Status     | Details                                                                                     |
|-----------------------------|---------------------------------------------|------------|---------------------------------------------------------------------------------------------|
| `tools/debug-pipeline.js`   | DynamoDB session pipeline status report     | VERIFIED   | 105 lines, substantive; GetCommand on `SESSION#<id>/METADATA`, 4 labeled print sections, fmt() helper, fmtPreview() for transcript/summary |
| `tools/replay-pipeline.js`  | EventBridge PutEvents for 4 pipeline stages | VERIFIED   | 154 lines, substantive; buildEntry() switch for recording-ended/mediaconvert/transcribe/summary, FailedEntryCount check, SQS latency note |

### Key Link Verification

| From                        | To                          | Via                                       | Status  | Details                                                                                                |
|-----------------------------|-----------------------------|-------------------------------------------|---------|--------------------------------------------------------------------------------------------------------|
| `tools/replay-pipeline.js`  | DynamoDB `vnl-sessions`     | `GetCommand` on `PK=SESSION#<id>, SK=METADATA` | WIRED | Line 119-122: `new GetCommand({ TableName: tableName, Key: { PK: \`SESSION#${sessionId}\`, SK: 'METADATA' } })` |
| `tools/replay-pipeline.js`  | EventBridge default bus     | `PutEventsCommand` with stage-specific Source/DetailType/Detail | WIRED | Lines 132-134: `ebClient.send(new PutEventsCommand({ Entries: [entry] }))` where entry built by buildEntry() |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                                      | Status    | Evidence                                                                                              |
|-------------|-------------|------------------------------------------------------------------------------------------------------------------|-----------|-------------------------------------------------------------------------------------------------------|
| DEVEX-01    | 35-01-PLAN  | debug-pipeline.js reads DynamoDB session record and prints all pipeline fields in human-readable report          | SATISFIED | tools/debug-pipeline.js: GetCommand + 4 grouped print sections covering all domain fields             |
| DEVEX-02    | 35-01-PLAN  | replay-pipeline.js publishes correct EventBridge event for 4 stages (recording-ended, mediaconvert, transcribe, summary) | SATISFIED | tools/replay-pipeline.js: buildEntry() switch covering all 4 stages with correct Source/DetailType   |
| DEVEX-03    | 35-01-PLAN  | Both tools use AWS SDK credential chain; read AWS_REGION from env or fall back to us-east-1                     | SATISFIED | Both files: `const region = process.env.AWS_REGION ?? 'us-east-1'`; no hardcoded credentials         |

All three DEVEX requirements are marked `[x]` in REQUIREMENTS.md and all are mapped to Phase 35. No orphaned requirements.

### Anti-Patterns Found

None. No TODO/FIXME/PLACEHOLDER comments, no stub return values, no empty handlers in either tool file.

### Human Verification Required

#### 1. Live AWS round-trip (debug-pipeline.js)

**Test:** Run `node tools/debug-pipeline.js --sessionId <real-session-id>` with valid AWS credentials.
**Expected:** Prints all four sections (Identity, Recording, Pipeline State, Upload Pipeline) with actual field values from DynamoDB; exits 0.
**Why human:** Requires live AWS credentials and a real session record; cannot be verified programmatically without network access.

#### 2. Live AWS round-trip (replay-pipeline.js)

**Test:** Run `node tools/replay-pipeline.js --sessionId <stuck-session-id> --from summary` with valid AWS credentials.
**Expected:** Prints "Event published to EventBridge default bus" with correct Stage/Source/Detail-Type; Lambda executes within ~20 seconds; session aiSummaryStatus updates in DynamoDB.
**Why human:** Requires live AWS credentials and a session with transcriptS3Path set; end-to-end pipeline trigger cannot be verified programmatically.

#### 3. recording-ended guard path

**Test:** Run `replay-pipeline.js --sessionId <session-without-recordingS3Path> --from recording-ended`.
**Expected:** Prints "ERROR: Session has no recordingS3Path. Cannot publish Recording Recovery event." and exits 1.
**Why human:** Requires a real DynamoDB session record that lacks `recordingS3Path`.

### Gaps Summary

No gaps. All four observable truths are verified, both artifacts are substantive and committed (commits a4f4566 and 8969e0f), both key links are wired with real SDK calls, all three DEVEX requirements are satisfied, and no anti-patterns were found.

The only remaining items are live AWS integration tests that require credentials and real session data — these are noted above as human verification items but do not block the phase goal.

---

_Verified: 2026-03-11T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
