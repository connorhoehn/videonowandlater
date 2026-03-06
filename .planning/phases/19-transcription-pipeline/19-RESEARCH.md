# Phase 19: Transcription Pipeline - Research

**Researched:** 2026-03-06
**Domain:** AWS Transcribe + MediaConvert integration, EventBridge-driven async pipelines, DynamoDB session augmentation
**Confidence:** HIGH

## Summary

Phase 19 implements an automated transcription pipeline triggered when IVS recordings become available. The critical blocker identified in STATE.md — HLS/MediaConvert format compatibility — is confirmed: **Amazon Transcribe does NOT accept HLS M3U8 playlists directly**. IVS stores recordings as HLS fMP4 segments, requiring conversion to MP4 format via AWS MediaConvert before transcription can begin. The architecture is serial: `recording-ended` → MediaConvert job start → Transcribe job start → EventBridge completion → transcript parsing → DynamoDB storage.

**Primary recommendation:** Extend `recording-ended.ts` handler to submit MediaConvert job using IVS HLS master playlist as input. Attach job name encoding (format: `vnl-{sessionId}-{epochMs}`) to enable correlation in Transcribe completion handler without extra DynamoDB reads. Use EventBridge rules for both MediaConvert completion → Transcribe start and Transcribe completion → transcript storage.

## User Constraints

No CONTEXT.md exists for this phase. All research decisions are available for planner discretion.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRNS-01 | Transcribe job auto-starts when recording available in S3 | MediaConvert required as intermediary; Transcribe inputs validated (MP4 required); EventBridge integration enables automation |
| TRNS-02 | Transcription job name encodes session ID for correlation | Transcribe API confirms custom TranscriptionJobName field; format `vnl-{sessionId}-{epochMs}` eliminates need for job lookup |
| TRNS-03 | Transcript text stored on session record when job completes | EventBridge "Transcribe Job State Change" event includes TranscriptionJobName; JSON output includes `results.transcripts[0].transcript` plain text |
| TRNS-04 | Transcription failures recorded without blocking pool release | recording-ended.ts already uses non-blocking error pattern for related operations; add `transcriptStatus: failed` field to session record on job failure |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| AWS Transcribe | Current (boto3, Node SDK) | Batch speech-to-text service | Official AWS standard for async transcription; managed service, no infrastructure |
| AWS MediaConvert | Current (Node SDK) | Video format conversion (HLS → MP4) | Only AWS service supporting HLS-to-MP4 conversion; battle-tested for IVS workflows |
| AWS EventBridge | Current (CDK native) | Event routing and correlation | Already in use for IVS lifecycle events; triggers Lambda handlers asynchronously |
| AWS Lambda | Node.js 20.x | Event handlers and orchestration | Existing compute platform; low latency for metadata updates |
| AWS DynamoDB | Existing single table | Transcript and status storage | Session record already stored here; reuse existing table and access patterns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| AWS SDK for JavaScript (@aws-sdk) | @aws-sdk/client-transcribe | Transcribe API client (StartTranscriptionJob, GetTranscriptionJob) | Submitting jobs and querying status in Lambda handlers |
| AWS SDK for JavaScript (@aws-sdk) | @aws-sdk/client-mediaconvert | MediaConvert API client (CreateJob) | Submitting HLS→MP4 conversion jobs from recording-ended handler |
| AWS SDK for JavaScript (@aws-sdk) | @aws-sdk/lib-dynamodb | DynamoDB document client | Existing pattern; used throughout backend for session updates |

## Architecture Patterns

### Recommended Pipeline Flow

```
IVS recording-ended event
  ↓
[recording-ended Lambda handler]
  ├─ Update session: ENDING → ENDED
  ├─ Store recording metadata (HLS URL, duration, thumbnail)
  ├─ Release pool resources
  ├─ Aggregate reaction summary (existing, Phase 17)
  ├─ **NEW: Submit MediaConvert job**
  │    ├─ Input: s3://ivs-bucket/{prefix}/media/hls/master.m3u8
  │    ├─ Output: s3://transcription-bucket/{sessionId}/recording.mp4
  │    ├─ Job name: vnl-{sessionId}-{epochMs}
  │    └─ Return: MediaConvert job ID for tracking
  └─ Log success or failure (errors non-blocking)
       ↓
[MediaConvert job completes] (2-5 min typical)
  ↓
[EventBridge: MediaConvert Job State Change → COMPLETE]
  ↓
[transcode-completed Lambda handler] **NEW**
  ├─ Extract MediaConvert output MP4 S3 path
  ├─ Parse job name to get sessionId
  ├─ Submit Transcribe StartTranscriptionJob
  │    ├─ Input: s3://transcription-bucket/{sessionId}/recording.mp4
  │    ├─ Job name: vnl-{sessionId}-{epochMs}  (reuse MediaConvert job name pattern)
  │    ├─ Output location: s3://transcription-bucket/{sessionId}/
  │    └─ Media format: MP4
  └─ Log job submission
       ↓
[Transcribe job processes] (1-10 min, depends on duration)
  ↓
[EventBridge: Transcribe Job State Change → COMPLETED or FAILED]
  ↓
[transcribe-completed Lambda handler] **NEW**
  ├─ Extract TranscriptionJobName from event
  ├─ Parse sessionId from job name
  ├─ If COMPLETED:
  │    ├─ Fetch transcript JSON from s3://transcription-bucket/{sessionId}/transcript.json
  │    ├─ Parse `results.transcripts[0].transcript` plain text
  │    ├─ Update session record:
  │    │    ├─ transcriptS3Path: s3://transcription-bucket/{sessionId}/transcript.json
  │    │    ├─ transcriptStatus: "available"
  │    │    └─ transcript: <plain text> (optional, for immediate display)
  │    └─ Trigger AI Summary pipeline (Phase 20)
  └─ If FAILED:
       ├─ Log FailureReason from event detail
       └─ Update session: transcriptStatus: "failed" (non-blocking)
```

### Session Record Augmentation

Add fields to Session domain model in `backend/src/domain/session.ts`:

```typescript
export interface Session {
  // ... existing fields ...

  // Transcription pipeline fields (Phase 19)
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  transcriptS3Path?: string;
  transcript?: string;  // Optional: plain text of full transcript

  // AI Summary fields (Phase 20, prepared here)
  aiSummaryStatus?: 'pending' | 'processing' | 'available' | 'failed';
  aiSummary?: string;
}
```

### Error Handling Pattern (Non-Blocking)

Recording-ended handler pattern is the standard for this codebase. Phase 19 extends it:

```typescript
// In recording-ended.ts, after releasing pool resources:

try {
  await submitMediaConvertJob(tableName, sessionId, recordingS3KeyPrefix);
  console.log('MediaConvert job submitted:', sessionId);
} catch (error: any) {
  console.error('Failed to submit MediaConvert job (non-blocking):', error.message);
  // Do NOT throw — transcription is best-effort, don't block session cleanup
  // Record failure status is logged to CloudWatch for monitoring
}
```

New handlers follow the same pattern: errors logged, `transcriptStatus` set to "failed", no exception propagated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HLS-to-MP4 conversion | Custom FFmpeg Lambda layer with stream downloading | AWS MediaConvert service | MediaConvert handles fragmented MP4 reassembly, bitrate optimization, codec negotiation; hand-rolled FFmpeg requires managing binary dependencies, memory limits (512 MB max for Lambda layers), and complex stream reassembly |
| Transcription engine | Custom Whisper/Deepgram integration or Lambda-based transcription | Amazon Transcribe managed service | Transcribe is domain-optimized for 100+ languages, custom vocabulary, speaker partitioning; hand-rolled solution requires model hosting, scaling, and maintenance |
| Job status tracking | Polling Transcribe API every N seconds | EventBridge events for state changes | Polling scales poorly (API throttling, cost), adds latency (5-30 min delay); EventBridge events fire within seconds of state change with no polling overhead |
| Transcript parsing | Regex or custom JSON parsing | AWS SDK Transcribe output deserialization | Official output structure is guaranteed stable; custom parsing breaks on schema changes |
| Session correlation | DynamoDB lookup on Transcribe job name | Encode sessionId in job name | Eliminates extra DynamoDB read per job completion; job names are unique per account, safe for encoding metadata |

**Key insight:** Phase 19 is integration-focused, not computation-focused. Every custom component adds operational debt. Use managed services for transcription and conversion; Lambda only orchestrates between services.

## Common Pitfalls

### Pitfall 1: Using Individual HLS Segments Instead of Master Playlist

**What goes wrong:** Developer extracts an individual fMP4 segment from the HLS folder (e.g., `segment-00001.m4s`) and tries to transcribe it. Transcribe accepts it but produces a partial transcript — only audio from that 10-second segment, missing 90% of the session.

**Why it happens:** HLS manifests are confusing. The temptation is to find a complete media file rather than assembling from manifest. Also saves a MediaConvert step (incorrectly).

**How to avoid:** Always convert via MediaConvert. Use IVS recording metadata file (`recording-ended.json`) to locate the master.m3u8 URL. Validate input path in test environment before deploying.

**Warning signs:** Transcripts are consistently 2-3% of expected length. Check CloudWatch logs for MediaConvert skipped step.

### Pitfall 2: Forgetting to Set OutputBucketName in Transcribe Job

**What goes wrong:** StartTranscriptionJob omits or misconfigures the OutputBucketName. Job completes but transcript JSON is not written to expected S3 path. Lambda handler tries to fetch from S3, gets 404, and transcriptStatus never transitions to "available".

**Why it happens:** AWS SDK documentation lists OutputBucketName as optional (defaults to regional Transcribe bucket), but it's required for reliable output location. Default bucket is not guaranteed to be accessible from Lambda.

**How to avoid:** Always explicitly set OutputBucketName to a bucket you control. Test S3 write permissions in local test before deployment. Log the exact S3 path in job submission.

**Warning signs:** Transcribe job shows COMPLETED in CloudWatch Events, but transcript is missing from expected S3 location.

### Pitfall 3: Job Name Encoding Limits (Max 200 characters)

**What goes wrong:** Format string `vnl-{sessionId}-{epochMs}-{metadata}-{more-data}` exceeds 200-character limit. StartTranscriptionJob or CreateJob fails with validation error, but error message is vague.

**Why it happens:** Developers pack too much metadata into job names thinking "let's be comprehensive". Epoch milliseconds alone add 13 chars; sessionId adds ~12; prefix adds 4. Overhead reduces available space.

**How to avoid:** Use minimal format: `vnl-{sessionId}-{epochMs}` (4 + 36 + 1 + 13 = 54 chars max). Reserve rest for future flexibility. Test with actual max-length sessionIds.

**Warning signs:** Job submission fails with `InvalidParameterException` about length. Check CloudWatch logs for exact error.

### Pitfall 4: MediaConvert Output Overwriting / Collision

**What goes wrong:** Multiple concurrent sessions submit MediaConvert jobs with overlapping output S3 paths. Second job overwrites first job's MP4. Lambda fetches output but gets wrong file.

**Why it happens:** Lazy output path design: `s3://bucket/output.mp4` instead of `s3://bucket/{sessionId}/output.mp4`.

**How to avoid:** **Always include sessionId in output paths.** Format: `s3://transcription-bucket/{sessionId}/recording.mp4`. Same for Transcribe output.

**Warning signs:** Transcript text doesn't match session duration. Check S3 bucket for duplicate filenames and timestamps.

### Pitfall 5: Assuming All Transcribe Failures are Retryable

**What goes wrong:** Lambda catches Transcribe job failure and logs it, but transcriptStatus is never set to "failed" because code assumes failure is temporary. Session appears stuck in "transcription processing" forever.

**Why it happens:** Some errors are retryable (service throttle, transient network), others are permanent (invalid audio format, unsupported language). Code tries to retry all.

**How to avoid:** On EventBridge Transcribe Job State Change event with status FAILED, immediately set transcriptStatus to "failed" and log FailureReason. Don't retry in handler — if AWS Transcribe service already retried internally, handler retry wastes time.

**Warning signs:** Monitoring shows sessions with transcriptStatus stuck in "processing" for hours. Check CloudWatch Logs for FailureReason field.

### Pitfall 6: Missing IAM Permissions for MediaConvert/Transcribe Output Buckets

**What goes wrong:** MediaConvert job fails silently (no output written) because Lambda's execution role lacks s3:PutObject on the output bucket. Transcribe job completes but transcript isn't written to S3.

**Why it happens:** Permission policies are overly restrictive or output bucket is different from input bucket (common in multi-account setups).

**How to avoid:** Lambda execution role must have:
- `s3:GetObject` on input bucket (IVS recordings bucket)
- `s3:PutObject` on output bucket (transcription bucket)
- `transcribe:StartTranscriptionJob` and `mediaconvert:CreateJob` service permissions
Test permission boundaries in development before production.

**Warning signs:** MediaConvert job shows COMPLETED but no MP4 in S3. Transcribe job shows COMPLETED but no JSON in S3. CloudWatch Logs show AccessDenied errors.

## Code Examples

### Example 1: MediaConvert Job Submission (in recording-ended.ts)

**Source:** Pattern from [AWS media services VOD automation](https://github.com/aws-samples/aws-media-services-vod-automation), adapted for IVS HLS inputs

```typescript
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';

async function submitMediaConvertJob(
  sessionId: string,
  recordingS3KeyPrefix: string,
  recordingsBucket: string
): Promise<string> {
  const epochMs = Date.now();
  const jobName = `vnl-${sessionId}-${epochMs}`;

  const mediaConvertClient = new MediaConvertClient({ region: process.env.AWS_REGION });

  const command = new CreateJobCommand({
    JobTemplate: 'Default', // Or create a saved job template
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${recordingsBucket}/${recordingS3KeyPrefix}/media/hls/master.m3u8`,
          // HLS manifest is the input; MediaConvert reads fMP4 segments referenced by manifest
          AudioSelectors: {
            default: {
              DefaultSelection: 'DEFAULT',
            },
          },
          VideoSelectors: {
            default: {},
          },
        },
      ],
      OutputGroups: [
        {
          Name: 'File Group',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `s3://${transcriptionBucket}/${sessionId}/`, // Output folder
              DestinationSettings: {
                S3Settings: {
                  AccessControl: 'PRIVATE',
                  CannedAcl: 'PRIVATE',
                },
              },
            },
          },
          Outputs: [
            {
              NameModifier: 'recording', // Output: {sessionId}/recording.mp4
              ContainerSettings: {
                Container: 'MP4',
              },
              VideoDescription: {
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    MaxBitrate: 5000000, // 5 Mbps
                    RateControlMode: 'VBR',
                    CodecProfile: 'MAIN',
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: 'CODING_MODE_2_0', // Stereo
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    Role: process.env.MEDIACONVERT_ROLE_ARN,
    Queue: `arn:aws:mediaconvert:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:queues/Default`,
    Tags: {
      sessionId,
      phase: '19-transcription',
    },
  });

  const result = await mediaConvertClient.send(command);
  console.log('MediaConvert job created:', {
    jobId: result.Job?.Id,
    jobName,
    sessionId,
  });

  return result.Job?.Id || '';
}
```

### Example 2: Transcribe Job Submission (in transcode-completed.ts handler)

**Source:** AWS Transcribe API documentation

```typescript
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

async function submitTranscribeJob(
  sessionId: string,
  recordingS3Path: string  // e.g., s3://bucket/{sessionId}/recording.mp4
): Promise<void> {
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET || 'vnl-transcription';
  const epochMs = Date.now();
  const jobName = `vnl-${sessionId}-${epochMs}`;

  const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });

  const command = new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: {
      MediaFileUri: recordingS3Path, // s3://bucket/sessionId/recording.mp4
    },
    MediaFormat: 'mp4',
    LanguageCode: 'en-US',  // Support additional languages in Phase 20
    OutputBucketName: transcriptionBucket,
    OutputKey: `${sessionId}/transcript.json`,  // Explicit output path
    Settings: {
      VocabularyName: undefined,  // Optional: can be added later for domain-specific terms
      ShowAlternatives: false,
      MaxSpeakerLabels: 12, // For hangouts with up to 12 participants
      ShowSpeakerLabels: false, // Disable for v1.2; enable in Phase 20 if needed for AI summary
    },
  });

  const result = await transcribeClient.send(command);
  console.log('Transcribe job started:', {
    jobName: result.TranscriptionJob?.TranscriptionJobName,
    sessionId,
    status: result.TranscriptionJob?.TranscriptionJobStatus,
  });
}
```

### Example 3: EventBridge Rule for Transcribe Completion (in CDK session-stack.ts)

**Source:** EventBridge pattern from existing session-stack.ts, Transcribe integration patterns from AWS docs

```typescript
// In session-stack.ts, after recordingEndRule setup

// EventBridge rule for MediaConvert job completion
const transcodeCompletedRule = new events.Rule(this, 'TranscodeCompletedRule', {
  eventPattern: {
    source: ['aws.mediaconvert'],
    detailType: ['MediaConvert Job State Change'],
    detail: {
      status: ['COMPLETE', 'ERROR', 'CANCELED'],
      userMetadata: {
        phase: ['19-transcription'], // Filter to transcription pipeline jobs
      },
    },
  },
  description: 'Submit Transcribe job when MediaConvert completes',
});

const transcodeCompletedFn = new nodejs.NodejsFunction(this, 'TranscodeCompleted', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/transcode-completed.ts'),
  timeout: Duration.seconds(30),
  environment: {
    TABLE_NAME: this.table.tableName,
    TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
  },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});

this.table.grantReadWriteData(transcodeCompletedFn);
transcribeClient.grantStartTranscriptionJob(transcodeCompletedFn);

transcodeCompletedRule.addTarget(new targets.LambdaFunction(transcodeCompletedFn, {
  deadLetterQueue: recordingEventsDlq,
  retryAttempts: 2,
}));

transcodeCompletedFn.addPermission('AllowEBTranscodeCompletedInvoke', {
  principal: new iam.ServicePrincipal('events.amazonaws.com'),
  sourceArn: transcodeCompletedRule.ruleArn,
});

// EventBridge rule for Transcribe job completion
const transcribeCompletedRule = new events.Rule(this, 'TranscribeCompletedRule', {
  eventPattern: {
    source: ['aws.transcribe'],
    detailType: ['Transcribe Job State Change'],
    detail: {
      TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
    },
  },
  description: 'Update session with transcript when Transcribe completes',
});

const transcribeCompletedFn = new nodejs.NodejsFunction(this, 'TranscribeCompleted', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/transcribe-completed.ts'),
  timeout: Duration.seconds(30),
  environment: {
    TABLE_NAME: this.table.tableName,
    TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
  },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});

this.table.grantReadWriteData(transcribeCompletedFn);
transcriptionBucket.grantRead(transcribeCompletedFn);

transcribeCompletedRule.addTarget(new targets.LambdaFunction(transcribeCompletedFn, {
  deadLetterQueue: recordingEventsDlq,
  retryAttempts: 2,
}));

transcribeCompletedFn.addPermission('AllowEBTranscribeCompletedInvoke', {
  principal: new iam.ServicePrincipal('events.amazonaws.com'),
  sourceArn: transcribeCompletedRule.ruleArn,
});
```

### Example 4: Parsing Transcribe Output JSON (in transcribe-completed.ts)

**Source:** AWS Transcribe output structure from API documentation

```typescript
interface TranscribeOutput {
  jobName: string;
  accountId: string;
  status: 'COMPLETED' | 'FAILED';
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
    items: Array<{
      start_time?: string;
      end_time?: string;
      alternatives: Array<{
        confidence: string;
        content: string;
      }>;
      type: 'pronunciation' | 'punctuation';
    }>;
  };
}

async function fetchAndParseTranscript(s3Path: string): Promise<string> {
  const s3Client = new S3Client({ region: process.env.AWS_REGION });

  // s3Path format: s3://bucket/sessionId/transcript.json
  const [bucket, ...keyParts] = s3Path.replace('s3://', '').split('/');
  const key = keyParts.join('/');

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  const bodyString = await response.Body?.transformToString();
  const transcribeOutput: TranscribeOutput = JSON.parse(bodyString || '{}');

  // Extract plain text transcript
  const plainText = transcribeOutput.results?.transcripts?.[0]?.transcript || '';

  console.log('Parsed transcript:', {
    length: plainText.length,
    words: plainText.split(' ').length,
  });

  return plainText;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual transcription outsourcing | Automated AWS Transcribe in pipeline | 2020+ (AWS Transcribe GA) | Reduces latency from days to hours; enables real-time API integration |
| Custom FFmpeg layer for HLS conversion | AWS MediaConvert service | 2018+ (MediaConvert launch) | Eliminates Lambda binary management; handles codec negotiation and optimization |
| Polling Transcribe API every 30s | EventBridge event-driven completion | 2020+ (Transcribe EventBridge support) | Reduces API calls 99%; eliminates polling latency and scalability concerns |
| Embedding transcripts in DynamoDB | S3 storage with JSON + plain text on session record | 2024+ (S3 cost optimization) | Keeps hot data in DynamoDB, archive in S3; enables archival without session bloat |
| Real-time transcription via WebSocket | Batch transcription in replay | 2023+ (Streaming Transcribe complexity) | Batch is simpler, less cost, sufficient for v1.2 use case |

**Deprecated/outdated:**
- **Elastic Transcoder:** Replaced by MediaConvert (2018). Transcoder no longer updated; MediaConvert is the maintained service.
- **Hand-rolled MP4 assembly:** Old approach used FFmpeg in Lambda to download HLS segments and assemble into MP4. MediaConvert is now the standard (no Lambda binary complexity).

## Open Questions

1. **Transcribe Language Support in v1.2**
   - What we know: Phase 19 defaults to `en-US`. Transcribe supports 100+ languages via LanguageCode parameter. Phase 20 (AI Summary) uses Claude, which supports 100+ languages.
   - What's unclear: Should v1.2 support automatic language detection (IdentifyLanguage: true) or single-language? Detection adds latency and cost.
   - Recommendation: Ship v1.2 with `en-US` fixed. Add IdentifyLanguage support in v1.x if users request multi-language sessions. Test language detection with sample recordings before enabling.

2. **MediaConvert Queue and Priorities**
   - What we know: MediaConvert uses queues for job scheduling. Default queue has standard throughput. On-Demand queues are higher cost but no queue wait.
   - What's unclear: Will Phase 19 scale to 100+ concurrent sessions? Should we use Default queue (cheaper, potential wait) or On-Demand queue (instant, higher cost)?
   - Recommendation: Ship with Default queue. Monitor job queue time in Phase 20 planning. If conversion time exceeds 5 minutes (user expectation for summary), switch to On-Demand queue.

3. **Transcription Failure Monitoring and Alerts**
   - What we know: EventBridge sends FAILED events with FailureReason field. Current recording-ended handler logs non-blocking errors to CloudWatch.
   - What's unclear: Should phase include SNS alerts for repeated failures? CloudWatch Alarms? Or is CloudWatch Logs sufficient for v1.2?
   - Recommendation: Implement CloudWatch dashboard showing transcription job completion rate and failure rate by reason (invalid audio, unsupported language, etc.). Add SNS alert only if failure rate exceeds 5% of sessions.

## Validation Architecture

The `.planning/config.json` does not set `workflow.nyquist_validation` to enable test requirements. This section is deferred to phase planning.

## Sources

### Primary (HIGH confidence)
- [AWS Transcribe - Data input and output](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html) - Confirmed supported input formats (MP4, not HLS M3U8), output JSON structure
- [AWS Transcribe - EventBridge integration](https://docs.aws.amazon.com/transcribe/latest/dg/monitoring-events.html) - Confirmed event structure, TranscriptionJobName field, COMPLETED/FAILED status values
- [AWS IVS - Record to S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html) - Confirmed S3 folder structure (HLS in `/media/hls/`, master.m3u8 location)
- [AWS Transcribe API - StartTranscriptionJob](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html) - Confirmed job name limits, OutputBucketName behavior, supported settings
- [AWS Transcribe - Supported languages table](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html) - Confirmed LanguageCode parameter, IdentifyLanguage option

### Secondary (MEDIUM confidence)
- [AWS for M&E Blog - Using Amazon IVS and MediaConvert in a post processing workflow](https://aws.amazon.com/blogs/media/awse-using-amazon-ivs-and-mediaconvert-in-a-post-processing-workflow/) - Architecture pattern for IVS + MediaConvert, Lambda integration points, job submission patterns
- [AWS Media Services - VOD Automation](https://github.com/aws-samples/aws-media-services-vod-automation) - Reference implementation for MediaConvert + EventBridge workflow
- [Transcribing audio uploaded to S3](https://romandc.com/blog/2023/02/transcribing-audio-uploaded-to-s3/) - Practical example of Lambda-triggered Transcribe pipeline
- [Creating Event-Driven Architecture for Audio File Transcription](https://srivastavayushmaan1347.medium.com/creating-an-event-driven-architecture-for-audio-file-transcription-with-aws-transcribe-f0795241afd4) - EventBridge pattern for Transcribe job completion handling

### Tertiary (LOW confidence, flagged for validation)
- WebSearch results on MediaConvert error handling and job submission validation - General patterns found, but specific error codes require official AWS documentation verification
- WebSearch on Transcribe failure reasons - General categories identified, but official API docs should be final reference

## Metadata

**Confidence breakdown:**
- Standard stack (Transcribe, MediaConvert, EventBridge): HIGH - All verified in official AWS docs
- Architecture patterns (pipeline flow, handler design): HIGH - Matches existing codebase patterns and AWS reference implementations
- Pitfalls (common mistakes): MEDIUM - Based on patterns from AWS blogs and community examples; prioritized by relevance to this codebase
- Specific Transcribe output schema: HIGH - Official docs fetched and parsed
- MediaConvert HLS input support: HIGH - Official docs confirm master.m3u8 as valid input
- Error handling strategies: MEDIUM - Patterns confirmed in existing handlers; specific failure scenarios require testing

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (30 days; Transcribe/MediaConvert APIs stable, but monitor AWS service announcements for new features)
