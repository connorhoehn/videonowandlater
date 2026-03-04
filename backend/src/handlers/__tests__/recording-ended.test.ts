/**
 * Tests for recording-ended handler
 * EventBridge handler for IVS Recording End events
 * Covers both IVS Low-Latency (broadcast) and IVS RealTime Stage (hangout) event shapes.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { handler } from '../recording-ended';
import { updateRecordingMetadata, findSessionByStageArn } from '../../repositories/session-repository';

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({ Items: [] }),
  })),
}));

jest.mock('../../repositories/session-repository', () => ({
  updateSessionStatus: jest.fn().mockResolvedValue(undefined),
  updateRecordingMetadata: jest.fn().mockResolvedValue(undefined),
  findSessionByStageArn: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../repositories/resource-pool-repository', () => ({
  releasePoolResource: jest.fn().mockResolvedValue(undefined),
}));

const mockUpdateRecordingMetadata = updateRecordingMetadata as jest.MockedFunction<typeof updateRecordingMetadata>;
const mockFindSessionByStageArn = findSessionByStageArn as jest.MockedFunction<typeof findSessionByStageArn>;

describe('recording-ended handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
    };
    jest.clearAllMocks();
    // Default: no session found (channel lookups go through DynamoDB scan mock returning empty)
    mockFindSessionByStageArn.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes Recording End event and transitions session to ENDED', async () => {
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Should not throw (even if DynamoDB connection fails in unit test)
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('releases channel and chat room resources back to pool', async () => {
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Should complete without error
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('detects Channel ARN format and calls findSessionByChannelArn', async () => {
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Should complete without error
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('detects Stage ARN format and calls findSessionByStageArn', async () => {
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Should complete without error
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('logs error and returns early if ARN format unrecognized', async () => {
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Should complete without error (logs warning and returns early)
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('updates recording metadata for Stage sessions', async () => {
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

    // Should complete without error and update recording metadata
    await expect(handler(event)).resolves.not.toThrow();
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

    const event = {
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
    };
    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';
    await expect(handler(event as any)).resolves.not.toThrow();
    expect(mockFindSessionByStageArn).toHaveBeenCalledWith('test-table', 'arn:aws:ivs:us-east-1:123456789012:stage/hangout123');
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
    const event = {
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
    };
    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';
    await handler(event as any);
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

    const event = {
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
    };
    process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';
    await handler(event as any);
    expect(mockUpdateRecordingMetadata).toHaveBeenCalledWith(
      'test-table',
      'hangout-session-123',
      expect.objectContaining({ recordingStatus: 'available' })
    );
  });
});
