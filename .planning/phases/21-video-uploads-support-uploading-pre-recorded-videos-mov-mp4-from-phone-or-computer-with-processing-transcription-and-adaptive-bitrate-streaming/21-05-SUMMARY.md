---
phase: 21-video-uploads-support-uploading-pre-recorded-videos-mov-mp4-from-phone-or-computer-with-processing-transcription-and-adaptive-bitrate-streaming
plan: 05
subsystem: api, infra
tags: [CDK, Lambda, API Gateway, S3, Cognito, upload, multipart]

# Dependency graph
requires:
  - phase: 21-video-uploads-support-uploading-pre-recorded-videos-mov-mp4-from-phone-or-computer-with-processing-transcription-and-adaptive-bitrate-streaming
    plan: 02
    provides: "Upload handler implementations (init-upload, get-part-presigned-url, complete-upload)"
  - phase: 21-video-uploads-support-uploading-pre-recorded-videos-mov-mp4-from-phone-or-computer-with-processing-transcription-and-adaptive-bitrate-streaming
    plan: 01
    provides: "Session model with UPLOAD type support"

provides:
  - "API Gateway routes for /upload/init, /upload/part-url, /upload/complete with Cognito auth"
  - "Lambda function definitions in CDK with proper IAM permissions and environment variables"
  - "S3 multipart upload integration for video file uploads"
  - "SNS publish permission for MediaConvert job triggering"

affects: ["21-06-frontend-upload-ui", "phase-22", "deployment"]

# Tech tracking
tech-stack:
  added: []
  patterns: ["NodejsFunction for handler bundling", "LambdaIntegration with Cognito authorizer", "Conditional IAM permissions via props validation"]

key-files:
  created: []
  modified:
    - "infra/lib/stacks/api-stack.ts"
    - "infra/bin/app.ts"
    - "infra/lib/stacks/session-stack.ts"

key-decisions:
  - "Export recordingsBucket and mediaConvertTopic from SessionStack to make them available to ApiStack"
  - "Use NodejsFunction with depsLockFilePath for consistent handler bundling across all upload functions"
  - "Conditional permission grants using if(props.recordingsBucket) pattern to handle optional props safely"
  - "All three upload endpoints protected by Cognito authorizer matching /sessions endpoint security model"

patterns-established:
  - "API Gateway resource creation: addResource() for path segments, addMethod() for HTTP verb and integration"
  - "Lambda environment variables via environment object on NodejsFunction constructor"
  - "Permission grants: grantReadWriteData for DynamoDB, grantReadWrite for S3, grantPublish for SNS"

requirements-completed:
  - "UPLOAD-04"
  - "UPLOAD-05"
  - "UPLOAD-06"

# Metrics
duration: 1min
completed: 2026-03-06
---

# Phase 21: Video Uploads — Plan 05 Summary

**Upload handlers integrated into API Gateway with Lambda functions, Cognito auth, and complete IAM permissions (init, part-url, complete endpoints)**

## Performance

- **Duration:** 1 min (plan already executed)
- **Started:** 2026-03-05T20:47:00Z
- **Completed:** 2026-03-05T20:47:23Z
- **Tasks:** 1 (all work completed in single commit)
- **Files modified:** 3

## Accomplishments

- All three upload handlers (init-upload, get-part-presigned-url, complete-upload) wired as Lambda functions in CDK
- API Gateway routes created for POST /upload/init, POST /upload/part-url, POST /upload/complete
- All endpoints protected with Cognito authorizer (consistent with existing /sessions endpoints)
- Complete IAM permissions: DynamoDB read/write, S3 read/write, SNS publish (complete-upload only)
- Environment variables correctly passed to all handlers: TABLE_NAME, RECORDINGS_BUCKET, MEDIACONVERT_TOPIC_ARN
- CDK synthesizes successfully with all three handlers bundled (verified via cdk synth)

## Task Commits

1. **Task 1: Create Lambda function definitions and wire upload handlers into API Gateway** - `be22219` (feat)

**Plan metadata:** (embedded in task commit — no separate docs commit needed as plan was already executed)

## Files Created/Modified

- `infra/lib/stacks/api-stack.ts` - Added NodejsFunction definitions for initUploadFunction, getPartPresignedUrlFunction, completeUploadFunction; created /upload API Gateway resource with sub-resources for init, part-url, complete; granted permissions
- `infra/lib/stacks/session-stack.ts` - Exported recordingsBucket and mediaConvertTopic as public properties to make them available to ApiStack
- `infra/bin/app.ts` - Added mediaConvertTopic prop to ApiStack constructor call

## Decisions Made

- **Export resources from SessionStack:** recordingsBucket and mediaConvertTopic needed to be exported from SessionStack so ApiStack can reference them when creating upload Lambda functions. This maintains separation of concerns while enabling cross-stack dependencies.
- **NodejsFunction bundling strategy:** Using NodejsFunction with depsLockFilePath ensures all handlers are bundled consistently with the same dependency resolution as the backend package.
- **Conditional S3 permission grants:** Used if (props.recordingsBucket) pattern to safely handle optional S3 bucket prop and only grant permissions when bucket is provided.
- **Cognito authorizer for all upload endpoints:** Matches existing pattern used for /sessions endpoints. All upload operations require authenticated user context.

## Deviations from Plan

None - plan executed exactly as written. All requirements met:
- ✓ NodejsFunction definitions created for all three handlers
- ✓ API Gateway resources created at correct paths (/upload/init, /upload/part-url, /upload/complete)
- ✓ DynamoDB, S3, and SNS permissions granted appropriately
- ✓ Cognito authorizer applied to all endpoints
- ✓ Environment variables correctly configured
- ✓ CDK synth successful with all handlers bundled

## Issues Encountered

None - implementation straightforward. CDK synthesized successfully on first attempt with all Lambda functions properly bundled and API Gateway integrations configured.

## Verification Completed

1. TypeScript compilation: `npx tsc --noEmit` - no errors
2. CDK synthesis: `npx cdk synth` - completed successfully
3. CloudFormation template inspection:
   - All three Lambda functions present: InitUploadFunction, GetPartPresignedUrlFunction, CompleteUploadFunction
   - All three API Gateway resources present: /upload/init, /upload/part-url, /upload/complete
   - All three POST methods configured with Cognito authorizer
   - Service roles and IAM permissions properly generated
4. Handler files confirmed present:
   - /backend/src/handlers/init-upload.ts (3.9kb, implements multipart upload initialization)
   - /backend/src/handlers/get-part-presigned-url.ts (2.6kb, generates presigned URLs for parts)
   - /backend/src/handlers/complete-upload.ts (4.7kb, completes upload and triggers MediaConvert)

## Next Phase Readiness

- Upload API infrastructure is complete and ready for frontend integration (Plan 21-06)
- All backend handlers deployed and accessible via authenticated endpoints
- MediaConvert topic wiring ready for Plan 21-03 event subscription
- No blockers identified

---

*Phase: 21-video-uploads-support-uploading-pre-recorded-videos-mov-mp4-from-phone-or-computer-with-processing-transcription-and-adaptive-bitrate-streaming*
*Plan: 05-api-gateway-wiring*
*Completed: 2026-03-06*
