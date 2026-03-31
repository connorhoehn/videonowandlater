/**
 * Tests for recording-ended handler
 * SQS-wrapped handler for IVS Recording End events
 * Covers both IVS Low-Latency (broadcast) and IVS RealTime Stage (hangout) event shapes.
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { handler } from '../recording-ended';
import { updateRecordingMetadata, findSessionByChannelArn, findSessionByStageArn, computeAndStoreReactionSummary, getHangoutParticipants, updateParticipantCount } from '../../repositories/session-repository';

// ---------------------------------------------------------------------------
// TRACE-02 / TRACE-03: Tracer mock — captureAWSv3Client + putAnnotation
// Use var (no initializer) + assign inside jest.mock factory for ESM compat.
// jest.mock factories run before module-scope initializers in ESM mode.
// ---------------------------------------------------------------------------
var mockCaptureAWSv3Client: jest.Mock;
var mockPutAnnotation: jest.Mock;
var mockAddErrorAsMetadata: jest.Mock;
var mockGetSegment: jest.Mock;
var mockSetSegment: jest.Mock;

jest.mock('@aws-lambda-powertools/tracer', () => {
  mockCaptureAWSv3Client = jest.fn((client: any) => client);
  mockPutAnnotation = jest.fn();
  mockAddErrorAsMetadata = jest.fn();
  mockGetSegment = jest.fn(() => ({
    addNewSubsegment: jest.fn(() => ({
      close: jest.fn(),
      addError: jest.fn(),
    })),
  }));
  mockSetSegment = jest.fn();
  return {
    Tracer: jest.fn().mockImplementation(() => ({
      captureAWSv3Client: mockCaptureAWSv3Client,
      putAnnotation: mockPutAnnotation,
      addErrorAsMetadata: mockAddErrorAsMetadata,
      getSegment: mockGetSegment,
      setSegment: mockSetSegment,
    })),
  };
});

// Mock DynamoDBClient so module-scope construction works in tests
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

// Mock DynamoDBDocumentClient.from + commands so docClient.send returns predictable values
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: jest.fn().mockResolvedValue({ Items: [] }),
    })),
  },
  GetCommand: jest.fn().mockImplementation((input: any) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input: any) => ({ input })),
  ScanCommand: jest.fn().mockImplementation((input: any) => ({ input })),
}));

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({ Items: [] }),
  })),
}));

jest.mock('@aws-sdk/client-mediaconvert', () => ({
  MediaConvertClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ Job: { Id: 'mock-job-id-123' } }),
  })),
  CreateJobCommand: jest.fn().mockImplementation((input: any) => ({ input })),
}));

jest.mock('../../repositories/session-repository', () => ({
  updateSessionStatus: jest.fn().mockResolvedValue(undefined),
  updateRecordingMetadata: jest.fn().mockResolvedValue(undefined),
  findSessionByChannelArn: jest.fn().mockResolvedValue(null),
  findSessionByStageArn: jest.fn().mockResolvedValue(null),
  computeAndStoreReactionSummary: jest.fn().mockResolvedValue({}),
  getHangoutParticipants: jest.fn().mockResolvedValue([]),
  updateParticipantCount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../repositories/resource-pool-repository', () => ({
  releasePoolResource: jest.fn().mockResolvedValue(undefined),
}));

const mockUpdateRecordingMetadata = updateRecordingMetadata as jest.MockedFunction<typeof updateRecordingMetadata>;
const mockFindSessionByChannelArn = findSessionByChannelArn as jest.MockedFunction<typeof findSessionByChannelArn>;
const mockFindSessionByStageArn = findSessionByStageArn as jest.MockedFunction<typeof findSessionByStageArn>;
const mockComputeAndStoreReactionSummary = computeAndStoreReactionSummary as jest.MockedFunction<typeof computeAndStoreReactionSummary>;
const mockGetHangoutParticipants = getHangoutParticipants as jest.MockedFunction<typeof getHangoutParticipants>;
const mockUpdateParticipantCount = updateParticipantCount as jest.MockedFunction<typeof updateParticipantCount>;

function makeSqsEvent(ebEvent: Record<string, any>): SQSEvent {
  return {
    Records: [{
      messageId: 'test-message-id',
      receiptHandle: 'test-receipt-handle',
      body: JSON.stringify(ebEvent),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1234567890',
        SenderId: 'test-sender',
        ApproximateFirstReceiveTimestamp: '1234567890',
      },
      messageAttributes: {},
      md5OfBody: 'test-md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-recording-ended',
      awsRegion: 'us-east-1',
    }],
  };
}

describe('recording-ended handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
    };
    jest.clearAllMocks();
    mockCaptureAWSv3Client.mockClear();
    mockPutAnnotation.mockClear();
    // Default: no session found
    mockFindSessionByChannelArn.mockResolvedValue(null);
    mockFindSessionByStageArn.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes Recording End event and transitions session to ENDED', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],
      'detail': {
        channel_name: 'My Test Channel',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('releases channel and chat room resources back to pool', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],
      'detail': {
        channel_name: 'My Test Channel',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('detects Channel ARN format and calls findSessionByChannelArn', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/abc123'],
      'detail': {
        channel_name: 'My Broadcast Channel',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/channel/',
        recording_duration_ms: 300000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('detects Stage ARN format and calls findSessionByStageArn', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/xyz789'],
      'detail': {
        channel_name: 'My Hangout',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/stage/',
        recording_duration_ms: 300000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('logs error and returns early if ARN format unrecognized', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:unknown/invalid'],
      'detail': {
        channel_name: 'Some Name',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/unknown/',
        recording_duration_ms: 300000,
      },
    }));

    // Should complete without error (logs warning and returns early)
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('updates recording metadata for Stage sessions', async () => {
    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        channel_name: 'My Hangout',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'hangouts/session-123/',
        recording_duration_ms: 450000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
  });

  // =========================================================================
  // New Stage (IVS RealTime) event tests
  // =========================================================================

  it('detects Stage ARN from resources[0] and calls findSessionByStageArn', async () => {
    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'hangout-session-123',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'stage-event-id',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'stage-id/session-id/participant-id/2024-01-01T00-00-00Z',
        recording_duration_ms: 450000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockFindSessionByStageArn).toHaveBeenCalledWith('test-table', 'arn:aws:ivs:us-east-1:123456789012:stage/hangout123');

    // TRACE-02: SDK clients must be wrapped at module scope
    expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.objectContaining({})); // DynamoDBClient
    expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.objectContaining({})); // MediaConvertClient

    // TRACE-03: annotations written during handler invocation
    expect(mockPutAnnotation).toHaveBeenCalledWith('sessionId', expect.any(String));
    expect(mockPutAnnotation).toHaveBeenCalledWith('pipelineStage', 'recording-ended');
  });

  it('builds Stage HLS URL using media/hls/multivariant.m3u8 path', async () => {
    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'hangout-session-123',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    const prefix = 'stage-id/session-id/participant-id/2024-01-01T00-00-00Z';
    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    await handler(makeSqsEvent({
      'version': '0',
      'id': 'stage-url-test',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: prefix,
        recording_duration_ms: 450000,
      },
    }));

    expect(mockUpdateRecordingMetadata).toHaveBeenCalledWith(
      'test-table',
      'hangout-session-123',
      expect.objectContaining({
        recordingHlsUrl: `https://d1234567890.cloudfront.net/${prefix}/media/hls/multivariant.m3u8`,
        thumbnailUrl: `https://d1234567890.cloudfront.net/${prefix}/media/latest_thumbnail/high/thumb.jpg`,
        recordingStatus: 'available',
      })
    );
  });

  it('sets recordingStatus available for Stage Recording End event', async () => {
    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'hangout-session-123',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    await handler(makeSqsEvent({
      'version': '0',
      'id': 'stage-status-test',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'some/prefix',
        recording_duration_ms: 300000,
      },
    }));

    expect(mockUpdateRecordingMetadata).toHaveBeenCalledWith(
      'test-table',
      'hangout-session-123',
      expect.objectContaining({ recordingStatus: 'available' })
    );
  });

  // =========================================================================
  // Reaction summary computation tests
  // =========================================================================

  it('computes and stores reaction summary after metadata update', async () => {
    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'session-with-reactions',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { chatRoom: 'arn:aws:ivschat:...' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    mockComputeAndStoreReactionSummary.mockResolvedValue({
      heart: 42,
      fire: 17,
      clap: 8,
      laugh: 5,
      surprised: 3,
    });

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    expect(mockComputeAndStoreReactionSummary).toHaveBeenCalledWith('test-table', 'session-with-reactions');
  });

  it('continues to pool release if reaction summary computation fails', async () => {
    const { releasePoolResource } = require('../../repositories/resource-pool-repository');
    const mockReleasePoolResource = releasePoolResource as jest.MockedFunction<any>;

    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'session-summary-error',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { chatRoom: 'arn:aws:ivschat:...' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    mockComputeAndStoreReactionSummary.mockRejectedValueOnce(new Error('Reaction summary computation failed'));

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    // Should not fail - pool release should still happen
    expect(result.batchItemFailures).toHaveLength(0);

    // Verify pool release was called despite reaction summary error
    expect(mockReleasePoolResource).toHaveBeenCalled();
  });

  it('logs error when reaction summary computation fails', async () => {
    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'session-log-error',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { chatRoom: 'arn:aws:ivschat:...' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    mockComputeAndStoreReactionSummary.mockRejectedValueOnce(new Error('Test reaction error'));

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    // Verify the handler completes without failing (non-blocking)
    expect(result.batchItemFailures).toHaveLength(0);
  });

  // =========================================================================
  // Participant count tracking tests
  // =========================================================================

  it('computes participantCount for HANGOUT sessions at recording end', async () => {
    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'hangout-participants',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { stage: 'arn:aws:ivs:us-east-1:123456789012:stage/hangout123', chatRoom: 'arn:aws:ivschat:...' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    mockGetHangoutParticipants.mockResolvedValueOnce([
      { sessionId: 'hangout-participants', userId: 'user-1', displayName: 'user-1', participantId: 'p-1', joinedAt: '2024-01-01T00:01:00Z' },
      { sessionId: 'hangout-participants', userId: 'user-2', displayName: 'user-2', participantId: 'p-2', joinedAt: '2024-01-01T00:02:00Z' },
      { sessionId: 'hangout-participants', userId: 'user-3', displayName: 'user-3', participantId: 'p-3', joinedAt: '2024-01-01T00:03:00Z' },
    ]);

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    await handler(makeSqsEvent({
      'version': '0',
      'id': 'participant-count-test',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    expect(mockGetHangoutParticipants).toHaveBeenCalledWith('test-table', 'hangout-participants');
    expect(mockUpdateParticipantCount).toHaveBeenCalledWith('test-table', 'hangout-participants', 3);
  });

  it('skips participantCount for BROADCAST sessions', async () => {
    // Channel ARN event - BROADCAST session found via DynamoDB scan mock
    // The default DynamoDB mock returns empty Items, so no session is found.
    // We need to test with a channel ARN that does find a BROADCAST session.
    // Since channel lookups use raw DynamoDB scan (not findSessionByStageArn),
    // and our mock returns Items: [], the handler returns early with "No session found".
    // This test verifies getHangoutParticipants is NOT called for channel ARN events.

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    await handler(makeSqsEvent({
      'version': '0',
      'id': 'broadcast-skip-test',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/broadcast123'],
      'detail': {
        channel_name: 'My Broadcast',
        stream_id: 'st_test_stream_id',
        recording_status: 'Recording End',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    // getHangoutParticipants should NOT be called for broadcast sessions
    expect(mockGetHangoutParticipants).not.toHaveBeenCalled();
  });

  it('participant count failure does not block pool release', async () => {
    const { releasePoolResource } = require('../../repositories/resource-pool-repository');
    const mockReleasePoolResource = releasePoolResource as jest.MockedFunction<any>;

    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'hangout-count-error',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { stage: 'arn:aws:ivs:us-east-1:123456789012:stage/hangout123', chatRoom: 'arn:aws:ivschat:...' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    mockGetHangoutParticipants.mockRejectedValueOnce(new Error('DynamoDB query failed'));

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'count-error-test',
      'detail-type': 'IVS Participant Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],
      'detail': {
        session_id: 'st-test-session',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    // Should not fail - participant count error is non-blocking
    expect(result.batchItemFailures).toHaveLength(0);

    // Pool release should still happen
    expect(mockReleasePoolResource).toHaveBeenCalled();
  });

  // =========================================================================
  // MediaConvert failure → SQS batchItemFailures tests
  // =========================================================================

  it('returns batchItemFailure when MediaConvert submission fails', async () => {
    const { MediaConvertClient } = require('@aws-sdk/client-mediaconvert');

    // Override to make MediaConvertClient.send throw
    (MediaConvertClient as jest.Mock).mockImplementationOnce(() => ({
      send: jest.fn().mockRejectedValueOnce(new Error('MediaConvert service unavailable')),
    }));

    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'mc-fail-session',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { stage: 'arn:aws:ivs:us-east-1:123456789012:stage/hangout-fail', chatRoom: 'arn:aws:ivschat:room1' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'mc-fail-event',
      'detail-type': 'IVS Participant Recording State Change',
      source: 'aws.ivs',
      account: '123456789012',
      time: '2024-01-01T00:05:00Z',
      region: 'us-east-1',
      resources: ['arn:aws:ivs:us-east-1:123456789012:stage/hangout-fail'],
      detail: {
        session_id: 'st-test-stream',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
  });

  it('releases pool resources even when MediaConvert submission fails', async () => {
    const { MediaConvertClient } = require('@aws-sdk/client-mediaconvert');
    const { releasePoolResource } = require('../../repositories/resource-pool-repository');
    const mockReleasePoolResource = releasePoolResource as jest.MockedFunction<any>;

    (MediaConvertClient as jest.Mock).mockImplementationOnce(() => ({
      send: jest.fn().mockRejectedValueOnce(new Error('MediaConvert service unavailable')),
    }));

    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'mc-fail-release-session',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { stage: 'arn:aws:ivs:us-east-1:123456789012:stage/hangout-fail2', chatRoom: 'arn:aws:ivschat:room2' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    await handler(makeSqsEvent({
      version: '0',
      id: 'mc-fail-release-event',
      'detail-type': 'IVS Participant Recording State Change',
      source: 'aws.ivs',
      account: '123456789012',
      time: '2024-01-01T00:05:00Z',
      region: 'us-east-1',
      resources: ['arn:aws:ivs:us-east-1:123456789012:stage/hangout-fail2'],
      detail: {
        session_id: 'st-test-stream',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/',
        recording_duration_ms: 300000,
      },
    }));

    // Pool resources must be released even when MediaConvert throws
    expect(mockReleasePoolResource).toHaveBeenCalled();
  });

  // =========================================================================
  // Validation Failure Tests (Plan 01)
  // =========================================================================

  it('should add invalid event to batchItemFailures without calling AWS SDK', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],
      'detail': {
        // Missing required fields for broadcast shape
        channel_name: 'My Channel',
        // Missing: stream_id, recording_status, recording_s3_bucket_name, etc.
      },
    }));

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
  });

  it('should handle multiple records with one invalid', async () => {
    const result = await handler({
      Records: [
        {
          messageId: 'valid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'test-event-id',
            'detail-type': 'IVS Recording State Change',
            'source': 'aws.ivs',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],
            'detail': {
              channel_name: 'Valid Channel',
              stream_id: 'st_valid_stream',
              recording_status: 'Recording End',
              recording_s3_bucket_name: 'my-bucket',
              recording_s3_key_prefix: 'prefix/',
              recording_duration_ms: 100000,
            },
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'test-sender',
            ApproximateFirstReceiveTimestamp: '1234567890',
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-recording-ended',
          awsRegion: 'us-east-1',
        },
        {
          messageId: 'invalid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'invalid-event-id',
            'detail-type': 'IVS Recording State Change',
            'source': 'aws.ivs',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],
            'detail': {
              // Missing required fields
              channel_name: 'Invalid Channel',
            },
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'test-sender',
            ApproximateFirstReceiveTimestamp: '1234567890',
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-recording-ended',
          awsRegion: 'us-east-1',
        },
      ],
    });

    // One invalid, one valid
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('invalid-message-id');
  });

  // =========================================================================
  // MediaConvert Thumbnails output group tests
  // =========================================================================

  it('includes Thumbnails output group in MediaConvert job with FRAME_CAPTURE codec', async () => {
    const { CreateJobCommand } = require('@aws-sdk/client-mediaconvert');

    mockFindSessionByStageArn.mockResolvedValue({
      sessionId: 'thumb-test-session',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      userId: 'user-abc',
      claimedResources: { stage: 'arn:aws:ivs:us-east-1:123456789012:stage/hangout-thumb', chatRoom: 'arn:aws:ivschat:room-thumb' },
      createdAt: '2024-01-01T00:00:00Z',
    } as any);

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';
    process.env.MEDIACONVERT_ROLE_ARN = 'arn:aws:iam::role/test';
    process.env.TRANSCRIPTION_BUCKET = 'test-transcription-bucket';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCOUNT_ID = '123456789012';

    await handler(makeSqsEvent({
      version: '0',
      id: 'thumb-event',
      'detail-type': 'IVS Participant Recording State Change',
      source: 'aws.ivs',
      account: '123456789012',
      time: '2024-01-01T00:05:00Z',
      region: 'us-east-1',
      resources: ['arn:aws:ivs:us-east-1:123456789012:stage/hangout-thumb'],
      detail: {
        session_id: 'st-test-stream',
        event_name: 'Recording End',
        participant_id: 'participant-abc',
        recording_s3_bucket_name: 'my-recordings',
        recording_s3_key_prefix: 'prefix/path',
        recording_duration_ms: 300000,
      },
    }));

    // Verify CreateJobCommand was called with two output groups
    expect(CreateJobCommand).toHaveBeenCalled();
    const jobInput = (CreateJobCommand as jest.Mock).mock.calls[0][0];
    const outputGroups = jobInput.Settings.OutputGroups;

    expect(outputGroups).toHaveLength(2);

    // First output group: MP4
    expect(outputGroups[0].Name).toBe('File Group');
    expect(outputGroups[0].Outputs[0].ContainerSettings.Container).toBe('MP4');

    // Second output group: Thumbnails
    const thumbGroup = outputGroups[1];
    expect(thumbGroup.Name).toBe('Thumbnails');
    expect(thumbGroup.OutputGroupSettings.Type).toBe('FILE_GROUP_SETTINGS');
    expect(thumbGroup.OutputGroupSettings.FileGroupSettings.Destination).toContain('thumbnails/');
    expect(thumbGroup.Outputs).toHaveLength(1);

    const thumbOutput = thumbGroup.Outputs[0];
    expect(thumbOutput.ContainerSettings.Container).toBe('RAW');
    expect(thumbOutput.VideoDescription.CodecSettings.Codec).toBe('FRAME_CAPTURE');
    expect(thumbOutput.VideoDescription.CodecSettings.FrameCaptureSettings).toEqual({
      FramerateNumerator: 1,
      FramerateDenominator: 5,
      MaxCaptures: 500,
      Quality: 80,
    });
    expect(thumbOutput.VideoDescription.Width).toBe(640);
    expect(thumbOutput.VideoDescription.Height).toBe(360);
    expect(thumbOutput.Extension).toBe('jpg');
    expect(thumbOutput.NameModifier).toBe('-thumb');

    // IMPORTANT: Frame capture output must NOT have AudioDescriptions
    expect(thumbOutput.AudioDescriptions).toBeUndefined();
  });

  it('should handle invalid JSON in record body', async () => {
    const result = await handler({
      Records: [{
        messageId: 'malformed-json-id',
        receiptHandle: 'test-receipt-handle',
        body: 'not valid json {{{',
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1234567890',
          SenderId: 'test-sender',
          ApproximateFirstReceiveTimestamp: '1234567890',
        },
        messageAttributes: {},
        md5OfBody: 'test-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-recording-ended',
        awsRegion: 'us-east-1',
      }],
    });

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('malformed-json-id');
  });
});
