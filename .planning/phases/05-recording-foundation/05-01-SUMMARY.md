---
phase: 05-recording-foundation
plan: 01
subsystem: recording-infrastructure
tags: [infrastructure, ivs, s3, cloudfront, recording, cdk]
dependency_graph:
  requires: []
  provides: [recording-s3-bucket, cloudfront-distribution, recording-configuration, recording-events]
  affects: [session-domain, session-stack]
tech_stack:
  added: [aws-ivs-recording, cloudfront-oac, s3-encryption]
  patterns: [eventbridge-lifecycle, cdk-l1-constructs]
key_files:
  created:
    - .planning/phases/05-recording-foundation/deferred-items.md
  modified:
    - infra/lib/stacks/session-stack.ts
    - infra/lib/stacks/api-stack.ts
    - backend/src/domain/session.ts
decisions:
  - title: CloudFront OAC over OAI
    rationale: OAC is the modern AWS-recommended approach for S3 origins, OAI is deprecated
    impact: Secure recordings distribution without public bucket access
  - title: Flat recording fields on Session interface
    rationale: Per CONTEXT.md decision, avoid nested objects for simpler DynamoDB mapping
    impact: Recording metadata stored as top-level optional fields
  - title: Multi-rendition recording with HD thumbnails
    rationale: Enables adaptive bitrate playback and visual preview generation
    impact: Better playback experience, storage costs for multiple renditions
  - title: EventBridge rules created without targets
    rationale: Lambda handlers will be created in Plan 05-02, targets wired then
    impact: Clean separation between infrastructure and handler implementation
metrics:
  tasks_completed: 2
  tasks_planned: 2
  duration_minutes: 3
  commits: 2
  files_modified: 3
  deviations: 1
  completed_at: "2026-03-03T00:57:27Z"
---

# Phase 05 Plan 01: Recording Infrastructure Summary

**One-liner:** S3 bucket, CloudFront distribution with OAC, IVS RecordingConfiguration, EventBridge lifecycle rules, and Session domain extended with recording metadata fields.

## Objective Achievement

Created foundational AWS infrastructure for automatic session recording with secure playback and extended Session domain model to support recording lifecycle tracking.

**Status:** Complete - All tasks executed successfully

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create Recording Infrastructure in SessionStack | 23d9374 | infra/lib/stacks/session-stack.ts, infra/lib/stacks/api-stack.ts |
| 2 | Extend Session Domain with Recording Metadata | 0da74d6 | backend/src/domain/session.ts |

## Infrastructure Created

### S3 Bucket for Recordings
- **Name:** `vnl-recordings-vnl-session` (uses stack name pattern)
- **Security:** Block all public access, S3-managed encryption
- **Lifecycle:** RemovalPolicy.DESTROY with autoDeleteObjects (consistent with dev environment)
- **Region:** us-east-1 (same as IVS resources per PROJECT.md)

### CloudFront Distribution
- **Purpose:** Secure playback of recordings via HTTPS
- **Security:** Origin Access Control (OAC) with sigv4 signing - modern replacement for deprecated OAI
- **Cache:** CACHING_OPTIMIZED policy (recordings are immutable)
- **Protocol:** REDIRECT_TO_HTTPS viewer policy
- **Access:** S3 bucket policy grants CloudFront GetObject via distribution ARN condition

### IVS RecordingConfiguration
- **Destination:** S3 bucket configured above
- **Thumbnails:**
  - Recording mode: INTERVAL
  - Target interval: 10 seconds (enables visual preview generation)
  - Resolution: HD
- **Renditions:** HD, SD, LOWEST_RESOLUTION (adaptive bitrate playback support)
- **Export:** ARN exported as stack output `vnl-recording-config-arn`

### EventBridge Lifecycle Rules
- **Recording Start Rule:** Captures IVS Recording State Change events with `event_name: Recording Start`
- **Recording End Rule:** Captures IVS Recording State Change events with `event_name: Recording End`
- **Integration:** Rules created as class properties for Lambda target attachment in Plan 05-02
- **Note:** Targets intentionally not added yet - handlers will be created in next plan

### Stack Outputs
- `vnl-recording-config-arn`: IVS RecordingConfiguration ARN for channel attachment
- `vnl-recordings-domain`: CloudFront domain name for HLS manifest and thumbnail URLs

## Session Domain Extensions

### RecordingStatus Enum
```typescript
export enum RecordingStatus {
  PENDING = 'pending',      // Session created but recording not started
  PROCESSING = 'processing', // Recording in progress or finalizing
  AVAILABLE = 'available',   // Recording complete and ready
  FAILED = 'failed',        // Recording encountered an error
}
```

### Session Interface Fields
All fields optional (sessions don't have recordings until stream starts):

| Field | Type | Purpose |
|-------|------|---------|
| recordingS3Path | string | S3 key prefix from IVS (e.g., "ivs/v1/123456/2026/3/2/...") |
| recordingDuration | number | Duration in milliseconds from IVS Recording End event |
| thumbnailUrl | string | CloudFront URL for first thumbnail (HD resolution) |
| recordingHlsUrl | string | CloudFront URL for HLS manifest (master.m3u8) |
| recordingStatus | RecordingStatus | Recording lifecycle state |

**Design rationale:** Flat fields on Session interface (not nested object) per CONTEXT.md decision for simpler DynamoDB attribute mapping.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect iam.PolicyStatement import in api-stack.ts**
- **Found during:** Task 1 - CDK build verification
- **Issue:** TypeScript error - `apigateway.aws_iam.PolicyStatement` does not exist (line 166)
- **Root cause:** Incorrect namespace usage - `iam` module already imported but not used
- **Fix:** Changed `new apigateway.aws_iam.PolicyStatement` to `new iam.PolicyStatement`
- **Files modified:** infra/lib/stacks/api-stack.ts
- **Commit:** 23d9374 (included in Task 1 commit)
- **Impact:** No functional change - corrected import usage for existing IVS GetStream permission grant

## Integration Points for Plan 05-02

### EventBridge Rule Properties (for Lambda Target Attachment)
The following EventBridge rules are exposed as public class properties on SessionStack:

```typescript
public readonly recordingStartRule: events.Rule;
public readonly recordingEndRule: events.Rule;
```

**Usage in Plan 05-02:**
```typescript
// In handler creation code
sessionStack.recordingStartRule.addTarget(
  new targets.LambdaFunction(recordingStartHandler)
);
sessionStack.recordingEndRule.addTarget(
  new targets.LambdaFunction(recordingEndHandler)
);
```

### Environment Variables for Handlers
Lambda functions in Plan 05-02 will need:
- `TABLE_NAME`: From existing `sessionStack.table.tableName`
- `CLOUDFRONT_DOMAIN`: From new CloudFront distribution domain
- `RECORDINGS_BUCKET`: From new S3 bucket name

### IAM Permissions Granted
Existing Lambda functions now have S3 read access to recordings bucket:
- streamStartedFn: Can read recording metadata files
- recordingEndedFn: Can read recording metadata files

New handlers in Plan 05-02 will need additional permissions:
- DynamoDB write access (update Session items with recording fields)
- S3 GetObject access to recording metadata JSON files

## Verification Results

All success criteria met:

- ✅ CDK synth produces CloudFormation template with 4+ new resources (S3, CloudFront, RecordingConfiguration, EventBridge rules)
- ✅ RecordingConfiguration ARN and CloudFront domain exported as stack outputs
- ✅ Session.ts exports RecordingStatus enum with 4 states
- ✅ Session interface includes recordingS3Path, recordingDuration, thumbnailUrl, recordingHlsUrl, recordingStatus fields
- ✅ Infra package builds successfully (TypeScript compilation succeeds)
- ✅ Session.ts compiles successfully (verified in isolation)

**Note:** Full backend package has pre-existing TypeScript errors in test files and session-repository.ts unrelated to Session domain changes. These are documented in deferred-items.md as out-of-scope issues.

## Known Issues / Blockers

None. Plan executed successfully with one auto-fixed bug (pre-existing TypeScript error in api-stack.ts).

## Next Steps (Plan 05-02)

1. Create Lambda handler for Recording Start events
   - Parse IVS event, extract recording metadata
   - Update Session item with recordingStatus: PROCESSING, recordingS3Path
   - Generate thumbnailUrl using CloudFront domain

2. Create Lambda handler for Recording End events
   - Parse IVS event, extract duration and final S3 path
   - Update Session item with recordingStatus: AVAILABLE, recordingDuration, recordingHlsUrl
   - Handle failed recordings (recordingStatus: FAILED)

3. Wire Lambda targets to EventBridge rules created in this plan

4. Add unit tests for recording lifecycle state transitions

## References

- Plan file: `.planning/phases/05-recording-foundation/05-01-PLAN.md`
- Research: `.planning/phases/05-recording-foundation/05-RESEARCH.md`
- Context: `.planning/phases/05-recording-foundation/05-CONTEXT.md`
- AWS IVS Recording: https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_RecordingConfiguration.html
- CloudFront OAC: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html

## Self-Check: PASSED

All claimed files and commits verified:
- ✅ FOUND: infra/lib/stacks/session-stack.ts
- ✅ FOUND: backend/src/domain/session.ts
- ✅ FOUND: deferred-items.md
- ✅ FOUND: commit 23d9374 (Task 1)
- ✅ FOUND: commit 0da74d6 (Task 2)
