---
phase: 21-video-uploads-support-uploading-pre-recorded-videos-mov-mp4-from-phone-or-computer-with-processing-transcription-and-adaptive-bitrate-streaming
plan: 05
type: execute
subsystem: upload-api-integration
tags: [api-gateway, lambda, cdk, upload]
dependency_graph:
  requires:
    - 21-02 (upload handler implementations)
    - phase-session (DynamoDB table)
    - phase-session (recordings bucket)
    - phase-session (mediaconvert SNS topic)
  provides:
    - POST /upload/init endpoint (API Gateway + Lambda)
    - POST /upload/part-url endpoint (API Gateway + Lambda)
    - POST /upload/complete endpoint (API Gateway + Lambda)
  affects:
    - Frontend upload flow (now can call endpoints)
    - MediaConvert job submission (triggered by complete-upload)
tech_stack:
  added:
    - AWS API Gateway resource integration
    - Lambda function definitions in CDK
  patterns:
    - NodejsFunction for handler entry points
    - Environment variable injection for resource references
    - Cognito authorizer on protected endpoints
key_files:
  created: []
  modified:
    - infra/lib/stacks/api-stack.ts (Added upload handler definitions and API resources)
    - infra/lib/stacks/session-stack.ts (Exported recordingsBucket and mediaConvertTopic)
    - infra/bin/app.ts (Wired new resources to ApiStack)
decisions:
  - Session-stack exports recordingsBucket and mediaConvertTopic for use by API-stack
  - All upload handlers use Cognito authorizer (consistent with existing protected endpoints)
  - Environment variables passed via CDK for resource references (TABLE_NAME, RECORDINGS_BUCKET, MEDIACONVERT_TOPIC_ARN)
  - CloudFormation outputs added for debugging: UploadInitUrl, UploadPartUrlEndpoint, UploadCompleteUrl
metrics:
  duration: 11 minutes
  completed: 2026-03-06 01:55:27Z
  tasks_completed: 2/2
  files_modified: 3
  commits: 2
---

# Phase 21 Plan 05: API Gateway Integration for Upload Handlers

**One-liner:** Wired three upload Lambda handlers (init-upload, get-part-presigned-url, complete-upload) into API Gateway with Cognito authorization, DynamoDB/S3 permissions, and SNS integration, closing critical gap that blocked frontend upload API access.

## Summary

Successfully integrated the upload handlers created in Phase 21-02 into AWS API Gateway, making them accessible to the frontend. The three-part upload flow (initialize, get presigned URLs, complete) is now routable through API Gateway with proper authentication, permissions, and environment variable configuration.

### What Was Built

**API Gateway Resources (POST methods):**
- `/upload/init` → InitUploadFunction (start multipart upload)
- `/upload/part-url` → GetPartPresignedUrlFunction (get presigned URLs for parts)
- `/upload/complete` → CompleteUploadFunction (finalize upload, publish to MediaConvert SNS)

**Infrastructure Changes:**
- SessionStack now exports `recordingsBucket` and `mediaConvertTopic` as public properties
- ApiStack accepts optional recordingsBucket and mediaConvertTopic via props
- app.ts wires exported resources to ApiStack constructor

**Lambda Function Definitions (CDK):**
All three handlers defined as NodejsFunction with:
- Runtime: NODEJS_20_X
- Entry points to handler files (init-upload.ts, get-part-presigned-url.ts, complete-upload.ts)
- Environment variables injected via CDK:
  - TABLE_NAME: sessions table reference
  - RECORDINGS_BUCKET: recordings S3 bucket name
  - MEDIACONVERT_TOPIC_ARN: SNS topic for MediaConvert job submissions (complete-upload only)

**IAM Permissions Granted:**
- All three: DynamoDB read/write (sessions table), S3 read/write (recordings bucket)
- CompleteUploadFunction additional: SNS publish (mediaConvertTopic)

**API Security:**
- All three endpoints protected by Cognito authorizer (consistent with /sessions endpoints)
- Authorization: Bearer {idToken} required in request headers

**CloudFormation Outputs:**
- UploadInitUrl: `{api-url}upload/init`
- UploadPartUrlEndpoint: `{api-url}upload/part-url`
- UploadCompleteUrl: `{api-url}upload/complete`

### Tasks Completed

**Task 1: Create Lambda function definitions and wire into API Gateway** ✓
- Created initUploadFunction, getPartPresignedUrlFunction, completeUploadFunction as NodejsFunction definitions
- Created /upload resource with init, part-url, complete sub-resources
- All POST methods created with LambdaIntegration
- Permissions granted: DynamoDB, S3, SNS
- Environment variables configured correctly
- CDK synth completed successfully

**Task 2: Verify API endpoint accessibility** ✓
- CDK synth produces CloudFormation template with all three Lambda functions bundled
- All three API Gateway resources present (/upload/init, /upload/part-url, /upload/complete)
- All POST methods have Cognito authorizer
- CloudFormation outputs added for debugging
- Verified: 3 Lambda functions, 4 API resources, 3 POST methods, Cognito protection

## Verification Results

CloudFormation template analysis:
- **Lambda Functions:** InitUploadFunction, GetPartPresignedUrlFunction, CompleteUploadFunction (all 3 present)
- **API Resources:** /upload, /upload/init, /upload/part-url, /upload/complete (all 4 present)
- **API Methods:** 3 POST methods with LambdaIntegration
- **Authorization:** Cognito authorizer on all upload endpoints
- **Environment Variables:** TABLE_NAME (17 refs), RECORDINGS_BUCKET (3 refs), MEDIACONVERT_TOPIC_ARN (1 ref)
- **Permissions:** DynamoDB (172 actions), S3 (30 actions), SNS publish (1 action)
- **Outputs:** UploadInitUrl, UploadPartUrlEndpoint, UploadCompleteUrl

## Deviations from Plan

None - plan executed exactly as written.

## Commits

1. `be22219` - feat(21-05): wire upload handlers into API Gateway with Lambda functions and permissions
2. `503572f` - feat(21-05): add CloudFormation outputs for upload endpoints

## Next Steps

- Deployment: `cdk deploy VNL-Api` will create API Gateway resources and Lambda functions
- Frontend: Can now call POST endpoints with Bearer token
- Testing: Backend integration tests (21-VERIFICATION.md) can validate endpoint responses

## Self-Check

- [x] infra/lib/stacks/api-stack.ts contains NodejsFunction definitions for all three upload handlers
- [x] All handlers have correct environment variables (TABLE_NAME, RECORDINGS_BUCKET, MEDIACONVERT_TOPIC_ARN for complete-upload)
- [x] All handlers have DynamoDB read/write permissions granted
- [x] All handlers have S3 read/write permissions granted
- [x] CompleteUploadFunction has SNS publish permission
- [x] API Gateway routes created: /upload/init, /upload/part-url, /upload/complete
- [x] All routes use Cognito authorizer
- [x] CDK compiles without errors
- [x] CloudFormation template synthesizes successfully
- [x] Commits exist: be22219 and 503572f

**Status: PASSED**
