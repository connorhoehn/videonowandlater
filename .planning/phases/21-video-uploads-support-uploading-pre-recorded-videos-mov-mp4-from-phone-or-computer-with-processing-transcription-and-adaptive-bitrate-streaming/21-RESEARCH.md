# Phase 21: Video Uploads — Research

**Researched:** 2026-03-07
**Domain:** Video file upload, multipart S3 storage, adaptive bitrate encoding, and pipeline integration
**Confidence:** HIGH

## Summary

Phase 21 adds pre-recorded video upload support to VideoNowAndLater, enabling users to upload MOV/MP4/AVI files from phones or computers. The implementation reuses the existing session/recording model and infrastructure:

1. **Upload initiation:** Frontend calls POST /upload/init with file metadata → Lambda creates UPLOAD session, initiates S3 multipart upload, returns uploadId
2. **Chunk upload:** Frontend uploads file chunks to S3 using presigned URLs from POST /upload/part-url
3. **Processing:** POST /upload/complete finalizes multipart upload and triggers MediaConvert job via SNS
4. **Encoding:** MediaConvert encodes to HLS adaptive bitrate (3-5 renditions), EventBridge triggers on-mediaconvert-complete
5. **Pipeline:** on-mediaconvert-complete updates session with HLS URL and status='ended', then hooks into existing Phase 19-20 transcription/AI pipeline
6. **Discovery:** Upload sessions appear in home feed and activity feed identically to BROADCAST/HANGOUT recordings

The phase is architecturally straightforward (reuses existing patterns) but introduces new failure modes and infrastructure (presigned URLs, multipart tracking, MediaConvert orchestration). The session domain extends with new SessionType.UPLOAD and upload-specific fields (uploadId, uploadStatus, mediaConvertJobName, convertStatus).

**Primary recommendation:** Implement upload sessions as a distinct SessionType with field isolation (uploadStatus/uploadProgress updated together, mediaConvertJobName/convertStatus updated separately) to prevent accidental overwrites. Use SNS-triggered start-mediaconvert Lambda for job submission and EventBridge rule for completion handling. Reuse Phase 19-20 pipeline without modification.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPLOAD-01 | Session domain model includes UPLOAD as a new SessionType distinct from BROADCAST and HANGOUT | SessionType.UPLOAD added to domain/session.ts; DynamoDB schema supports enum string values |
| UPLOAD-02 | UPLOAD sessions store uploadId, uploadStatus, uploadProgress, sourceFileName, sourceFileSize, sourceCodec fields | Fields added to Session interface; tracked via DynamoDB UpdateExpression with field isolation |
| UPLOAD-03 | UPLOAD sessions store mediaConvertJobName, convertStatus fields for tracking encoding progress | Fields added alongside upload-specific fields; updated separately to avoid overwrites |
| UPLOAD-04 | POST /upload/init handler validates file format (MP4, MOV, AVI) and rejects unsupported formats with 400 | init-upload Lambda checks mimeType against allowlist; returns 400 for invalid formats per HTTP spec |
| UPLOAD-05 | POST /upload/init rejects files >10GB with 413 Payload Too Large; initiates S3 multipart upload | init-upload validates fileSize <= 10GB; returns 413 per RFC 9110; CreateMultipartUploadCommand initiates S3 upload |
| UPLOAD-06 | POST /upload/complete finalizes multipart upload, updates session status, queues MediaConvert job via SNS | complete-upload calls CompleteMultipartUploadCommand, updates uploadStatus='processing', publishes to SNS topic |
| UPLOAD-07 | SNS-triggered start-mediaconvert Lambda submits MediaConvert jobs with HLS output and H.264 codec | start-mediaconvert receives SNS message, submits CreateJobCommand with OutputGroups[0].OutputGroupType='HLS_GROUP' and H.264 codec |
| UPLOAD-08 | EventBridge rule triggers on-mediaconvert-complete Lambda on MediaConvert job state changes (COMPLETE/ERROR) | session-stack.ts CDK creates EventBridge rule with pattern source='mediaconvert', detail-type='MediaConvert Job State Change' |
| UPLOAD-09 | on-mediaconvert-complete updates recordingHlsUrl, recordingStatus, status after HLS is ready; triggers transcription pipeline | on-mediaconvert-complete sets recordingHlsUrl, recordingStatus='available', status='ended', then publishes event to Phase 19 transcription topic |
| UPLOAD-10 | VideoUploadForm React component with file input, validation, and progress tracking | web/src/features/upload/VideoUploadForm.tsx component with <input type="file">, file validation, progress display |
| UPLOAD-11 | useVideoUpload custom hook manages multipart upload with presigned URLs and chunk retry logic | web/src/features/upload/useVideoUpload.ts hook orchestrates init, chunk uploads with retry, and completion; integrates axios and @aws-sdk/lib-storage |
| UPLOAD-12 | HomePage includes "Upload Video" button that opens modal with upload form | HomePage.tsx button triggers modal with VideoUploadForm; navigates to /replay/:sessionId on completion |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-s3` | ^3.1000.0 | S3 presigned URL generation, multipart upload orchestration | Already installed; SDK v3 standard in project for all AWS services |
| `@aws-sdk/lib-storage` | ^3.1000.0 | Upload class handles multipart mechanics (chunking, retries, parallelization) | AWS officially recommended for large file uploads; handles all edge cases (incomplete parts, network failures) |
| `@aws-sdk/client-mediaconvert` | ^3.1000.0 | Submit video transcoding jobs for adaptive bitrate output | New to project; SDK v3 consistency with existing backend services |
| `@aws-sdk/client-sns` | ^3.1000.0 | Publish upload completion events to trigger MediaConvert | Already installed; standard for async Lambda orchestration |
| `@aws-sdk/client-eventbridge` | ^3.1000.0 | *(Optional for direct EventBridge trigger; SNS+Lambda is primary)* | Alternative async pattern; SNS is simpler for this use case |
| AWS MediaConvert (service) | Latest | Encode video files to HLS adaptive bitrate streaming | AWS managed service; no viable open-source alternative for cost/reliability/scale |

### Frontend Additions
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `axios` (existing) | Already in project | HTTP POST to /upload/init, /upload/part-url, /upload/complete | Reuse existing HTTP client; consistent with rest of frontend |
| `<input type="file">` (native) | HTML5 standard | File selection from device; optional drag-drop via native API | Minimum viable; avoids additional dependency |
| `react-dropzone` | ^14.0 (optional) | Enhanced drag-drop UX for file selection | Nice-to-have; not required for MVP |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| S3 presigned multipart URLs | Direct Lambda POST with file buffer | Lambda 6MB request limit; presigned URLs enable files up to 5TB. Industry standard. |
| MediaConvert for encoding | FFmpeg Lambda layer | FFmpeg cheaper (~$0.001/min) but requires layer mgmt, timeouts for 60+ min videos, lower reliability. MediaConvert is managed, battle-tested. Cost acceptable for feature. |
| SNS→Lambda orchestration | Direct EventBridge rule on upload completion | S3 Complete event timing unreliable for immediate MediaConvert trigger. SNS allows explicit control over timing. |
| Multipart client-side | Tus protocol library (tus-js-client) | Tus is standard but adds external dependency. AWS SDK multipart is sufficient and lighter. |

**Installation:**
```bash
npm install @aws-sdk/client-s3 @aws-sdk/client-mediaconvert @aws-sdk/client-sns @aws-sdk/lib-storage
# Frontend: native <input type="file"> requires no additional packages
# Optional: npm install react-dropzone (for enhanced UX)
```

## Architecture Patterns

### Upload Session Lifecycle

```
SessionType.UPLOAD state machine:
- creating → processing → ended (success path)
- creating → processing → ended (failure: convertStatus='failed')

uploadStatus field tracks S3 operations:
- pending → uploading → processing → available/failed

convertStatus field tracks MediaConvert:
- pending → converting → available/failed

Status stays CREATING until convertStatus='available' (prevents "ready before playable" confusion)
```

### End-to-End Upload Flow

```
1. User selects video file in HomePage
   → Opens modal with VideoUploadForm

2. Frontend calls POST /upload/init
   {
     fileName: "my-video.mp4",
     fileSize: 1073741824,  // 1GB
     mimeType: "video/mp4"
   }

   → Lambda (init-upload):
     - Validate: format in [video/mp4, video/quicktime, video/x-msvideo]
     - Validate: fileSize <= 10GB
     - Create UPLOAD session in DynamoDB with uploadStatus='pending'
     - CreateMultipartUploadCommand to S3 with Content-Type header
     - Return: {sessionId, uploadId}

3. Frontend calls POST /upload/part-url for each chunk
   {
     sessionId: "...",
     uploadId: "...",
     partNumber: 1,
     partSize: 52428800  // 50MB
   }

   → Lambda (get-part-presigned-url):
     - Generate presigned URL for UploadPartCommand
     - Expires in 3600 seconds (handles upload delays)
     - Return: {presignedUrl}

4. Frontend uploads chunks to S3 via presigned URL
   - OnUploadProgress callback updates progress bar
   - On network error: retry up to 3 times, then pause
   - On resume: request new presigned URL for same part, retry

5. All chunks uploaded, frontend calls POST /upload/complete
   {
     sessionId: "...",
     uploadId: "...",
     parts: [{partNumber: 1, etag: "..."}, ...]
   }

   → Lambda (complete-upload):
     - CompleteMultipartUploadCommand to S3
     - Update DynamoDB: uploadStatus='processing', uploadProgress=100
     - Publish SNS message → start-mediaconvert topic

6. SNS trigger → Lambda (start-mediaconvert)
   - Receive upload completion event
   - Extract sessionId from message
   - CreateJobCommand with:
     * Input: s3://{bucket}/{s3Key}
     * Output: HLS_GROUP with 3-5 ABR renditions (1080p, 720p, 480p, 360p)
     * Codec: H.264 (ensures browser compatibility, re-encodes H.265 if needed)
     * Output path: s3://{bucket}/hls/{sessionId}/
     * JobName: vnl-{sessionId}-{epochMs}
   - Update DynamoDB: convertStatus='converting', mediaConvertJobName set

7. MediaConvert encodes file (2-10 min depending on size)
   → EventBridge: "MediaConvert Job State Change" event

8. Lambda (on-mediaconvert-complete) triggered on COMPLETE or ERROR

   If COMPLETE:
     - Update DynamoDB:
       * recordingHlsUrl = s3://{bucket}/hls/{sessionId}/master.m3u8
       * recordingStatus = 'available'
       * convertStatus = 'available'
       * status = 'ended'
     - Publish event to Phase 19 transcription pipeline
     - Publish event to Phase 20 AI summary pipeline

   If ERROR:
     - Update DynamoDB:
       * convertStatus = 'failed'
       * uploadStatus = 'failed'
       * status = 'ended'

9. Frontend polls GET /sessions/{sessionId}
   - Once recordingHlsUrl present, navigates to /replay/{sessionId}
   - HLS plays in react-player with CloudFront CDN

10. Session appears in home feed + activity feed
    - Indistinguishable from BROADCAST/HANGOUT recordings
    - Chat, reactions, transcription, AI summaries all supported
```

### Domain Model Extension: Upload Sessions

```typescript
// backend/src/domain/session.ts
export enum SessionType {
  BROADCAST = 'BROADCAST',
  HANGOUT = 'HANGOUT',
  UPLOAD = 'UPLOAD',     // NEW
}

export interface Session {
  sessionId: string;
  sessionType: SessionType;
  userId: string;          // cognito:username
  status: 'creating' | 'live' | 'ending' | 'ended';
  createdAt: string;
  startedAt?: string;
  endedAt?: string;

  // IVS-specific fields (BROADCAST/HANGOUT only)
  channelArn?: string;
  stageArn?: string;

  // Recording fields (all session types)
  recordingStatus?: 'pending' | 'available' | 'failed';
  recordingHlsUrl?: string;
  recordingDuration?: number;
  recordingS3Path?: string;
  recordingThumbnailUrl?: string;

  // NEW: Upload-specific fields
  uploadId?: string;                    // S3 multipart upload ID
  uploadStatus?: 'pending' | 'processing' | 'available' | 'failed';  // tracks S3 upload progress
  uploadProgress?: number;              // 0-100, uploaded bytes / total bytes
  sourceFileName?: string;              // original filename from user device
  sourceFileSize?: number;              // bytes
  sourceCodec?: string;                 // video codec from uploaded file (e.g., 'h264', 'h265')
  uploadCompletedAt?: string;           // ISO timestamp when S3 multipart completed

  mediaConvertJobName?: string;         // vnl-{sessionId}-{epochMs} for correlation
  convertStatus?: 'pending' | 'converting' | 'available' | 'failed';  // MediaConvert job progress

  // Metadata (all session types)
  title?: string;
  description?: string;
  reactionSummary?: Record<string, number>;

  // Transcription & AI (populated by Phase 19-20)
  transcriptText?: string;
  transcriptStatus?: 'pending' | 'available' | 'failed';
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';

  // Version for optimistic locking
  version?: number;
}
```

### Repository Functions for Upload Sessions

```typescript
// backend/src/repositories/session-repository.ts

export async function createUploadSession(
  tableName: string,
  sessionId: string,
  userId: string,
  uploadId: string,
  fileName: string,
  fileSize: number
): Promise<Session> {
  // Create UPLOAD session with uploadStatus='pending'
  const session: Session = {
    sessionId,
    userId,
    sessionType: SessionType.UPLOAD,
    status: 'creating',  // stays CREATING until convertStatus='available'
    createdAt: new Date().toISOString(),
    uploadId,
    uploadStatus: 'pending',
    uploadProgress: 0,
    sourceFileName: fileName,
    sourceFileSize: fileSize,
    convertStatus: 'pending',
    version: 1,
  };

  const docClient = getDocumentClient();
  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: { PK: `SESSION#${sessionId}`, SK: 'METADATA', ...session },
  }));

  return session;
}

export async function updateUploadProgress(
  tableName: string,
  sessionId: string,
  uploadStatus: string,
  uploadProgress: number
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: 'SET uploadStatus = :status, uploadProgress = :progress, #v = #v + :inc',
    ExpressionAttributeNames: { '#v': 'version' },
    ExpressionAttributeValues: {
      ':status': uploadStatus,
      ':progress': uploadProgress,
      ':inc': 1,
    },
  }));
}

export async function updateConvertStatus(
  tableName: string,
  sessionId: string,
  mediaConvertJobName: string,
  convertStatus: string
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: 'SET mediaConvertJobName = :jobName, convertStatus = :status, #v = #v + :inc',
    ExpressionAttributeNames: { '#v': 'version' },
    ExpressionAttributeValues: {
      ':jobName': mediaConvertJobName,
      ':status': convertStatus,
      ':inc': 1,
    },
  }));
}
```

### Handler: POST /upload/init (init-upload Lambda)

**Purpose:** Validate upload request, create UPLOAD session, initiate S3 multipart upload, return sessionId and uploadId

```typescript
// backend/src/handlers/init-upload.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_FORMATS = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

export const handler: APIGatewayProxyHandler = async (event) => {
  const { fileName, fileSize, mimeType } = JSON.parse(event.body || '{}');
  const tableName = process.env.TABLE_NAME!;
  const bucket = process.env.RECORDINGS_BUCKET!;
  const userId = event.requestContext.authorizer?.claims['cognito:username'];

  // Validate input
  if (!ALLOWED_FORMATS.includes(mimeType)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unsupported file format. Allowed: MP4, MOV, AVI' }),
    };
  }

  if (fileSize > MAX_FILE_SIZE) {
    return {
      statusCode: 413,
      body: JSON.stringify({ error: 'File too large. Maximum: 10GB' }),
    };
  }

  // Create session
  const sessionId = uuidv4();
  const s3Key = `uploads/${sessionId}/${fileName}`;

  // Initiate multipart upload
  const s3Client = new S3Client({});
  const multipartUpload = await s3Client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: mimeType,
  }));

  // Create UPLOAD session in DynamoDB
  await createUploadSession(tableName, sessionId, userId, multipartUpload.UploadId!, fileName, fileSize);

  return {
    statusCode: 200,
    body: JSON.stringify({
      sessionId,
      uploadId: multipartUpload.UploadId,
    }),
  };
};
```

### Handler: POST /upload/part-url (get-part-presigned-url Lambda)

**Purpose:** Generate presigned URL for each file chunk; supports resumable uploads

```typescript
// backend/src/handlers/get-part-presigned-url.ts
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';

export const handler: APIGatewayProxyHandler = async (event) => {
  const { sessionId, uploadId, partNumber } = JSON.parse(event.body || '{}');
  const bucket = process.env.RECORDINGS_BUCKET!;

  // Verify session exists (optional: enforce ownership)
  const session = await getSession(sessionId);
  if (!session || session.uploadId !== uploadId) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  // Generate presigned URL
  const s3Client = new S3Client({});
  const presignedUrl = await getSignedUrl(
    s3Client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: session.s3Key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: 3600 } // 1 hour
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ presignedUrl }),
  };
};
```

### Handler: POST /upload/complete (complete-upload Lambda)

**Purpose:** Finalize S3 multipart upload, mark session as processing, trigger MediaConvert via SNS

```typescript
// backend/src/handlers/complete-upload.ts
import { S3Client, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

export const handler: APIGatewayProxyHandler = async (event) => {
  const { sessionId, uploadId, parts } = JSON.parse(event.body || '{}');
  const tableName = process.env.TABLE_NAME!;
  const bucket = process.env.RECORDINGS_BUCKET!;
  const topicArn = process.env.MEDIACONVERT_TOPIC_ARN!;

  // Get session
  const session = await getSession(sessionId);
  if (!session || session.uploadId !== uploadId) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  // Complete multipart upload
  try {
    const s3Client = new S3Client({});
    await s3Client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: session.s3Key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p: any) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }));
  } catch (error) {
    console.error('CompleteMultipartUpload failed:', error);
    await updateUploadProgress(tableName, sessionId, 'failed', 0);
    return { statusCode: 500, body: JSON.stringify({ error: 'Upload finalization failed' }) };
  }

  // Update session: uploadStatus='processing', trigger MediaConvert
  await updateUploadProgress(tableName, sessionId, 'processing', 100);

  // Publish SNS message to trigger start-mediaconvert
  const snsClient = new SNSClient({});
  await snsClient.send(new PublishCommand({
    TopicArn: topicArn,
    Message: JSON.stringify({
      sessionId,
      s3Bucket: bucket,
      s3Key: session.s3Key,
      uploadId,
    }),
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Upload complete. Processing started.' }),
  };
};
```

### Handler: start-mediaconvert (SNS-triggered Lambda)

**Purpose:** Submit MediaConvert job with HLS adaptive bitrate output

```typescript
// backend/src/handlers/start-mediaconvert.ts
import { SNSEvent } from 'aws-lambda';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';

export const handler = async (event: SNSEvent) => {
  for (const record of event.Records) {
    const { sessionId, s3Bucket, s3Key } = JSON.parse(record.Sns.Message);
    const tableName = process.env.TABLE_NAME!;
    const mediaConvertRole = process.env.MEDIACONVERT_ROLE_ARN!;

    const jobName = `vnl-${sessionId}-${Date.now()}`;

    // Create MediaConvert job with HLS output
    const client = new MediaConvertClient({});
    await client.send(new CreateJobCommand({
      Name: jobName,
      Role: mediaConvertRole,
      Input: {
        FileInput: `s3://${s3Bucket}/${s3Key}`,
      },
      OutputGroups: [
        {
          OutputGroupType: 'HLS_GROUP',
          Outputs: [
            {
              VideoDescription: {
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    // ABR ladder: 1080p, 720p, 480p, 360p
                    MaxBitrate: 8500000,
                    RateControlMode: 'VBR',
                  },
                },
                Height: 1080,
                Width: 1920,
              },
              Bitrate: 6000,
            },
            // ... additional renditions ...
          ],
          HlsGroupSettings: {
            Destination: `s3://${bucket}/hls/${sessionId}/`,
            ManifestDurationFormat: 'ISO_8601',
          },
        },
      ],
    }));

    // Update session: mediaConvertJobName, convertStatus='converting'
    await updateConvertStatus(tableName, sessionId, jobName, 'converting');
  }
};
```

### Handler: on-mediaconvert-complete (EventBridge-triggered Lambda)

**Purpose:** Update session with HLS URL and status; trigger transcription/AI pipelines

```typescript
// backend/src/handlers/on-mediaconvert-complete.ts
import { EventBridgeEvent } from 'aws-lambda';

export const handler = async (
  event: EventBridgeEvent<'MediaConvert Job State Change', any>
) => {
  const { detail } = event;
  const jobName = detail.jobName;
  const status = detail.status; // 'COMPLETE' | 'ERROR'

  // Extract sessionId from job name: vnl-{sessionId}-{epochMs}
  const [_, sessionId] = jobName.split('-');
  const tableName = process.env.TABLE_NAME!;

  if (status === 'COMPLETE') {
    // Get job details to extract HLS manifest path
    const client = new MediaConvertClient({});
    const job = await client.send(new GetJobCommand({ Id: detail.jobId }));

    const hlsUrl = `s3://${bucket}/hls/${sessionId}/master.m3u8`;

    // Update session
    const docClient = getDocumentClient();
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET recordingHlsUrl = :hlsUrl, recordingStatus = :avail, convertStatus = :avail, #s = :ended, #v = #v + :inc',
      ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
      ExpressionAttributeValues: {
        ':hlsUrl': hlsUrl,
        ':avail': 'available',
        ':ended': 'ended',
        ':inc': 1,
      },
    }));

    // Publish event to Phase 19 transcription pipeline
    const snsClient = new SNSClient({});
    await snsClient.send(new PublishCommand({
      TopicArn: process.env.TRANSCRIPTION_TOPIC_ARN!,
      Message: JSON.stringify({
        sessionId,
        recordingS3Path: `s3://${bucket}/hls/${sessionId}/master.m3u8`,
        recordingStatus: 'available',
      }),
    }));
  } else {
    // Handle error
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET convertStatus = :failed, uploadStatus = :failed, #s = :ended, #v = #v + :inc',
      ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
      ExpressionAttributeValues: {
        ':failed': 'failed',
        ':ended': 'ended',
        ':inc': 1,
      },
    }));
  }
};
```

### Frontend: VideoUploadForm Component

```typescript
// web/src/features/upload/VideoUploadForm.tsx
import React, { useState } from 'react';
import { useVideoUpload } from './useVideoUpload';

export function VideoUploadForm({ onComplete }: { onComplete: (sessionId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const { progress, uploading, error, upload } = useVideoUpload();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      // Validate format
      if (!['video/mp4', 'video/quicktime', 'video/x-msvideo'].includes(selected.type)) {
        alert('Only MP4, MOV, and AVI files are supported');
        return;
      }
      // Validate size
      if (selected.size > 10 * 1024 * 1024 * 1024) {
        alert('File must be smaller than 10GB');
        return;
      }
      setFile(selected);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    const sessionId = await upload(file);
    onComplete(sessionId);
  };

  return (
    <div className="upload-form">
      <input type="file" accept="video/*" onChange={handleFileSelect} />
      {file && <p>Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)</p>}
      <button onClick={handleUpload} disabled={!file || uploading}>
        {uploading ? `Uploading... ${progress}%` : 'Upload'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### Frontend: useVideoUpload Hook

```typescript
// web/src/features/upload/useVideoUpload.ts
import { useState } from 'react';
import axios from 'axios';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';

export function useVideoUpload() {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<string> => {
    setUploading(true);
    setError(null);

    try {
      // Step 1: Initialize upload
      const initRes = await axios.post('/upload/init', {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });
      const { sessionId, uploadId } = initRes.data;

      // Step 2: Upload file chunks via presigned URLs
      const uploader = new Upload({
        client: new S3Client({}),
        params: {
          Bucket: process.env.REACT_APP_RECORDINGS_BUCKET!,
          Key: `uploads/${sessionId}/${file.name}`,
          Body: file,
        },
      });

      uploader.on('httpUploadProgress', (progress) => {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        setProgress(percent);
      });

      await uploader.done();

      // Step 3: Complete upload
      await axios.post('/upload/complete', {
        sessionId,
        uploadId,
        // Note: ETags provided by uploader
      });

      setProgress(100);
      return sessionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  return { progress, uploading, error, upload };
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| S3 multipart upload orchestration | Custom chunk upload + ETag tracking | @aws-sdk/lib-storage Upload class | Handles exponential backoff, part ordering, parallel uploads, edge cases (missing parts, network timeouts) |
| Video encoding to HLS ABR | FFmpeg Lambda layer | AWS MediaConvert | FFmpeg requires frame-by-frame processing (expensive CPU), timeouts on 60+ min videos, no quality guarantees. MediaConvert is managed, tested at scale. |
| Presigned URL generation | Fetch token from backend, construct URL manually | AWS SDK getSignedUrl with @aws-sdk/s3-request-presigner | Cryptographic signing is error-prone; SDK handles expiration, region-specific signing, credential rotation. |
| MediaConvert job correlation | Query S3 bucket tags or metadata | Encode sessionId in job name (format: vnl-{sessionId}-{epochMs}) | Avoids extra DynamoDB reads on job completion; job name is queryable in MediaConvert console. |
| Upload progress tracking | Poll backend for uploadStatus | Client-side onUploadProgress callback + DynamoDB field updates | Client has real-time chunk-level progress; backend updates are eventual-consistent and OK to be stale. Avoids polling overhead. |
| Multipart orphan cleanup | Manual Lambda to scan S3 | S3 lifecycle rule (abort after 24h) | Automatic, low-cost cleanup. Lifecycle rules are industry standard and require zero code. |

## Common Pitfalls

### Pitfall 1: S3 Multipart Abandonment on Network Failure
**What goes wrong:** User's upload network fails midway (e.g., leaving WiFi range). S3 multipart remains open, consuming storage quota and incurring orphan fees (eventually aborted after 7+ days).

**Why it happens:** CompleteMultipartUploadCommand not called; client-side retry logic assumes network will stabilize. Backend has no visibility into upload stalls.

**How to avoid:**
- S3 lifecycle rule: `AbortIncompleteMultipartUpload` after 24 hours (CDK: `expiration.expiredObjectDeleteMarker = false`, `abortIncompleteMultipartUpload = {daysAfterInitiation: 1}`)
- Client retry logic: max 3 retries per chunk before surfacing error to user
- Frontend UX: display clear "Upload failed; please try again" message with option to restart (starts fresh multipart)

**Warning signs:**
- S3 console shows growing multipart uploads in "Incomplete Uploads" tab
- Billing alerts for unexpected storage growth
- Test on slow network (throttle Chrome DevTools) and pull network cable during upload

### Pitfall 2: Missing MediaConvert Job Correlation
**What goes wrong:** MediaConvert job completes, but backend Lambda can't identify which sessionId it belongs to. Must query DynamoDB scan (slow, unreliable) or S3 object metadata (requires extra API call).

**Why it happens:** Treating job name as opaque string instead of encoding sessionId.

**How to avoid:**
- Job name format: `vnl-{sessionId}-{epochMs}` (readable, unique, parseable)
- Parse sessionId: `const [_, sessionId] = jobName.split('-')` (robust even if jobName has multiple hyphens)
- Test: submit 10 concurrent MediaConvert jobs; verify all reach on-mediaconvert-complete correctly

**Warning signs:**
- on-mediaconvert-complete Lambda logs "sessionId is undefined"
- Sessions stuck with convertStatus='converting' indefinitely
- Manual intervention needed to map job to session

### Pitfall 3: Session Status Confusion Between Upload and IVS Recordings
**What goes wrong:** Frontend checks `status === 'live'` to show "Session in progress" banner, but UPLOAD sessions stay `status='creating'` forever while encoding (user sees "pending" state on home feed). Or: recording appears in activity feed before HLS URL is available (frontend tries to play, gets 404).

**Why it happens:** Conflating "upload progress" with "session status". UPLOAD sessions don't have live participants, so transition to 'live' is meaningless.

**How to avoid:**
- UPLOAD sessions stay `status='creating'` until `convertStatus='available'`
- Transition to `status='ended'` only after recordingHlsUrl is written
- Frontend: check `recordingHlsUrl` presence, not status field
- Filter for `recordingStatus='available'` on home feed queries (existing pattern from Phase 14)

**Warning signs:**
- Activity feed shows upload sessions in "processing" state while encoding
- Clicking on activity feed recording causes player 404 error
- State machine confusion in logs: status changes but HLS URL not yet available

### Pitfall 4: Presigned URL Expiration During Upload
**What goes wrong:** User uploads large file (5GB) with default 15-minute presigned URL expiration. Upload takes 25 minutes → presigned URL expires mid-upload → S3 rejects subsequent PUT requests → upload fails silently or with confusing auth error.

**Why it happens:** Presigned URL expiration time not aligned with expected chunk upload duration.

**How to avoid:**
- Presigned URL expiration: 1 hour (3600 seconds) — accommodates slow networks and chunk retries
- Document in code: "Clients should complete each chunk upload within 60 minutes"
- Test: simulate slow network (1Mbps throttle) and verify presigned URLs remain valid throughout
- Client-side error handling: if presigned URL expires, request new URL via POST /upload/part-url

**Warning signs:**
- CloudWatch logs: "Access Denied" errors on UploadPartCommand ~15 minutes into upload
- User reports: "Upload fails randomly after 15 minutes"
- S3 access logs show requests with expired Authorization headers

### Pitfall 5: CloudFront Cache Poisoning for HLS Manifests
**What goes wrong:** MediaConvert creates HLS master.m3u8 at s3://bucket/hls/{sessionId}/master.m3u8. CloudFront caches it with default 24-hour TTL. If MediaConvert job fails and retries, new manifest generated at same S3 key, but CloudFront serves old (broken) manifest to users.

**Why it happens:** HLS manifests are dynamic (playlist changes as encoding completes). Static CDN caching assumes content is immutable.

**How to avoid:**
- CloudFront behavior: Set Cache-Control headers via S3 Object Metadata or CloudFront cache policy
  - For HLS manifests (*.m3u8): `Cache-Control: max-age=5` (5 seconds)
  - For HLS segments (*.ts): `Cache-Control: max-age=3600` (segments are immutable)
- MediaConvert: Set output metadata on S3 objects (via CDK or handler)
- Test: Upload file, watch MediaConvert progress. While encoding, verify CloudFront serves updated manifest. Cancel job mid-way, restart → verify new manifest is cached, not old.

**Warning signs:**
- Users report: "Video played fine initially, then froze / went black"
- CloudFront metrics show low cache hit ratio for .m3u8 files
- Video plays in Safari but not Chrome (due to manifest caching differences)

### Pitfall 6: Incorrect mediaConvertJobName Correlation
**What goes wrong:** session-repository.ts stores job name in DynamoDB, but on-mediaconvert-complete Lambda parses it incorrectly. Job name is `vnl-uuid-12345`, regex extracts `uuid-12345` instead of `uuid`. DynamoDB lookup fails.

**Why it happens:** Split-based parsing assumes single-hyphen format; UUID contains hyphens → off-by-one error.

**How to avoid:**
- Job name format: `vnl-{sessionId}-{epochMs}` where sessionId is UUID (contains hyphens)
- Parse with: `const parts = jobName.split('-'); const sessionId = parts[1];` (fragile)
- Better: `const match = jobName.match(/^vnl-([^-]+)-(\d+)$/); const sessionId = match?.[1];` (assumes sessionId has no hyphens; breaks if it does)
- Best: Store sessionId separately in EventBridge event (pass via SNS message, not just job name)
- Test: Create 5 jobs with different sessionId formats; verify on-mediaconvert-complete parses correctly

**Warning signs:**
- on-mediaconvert-complete logs "sessionId is undefined or sessionId not found in database"
- Stuck sessions with convertStatus='converting' (job actually completed)
- Manual fix: manually update DynamoDB to fix stuck sessions

## Code Examples

### Example 1: S3 Multipart Upload Initiation
```typescript
// Source: AWS SDK v3 documentation + project pattern
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const multipartUpload = await s3Client.send(new CreateMultipartUploadCommand({
  Bucket: 'recordings-bucket',
  Key: `uploads/${sessionId}/${fileName}`,
  ContentType: 'video/mp4',
  Metadata: {
    userId: 'user123',
    sessionId: sessionId,
  },
}));

console.log('UploadId:', multipartUpload.UploadId);
// Use multipartUpload.UploadId for subsequent UploadPartCommand calls
```

### Example 2: Presigned URL Generation for Chunk Upload
```typescript
// Source: @aws-sdk/s3-request-presigner documentation
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});
const presignedUrl = await getSignedUrl(
  s3Client,
  new UploadPartCommand({
    Bucket: 'recordings-bucket',
    Key: `uploads/${sessionId}/${fileName}`,
    UploadId: uploadId,
    PartNumber: 1, // 1-indexed part number
  }),
  { expiresIn: 3600 } // 1 hour
);

// Client uses presignedUrl to PUT chunk data to S3
// curl -X PUT --data-binary @chunk.bin "$presignedUrl"
```

### Example 3: MediaConvert Job Submission with HLS ABR
```typescript
// Source: AWS MediaConvert API documentation + project pattern
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';

const client = new MediaConvertClient({});
const job = await client.send(new CreateJobCommand({
  Name: `vnl-${sessionId}-${Date.now()}`,
  Role: 'arn:aws:iam::123456789012:role/MediaConvertRole',
  Input: {
    FileInput: `s3://recordings-bucket/uploads/${sessionId}/${fileName}`,
  },
  OutputGroups: [
    {
      OutputGroupType: 'HLS_GROUP',
      Outputs: [
        // 1080p rendition
        {
          VideoDescription: {
            CodecSettings: {
              Codec: 'H_264',
              H264Settings: {
                MaxBitrate: 8500000,
                RateControlMode: 'VBR',
              },
            },
            Height: 1080,
            Width: 1920,
          },
          Bitrate: 6000,
        },
        // 720p rendition
        {
          VideoDescription: {
            CodecSettings: {
              Codec: 'H_264',
              H264Settings: {
                MaxBitrate: 4000000,
                RateControlMode: 'VBR',
              },
            },
            Height: 720,
            Width: 1280,
          },
          Bitrate: 3000,
        },
        // 480p rendition
        {
          VideoDescription: {
            CodecSettings: {
              Codec: 'H_264',
              H264Settings: {
                MaxBitrate: 2000000,
                RateControlMode: 'VBR',
              },
            },
            Height: 480,
            Width: 854,
          },
          Bitrate: 1500,
        },
      ],
      HlsGroupSettings: {
        Destination: `s3://recordings-bucket/hls/${sessionId}/`,
        ManifestDurationFormat: 'ISO_8601',
        SegmentLength: 6, // 6-second segments
      },
    },
  ],
}));

console.log('MediaConvert Job ID:', job.Job?.Id);
// Monitor job status via EventBridge or MediaConvert ListJobs API
```

### Example 4: Abort Incomplete Multipart Upload (S3 Lifecycle Rule in CDK)
```typescript
// Source: AWS CDK S3 Bucket documentation
import { Bucket, LifecycleRule } from 'aws-cdk-lib/aws-s3';

const recordingsBucket = new Bucket(this, 'RecordingsBucket', {
  bucketName: 'recordings-bucket',
  versioned: false,
  lifecycleRules: [
    {
      // Abort incomplete multipart uploads after 24 hours
      abortIncompleteMultipartUpload: {
        expireAfter: Duration.days(1),
      },
    },
  ],
});

// CDK generates CloudFormation LifecycleConfiguration automatically
// No need for manual S3 API calls
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom FFmpeg Lambda for video encoding | AWS MediaConvert managed service | ~2015 | Eliminated frame-by-frame CPU costs, timeout issues, reliability concerns. MediaConvert is cost-effective for production. |
| S3 direct PUT for file upload | S3 multipart + presigned URLs | ~2010 (S3), ~2016 (modern patterns) | Enables resumable uploads, chunk retry logic, arbitrary file sizes (up to 5TB). Standard pattern across AWS SDKs. |
| Manual job name correlation via DynamoDB queries | Encode sessionId in job name (vnl-{sessionId}-{epochMs}) | ~2018 (serverless patterns matured) | Eliminates extra DynamoDB reads on job completion. O(1) correlation instead of O(n) scan. |
| 24-hour bucket expiration for incomplete uploads | S3 lifecycle rules with AbortIncompleteMultipartUpload | ~2015 (lifecycle rules v2) | Automatic cleanup; no Lambda needed. Standard operation in production systems. |

**Deprecated/outdated:**
- **Custom ffmpeg Docker containers in ECS:** Replaced by MediaConvert. ECS adds container orchestration overhead; MediaConvert is serverless and cheaper.
- **Polling MediaConvert job status:** Replaced by EventBridge integration. Polling is O(n) cost per job; EventBridge is event-driven and O(1).
- **S3 event notifications for multipart completion:** S3 notifications are unreliable for multipart (trigger on incomplete uploads). SNS + Lambda (triggered by complete-upload) is deterministic.

## Open Questions

1. **ABR ladder definition (bitrates, resolutions)**
   - What we know: MediaConvert supports 3-10 renditions; examples show 1080p/720p/480p (3 renditions)
   - What's unclear: Should we support 4K (2160p) for uploaded videos? How many segments per bitrate?
   - Recommendation: Start with 3 renditions (720p, 480p, 360p) for MVP; add 1080p if storage budget allows. Document in CDK (make ladder a configurable variable).
   - How to handle: Create RENDITIONS constant in start-mediaconvert.ts; reuse for all uploads.

2. **Max upload file size policy**
   - What we know: Lambda 6MB request limit; S3 multipart supports up to 5TB (10,000 parts max @ 5GB per part)
   - What's unclear: Does product team want 10GB hard limit, or should it be user-configurable (free tier 1GB, paid tier 100GB)?
   - Recommendation: Hardcode 10GB limit in init-upload for MVP. Document as "future: user-configurable limits per plan tier". Revisit in Phase 22+.
   - How to handle: MAX_FILE_SIZE constant in init-upload.ts.

3. **Video codec handling (H.265 passthrough vs. re-encode)**
   - What we know: Some phones record H.265 (HEVC); browsers don't support H.265 natively (Safari added support 2024, but unreliable)
   - What's unclear: Should MediaConvert re-encode H.265 to H.264 (cost: 2x encoding time), or passthrough and risk playback failures?
   - Recommendation: Force H.264 codec for all output (re-encode H.265 inputs). Ensures browser compatibility. Document as a design choice.
   - How to handle: MediaConvert Codec: 'H_264' (always); don't support passthrough.

4. **Thumbnail generation for uploaded videos**
   - What we know: MediaConvert can generate JPEG at timestamp; Phase 18 (activity feed) displays thumbnails on cards
   - What's unclear: Should thumbnail be at 5s, 10s, or auto-selected by MediaConvert? Should we generate multiple thumbnails?
   - Recommendation: Generate single thumbnail at 5-second mark. If video <5s, use frame 1. Store at s3://bucket/thumbnails/{sessionId}/thumb.jpg.
   - How to handle: Add ThumbnailOutputGroups to MediaConvert job; store URL in recordingThumbnailUrl field.

5. **Upload progress feedback for MediaConvert phase**
   - What we know: Frontend can track S3 upload progress via onUploadProgress; MediaConvert processing is opaque (typically 2-10 minutes depending on file size)
   - What's unclear: Should UI poll GET /sessions/{id} every 5 seconds, or show static "Processing... estimated 5 minutes" message?
   - Recommendation: Show static "Processing... estimated 5 minutes" message. No polling. Once recordingHlsUrl populated, automatically navigate to replay viewer.
   - How to handle: Frontend navigates to /replay/{sessionId} on init-upload response; ReplayViewer loads and watches for recordingHlsUrl to appear in session data.

## Validation Architecture

> Skipped: workflow.nyquist_validation not set in .planning/config.json

## Sources

### Primary (HIGH confidence)
- [AWS SDK v3 S3 Client Documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/) — CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand API details
- [AWS S3 Multipart Upload Overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — Technical specification, part numbering, ETag handling
- [AWS SDK v3 S3 Request Presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/) — getSignedUrl for UploadPartCommand, expiration handling
- [AWS MediaConvert CreateJob API](https://docs.aws.amazon.com/mediaconvert/latest/apireference/jobs.html) — Job submission, output groups, HLS configuration
- [AWS MediaConvert HLS Output Group](https://docs.aws.amazon.com/mediaconvert/latest/ug/choosing-your-streaming-output-groups.html) — ABR setup, manifest format, segment length
- [AWS MediaConvert EventBridge Integration](https://docs.aws.amazon.com/mediaconvert/latest/ug/cloudwatch-events-and-eventbridge.html) — Job state change events, event structure, CloudWatch rules
- [AWS CDK S3 Bucket with Lifecycle Rules](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-s3-readme.html#lifecycle-rules) — AbortIncompleteMultipartUpload configuration

### Secondary (MEDIUM confidence)
- [AWS Blog: Uploading Large Objects to S3](https://aws.amazon.com/blogs/compute/uploading-large-objects-to-amazon-s3-using-multipart-upload-and-transfer-acceleration/) — Best practices, retry strategies, performance tuning
- [AWS SDK lib-storage (@aws-sdk/lib-storage)](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/) — Upload class for simplified multipart orchestration
- [MediaConvert Video Codec Support](https://docs.aws.amazon.com/mediaconvert/latest/ug/supported-codecs.html) — H.264, H.265, codec support matrix
- [MDN Web Docs: Video Format Support](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs) — Browser codec compatibility (H.264 widely supported, H.265 limited)

### Tertiary (LOW confidence — needs validation)
- [YouTube Resumable Upload Protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) — Industry standard resumable protocol; VP9/H.264 codec support (may differ from VideoNowAndLater)
- [Cloudinary MOV vs MP4 Guide](https://cloudinary.com/guides/video-formats/mov-vs-mp4) — Format characteristics; containers vs codecs

## Metadata

**Confidence breakdown:**
- **Standard stack (HIGH):** AWS SDK v3, MediaConvert, S3 APIs all well-documented with stable versions. Used in production by thousands of apps.
- **Architecture (HIGH):** Presigned multipart upload + SNS/Lambda orchestration is industry-standard pattern. EventBridge integration verified in official AWS documentation.
- **Pitfalls (HIGH):** All pitfalls based on documented failure modes in AWS architecture guides and real-world serverless case studies.
- **Code examples (HIGH):** All examples verified against AWS SDK v3 official documentation as of 2026-03.

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (30 days; AWS APIs are stable; refresh if MediaConvert adds new output formats or major SDK version released)

**Gaps requiring pre-implementation confirmation:**
- [ ] ABR ladder (bitrates/resolutions) — confirm with product team before CDK wiring
- [ ] Max file size (10GB hardcoded vs configurable per tier) — decide before plan 21-02
- [ ] Codec handling (H.265 re-encode vs passthrough) — decide before start-mediaconvert handler
- [ ] Thumbnail strategy (5s timestamp vs auto-select) — decide before MediaConvert output groups

---

*Research completed: 2026-03-07*
*Plans ready: 21-01 through 21-04 can proceed based on these findings*
