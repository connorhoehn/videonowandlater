---
phase: quick-3
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/src/handlers/start-transcribe.ts
  - backend/src/handlers/__tests__/start-transcribe.test.ts
  - infra/lib/stacks/session-stack.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Start-transcribe handler triggers on Upload Recording Available events"
    - "Transcribe job is submitted with correct audio input from HLS recording"
    - "Job naming follows vnl-{sessionId}-{epochMs} convention"
  artifacts:
    - path: "backend/src/handlers/start-transcribe.ts"
      provides: "EventBridge handler for starting Transcribe jobs"
      min_lines: 100
    - path: "backend/src/handlers/__tests__/start-transcribe.test.ts"
      provides: "Test coverage for start-transcribe handler"
      min_lines: 120
  key_links:
    - from: "EventBridge Upload Recording Available"
      to: "start-transcribe handler"
      via: "EventBridge rule target"
    - from: "start-transcribe handler"
      to: "AWS Transcribe"
      via: "StartTranscriptionJob API call"
---

<objective>
Add the missing start-transcribe handler to complete the transcription pipeline

Purpose: Bridge the gap between MediaConvert completion and Transcribe job submission
Output: Working handler that starts Transcribe jobs when recordings are available
</objective>

<execution_context>
@/Users/connorhoehn/.claude/get-shit-done/workflows/execute-plan.md
@/Users/connorhoehn/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
The transcription pipeline is missing the critical start-transcribe handler. Currently:
- on-mediaconvert-complete publishes "Upload Recording Available" event with sessionId and recordingHlsUrl
- transcribe-completed handler exists and expects Transcribe jobs named vnl-{sessionId}-{epochMs}
- No handler exists to bridge these two components

Pattern from existing handlers:
- Job naming: vnl-{sessionId}-{epochMs} (seen in on-mediaconvert-complete and transcribe-completed)
- Event source: 'vnl.upload', DetailType: 'Upload Recording Available'
- HLS URL format: s3://{bucket}/hls/{sessionId}/master.m3u8
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create start-transcribe handler with tests</name>
  <files>backend/src/handlers/start-transcribe.ts, backend/src/handlers/__tests__/start-transcribe.test.ts</files>
  <behavior>
    - Test 1: Successfully starts Transcribe job for valid Upload Recording Available event
    - Test 2: Handles missing sessionId in event detail gracefully
    - Test 3: Handles Transcribe API errors without throwing
    - Test 4: Correctly formats job name as vnl-{sessionId}-{epochMs}
    - Test 5: Sets correct S3 output location for transcript
  </behavior>
  <action>
    Create an EventBridge handler that:
    1. Listens for events with source='vnl.upload' and DetailType='Upload Recording Available'
    2. Extracts sessionId and recordingHlsUrl from event detail
    3. Converts HLS URL to audio-only MP4 URL (replace /hls/ with /recordings/ and master.m3u8 with audio.mp4)
    4. Submits Transcribe job with:
       - JobName: vnl-{sessionId}-{Date.now()}
       - Media.MediaFileUri: the audio MP4 S3 URI
       - OutputBucketName: process.env.TRANSCRIPTION_BUCKET
       - OutputKey: {sessionId}/transcript.json
       - LanguageCode: 'en-US'
    5. Logs success/failure but doesn't throw (non-blocking pattern)

    Follow the error handling pattern from transcribe-completed.ts - wrap in try/catch, log errors, don't rethrow.
    Use @aws-sdk/client-transcribe for the Transcribe client.
  </action>
  <verify>
    <automated>cd backend && npm test -- start-transcribe</automated>
  </verify>
  <done>Handler created with 5+ passing tests, follows existing patterns</done>
</task>

<task type="auto">
  <name>Task 2: Wire handler to EventBridge in CDK</name>
  <files>infra/lib/stacks/session-stack.ts</files>
  <action>
    Add infrastructure for start-transcribe handler in session-stack.ts:

    1. Create Lambda function (after the transcribe-completed function, around line 500):
       ```typescript
       const startTranscribeFn = new nodejs.NodejsFunction(this, 'StartTranscribe', {
         runtime: lambda.Runtime.NODEJS_20_X,
         handler: 'handler',
         entry: path.join(__dirname, '../../../backend/src/handlers/start-transcribe.ts'),
         environment: {
           TABLE_NAME: this.table.tableName,
           TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
         },
         timeout: Duration.seconds(30),
         memorySize: 512,
       });
       ```

    2. Grant necessary permissions:
       - transcriptionBucket.grantReadWrite(startTranscribeFn)
       - recordingsBucket.grantRead(startTranscribeFn)
       - Grant Transcribe permissions via IAM statement

    3. Create EventBridge rule (after on-mediaconvert-complete rule):
       ```typescript
       const uploadRecordingAvailableRule = new events.Rule(this, 'UploadRecordingAvailableRule', {
         eventPattern: {
           source: ['vnl.upload'],
           detailType: ['Upload Recording Available'],
         },
         targets: [new targets.LambdaFunction(startTranscribeFn)],
         description: 'Start Transcribe job when recording is available',
       });
       ```

    4. Add IAM policy for Transcribe service:
       ```typescript
       startTranscribeFn.addToRolePolicy(new iam.PolicyStatement({
         actions: ['transcribe:StartTranscriptionJob'],
         resources: ['*'],
       }));
       ```
  </action>
  <verify>
    <automated>cd infra && npm run build</automated>
  </verify>
  <done>CDK builds successfully with new handler wired to EventBridge</done>
</task>

</tasks>

<verification>
After both tasks complete:
1. Backend tests pass for new handler
2. CDK builds without errors
3. Handler is properly wired to EventBridge rule
4. Permissions are correctly configured
</verification>

<success_criteria>
- start-transcribe handler exists with full test coverage
- Handler correctly processes Upload Recording Available events
- Infrastructure properly configured in CDK
- Pipeline gap is closed: MediaConvert → EventBridge → start-transcribe → Transcribe
</success_criteria>

<output>
After completion, create `.planning/quick/3-add-start-transcribe-handler-to-complete/3-SUMMARY.md`
</output>