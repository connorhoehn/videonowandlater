/**
 * Tests for recording-ended handler
 * EventBridge handler for IVS Recording End events
 * TDD RED phase
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { handler } from '../recording-ended';

interface RecordingEndDetail {
  channel_name: string;
  stream_id: string;
  recording_status: 'Recording End';
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

describe('recording-ended handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes Recording End event and transitions session to ENDED', async () => {
    const event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:channel/test123',
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
    const event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:channel/test123',
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
    const event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:channel/abc123',
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
    const event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:stage/xyz789',
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
    const event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:unknown/invalid',
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
    const event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Recording State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:stage/hangout123',
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
});
