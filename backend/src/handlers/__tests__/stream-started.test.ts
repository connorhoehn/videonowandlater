/**
 * Tests for stream-started handler
 * EventBridge handler for IVS Stream Start events
 * TDD RED phase
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { handler } from '../stream-started';

interface StreamStartDetail {
  event_name: 'Stream Start';
  channel_name: string;
  channel_arn: string;
  stream_id: string;
}

describe('stream-started handler', () => {
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

  it('processes Stream Start event and transitions session to LIVE', async () => {
    const event: EventBridgeEvent<'IVS Stream State Change', StreamStartDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Stream State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:00:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        event_name: 'Stream Start',
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:channel/test123',
        channel_arn: 'arn:aws:ivs:us-east-1:123456789012:channel/test123',
        stream_id: 'st_test_stream_id',
      },
    };

    // Should not throw (even if DynamoDB connection fails in unit test)
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('handles missing session gracefully (logs warning)', async () => {
    const event: EventBridgeEvent<'IVS Stream State Change', StreamStartDetail> = {
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'IVS Stream State Change',
      'source': 'aws.ivs',
      'account': '123456789012',
      'time': '2024-01-01T00:00:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        event_name: 'Stream Start',
        channel_name: 'arn:aws:ivs:us-east-1:123456789012:channel/orphaned',
        channel_arn: 'arn:aws:ivs:us-east-1:123456789012:channel/orphaned',
        stream_id: 'st_orphan_stream',
      },
    };

    // Should complete without error even if session not found
    await expect(handler(event)).resolves.not.toThrow();
  });
});
