# Phase 5: Recording Foundation - Research

**Researched:** 2026-03-02
**Domain:** AWS IVS recording infrastructure, S3 storage, CloudFront distribution, EventBridge lifecycle events
**Confidence:** HIGH

## Summary

Phase 5 implements automatic recording of all broadcast and hangout sessions to S3 with complete metadata tracking. This is foundational infrastructure that downstream phases (replay viewer, reactions) depend on. The implementation extends existing v1.0 patterns (EventBridge lifecycle events, DynamoDB single-table design, resource pool management) with IVS RecordingConfiguration, S3 bucket, CloudFront distribution, and recording metadata storage.

The recommended approach uses IVS's native recording capabilities with EventBridge integration for lifecycle events. All AWS CDK constructs are available in stable aws-cdk-lib (no alpha packages needed). Critical success factors: same-region enforcement (S3 bucket must be in same region as RecordingConfiguration), handling reconnect window delays (2-5 minute delay before recording-ended events), and clear UI states for processing/failed recordings.

**Primary recommendation:** Use one shared RecordingConfiguration for all sessions (both broadcasts and hangouts), attach during pool replenishment, implement two-phase metadata population (recording-started sets processing state, recording-ended sets final metadata), and use CloudFront with OAC for private S3 bucket access.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Recording Metadata Schema:**
- Structure: Flat fields added directly to Session interface (not nested object)
- Fields: `recordingS3Path`, `recordingDuration`, `thumbnailUrl`, `recordingHlsUrl`, `recordingStatus`
- Population timing: Two-phase (recording-started sets processing state, recording-ended sets final metadata)
- Status states: `pending`, `processing`, `available`, `failed`

**Error Handling & Reconnects:**
- UI processing state: Show "Processing recording..." when `recordingStatus='processing'`
- Failed recordings: Keep visible in feed with error message (`recordingStatus='failed'`)
- Reconnect window handling: Rely on IVS automatic stream merging (no special handling)
- EventBridge handlers: Create separate recording-started Lambda handler

**RecordingConfiguration Settings:**
- Count: One shared RecordingConfiguration for all sessions
- Thumbnail generation: 10 second interval, 720p resolution
- Video renditions: ALL (full ABR stack from LOWEST_RESOLUTION through FULL_HD)
- Attachment timing: During pool replenishment in `replenish-pool.ts`

### Claude's Discretion

- CloudFront distribution configuration (OAC vs signed URLs, cache settings, regional distribution)
- S3 bucket lifecycle policies (retention, storage class transitions)
- Error message text and UI design for processing/failed states
- DynamoDB attribute names (recordingS3Path vs recording_s3_path vs recordingS3Key)
- EventBridge rule retry policies and dead letter queue setup

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REC-01 | All broadcast sessions auto-record to S3 using IVS RecordingConfiguration | RecordingConfiguration + pool attachment pattern |
| REC-02 | All hangout sessions auto-record to S3 using IVS RealTime composite recording | Same RecordingConfiguration applies to Stages |
| REC-03 | S3 bucket and RecordingConfiguration deployed in same AWS region | CDK same-region enforcement pattern |
| REC-04 | CloudFront distribution with OAC serves private S3 recordings | CloudFront OAC standard pattern |
| REC-05 | EventBridge rules capture recording lifecycle events (started, ended, failed) | EventBridge event pattern configuration |
| REC-06 | Lambda handlers process recording-ended events and extract metadata | recording-ended.json parsing pattern |
| REC-07 | Session items in DynamoDB extended with recording metadata | Session interface extension pattern |
| REC-08 | Recording reconnect windows handled (fragmented streams merged or flagged) | IVS auto-merge + processing UI state |

</phase_requirements>

## Standard Stack

### Core (No New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aws-cdk-lib | ^2.170.0 (existing) | IVS RecordingConfiguration, S3, CloudFront constructs | All L1 constructs available (CfnRecordingConfiguration, CfnStorageConfiguration) |
| @aws-sdk/client-ivs | ^3.x (existing) | IVS API calls in pool replenishment | Already used for CreateChannel, CreateStage |
| @aws-sdk/client-s3 | ^3.x (existing) | S3 metadata file access (recording-ended.json) | Standard for S3 operations |
| @aws-sdk/lib-dynamodb | ^3.x (existing) | DynamoDB session updates | Already used for session repository |

### Supporting (Phase 6 - Replay Viewer)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-player | ^2.16.0 | HLS replay playback | Phase 6 (not needed in Phase 5 backend) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CloudFront with OAC | S3 presigned URLs | OAC better: automatic URL generation, no 7-day expiry, simpler architecture |
| Single RecordingConfiguration | Per-session configs | Single config: simpler management, consistent settings, no quota concerns |
| Flat Session fields | Nested recording object | Flat: simpler DynamoDB queries, easier GraphQL schema, matches v1.0 pattern |

**Installation:**
```bash
# No new backend dependencies required
# Phase 5 uses existing AWS SDK packages
```

## Architecture Patterns

### Recommended Project Structure
```
backend/src/
├── domain/
│   └── session.ts              # Extend with recording metadata fields
├── handlers/
│   ├── recording-started.ts    # NEW: Set processing state
│   ├── recording-ended.ts      # EXTEND: Store metadata, set final status
│   └── replenish-pool.ts       # EXTEND: Attach recordingConfigurationArn
├── repositories/
│   └── session-repository.ts   # EXTEND: Methods to update recording metadata
infra/lib/stacks/
└── session-stack.ts            # EXTEND: Add S3, CloudFront, RecordingConfiguration
```

### Pattern 1: IVS RecordingConfiguration with S3 + CloudFront

**What:** L1 CDK constructs create RecordingConfiguration with S3 bucket and CloudFront distribution for private access.

**When to use:** All IVS recording scenarios (broadcasts and hangouts).

**Example:**
```typescript
// Source: AWS CDK API Reference + IVS Recording Guide
import { CfnRecordingConfiguration, CfnStorageConfiguration } from 'aws-cdk-lib/aws-ivs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

// S3 bucket for recordings (same region as IVS resources)
const recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
  bucketName: 'vnl-recordings',
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  removalPolicy: RemovalPolicy.DESTROY, // Dev/test only
  autoDeleteObjects: true, // Dev/test only
});

// CloudFront Origin Access Control for private bucket access
const oac = new cloudfront.CfnOriginAccessControl(this, 'RecordingsOAC', {
  originAccessControlConfig: {
    name: 'vnl-recordings-oac',
    originAccessControlOriginType: 's3',
    signingBehavior: 'always',
    signingProtocol: 'sigv4',
  },
});

// CloudFront distribution
const distribution = new cloudfront.Distribution(this, 'RecordingsDistribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(recordingsBucket, {
      originAccessControl: oac,
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // Long cache for immutable recordings
  },
});

// Grant CloudFront read access to S3 bucket
recordingsBucket.addToResourcePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject'],
    resources: [`${recordingsBucket.bucketArn}/*`],
    principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
    conditions: {
      StringEquals: {
        'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
      },
    },
  })
);

// IVS Recording Configuration (L1 construct)
const storageConfig = new CfnStorageConfiguration(this, 'RecordingStorageConfig', {
  s3: {
    bucketName: recordingsBucket.bucketName,
  },
});

const recordingConfig = new CfnRecordingConfiguration(this, 'RecordingConfig', {
  destinationConfiguration: {
    s3: {
      bucketName: recordingsBucket.bucketName,
    },
  },
  thumbnailConfiguration: {
    recordingMode: 'INTERVAL',
    targetIntervalSeconds: 10,
    resolution: 'HD', // 720p
  },
  renditionConfiguration: {
    renditions: ['ALL'], // Full ABR stack
  },
});

// Export for use in pool replenishment
new CfnOutput(this, 'RecordingConfigurationArn', {
  value: recordingConfig.attrArn,
  exportName: 'vnl-recording-config-arn',
});

new CfnOutput(this, 'CloudFrontDomainName', {
  value: distribution.distributionDomainName,
  exportName: 'vnl-recordings-domain',
});
```

### Pattern 2: Two-Phase Metadata Population

**What:** Separate recording-started and recording-ended handlers populate metadata in stages.

**When to use:** All recording lifecycle tracking (prevents long "unknown status" periods).

**Example:**
```typescript
// Source: IVS EventBridge Integration Guide

// recording-started.ts - Phase 1: Set processing state
export const handler = async (event: EventBridgeEvent<'IVS Recording State Change', RecordingStartDetail>) => {
  const { channel_name, recording_s3_key_prefix } = event.detail;

  // Find session by channel ARN
  const session = await findSessionByChannelArn(channel_name);

  // Update: set processing state immediately
  await updateRecordingMetadata(session.sessionId, {
    recordingStatus: 'processing',
    recordingS3Path: recording_s3_key_prefix, // e.g., "ivs/v1/123456/2026/3/2/..."
  });
};

// recording-ended.ts - Phase 2: Set final metadata and status
export const handler = async (event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail>) => {
  const { channel_name, recording_s3_bucket_name, recording_s3_key_prefix, recording_duration_ms } = event.detail;

  // Find session by channel ARN
  const session = await findSessionByChannelArn(channel_name);

  // Compute CloudFront URLs
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN!;
  const recordingHlsUrl = `https://${cloudFrontDomain}/${recording_s3_key_prefix}/playlist.m3u8`;
  const thumbnailUrl = `https://${cloudFrontDomain}/${recording_s3_key_prefix}/thumb-0.jpg`;

  // Update: final metadata and status
  await updateRecordingMetadata(session.sessionId, {
    recordingDuration: recording_duration_ms,
    recordingHlsUrl,
    thumbnailUrl,
    recordingStatus: event.detail.recording_status === 'Recording End' ? 'available' : 'failed',
  });
};
```

### Pattern 3: Pool Replenishment with RecordingConfiguration Attachment

**What:** Attach recordingConfigurationArn when creating channels/stages during pool replenishment.

**When to use:** All resource pool creation (ensures recording-ready resources).

**Example:**
```typescript
// Source: IVS API Reference (CreateChannel/CreateStage)

// replenish-pool.ts - Attach recording config during creation
import { CreateChannelCommand, CreateStageCommand } from '@aws-sdk/client-ivs';

const recordingConfigArn = process.env.RECORDING_CONFIGURATION_ARN!;

// For broadcast channels
const createChannelResult = await ivsClient.send(new CreateChannelCommand({
  name: `vnl-channel-${Date.now()}`,
  latencyMode: 'LOW',
  type: 'STANDARD',
  recordingConfigurationArn: recordingConfigArn, // Attach here
}));

// For hangout stages
const createStageResult = await ivsClient.send(new CreateStageCommand({
  name: `vnl-stage-${Date.now()}`,
  participantTokenConfigurations: [
    { duration: 43200, userId: '*', capabilities: ['PUBLISH', 'SUBSCRIBE'] }
  ],
  autoParticipantRecordingConfiguration: {
    storageConfigurationArn: recordingConfigArn, // Attach here (RealTime uses StorageConfiguration)
    mediaTypes: ['AUDIO_VIDEO'],
  },
}));
```

### Anti-Patterns to Avoid

- **Per-session RecordingConfiguration creation:** Slow, quota limits (100 per account), unnecessary complexity
- **Manual S3 bucket policy management:** Use CloudFront OAC instead (simpler, automatic)
- **Nested recording metadata object:** Breaks DynamoDB query patterns, complicates GraphQL schema
- **Polling S3 for recording-ended.json:** Use EventBridge events instead (real-time, reliable)
- **Ignoring reconnect window:** Users see "Recording failed" during normal 30-60s processing window

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video transcoding/ABR | Custom ffmpeg Lambda | IVS RecordingConfiguration renditions: 'ALL' | IVS handles ABR ladder automatically, supports adaptive quality, tested at scale |
| Thumbnail generation | Custom ffmpeg extraction | IVS thumbnailConfiguration | Automatic interval-based generation, matches video timeline, no compute cost |
| HLS manifest generation | Custom m3u8 writer | IVS auto-generated manifests | Standards-compliant, handles discontinuities, includes all renditions |
| Recording lifecycle tracking | S3 event notifications + custom state machine | IVS EventBridge integration | Reliable events for start/end/failure, includes metadata, handles reconnect windows |
| Private S3 access | Custom presigned URL generator | CloudFront with OAC | No expiry management, automatic URL derivation, better caching |

**Key insight:** IVS recording is a fully-managed service. The only custom code needed is EventBridge event handlers to store metadata in DynamoDB. All transcoding, thumbnail generation, manifest creation, and lifecycle management is handled by AWS. Trying to build custom solutions introduces reliability issues and operational burden.

## Common Pitfalls

### Pitfall 1: Regional Mismatch Between RecordingConfiguration and S3 Bucket

**What goes wrong:** RecordingConfiguration creation succeeds but recordings silently fail with no clear error messages.

**Why it happens:** IVS requires S3 bucket in same region as RecordingConfiguration. Cross-region writes are not supported.

**How to avoid:**
- Enforce same region in CDK: validate `this.region` matches bucket region
- Use stack synthesis to ensure consistent region across all constructs
- Add integration test that verifies recording actually works (not just resource creation)

**Warning signs:**
- RecordingConfiguration shows in console but no files appear in S3 after stream ends
- EventBridge receives "Recording Start" but never "Recording End"
- CloudWatch shows no errors (silent failure)

### Pitfall 2: Recording End Event Delays Due to Reconnect Window

**What goes wrong:** Users see "Recording processing..." for 2-5 minutes after stream ends, believe recording failed.

**Why it happens:** IVS waits for reconnect window (default 60 seconds for Channels, configurable for Stages) before finalizing recording. EventBridge events delayed until window expires.

**How to avoid:**
- Implement explicit "Processing recording..." UI state with spinner
- Track stream end time separately from recording end time
- Show estimated completion time based on reconnect window setting
- Don't hide session or show "failed" during normal processing delay

**Warning signs:**
- Users report "recording stuck processing"
- Gap between stream end and recording metadata appearing
- Support tickets about "missing recordings" that appear minutes later

### Pitfall 3: Ignoring Recording Status in EventBridge Events

**What goes wrong:** Failed recordings treated as successful, users see broken playback links.

**Why it happens:** EventBridge "IVS Recording State Change" events include `recording_status` field that can be "Recording End" (success) or "Recording End Failure" (error).

**How to avoid:**
- Check `event.detail.recording_status` value in recording-ended handler
- Set `recordingStatus='failed'` on "Recording End Failure" events
- Display error state in UI but keep session visible (user can see stream happened)
- Log error details from event for debugging

**Warning signs:**
- Users report "video won't play" on some recordings
- 404 errors when accessing HLS URLs
- No pattern to failures (random sessions affected)

### Pitfall 4: Assuming Thumbnail Array Index Matches Time

**What goes wrong:** Thumbnail selection logic breaks, wrong thumbnails shown as preview.

**Why it happens:** IVS thumbnails generated at intervals but not guaranteed to align with exact timestamps. Gaps occur during stream reconnects or encoder issues.

**How to avoid:**
- Use thumbnail metadata from recording-ended.json (includes actual timestamps)
- Parse thumbnail filenames (contain timestamp info)
- Default to first thumbnail (thumb-0.jpg) for preview
- Don't assume regular interval spacing

**Warning signs:**
- Thumbnail previews show wrong moment in video
- Thumbnail count doesn't match expected (duration / interval)
- Missing thumbnails at specific time ranges

### Pitfall 5: Not Handling Stage Participant Recording Composition

**What goes wrong:** Hangout recordings missing participants, incomplete composite video.

**Why it happens:** IVS RealTime Stage recording creates separate files per participant. Composite recording requires all participants to be captured.

**How to avoid:**
- Use `autoParticipantRecordingConfiguration` on Stage creation
- Set `mediaTypes: ['AUDIO_VIDEO']` to capture both
- Handle multiple recording S3 paths in metadata (array of participant recordings)
- Consider server-side composition for single playback file (future Phase 8 decision)

**Warning signs:**
- Hangout recordings only show one participant
- Audio/video desync in composite playback
- S3 contains multiple recording folders per session

## Code Examples

Verified patterns from official sources:

### EventBridge Rule for Recording Lifecycle Events

```typescript
// Source: AWS CDK EventBridge API Reference

// Recording Start events
new events.Rule(this, 'RecordingStartRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      event_name: ['Recording Start'],
    },
  },
  targets: [new targets.LambdaFunction(recordingStartedFn)],
  description: 'Set session recording status to processing',
});

// Recording End events (success and failure)
new events.Rule(this, 'RecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      event_name: ['Recording End'],
    },
  },
  targets: [new targets.LambdaFunction(recordingEndedFn)],
  description: 'Store recording metadata and set final status',
});
```

### Session Interface Extension with Recording Metadata

```typescript
// Source: Project-specific pattern extending existing Session interface

export enum RecordingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  AVAILABLE = 'available',
  FAILED = 'failed',
}

export interface Session {
  sessionId: string;
  userId: string;
  sessionType: SessionType;
  status: SessionStatus;
  claimedResources: ClaimedResources;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  version: number;

  // Recording metadata (all optional - only populated after stream starts)
  recordingS3Path?: string;         // S3 key prefix from IVS
  recordingDuration?: number;       // Duration in milliseconds
  thumbnailUrl?: string;            // CloudFront URL for thumbnail
  recordingHlsUrl?: string;         // CloudFront URL for HLS manifest
  recordingStatus?: RecordingStatus; // Lifecycle state
}
```

### Computing CloudFront URLs from S3 Path

```typescript
// Source: CloudFront URL construction pattern

function buildRecordingUrls(s3KeyPrefix: string, cloudFrontDomain: string) {
  // IVS recording structure: {prefix}/playlist.m3u8, {prefix}/thumb-{N}.jpg
  const hlsUrl = `https://${cloudFrontDomain}/${s3KeyPrefix}/playlist.m3u8`;
  const thumbnailUrl = `https://${cloudFrontDomain}/${s3KeyPrefix}/thumb-0.jpg`;

  return { hlsUrl, thumbnailUrl };
}

// Usage in recording-ended handler
const { hlsUrl, thumbnailUrl } = buildRecordingUrls(
  event.detail.recording_s3_key_prefix,
  process.env.CLOUDFRONT_DOMAIN!
);
```

### DynamoDB Session Repository Update Pattern

```typescript
// Source: Existing session-repository.ts pattern extended for recording metadata

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

export async function updateRecordingMetadata(
  tableName: string,
  sessionId: string,
  metadata: Partial<Pick<Session, 'recordingS3Path' | 'recordingDuration' | 'thumbnailUrl' | 'recordingHlsUrl' | 'recordingStatus'>>
): Promise<void> {
  const docClient = getDocumentClient();

  // Build update expression dynamically for provided fields
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  if (metadata.recordingS3Path !== undefined) {
    updateExpressions.push('#recordingS3Path = :recordingS3Path');
    expressionAttributeNames['#recordingS3Path'] = 'recordingS3Path';
    expressionAttributeValues[':recordingS3Path'] = metadata.recordingS3Path;
  }

  if (metadata.recordingDuration !== undefined) {
    updateExpressions.push('#recordingDuration = :recordingDuration');
    expressionAttributeNames['#recordingDuration'] = 'recordingDuration';
    expressionAttributeValues[':recordingDuration'] = metadata.recordingDuration;
  }

  if (metadata.thumbnailUrl !== undefined) {
    updateExpressions.push('#thumbnailUrl = :thumbnailUrl');
    expressionAttributeNames['#thumbnailUrl'] = 'thumbnailUrl';
    expressionAttributeValues[':thumbnailUrl'] = metadata.thumbnailUrl;
  }

  if (metadata.recordingHlsUrl !== undefined) {
    updateExpressions.push('#recordingHlsUrl = :recordingHlsUrl');
    expressionAttributeNames['#recordingHlsUrl'] = 'recordingHlsUrl';
    expressionAttributeValues[':recordingHlsUrl'] = metadata.recordingHlsUrl;
  }

  if (metadata.recordingStatus !== undefined) {
    updateExpressions.push('#recordingStatus = :recordingStatus');
    expressionAttributeNames['#recordingStatus'] = 'recordingStatus';
    expressionAttributeValues[':recordingStatus'] = metadata.recordingStatus;
  }

  // Increment version for optimistic locking
  updateExpressions.push('#version = #version + :inc');
  expressionAttributeNames['#version'] = 'version';
  expressionAttributeValues[':inc'] = 1;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: `SESSION#${sessionId}`,
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual ffmpeg transcoding in Lambda | IVS RecordingConfiguration with renditions:'ALL' | IVS launch (2020) | Automatic ABR, no compute management |
| S3 event notifications for lifecycle | EventBridge IVS Recording State Change events | IVS EventBridge integration (2021) | Rich metadata in events, reliable delivery |
| S3 presigned URLs | CloudFront with Origin Access Control (OAC) | OAC launch (2022) | No expiry, simpler architecture, better caching |
| Origin Access Identity (OAI) | Origin Access Control (OAC) | 2022 | Better security, supports all S3 features |
| Per-session recording configs | Shared RecordingConfiguration | Best practice pattern | Simpler management, quota efficiency |

**Deprecated/outdated:**
- CloudFront Origin Access Identity (OAI): Replaced by OAC (better security, more features)
- @aws-cdk/aws-ivs-alpha: L2 constructs experimental, use stable L1 constructs from aws-cdk-lib
- Manual thumbnail extraction: IVS thumbnailConfiguration handles automatically

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.x (existing in package.json) |
| Config file | jest.config.js (existing) |
| Quick run command | `npm test -- --testPathPattern=recording` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REC-01 | Broadcast sessions auto-record to S3 | integration | `npm test -- handlers/recording-started.test.ts -x` | ❌ Wave 0 |
| REC-02 | Hangout sessions auto-record to S3 | integration | `npm test -- handlers/recording-started.test.ts -x` | ❌ Wave 0 |
| REC-03 | Same-region enforcement | unit | `npm test -- stacks/session-stack.test.ts -x` | ❌ Wave 0 |
| REC-04 | CloudFront OAC serves recordings | integration | `npm test -- cloudfront-access.test.ts -x` | ❌ Wave 0 |
| REC-05 | EventBridge rules capture events | unit | `npm test -- stacks/session-stack.test.ts -x` | ❌ Wave 0 |
| REC-06 | recording-ended extracts metadata | unit | `npm test -- handlers/recording-ended.test.ts -x` | ❌ Wave 0 |
| REC-07 | Session metadata extension | unit | `npm test -- domain/session.test.ts -x` | ❌ Wave 0 |
| REC-08 | Reconnect windows handled | integration | `npm test -- handlers/recording-ended.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern={modified-handler} -x` (fast unit tests only)
- **Per wave merge:** `npm test` (full suite including integration tests)
- **Phase gate:** Full suite green + manual verification of actual S3 recording before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `backend/src/handlers/__tests__/recording-started.test.ts` — covers REC-01, REC-02
- [ ] `backend/src/handlers/__tests__/recording-ended.test.ts` — covers REC-06, REC-08
- [ ] `infra/lib/stacks/__tests__/session-stack.test.ts` — covers REC-03, REC-05
- [ ] `backend/src/domain/__tests__/session.test.ts` — covers REC-07
- [ ] `tests/integration/cloudfront-access.test.ts` — covers REC-04

## Open Questions

1. **CloudFront cache invalidation strategy for failed recordings**
   - What we know: Failed recordings should show error state, not cached "processing" state
   - What's unclear: Whether to use CloudFront cache-control headers or explicit invalidation
   - Recommendation: Use `Cache-Control: no-cache` for thumbnail.jpg during processing state, switch to long cache after available

2. **S3 lifecycle policy for old recordings**
   - What we know: Recordings accumulate storage costs over time
   - What's unclear: Retention period appropriate for MVP (30 days? 90 days? indefinite?)
   - Recommendation: Start with indefinite retention, add lifecycle policy in Phase 7 after observing storage growth

3. **Handling partial recording failures (some renditions missing)**
   - What we know: IVS can fail to generate specific renditions while others succeed
   - What's unclear: Whether to mark entire recording as failed or serve available renditions
   - Recommendation: Check recording-ended.json for renditions array, mark failed if missing baseline rendition (480p), serve partial if only high renditions missing

## Sources

### Primary (HIGH confidence)

- [AWS IVS Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html) — RecordingConfiguration setup
- [AWS IVS RealTime Stage Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-composite-recording.html) — Stage recording patterns
- [AWS IVS EventBridge Integration](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html) — Event patterns and metadata
- [AWS CDK CfnRecordingConfiguration API](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ivs.CfnRecordingConfiguration.html) — L1 construct reference
- [CloudFront Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) — OAC setup pattern
- [DynamoDB Single-Table Design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html) — Access patterns

### Secondary (MEDIUM confidence)

- Project-specific: `.planning/research/SUMMARY.md` — v1.1 milestone research findings
- Project-specific: `backend/src/domain/session.ts` — Existing session lifecycle pattern
- Project-specific: `infra/lib/stacks/session-stack.ts` — Existing EventBridge integration pattern

### Tertiary (LOW confidence)

None — all findings verified with official AWS documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All constructs in stable aws-cdk-lib, verified in AWS CDK API docs
- Architecture: HIGH - Extends validated v1.0 patterns, official IVS recording guide followed
- Pitfalls: HIGH - Sourced from AWS official docs (regional requirements, reconnect windows, event status handling)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - stable AWS services, infrequent breaking changes)
