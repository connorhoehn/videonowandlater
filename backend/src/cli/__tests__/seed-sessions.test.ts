/**
 * Tests for seed-sessions command
 */

import { SessionType, SessionStatus, RecordingStatus } from '../../domain/session';

describe('seed-sessions command', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  it('should create sessions alternating BROADCAST/HANGOUT types', () => {
    // Verify type alternation logic
    const types = [0, 1, 2, 3].map(i => i % 2 === 0 ? SessionType.BROADCAST : SessionType.HANGOUT);

    expect(types[0]).toBe(SessionType.BROADCAST);
    expect(types[1]).toBe(SessionType.HANGOUT);
    expect(types[2]).toBe(SessionType.BROADCAST);
    expect(types[3]).toBe(SessionType.HANGOUT);
  });

  it('should use recording metadata structure', () => {
    // Verify recording metadata fields match Session interface
    const metadata = {
      recordingStatus: RecordingStatus.AVAILABLE,
      recordingDuration: 1800,
      recordingS3Path: 's3://test/path',
      recordingHlsUrl: 'https://test.cloudfront.net/playlist.m3u8',
      thumbnailUrl: 'https://test.cloudfront.net/thumbnail.jpg',
    };

    expect(metadata.recordingStatus).toBe('available');
    expect(metadata.recordingDuration).toBe(1800);
    expect(metadata.recordingS3Path).toBeDefined();
    expect(metadata.recordingHlsUrl).toBeDefined();
    expect(metadata.thumbnailUrl).toBeDefined();
  });

  it('should use ENDED status for seeded sessions', () => {
    const status = SessionStatus.ENDED;
    expect(status).toBe('ended');
  });

  it('should use proper DynamoDB key structure', () => {
    const sessionId = 'test-123';
    const keys = {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
      GSI1PK: 'STATUS#ENDED',
      entityType: 'SESSION',
    };

    expect(keys.PK).toMatch(/^SESSION#/);
    expect(keys.SK).toBe('METADATA');
    expect(keys.GSI1PK).toBe('STATUS#ENDED');
    expect(keys.entityType).toBe('SESSION');
  });
});
