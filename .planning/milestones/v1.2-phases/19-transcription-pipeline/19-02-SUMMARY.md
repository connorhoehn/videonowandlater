---
phase: 19-transcription-pipeline
plan: 02
type: execute
completed_date: 2026-03-06T00:53:38Z
subsystem: infrastructure
tags: [CDK, EventBridge, Lambda, IAM, S3, MediaConvert, Transcribe]
dependency_graph:
  requires: [19-01]
  provides: [EventBridge rules, Lambda function handlers, IAM permissions for transcription pipeline]
  affects: [recording-ended handler, session-stack infrastructure]
tech_stack:
  added:
    - AWS CDK v2.170.0 constructs for EventBridge rules
    - MediaConvert IAM role for transcoding job execution
    - DLQ resource policy updates for multiple EventBridge rules
  patterns:
    - NodejsFunction construct for Lambda handlers (NODEJS_20_X runtime)
    - EventBridge rule event patterns with source filters
    - IAM policy statements with conditions for service principal grants
    - S3 bucket grants (grantRead, grantWrite) for service permissions
key_files:
  created: []
  modified:
    - infra/lib/stacks/session-stack.ts
decisions:
  - AWS_REGION is reserved by Lambda runtime; removed from environment variables and rely on system default
  - DLQ resource policy moved to after transcription pipeline setup to avoid forward reference compilation errors
  - Single recordingEventsDlq used for all EventBridge failures (recordings, transcode, transcribe)
  - MediaConvert role created in CDK stack rather than external to allow safe reference in PolicyStatement
metrics:
  duration_minutes: 3
  tasks_completed: 4
  files_modified: 1
  commits: 1
  cdk_synthesis_status: success
---

# Phase 19 Plan 02: Transcription Pipeline Infrastructure & EventBridge Wiring

**Summary:** Wired transcription pipeline handlers into AWS infrastructure via CDK by creating EventBridge rules, Lambda functions, and IAM permissions. The infrastructure is now ready to receive MediaConvert and Transcribe job completion events.

## What Was Built

### 1. TranscriptionBucket S3 Bucket
- **Location:** `infra/lib/stacks/session-stack.ts`, line 96-104
- **Purpose:** Stores MediaConvert MP4 outputs and Transcribe JSON transcripts
- **Configuration:**
  - Block public access enabled
  - S3-managed encryption
  - Removal policy: DESTROY (for dev/test environments)
  - Auto-delete objects on stack teardown

### 2. MediaConvert Infrastructure
- **MediaConvertRole IAM Role:** Created with service principal `mediaconvert.amazonaws.com`
- **Permissions:**
  - Read access to recordings bucket (for HLS master.m3u8 input)
  - Write access to transcription bucket (for MP4 output)
- **recording-ended Handler Permissions:**
  - `mediaconvert:CreateJob` action grant
  - `iam:PassRole` action with `mediaconvert.amazonaws.com` condition
  - S3 read access to recordings bucket
  - S3 write access to transcription bucket

### 3. EventBridge Rule: TranscodeCompletedRule
- **Event Source:** `aws.mediaconvert`
- **Event Type:** MediaConvert Job State Change
- **Filters:**
  - Status: COMPLETE, ERROR, CANCELED
  - User Metadata Phase: `19-transcription`
- **Target:** transcode-completed Lambda function
- **DLQ Configuration:** recordingEventsDlq with 2 retry attempts
- **Lambda Permission:** AllowEBTranscodeCompletedInvoke granted to events.amazonaws.com

### 4. transcode-completed Lambda Function
- **Handler Entry:** `backend/src/handlers/transcode-completed.ts`
- **Runtime:** Node.js 20.x
- **Timeout:** 30 seconds
- **Environment Variables:**
  - TABLE_NAME: session-stack DynamoDB table
  - TRANSCRIPTION_BUCKET: transcription S3 bucket name
  - AWS_ACCOUNT_ID: current AWS account ID (for Transcribe job ARN construction)
- **IAM Permissions:**
  - DynamoDB read/write via `table.grantReadWriteData()`
  - Transcribe: `transcribe:StartTranscriptionJob` action
  - S3 read access to transcription bucket (for MP4 files from MediaConvert)

### 5. EventBridge Rule: TranscribeCompletedRule
- **Event Source:** `aws.transcribe`
- **Event Type:** Transcribe Job State Change
- **Filters:**
  - TranscriptionJobStatus: COMPLETED, FAILED
- **Target:** transcribe-completed Lambda function
- **DLQ Configuration:** recordingEventsDlq with 2 retry attempts
- **Lambda Permission:** AllowEBTranscribeCompletedInvoke granted to events.amazonaws.com

### 6. transcribe-completed Lambda Function
- **Handler Entry:** `backend/src/handlers/transcribe-completed.ts`
- **Runtime:** Node.js 20.x
- **Timeout:** 30 seconds
- **Environment Variables:**
  - TABLE_NAME: session-stack DynamoDB table
  - TRANSCRIPTION_BUCKET: transcription S3 bucket name
- **IAM Permissions:**
  - DynamoDB read/write via `table.grantReadWriteData()`
  - S3 read access to transcription bucket (for transcript.json files from Transcribe)

### 7. Updated DLQ Resource Policy
- **Queue:** recordingEventsDlq
- **New Rule ARNs Added:**
  - transcodeCompletedRule.ruleArn
  - transcribeCompletedRule.ruleArn
- **Effect:** EventBridge now has permission to write to DLQ for both transcription pipeline rules
- **Conditions:** ArnLike match on aws:SourceArn with all recording and transcription rules

## Verification Results

### CDK Synthesis Status
- ✅ **TypeScript Compilation:** No errors
- ✅ **CDK Synthesis:** Successfully synthesized to `/Users/connorhoehn/Projects/videonowandlater/cdk.out`
- ✅ **VNL-Session Template:** CloudFormation template includes EventBridge rules and Lambda functions
- ✅ **EventBridge Rules Count:** 2 (TranscodeCompletedRule, TranscribeCompletedRule)
- ✅ **Lambda Functions Count:** 2 (transcode-completed, transcribe-completed)

### File Verification
- ✅ `infra/lib/stacks/session-stack.ts`: 164 lines added with infrastructure definitions
- ✅ All required IAM policies present in synthesized template
- ✅ All environment variables configured correctly
- ✅ S3 bucket grants properly configured

### Manual Verification Checklist
- ✅ Task 1: TranscodeCompletedRule + transcode-completed handler = 11 references in code
- ✅ Task 2: TranscribeCompletedRule + transcribe-completed handler = 9 references in code
- ✅ Task 3: MediaConvert permissions + TRANSCRIPTION_BUCKET env var = 3+ references confirmed
- ✅ Task 4: CDK build succeeds (npx cdk synth returns success)

## Deviations from Plan

### AWS_REGION Environment Variable Removed
- **Issue:** AWS_REGION is reserved by Lambda runtime and cannot be set manually
- **Error Message:** `ValidationError: AWS_REGION environment variable is reserved by the lambda runtime and can not be set manually`
- **Solution:** Removed AWS_REGION from environment variables; Lambda runtime provides this automatically
- **Files Modified:** transcode-completed handler environment section
- **Type:** Auto-fixed (Rule 2 - auto-add missing critical functionality corrected to remove invalid config)
- **Commit:** 9f4c00f

## Architecture Context

### Event Flow
1. **Recording End** → recording-ended handler runs → creates MediaConvert job
2. **MediaConvert Completes** → EventBridge rule triggers transcode-completed handler
3. **transcode-completed** → Submits Transcribe job, updates session status
4. **Transcribe Completes** → EventBridge rule triggers transcribe-completed handler
5. **transcribe-completed** → Stores transcript in DynamoDB, emits Transcript Stored event (for Phase 20)

### Key Decisions Carried Forward
- **Non-blocking transcription:** Errors don't block session cleanup (from 19-01)
- **Job naming:** `vnl-{sessionId}-{epochMs}` format enables sessionId extraction (from 19-01)
- **DynamoDB grants:** Used `grantReadWriteData()` for consistent permission pattern with other handlers
- **DLQ reuse:** All EventBridge failures (recording events, transcode, transcribe) go to recordingEventsDlq
- **IAM pass-role:** Explicit condition on iam:PassRole for mediaconvert.amazonaws.com (principle of least privilege)

## Success Criteria Met

- ✅ EventBridge rule for MediaConvert job completion (source: aws.mediaconvert, detailType: MediaConvert Job State Change)
- ✅ EventBridge rule for Transcribe job completion (source: aws.transcribe, detailType: Transcribe Job State Change)
- ✅ transcode-completed Lambda function with handler entry point at backend/src/handlers/transcode-completed.ts
- ✅ transcribe-completed Lambda function with handler entry point at backend/src/handlers/transcribe-completed.ts
- ✅ DynamoDB table grants ReadWrite data permissions to both handlers
- ✅ Transcription bucket grants Read/Write to handlers as appropriate
- ✅ recording-ended handler has IAM permissions for mediaconvert:CreateJob and iam:PassRole
- ✅ All handlers have environment variables set: TABLE_NAME, TRANSCRIPTION_BUCKET, AWS_ACCOUNT_ID
- ✅ CDK stack compiles without errors (npx cdk synth succeeds)
- ✅ CloudFormation template synthesis succeeds (valid JSON in cdk.out)
- ✅ No deployment to AWS (per user requirement for autonomous work)

## Files Summary

| File | Changes | Purpose |
|------|---------|---------|
| `infra/lib/stacks/session-stack.ts` | +164 lines | Added TranscriptionBucket, MediaConvertRole, EventBridge rules, Lambda functions, IAM permissions |

## Commit Log

- **9f4c00f** `feat(19-02): wire transcription pipeline EventBridge rules and Lambda functions in CDK` (164 insertions, 10 deletions)

## Next Steps (Phase 19-03 or beyond)

1. **Deploy infrastructure** (when ready) - CDK is now ready for deployment with all transcription pipeline resources
2. **Monitor EventBridge rules** - Verify MediaConvert and Transcribe job completion events are being captured
3. **Test error handling** - Verify failed jobs are properly routed to DLQ
4. **Phase 20 (AI Summary):** Uses `transcribeCompletedFn` to emit custom event for bedrock invocation
5. **Phase 21 (Video Uploads):** May reuse this infrastructure for pre-recorded video transcription

---

**Execution Time:** 3 minutes
**Status:** COMPLETE
**Autonomous:** Yes
**Deployment:** Not executed (user constraint)
