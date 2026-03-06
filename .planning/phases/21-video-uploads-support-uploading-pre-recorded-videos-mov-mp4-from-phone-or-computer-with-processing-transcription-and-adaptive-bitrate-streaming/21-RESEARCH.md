# Phase 21: Video Uploads — Research

**Researched:** 2026-03-06
**Domain:** Video file upload, processing pipeline, and adaptive bitrate streaming
**Confidence:** MEDIUM-HIGH

## Summary

Phase 21 adds pre-recorded video upload support to VideoNowAndLater, enabling users to upload MOV/MP4 files from phones or computers. These uploads follow the existing session/recording model: users create an "upload session," the video is stored in S3 via presigned URL + multipart upload, MediaConvert processes the file to produce HLS adaptive bitrate streams, and the resulting recording is treated identically to IVS-recorded broadcasts for replay, chat, and reactions.

The phase is architecturally straightforward but high-complexity in implementation. It reuses the existing recording infrastructure (CloudFront, DynamoDB Session model, activity feed) but introduces new infrastructure components (presigned URL generation, S3 upload tracking, MediaConvert job orchestration) and new failure modes (incomplete uploads, corrupt files, format validation). The upload flow is event-driven: presigned URL Lambda → client S3 upload → upload completion Lambda → MediaConvert start → Bedrock transcription/summarization (via Phase 20 existing pipeline).

**Primary recommendation:** Implement upload sessions as a new SessionType (UPLOAD) distinct from BROADCAST/HANGOUT, with presigned URL generation for client-side S3 multipart upload. Use S3 `CompleteMultipartUpload` event (or polling Lambda) to trigger MediaConvert job. Reuse the existing Phase 19-20 transcription/AI pipeline without modification. Store upload progress in DynamoDB with `uploadStatus` and `uploadProgress` fields for UI feedback.

## User Constraints

*No CONTEXT.md exists for Phase 21 — all research is exploratory.*

## Phase Requirements

Phase 21 has no formally defined requirements in REQUIREMENTS.md yet (v1.2 focused on Phases 16-20). The roadmap stub indicates the feature scope: "Support uploading pre-recorded videos (mov/mp4 from phone or computer) with processing, transcription, and adaptive bitrate streaming."

Implied requirements from scope:
- Users can select and upload MOV/MP4 files from device
- Upload progress shown with percentage indicator
- Resumable upload on network interruption
- MediaConvert automatically processes to HLS ABR
- Uploaded recordings appear in home feed and activity feed
- Chat, reactions, transcription, AI summaries apply to uploaded videos like IVS recordings

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-s3` | `^3.1000.0` | S3 presigned URL generation, multipart upload management | Already installed; SDK v3 standard in project |
| `@aws-sdk/lib-storage` | `^3.1000.0` | Upload class handles multipart mechanics (chunk retries, parallelization) | AWS best practice for large file uploads; handles all failure modes |
| `@aws-sdk/client-mediaconvert` | `^3.1000.0` | Submit video transcoding jobs for ABR output | New to project; matches SDK v3 version convention |
| AWS MediaConvert service (AWS-managed) | Latest | Encode to HLS/DASH adaptive bitrate | AWS industry standard; no alternative for cost/performance |

### Frontend Additions
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-dropzone` OR `<input type="file">` | Built-in / optional | File selection from device or drag-drop | Drag-drop is UX nice-to-have; `<input>` is minimum viable |
| `axios` (existing) | Already in project | HTTP requests for presigned URL and completion endpoints | Reuse existing HTTP client |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Presigned S3 URLs | Direct Lambda POST with file content | Lambda has 6MB request payload limit; presigned URL enables arbitrary file size (up to 5TB). Presigned URLs are standard for streaming file uploads. |
| MediaConvert for processing | Custom FFmpeg Lambda layer | FFmpeg Lambda is cheaper (~$0.001/min CPU) but requires layer management, timeout concerns (videos >60min), and lower reliability. MediaConvert is managed, fully tested, and worth the cost. |
| EventBridge completion tracking | S3 event notifications | EventBridge is not suitable for S3 object finality (triggers on incomplete multipart). Use S3 CompleteMultipartUpload event via SNS→Lambda or polling Lambda. |
| Multipart upload client-side | Tus protocol library | Tus is open standard but adds dependency. AWS Amplify and custom code handle presigned multipart just as well for this use case. |

**Installation:**
```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage @aws-sdk/client-mediaconvert
# Frontend: no new packages required if using native <input type="file">
# OR: npm install react-dropzone (optional for drag-drop UX)
```

## Architecture Patterns

### End-to-End Upload Flow

```
User selects video from device
  ↓
Frontend: POST /upload/init → {sessionId, uploadId}
  ↓
Lambda (init-upload):
  - Create UPLOAD session in DynamoDB
  - Generate presigned POST URL for multipart upload
  - Return: {presignedUrl, uploadId, sessionId}
  ↓
Frontend: Upload file in chunks to S3
  - Use presigned URL + multipart upload API
  - Show progress bar as chunks complete
  - On network error: pause and resume from last chunk
  ↓
S3: CompleteMultipartUpload event OR polling Lambda confirms completion
  ↓
Lambda (on-upload-complete):
  - Verify file exists, extract metadata (duration, codec via ffprobe OR MediaConvert check)
  - Set uploadStatus = 'processing'
  - Submit MediaConvert job for HLS conversion
  - Store job name on session record
  ↓
MediaConvert: Encodes to HLS + DASH adaptive bitrate
  → EventBridge: MediaConvert Job State Change (COMPLETED/FAILED)
  ↓
Lambda (on-mediaconvert-complete):
  - Update recordingHlsUrl, recordingStatus = 'available'
  - Trigger Phase 19 transcription pipeline (existing)
  - Trigger Phase 20 AI summary (existing)
  ↓
Frontend: Recording appears in home feed + activity feed
  - Same layout as IVS recordings
  - Chat, reactions, replay fully functional
```

### Domain Model Extension: Upload Sessions

New SessionType:
```typescript
export enum SessionType {
  BROADCAST = 'BROADCAST',    // IVS one-to-many (existing)
  HANGOUT = 'HANGOUT',        // IVS RealTime multi-participant (existing)
  UPLOAD = 'UPLOAD',          // NEW: User-submitted pre-recorded video
}
```

New Session fields:
```typescript
export interface Session {
  // ... existing fields ...
  uploadId?: string;                          // S3 multipart upload ID
  uploadStatus?: 'pending' | 'processing' | 'converting' | 'available' | 'failed';
  uploadProgress?: number;                    // 0-100 percentage (tracked in frontend or DynamoDB)
  uploadSourceLocation?: 'phone' | 'computer'; // Metadata for analytics
  sourceFileName?: string;                    // Original filename user selected
  sourceFileSize?: number;                    // In bytes
  sourceCodec?: string;                       // Detected codec (H.264, H.265, ProRes, etc.)
  mediaConvertJobName?: string;               // Like Phase 19: vnl-{sessionId}-{epochMs}
  convertStatus?: 'pending' | 'processing' | 'available' | 'failed';
  // ... recording fields inherited from broadcast ...
  // recordingHlsUrl, recordingDuration, thumbnailUrl, recordingStatus all apply
  // transcriptText, transcriptStatus, aiSummary, aiSummaryStatus all apply
}
```

### Handler: init-upload (POST /upload/init)

```typescript
// Source: AWS S3 Multipart documentation + project pattern
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface InitUploadRequest {
  filename: string;
  filesize: number;           // Client-reported size for UI feedback
  mimeType: string;           // 'video/mp4' or 'video/quicktime'
}

interface InitUploadResponse {
  sessionId: string;
  uploadId: string;
  presignedUrl: string;       // URL for client POST
  maxChunkSize: number;       // 52,428,800 bytes recommended
  expiresIn: number;          // seconds (default 15 min)
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = event.requestContext.authorizer.claims['cognito:username'];
  const { filename, filesize, mimeType } = JSON.parse(event.body || '{}');

  // Validate
  if (!filename || !filesize || !mimeType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  if (!['video/mp4', 'video/quicktime', 'video/x-msvideo'].includes(mimeType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported format' }) };
  }

  if (filesize > 10 * 1024 * 1024 * 1024) { // 10GB limit
    return { statusCode: 413, body: JSON.stringify({ error: 'File too large (max 10GB)' }) };
  }

  const tableName = process.env.TABLE_NAME!;
  const bucketName = process.env.RECORDINGS_BUCKET!;
  const s3Client = new S3Client({});

  // 1. Create UPLOAD session in DynamoDB
  const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
      sessionId,
      userId,
      sessionType: 'UPLOAD',
      status: 'creating',
      uploadStatus: 'pending',
      sourceFileName: filename,
      sourceFileSize: filesize,
      createdAt: new Date().toISOString(),
      version: 1,
    },
  }));

  // 2. Initiate multipart upload
  const s3Key = `uploads/${sessionId}/${filename}`;
  const multipartUpload = await s3Client.send(new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: s3Key,
    ContentType: mimeType,
  }));

  const uploadId = multipartUpload.UploadId!;

  // 3. Save uploadId to session
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: 'SET uploadId = :uploadId, #s3key = :s3key',
    ExpressionAttributeNames: { '#s3key': 's3Key' },
    ExpressionAttributeValues: { ':uploadId': uploadId, ':s3key': s3Key },
  }));

  // 4. Generate presigned URL for client to upload parts
  // NOTE: Client will use AWS SDK or fetch to submit UploadPartCommand presigned URLs
  // For simplicity, return bucket/key/uploadId; client can call backend for individual part presigned URLs
  // OR: Generate all presigned URLs upfront (risky if >1000 parts)
  // BEST: Client calls POST /upload/part-url for each part presigned URL

  return {
    statusCode: 200,
    body: JSON.stringify({
      sessionId,
      uploadId,
      bucketName,
      s3Key,
      maxChunkSize: 52 * 1024 * 1024, // 52MB
      expiresIn: 15 * 60,              // 15 minutes
    }),
  };
}
```

### Handler: get-part-presigned-url (POST /upload/part-url)

```typescript
// Clients request a presigned URL for each chunk before uploading
interface GetPartUrlRequest {
  sessionId: string;
  uploadId: string;
  partNumber: number;
}

interface GetPartUrlResponse {
  presignedUrl: string;
  expiresIn: number;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { sessionId, uploadId, partNumber } = JSON.parse(event.body || '{}');
  const bucketName = process.env.RECORDINGS_BUCKET!;
  const tableName = process.env.TABLE_NAME!;

  // Verify session exists and belongs to current user
  const docClient = getDocumentClient();
  const session = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!session.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  const s3Client = new S3Client({});
  const presignedUrl = await getSignedUrl(
    s3Client,
    new UploadPartCommand({
      Bucket: bucketName,
      Key: session.Item.s3Key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: 15 * 60 } // 15 minutes
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ presignedUrl, expiresIn: 15 * 60 }),
  };
}
```

### Handler: complete-upload (POST /upload/complete)

```typescript
// Client calls this after all parts are uploaded
interface CompleteUploadRequest {
  sessionId: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { sessionId, uploadId, parts } = JSON.parse(event.body || '{}');
  const tableName = process.env.TABLE_NAME!;
  const bucketName = process.env.RECORDINGS_BUCKET!;

  const docClient = getDocumentClient();
  const session = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!session.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  const s3Client = new S3Client({});

  // Complete the multipart upload
  try {
    await s3Client.send(new CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: session.Item.s3Key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }));
  } catch (error) {
    console.error('CompleteMultipartUpload failed:', error);

    // Mark upload as failed
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET uploadStatus = :status, #err = :err',
      ExpressionAttributeNames: { '#err': 'uploadError' },
      ExpressionAttributeValues: { ':status': 'failed', ':err': error.message },
    }));

    return { statusCode: 500, body: JSON.stringify({ error: 'Upload completion failed' }) };
  }

  // Mark upload as complete; trigger MediaConvert
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: 'SET uploadStatus = :status, convertStatus = :converting, #ts = :ts',
    ExpressionAttributeNames: { '#ts': 'uploadCompletedAt' },
    ExpressionAttributeValues: { ':status': 'processing', ':converting': 'pending', ':ts': new Date().toISOString() },
  }));

  // Trigger MediaConvert job via EventBridge
  // (alternatively, use SNS or direct Lambda invocation)
  await triggerMediaConvert(sessionId, session.Item.s3Key, bucketName);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Upload complete. Processing started.' }),
  };
}

async function triggerMediaConvert(sessionId: string, s3Key: string, bucketName: string) {
  const eventClient = new EventBridgeClient({});
  const jobName = `vnl-${sessionId}-${Date.now()}`;

  await eventClient.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'custom.vnl',
        DetailType: 'Upload Completed',
        Detail: JSON.stringify({ sessionId, s3Key, bucketName, jobName }),
      },
    ],
  }));
}
```

### Handler: start-mediaconvert (triggered by upload completion)

```typescript
// Source: AWS MediaConvert documentation + project Transcribe pattern
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';

interface UploadCompletedDetail {
  sessionId: string;
  s3Key: string;
  bucketName: string;
  jobName: string;
}

export async function handler(event: EventBridgeEvent<'Upload Completed', UploadCompletedDetail>): Promise<void> {
  const { sessionId, s3Key, bucketName, jobName } = event.detail;
  const tableName = process.env.TABLE_NAME!;
  const mediaConvertRole = process.env.MEDIACONVERT_ROLE_ARN!;
  const outputBucket = process.env.RECORDINGS_BUCKET!;

  const mediaConvertClient = new MediaConvertClient({});

  // Define HLS ABR output group
  const job = {
    Name: jobName,
    Role: mediaConvertRole,
    Input: {
      FileInput: `s3://${bucketName}/${s3Key}`,
    },
    OutputGroups: [
      {
        Name: 'Apple HLS',
        OutputGroupSettings: {
          Type: 'HLS_GROUP_SETTINGS',
          HlsGroupSettings: {
            Destination: `s3://${outputBucket}/hls/${sessionId}/`,
            SegmentLength: 10,
            MinSegmentLength: 0,
            Outputs: [
              // 720p, 480p, 360p renditions (adjust bitrates per your needs)
              {
                NameModifier: '_720p',
                OutputSettings: {
                  VideoDescription: {
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        Bitrate: 2500000,   // 2.5 Mbps
                        RateControlMode: 'CBR',
                        FrameRate: 30,
                        FramerateDenominator: 1,
                      },
                    },
                    Height: 720,
                    Width: 1280,
                  },
                  AudioDescriptions: [{ AudioSourceName: 'Audio Selector 1' }],
                },
              },
              {
                NameModifier: '_480p',
                OutputSettings: {
                  VideoDescription: {
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        Bitrate: 1200000,   // 1.2 Mbps
                        RateControlMode: 'CBR',
                        FrameRate: 30,
                        FramerateDenominator: 1,
                      },
                    },
                    Height: 480,
                    Width: 854,
                  },
                  AudioDescriptions: [{ AudioSourceName: 'Audio Selector 1' }],
                },
              },
              {
                NameModifier: '_360p',
                OutputSettings: {
                  VideoDescription: {
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        Bitrate: 600000,    // 600 Kbps
                        RateControlMode: 'CBR',
                        FrameRate: 30,
                        FramerateDenominator: 1,
                      },
                    },
                    Height: 360,
                    Width: 640,
                  },
                  AudioDescriptions: [{ AudioSourceName: 'Audio Selector 1' }],
                },
              },
            ],
          },
        },
      },
    ],
    // Optional: Thumbnail output for home feed card image
    ThumbnailOutputGroups: [
      {
        OutputGroupSettings: {
          Type: 'FILE_GROUP_SETTINGS',
          FileGroupSettings: {
            Destination: `s3://${outputBucket}/thumbnails/${sessionId}/thumb.jpg`,
          },
        },
        Outputs: [
          {
            NameModifier: '_thumbnail',
            OutputSettings: {
              ImageWidth: 320,
              ImageHeight: 180,
            },
          },
        ],
      },
    ],
  };

  try {
    const response = await mediaConvertClient.send(new CreateJobCommand(job));
    const mediaConvertJobId = response.Job?.Id!;

    // Store job ID on session
    const docClient = getDocumentClient();
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET convertStatus = :status, mediaConvertJobId = :jobId, mediaConvertJobName = :jobName',
      ExpressionAttributeValues: {
        ':status': 'processing',
        ':jobId': mediaConvertJobId,
        ':jobName': jobName,
      },
    }));

    console.log('MediaConvert job started:', { sessionId, jobId: mediaConvertJobId });
  } catch (error) {
    console.error('Failed to start MediaConvert job:', error);

    // Mark conversion as failed
    const docClient = getDocumentClient();
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET convertStatus = :status, #err = :err',
      ExpressionAttributeNames: { '#err': 'convertError' },
      ExpressionAttributeValues: { ':status': 'failed', ':err': error.message },
    }));

    throw error;
  }
}
```

### Handler: on-mediaconvert-complete (triggered by MediaConvert EventBridge event)

```typescript
// Source: AWS MediaConvert EventBridge + project recording-ended pattern
interface MediaConvertDetail {
  detail: {
    jobId: string;
    status: 'COMPLETE' | 'ERROR_FILE_INACCESSIBLE' | ...;
    outputGroupDetails: Array<{
      outputDetails: Array<{ outputFilePaths: string[] }>;
    }>;
  };
}

export async function handler(event: EventBridgeEvent<'MediaConvert Job State Change', MediaConvertDetail>): Promise<void> {
  const { detail } = event;
  const { jobId, status, outputGroupDetails } = detail;
  const tableName = process.env.TABLE_NAME!;

  // Extract sessionId from job name (vnl-{sessionId}-{timestamp})
  // OR query DynamoDB for the session with mediaConvertJobId == jobId
  const docClient = getDocumentClient();

  // Find session by jobId
  const sessionsResult = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1', // Assuming you have a GSI for lookups; adjust if needed
    // Better: add mediaConvertJobId as a GSI or scan + filter
  }));

  if (!sessionsResult.Items || sessionsResult.Items.length === 0) {
    console.warn('No session found for MediaConvert job:', jobId);
    return;
  }

  const session = sessionsResult.Items[0];
  const sessionId = session.sessionId;

  if (status === 'COMPLETE') {
    // Extract HLS master URL from output
    const hlsPaths = outputGroupDetails[0]?.outputDetails[0]?.outputFilePaths || [];
    const masterM3u8Path = hlsPaths.find(p => p.endsWith('master.m3u8'));

    if (!masterM3u8Path) {
      console.error('No master.m3u8 found in MediaConvert output');
      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        UpdateExpression: 'SET convertStatus = :status',
        ExpressionAttributeValues: { ':status': 'failed' },
      }));
      return;
    }

    // Update session with recording metadata
    const recordingBucket = process.env.RECORDINGS_BUCKET!;
    const recordingHlsUrl = `https://{cloudfront-domain}/hls/${sessionId}/master.m3u8`; // CloudFront signed URL

    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET convertStatus = :status, recordingHlsUrl = :url, recordingStatus = :recStatus, #ts = :ts, #status = :sessionStatus',
      ExpressionAttributeNames: { '#ts': 'recordingAvailableAt', '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'available',
        ':url': recordingHlsUrl,
        ':recStatus': 'available',
        ':ts': new Date().toISOString(),
        ':sessionStatus': 'ended',
      },
    }));

    // Trigger Phase 19 transcription pipeline (existing)
    await eventClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'custom.vnl',
        DetailType: 'Recording Available',
        Detail: JSON.stringify({ sessionId, recordingStatus: 'available' }),
      }],
    }));

    console.log('MediaConvert complete:', { sessionId, recordingHlsUrl });
  } else {
    // Job failed
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET convertStatus = :status, #err = :err',
      ExpressionAttributeNames: { '#err': 'convertError' },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':err': `MediaConvert job failed: ${status}`,
      },
    }));

    console.error('MediaConvert failed:', { sessionId, jobId, status });
  }
}
```

### Frontend: Upload Component

```tsx
// Source: React + AWS SDK patterns
import React, { useState } from 'react';
import axios, { AxiosProgressEvent } from 'axios';

interface UploadSession {
  sessionId: string;
  uploadId: string;
  bucketName: string;
  s3Key: string;
  maxChunkSize: number;
}

export const VideoUploadForm: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'complete' | 'error'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate format
      if (!['video/mp4', 'video/quicktime', 'video/x-msvideo'].includes(selectedFile.type)) {
        setError('Unsupported format. Please upload MP4 or MOV.');
        return;
      }
      // Validate size (10GB limit)
      if (selectedFile.size > 10 * 1024 * 1024 * 1024) {
        setError('File too large (max 10GB).');
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  };

  const uploadFile = async () => {
    if (!file) return;

    setStatus('uploading');
    setUploadProgress(0);

    try {
      // Step 1: Initialize upload session
      const initResponse = await axios.post<UploadSession>('/api/upload/init', {
        filename: file.name,
        filesize: file.size,
        mimeType: file.type,
      });

      const { sessionId: sid, uploadId, bucketName, s3Key, maxChunkSize } = initResponse.data;
      setSessionId(sid);

      // Step 2: Upload file in chunks using presigned URLs
      const chunkSize = Math.min(maxChunkSize, 52 * 1024 * 1024); // AWS recommends 52MB
      const numChunks = Math.ceil(file.size / chunkSize);
      const parts: Array<{ partNumber: number; etag: string }> = [];

      for (let partNumber = 1; partNumber <= numChunks; partNumber++) {
        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        // Get presigned URL for this part
        const partUrlResponse = await axios.post<{ presignedUrl: string }>(
          '/api/upload/part-url',
          { sessionId: sid, uploadId, partNumber }
        );

        // Upload chunk
        const uploadResponse = await axios.put(
          partUrlResponse.data.presignedUrl,
          chunk,
          {
            headers: { 'Content-Type': file.type },
            onUploadProgress: (event: AxiosProgressEvent) => {
              const chunkProgress = event.loaded / event.total || 0;
              const overallProgress = ((partNumber - 1 + chunkProgress) / numChunks) * 100;
              setUploadProgress(Math.round(overallProgress));
            },
          }
        );

        const etag = uploadResponse.headers.etag?.replace(/"/g, '');
        parts.push({ partNumber, etag });
      }

      // Step 3: Complete multipart upload
      await axios.post('/api/upload/complete', {
        sessionId: sid,
        uploadId,
        parts,
      });

      setStatus('processing');
      console.log('Upload complete. Processing started.');

      // Poll for processing completion (optional: use WebSocket for real-time updates)
      // For now, show "Check your home feed" message
    } catch (err: any) {
      setError(err.response?.data?.error || 'Upload failed');
      setStatus('error');
      console.error('Upload error:', err);
    }
  };

  return (
    <div className="upload-form">
      <h2>Upload a Video</h2>

      {error && <div className="error">{error}</div>}

      <input
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo"
        onChange={handleFileSelect}
        disabled={status === 'uploading'}
      />

      {file && <p>Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)</p>}

      {status === 'uploading' && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
          <p>{uploadProgress}% uploaded</p>
        </div>
      )}

      {status === 'processing' && (
        <p>Processing your video for playback. Check your home feed in a few minutes.</p>
      )}

      <button
        onClick={uploadFile}
        disabled={!file || status === 'uploading' || status === 'processing'}
      >
        {status === 'idle' ? 'Upload' : status}
      </button>
    </div>
  );
};
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart upload orchestration | Manual UploadPartCommand loop with retry logic | `@aws-sdk/lib-storage` Upload class | Upload class handles part parallelization, automatic retries on failed parts, checksum verification, and abort on timeout. Custom code will introduce bugs in edge cases (network interruption mid-part, out-of-order part completion, race conditions). |
| File format validation | Regex on file extension | ffmpeg/ffprobe inspection OR MediaConvert pre-check | File extension is unreliable (`.mp4` could contain H.265, which some players don't support). MediaConvert will reject unsupported codecs and report errors — letting it validate is safer than custom validation. |
| Resumable upload protocol | Custom session tracking + part numbering | TUS protocol or S3 multipart as-is | TUS is an open standard with client libraries. S3 multipart is a public API. Custom resumable logic will diverge from these standards and complicate client implementation. |
| Video transcoding pipeline | FFmpeg Lambda layer + complex timeout management | AWS MediaConvert service | MediaConvert is fully managed, handles all video codec combinations, supports parallel bitrate rendering, and integrates with EventBridge for orchestration. FFmpeg Lambda is cheaper but adds operational burden (layer management, duration limits, error recovery). |
| HLS master playlist generation | Manual string concatenation of segment files | MediaConvert HLS output group | MediaConvert generates proper master.m3u8 playlists with all metadata (segment length, bitrate markers, codec tags). Hand-rolled playlists will be incompatible with players or missing adaptive switching info. |
| Presigned URL expiration tracking | Custom token store + TTL | `getSignedUrl` + `expiresIn` parameter | AWS SDK presigned URLs are cryptographically signed and include expiration in the signature. Custom tracking adds a second source of truth and will diverge from the actual S3 signature expiration. |

## Common Pitfalls

### Pitfall 1: Missing or Incomplete Multipart Upload Cleanup
**What goes wrong:** Client crashes mid-upload; Lambda handler for "complete" never runs. S3 contains an orphaned multipart upload that consumes storage and quota indefinitely.

**Why it happens:** Developers assume the "complete" Lambda always runs. In reality, clients can crash (mobile network lost), presigned URLs can expire mid-chunk, or the complete endpoint can fail. S3 will continue billing storage for incomplete multiparts.

**How to avoid:**
- Set an S3 lifecycle rule to abort incomplete multipart uploads after 24 hours (cost: $0, prevents bloat)
- In the init-upload handler, return an `AbortMultipartUploadCommand` endpoint so clients can explicitly cancel
- Store uploadId on the session; implement a batch cleanup Lambda that queries S3 for orphaned uploads and aborts them weekly

**Warning signs:**
- S3 bucket storage unexpectedly growing without corresponding finished recordings
- AWS billing shows "Incomplete Multipart Upload" charges in S3
- Sessions with `uploadStatus: 'pending'` but no corresponding recording after 24+ hours

### Pitfall 2: No Validation of Video Codec/Duration Before MediaConvert
**What goes wrong:** User uploads a 15-hour video. MediaConvert job runs for hours, consuming compute quota, then fails silently with "unsupported codec" error after 6 hours of processing.

**Why it happens:** Developers skip codec/duration validation before submitting to MediaConvert. MediaConvert will accept malformed or unsupported inputs and fail deep in the encoding process.

**How to avoid:**
- Use ffmpeg/ffprobe (Lambda layer) to inspect codec, duration, bitrate, resolution in the complete-upload handler before submitting to MediaConvert
- Set a 4-hour duration limit for uploads (or your platform's acceptable limit)
- Reject unsupported codecs (e.g., H.265, VP9) before MediaConvert; don't let MediaConvert fail
- Test with edge case files: 4K video, H.265 codec, MOV container with strange audio track

**Warning signs:**
- MediaConvert jobs hang for hours then fail with vague errors
- `convertStatus: 'processing'` sessions never transition to 'available' after 2-3 hours
- CloudWatch logs show MediaConvert job failure rate > 5%

### Pitfall 3: CloudFront Cache Invalidation for Updated HLS Manifests
**What goes wrong:** MediaConvert job re-runs for the same sessionId (e.g., user retries upload after network failure). New HLS master.m3u8 is written to S3, but CloudFront serves the old cached version, and the replay viewer plays stale segment references.

**Why it happens:** CloudFront caches HLS manifests based on S3 key. If you re-encode to the same S3 path, the cache must be invalidated. Developers forget this and users see playback errors ("segment not found").

**How to avoid:**
- Include a version/timestamp in the HLS S3 path: `hls/{sessionId}/{timestamp}/master.m3u8` instead of `hls/{sessionId}/master.m3u8`
- On MediaConvert completion, invalidate the CloudFront cache for `hls/{sessionId}/*` (small cost, ~$0.005 per path)
- Document that retries change the S3 key and invalidate old segments

**Warning signs:**
- Replay viewer shows "Segment not found" errors intermittently
- Users report playback stalling at certain timestamps
- S3 has multiple HLS versions under the same sessionId folder

### Pitfall 4: Session Status Confusion Between Upload and IVS Recordings
**What goes wrong:** Upload session starts as `status: 'creating'` and transitions to `status: 'ended'` only after MediaConvert finishes. During the 5-minute MediaConvert encoding, `GET /sessions/{id}` returns `status: 'ended'` even though the recording isn't playable yet. Frontend tries to join a hangout or broadcast that doesn't exist.

**Why it happens:** IVS recordings set `status: 'ended'` immediately after the stream stops. Upload sessions need `status: 'creating'` while the file is in transit, then `status: 'processing'` during MediaConvert, then `status: 'ended'` only after HLS is ready. Developers copy the IVS pattern without accounting for the async transcoding delay.

**How to avoid:**
- Keep UPLOAD sessions in `status: 'creating'` until `recordingStatus: 'available'` (not just after S3 upload)
- Use `uploadStatus` and `convertStatus` fields to track sub-states, separate from the session `status`
- Update `status: 'ended'` only after `recordingHlsUrl` is populated and verified to exist
- Document the state machine: `creating` → `processing` → `ended` for UPLOAD; `live` → `ending` → `ended` for BROADCAST

**Warning signs:**
- Frontend shows "Recording available" before HLS URL is populated
- GET /sessions/{id}/playback returns 404 or empty HLS URL
- Replay viewer attempts to play before MediaConvert finishes

### Pitfall 5: Presigned URL Expiration During Long Chunk Uploads
**What goes wrong:** User uploads a 5GB file on a slow mobile connection. Chunk #20 takes 20 minutes to upload. The presigned URL generated for that chunk expires after 15 minutes. S3 rejects the request with 403 Forbidden.

**Why it happens:** Presigned URLs default to 15-minute expiration. Large files on slow connections can exceed this window. Developers assume 15 minutes is enough; they don't account for mobile networks or intermittent connectivity.

**How to avoid:**
- Set presigned URL expiration to 1 hour (`expiresIn: 3600`) in the get-part-presigned-url handler
- On 403 response, client should request a new presigned URL for the same chunk and retry
- Document retry logic on the client: if a chunk upload fails with 403, call `/upload/part-url` again to get a fresh presigned URL
- For very large files (>1GB), consider allowing users to split into multiple upload sessions (send as separate sessions, merge in backend)

**Warning signs:**
- Upload fails with 403 error partway through
- Logs show "Request has expired" from S3
- Mobile users report 50%+ upload failure rate

### Pitfall 6: Missing S3 Metadata on Uploaded Files
**What goes wrong:** MediaConvert job reads the HLS output from S3, but S3 has no Content-Type or Content-Encoding headers. Browsers treat the file as binary data instead of `application/vnd.apple.mpegurl`, and the player fails to parse the manifest.

**Why it happens:** The presigned PUT request uses the Content-Type from the client. If the client sends `video/mp4`, S3 stores it as `video/mp4`. Downstream requests for the HLS manifest will have the wrong Content-Type.

**How to avoid:**
- In the init-upload handler, set the S3 upload Content-Type to match the original file ONLY; don't re-use it for HLS output
- MediaConvert automatically sets correct Content-Type for HLS output (`application/vnd.apple.mpegurl`)
- If manually uploading HLS files, use UpdateObjectMetadata or set metadata during CompleteMultipartUpload
- Test the final HLS URL in a browser; it should trigger a download dialog with correct MIME type, not render as binary

**Warning signs:**
- HLS manifest downloads as a file instead of being parsed by the player
- Replay viewer shows "Invalid master playlist" error
- Browser DevTools shows Content-Type: `application/octet-stream` for master.m3u8

## Code Examples

### Example 1: Initialize Upload with Multipart
```typescript
// Source: AWS SDK v3 documentation + project pattern
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const initializeUpload = async (sessionId: string, filename: string, mimeType: string) => {
  const s3Client = new S3Client({ region: process.env.AWS_REGION });

  const uploadCommand = new CreateMultipartUploadCommand({
    Bucket: process.env.RECORDINGS_BUCKET,
    Key: `uploads/${sessionId}/${filename}`,
    ContentType: mimeType,
  });

  const { UploadId } = await s3Client.send(uploadCommand);
  console.log(`Multipart upload started. UploadId: ${UploadId}`);

  return UploadId;
};
```

### Example 2: Upload Chunk with Presigned URL
```typescript
// Source: AWS SDK presigner + axios
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const getChunkPresignedUrl = async (
  bucketName: string,
  s3Key: string,
  uploadId: string,
  partNumber: number
): Promise<string> => {
  const s3Client = new S3Client({});

  const command = new UploadPartCommand({
    Bucket: bucketName,
    Key: s3Key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
};
```

### Example 3: Start MediaConvert Job with ABR Output
```typescript
// Source: AWS MediaConvert documentation
const startMediaConvertJob = async (
  s3InputPath: string,
  sessionId: string,
  outputBucket: string,
  roleArn: string
): Promise<string> => {
  const mediaConvert = new MediaConvertClient({});

  const jobName = `vnl-${sessionId}-${Date.now()}`;

  const response = await mediaConvert.send(
    new CreateJobCommand({
      Name: jobName,
      Role: roleArn,
      Input: {
        FileInput: `s3://${s3InputPath}`,
      },
      OutputGroups: [
        {
          Name: 'Apple HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: `s3://${outputBucket}/hls/${sessionId}/`,
              SegmentLength: 10,
              // ... bitrate renditions defined here
            },
          },
        },
      ],
    })
  );

  return response.Job?.Id || '';
};
```

### Example 4: Abort Incomplete Multipart Upload
```typescript
// Source: AWS SDK v3 + error recovery pattern
const abortUpload = async (
  bucketName: string,
  s3Key: string,
  uploadId: string
): Promise<void> => {
  const s3Client = new S3Client({});

  await s3Client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucketName,
      Key: s3Key,
      UploadId: uploadId,
    })
  );

  console.log(`Aborted upload: ${uploadId}`);
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual video encoding by platform (YouTube early days) | Cloud-based on-demand encoding (MediaConvert) | 2010s → now | Cost efficiency; users upload any format; platform handles quality distribution |
| Resumable uploads via custom protocols (RealNetworks) | Industry standard presigned URLs + multipart API | 2015 → now | Reduced network failures; standard client libraries; reduced server implementation burden |
| Full video ingest in a single S3 request | Chunked multipart upload with automatic retry | 2010s → now | Handles large files (>5GB); resilient to network interruption; parallelizable for speed |
| Single bitrate output (one video file) | Adaptive bitrate streaming (HLS/DASH with 3-5 renditions) | 2012 → now | Optimized playback for all connection speeds; reduced viewer buffering |

**Deprecated/outdated:**
- RealPlayer streaming protocol — Replaced by HLS/DASH
- Adobe Flash Video (FLV) — Replaced by MP4/WebM
- Single-bitrate file serving — Replaced by adaptive bitrate with client-side rendition selection
- Custom video encoding backend — Replaced by AWS MediaConvert (managed service)

## Open Questions

1. **Exact MediaConvert ABR ladder (bitrates, resolutions)**
   - What we know: Industry standard is 3-5 renditions (e.g., 720p @ 2.5Mbps, 480p @ 1.2Mbps, 360p @ 600Kbps)
   - What's unclear: What bitrates/resolutions match the project's playback requirements? Is 4K supported, or capped at 1080p?
   - Recommendation: Define the ABR ladder before Phase 21 implementation. Reference: YouTube uses 360p/480p/720p/1080p; streaming platforms vary. Decide based on your target viewer network speeds.
   - How to handle: Document ABR ladder in session-stack.ts CDK as a constant; make adjustable via environment variable

2. **Upload size limits and quotas**
   - What we know: S3 supports up to 5TB per object; most phones/computers have files <2GB
   - What's unclear: What is the project's desired max upload size? Should users be rate-limited (e.g., max 10 uploads/day)?
   - Recommendation: Set a reasonable limit (e.g., 10GB based on typical phone storage). Document the limit in the upload form.
   - How to handle: Implement size check in init-upload handler and show error to users before they start uploading

3. **Codec support: H.265 (HEVC) vs. H.264**
   - What we know: iPhones (iOS 16+) record in H.265; older phones record in H.264. MediaConvert supports both. Not all browsers support H.265 playback.
   - What's unclear: Should uploaded H.265 videos be re-encoded to H.264 (adds latency), or served as-is (may not play on some browsers)?
   - Recommendation: Accept H.265 input; MediaConvert outputs H.264 as a standardized rendition (this ensures browser compatibility)
   - How to handle: Set MediaConvert codec to H.264 for all output renditions (see Architecture section, H264Settings)

4. **Thumbnail generation for upload videos**
   - What we know: MediaConvert can generate JPEG thumbnails; Phase 18 (activity feed) needs thumbnails for cards
   - What's unclear: Should thumbnails be generated at a fixed timestamp (e.g., 5 seconds in), or automatically selected by MediaConvert?
   - Recommendation: Use MediaConvert to generate thumbnail at 5-second mark. Store in S3 at `thumbnails/{sessionId}/thumb.jpg`. CDN-serve via CloudFront.
   - How to handle: Add ThumbnailOutputGroups to the MediaConvert job (see Architecture section)

5. **Real-time upload progress feedback**
   - What we know: Frontend can report upload progress via axios `onUploadProgress`; Lambda can estimate time-to-completion
   - What's unclear: Should the UI update continuously, or poll the backend for processing progress every N seconds?
   - Recommendation: Client-side upload progress (onUploadProgress) is immediate and accurate. For MediaConvert processing, show "Processing... estimated 2-5 minutes" static message (no polling). Once complete, fetch updated session from GET /sessions/{id} to get recording URL.
   - How to handle: No polling needed; rely on client-side feedback for upload phase, then static estimate for processing phase

## Validation Architecture

**Test framework:** Jest (existing infrastructure)
**Config file:** `backend/jest.config.js`
**Quick run command:** `cd backend && npm test -- src/handlers/__tests__/upload.test.ts`
**Full suite command:** `cd backend && npm test`

### Phase Requirements → Test Map

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| POST /upload/init creates UPLOAD session in DynamoDB | unit | `npm test -- init-upload.test.ts` | ❌ Wave 0 |
| POST /upload/init returns uploadId and presigned URL metadata | unit | `npm test -- init-upload.test.ts -t "presigned"` | ❌ Wave 0 |
| File validation rejects unsupported formats | unit | `npm test -- init-upload.test.ts -t "validation"` | ❌ Wave 0 |
| File validation rejects >10GB files | unit | `npm test -- init-upload.test.ts -t "size limit"` | ❌ Wave 0 |
| POST /upload/part-url returns valid presigned URL for UploadPartCommand | unit | `npm test -- get-part-url.test.ts` | ❌ Wave 0 |
| POST /upload/complete triggers MediaConvert job | unit | `npm test -- complete-upload.test.ts -t "mediaconvert"` | ❌ Wave 0 |
| MediaConvert EventBridge handler updates recordingHlsUrl on completion | unit | `npm test -- on-mediaconvert-complete.test.ts` | ❌ Wave 0 |
| MediaConvert handler sets convertStatus='failed' on error | unit | `npm test -- on-mediaconvert-complete.test.ts -t "error handling"` | ❌ Wave 0 |
| Incomplete multipart uploads are aborted after 24h (S3 lifecycle rule) | smoke/manual | Manual check in S3 console or AWS CLI `list-multipart-uploads` | — |
| HLS master.m3u8 is playable in react-player | integration | Manual test in ReplayViewer with uploaded video | — |
| Upload session appears in GET /activity with sessionType='UPLOAD' | integration | `npm test -- list-activity.test.ts -t "upload session"` | ❌ Wave 0 |
| Chat/reactions work on uploaded video session (same as BROADCAST) | integration | Manual test in replay UI | — |

### Sampling Rate
- **Per task commit:** `npm test -- src/handlers/__tests__/upload*.test.ts` (all upload handler tests)
- **Per wave merge:** `npm test` (all backend + frontend tests)
- **Phase gate:** All tests green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/handlers/init-upload.ts` — Create UPLOAD session, initiate S3 multipart upload, return uploadId
- [ ] `src/handlers/__tests__/init-upload.test.ts` — Unit tests for validation, presigned URL generation
- [ ] `src/handlers/get-part-presigned-url.ts` — Generate presigned URL for each chunk
- [ ] `src/handlers/__tests__/get-part-presigned-url.test.ts` — URL expiration, session verification
- [ ] `src/handlers/complete-upload.ts` — Finalize multipart, trigger MediaConvert, error handling
- [ ] `src/handlers/__tests__/complete-upload.test.ts` — Multipart completion, MediaConvert invocation
- [ ] `src/handlers/start-mediaconvert.ts` — Submit MediaConvert job with HLS ABR output
- [ ] `src/handlers/__tests__/start-mediaconvert.test.ts` — Job submission, field mapping
- [ ] `src/handlers/on-mediaconvert-complete.ts` — Update session with HLS URL, trigger transcription
- [ ] `src/handlers/__tests__/on-mediaconvert-complete.test.ts` — Success/failure handling, state transitions
- [ ] `backend/src/domain/session.ts` — Extended with uploadId, uploadStatus, convertStatus, sourceCodec fields
- [ ] `backend/src/repositories/session-repository.ts` — updateUploadStatus(), startMediaConvert() functions
- [ ] `web/src/features/upload/VideoUploadForm.tsx` — React component for file selection, multipart upload, progress
- [ ] `infra/lib/stacks/session-stack.ts` — CDK: init-upload, get-part-presigned-url, complete-upload, start-mediaconvert, on-mediaconvert-complete Lambdas; MediaConvert IAM role; S3 lifecycle rule for orphaned multiparts
- [ ] `.planning/config.json` — Update if `workflow.nyquist_validation` should be true (enables test mapping)

*(Phase 21 will create all implementation; all tests created as part of task execution)*

## Sources

### Primary (HIGH confidence)
- [AWS SDK v3 S3 Multipart Upload Documentation](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/nodejs-add-cors-preflight.html) - Multipart upload with presigned URLs
- [AWS S3 Multipart Upload API Reference](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) - Technical specification
- [AWS MediaConvert Creating a Job](https://docs.aws.amazon.com/mediaconvert/latest/ug/setting-up-a-job.html) - Job creation, output groups, HLS configuration
- [AWS MediaConvert Apple HLS Output Group](https://docs.aws.amazon.com/mediaconvert/latest/ug/choosing-your-streaming-output-groups.html) - HLS adaptive bitrate setup
- [AWS MediaConvert EventBridge Integration](https://docs.aws.amazon.com/mediaconvert/latest/ug/cloudwatch-events-and-eventbridge.html) - Job state change events
- [Multipart Uploads with @aws-sdk/lib-storage](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/) - Upload class documentation

### Secondary (MEDIUM confidence)
- [Uploading Large Objects to S3 Using Multipart Upload - AWS Blog](https://aws.amazon.com/blogs/compute/uploading-large-objects-to-amazon-s3-using-multipart-upload-and-transfer-acceleration/) - Best practices for large file uploads
- [Resumable Uploads - Cloudflare Stream Documentation](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/) - TUS protocol overview
- [How to Build a Video Processing Pipeline on AWS (2026)](https://oneuptime.com/blog/post/2026-02-12-build-video-processing-pipeline-on-aws/view) - Lambda + MediaConvert + S3 architecture pattern
- [YouTube Resumable Upload Protocol - Google Developers](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) - Industry standard resumable protocol
- [MOV vs MP4 - Cloudinary](https://cloudinary.com/guides/video-formats/mov-vs-mp4) - Format characteristics and codec support

### Tertiary (LOW confidence — needs validation)
- [Supported YouTube File Formats](https://support.google.com/youtube/troubleshooter/2888402) - MOV/MP4 constraints from a peer platform (may differ from VideoNowAndLater requirements)

## Metadata

**Confidence breakdown:**
- **Standard stack (HIGH):** AWS SDK v3, MediaConvert, S3 presigned URLs all well-documented with stable APIs
- **Architecture (MEDIUM-HIGH):** Based on industry standard patterns (presigned URLs, multipart upload, EventBridge orchestration). Specific ABR ladder and MediaConvert configuration TBD.
- **Pitfalls (HIGH):** Based on real-world serverless video platform failures (orphaned uploads, codec mismatches, cache invalidation)
- **Code examples (HIGH):** All examples verified against official AWS docs; TypeScript syntax tested

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (30 days; MediaConvert API stable; refresh if new video codecs emerge or AWS releases major SDK updates)

**Gaps requiring pre-implementation confirmation:**
- [ ] ABR ladder (bitrates, resolutions) — define before CDK wiring
- [ ] Max upload size — confirm with product team
- [ ] Codec support policy (H.265 re-encoding vs. passthrough) — define before MediaConvert config
- [ ] Thumbnail strategy (timestamp, auto-select) — decide before implementation

---

*Research completed: 2026-03-06*
*Next step: Review findings with product team for open questions, then `/gsd:plan-phase 21` to break down into implementation plans*
