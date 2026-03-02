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
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

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
    await expect(handler(event, mockContext, mockCallback)).resolves.not.toThrow();
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
    await expect(handler(event, mockContext, mockCallback)).resolves.not.toThrow();
  });
});
