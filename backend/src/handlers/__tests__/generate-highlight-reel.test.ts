/**
 * Tests for generate-highlight-reel Lambda handler
 * Validates chapter-based MediaConvert job submission for highlight reels
 */

import type { SQSEvent } from 'aws-lambda';
import { handler, msToTimecode } from '../generate-highlight-reel';
import * as sessionRepository from '../../repositories/session-repository';

// ---------------------------------------------------------------------------
// Tracer mock
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

jest.mock('../../repositories/session-repository');

// Track CreateJobCommand calls — use var for ESM-compat hoisting (same as tracer mock)
var lastCreateJobInput: any;
var mockMcSendFn: jest.Mock;

jest.mock('@aws-sdk/client-mediaconvert', () => {
  mockMcSendFn = jest.fn().mockResolvedValue({ Job: { Id: 'test-job-id' } });
  return {
    MediaConvertClient: jest.fn().mockImplementation(() => ({
      send: mockMcSendFn,
    })),
    CreateJobCommand: jest.fn().mockImplementation((input: any) => {
      lastCreateJobInput = input;
      return { input };
    }),
  };
});

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockUpdateHighlightReel = sessionRepository.updateHighlightReel as jest.MockedFunction<typeof sessionRepository.updateHighlightReel>;

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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-generate-highlight-reel',
      awsRegion: 'us-east-1',
    }],
  };
}

describe('generate-highlight-reel handler', () => {
  const TABLE_NAME = 'test-table';
  const TRANSCRIPTION_BUCKET = 'test-transcription-bucket';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.TRANSCRIPTION_BUCKET = TRANSCRIPTION_BUCKET;
    process.env.MEDIACONVERT_ROLE_ARN = 'arn:aws:iam::123456789012:role/MediaConvertRole';
    process.env.MEDIACONVERT_ENDPOINT = 'https://mediaconvert.us-east-1.amazonaws.com';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCOUNT_ID = '123456789012';
  });

  beforeEach(() => {
    mockPutAnnotation.mockClear();
    mockAddErrorAsMetadata.mockClear();
    mockGetSegment.mockClear();
    mockSetSegment.mockClear();
    mockGetSessionById.mockReset();
    mockUpdateHighlightReel.mockReset();
    mockUpdateHighlightReel.mockResolvedValue(undefined);
    mockMcSendFn.mockClear();
    mockMcSendFn.mockResolvedValue({ Job: { Id: 'test-job-id' } });
    lastCreateJobInput = null;
  });

  describe('msToTimecode', () => {
    it('should convert 0ms to 00:00:00:00', () => {
      expect(msToTimecode(0)).toBe('00:00:00:00');
    });

    it('should convert 5000ms to 00:00:05:00', () => {
      expect(msToTimecode(5000)).toBe('00:00:05:00');
    });

    it('should convert 65000ms to 00:01:05:00', () => {
      expect(msToTimecode(65000)).toBe('00:01:05:00');
    });

    it('should convert 3661000ms to 01:01:01:00', () => {
      expect(msToTimecode(3661000)).toBe('01:01:01:00');
    });

    it('should handle fractional seconds as frames (30fps)', () => {
      // 500ms at 30fps: Math.floor(500 / 33.333...) = 14 (floating point)
      expect(msToTimecode(500)).toBe('00:00:00:14');
    });

    it('should handle 100ms = 3 frames at 30fps', () => {
      expect(msToTimecode(100)).toBe('00:00:00:03');
    });

    it('should handle large values', () => {
      // 2 hours, 30 minutes, 45 seconds, 500ms
      const ms = (2 * 3600 + 30 * 60 + 45) * 1000 + 500;
      expect(msToTimecode(ms)).toBe('02:30:45:14');
    });
  });

  describe('Successful highlight reel generation', () => {
    it('should submit MediaConvert job with correct input clippings per chapter', async () => {
      const sessionId = 'highlight-test-session';
      const chapters = [
        { title: 'Intro', startTimeMs: 0, endTimeMs: 30000 },
        { title: 'Main Topic', startTimeMs: 30000, endTimeMs: 120000 },
        { title: 'Conclusion', startTimeMs: 120000, endTimeMs: 150000 },
      ];

      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters,
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockMcSendFn).toHaveBeenCalledTimes(1);

      // Verify the CreateJobCommand input was captured
      expect(lastCreateJobInput).not.toBeNull();

      // Should have 3 inputs (one per chapter)
      expect(lastCreateJobInput.Settings.Inputs).toHaveLength(3);

      // Verify each input has InputClippings
      for (const input of lastCreateJobInput.Settings.Inputs) {
        expect(input.InputClippings).toHaveLength(1);
        expect(input.InputClippings[0].StartTimecode).toBeDefined();
        expect(input.InputClippings[0].EndTimecode).toBeDefined();
        expect(input.FileInput).toBe(`s3://${TRANSCRIPTION_BUCKET}/${sessionId}/recording.mp4`);
      }

      // Should have 2 output groups (landscape + vertical)
      expect(lastCreateJobInput.Settings.OutputGroups).toHaveLength(2);
      expect(lastCreateJobInput.Settings.OutputGroups[0].Name).toBe('Landscape');
      expect(lastCreateJobInput.Settings.OutputGroups[1].Name).toBe('Vertical');

      // Verify tags
      expect(lastCreateJobInput.Tags.phase).toBe('highlight-reel');
      expect(lastCreateJobInput.Tags.sessionId).toBe(sessionId);
    });

    it('should update session with highlightReelStatus processing', async () => {
      const sessionId = 'status-test-session';
      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [{ title: 'Ch1', startTimeMs: 0, endTimeMs: 60000 }],
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      await handler(makeSqsEvent(ebEvent));

      expect(mockUpdateHighlightReel).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({ highlightReelStatus: 'processing', musicTrackKey: expect.any(String) })
      );
    });

    it('should clip max 10 seconds per chapter centered at midpoint', async () => {
      const sessionId = 'clip-duration-test';
      // Long chapter: midpoint at 60s, clip should be 55s-65s
      const chapters = [
        { title: 'Long Chapter', startTimeMs: 0, endTimeMs: 120000 },
      ];

      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters,
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      await handler(makeSqsEvent(ebEvent));

      const clipping = lastCreateJobInput.Settings.Inputs[0].InputClippings[0];

      // Midpoint = 60000, clip 55000-65000
      expect(clipping.StartTimecode).toBe(msToTimecode(55000));
      expect(clipping.EndTimecode).toBe(msToTimecode(65000));
    });

    it('should use chapter duration when less than 10 seconds', async () => {
      const sessionId = 'short-chapter-test';
      // 5-second chapter
      const chapters = [
        { title: 'Short', startTimeMs: 10000, endTimeMs: 15000 },
      ];

      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters,
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      await handler(makeSqsEvent(ebEvent));

      const clipping = lastCreateJobInput.Settings.Inputs[0].InputClippings[0];

      // midpoint=12500, clipDuration=5000, start=10000, end=15000
      expect(clipping.StartTimecode).toBe(msToTimecode(10000));
      expect(clipping.EndTimecode).toBe(msToTimecode(15000));
    });
  });

  describe('Skip conditions', () => {
    it('should skip when session not found', async () => {
      mockGetSessionById.mockResolvedValueOnce(null);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId: 'missing-session' },
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockUpdateHighlightReel).not.toHaveBeenCalled();
    });

    it('should skip when no chapters on session', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'no-chapters',
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [],
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId: 'no-chapters' },
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockUpdateHighlightReel).not.toHaveBeenCalled();
    });

    it('should skip when highlightReelStatus is already processing (idempotent)', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'already-processing',
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [{ title: 'Ch1', startTimeMs: 0, endTimeMs: 60000 }],
        highlightReelStatus: 'processing',
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId: 'already-processing' },
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockMcSendFn).not.toHaveBeenCalled();
    });

    it('should skip when highlightReelStatus is already available (idempotent)', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'already-available',
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [{ title: 'Ch1', startTimeMs: 0, endTimeMs: 60000 }],
        highlightReelStatus: 'available',
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId: 'already-available' },
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockMcSendFn).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should mark as failed when MediaConvert submission fails', async () => {
      const sessionId = 'mc-fail-session';
      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [{ title: 'Ch1', startTimeMs: 0, endTimeMs: 60000 }],
      } as any);

      mockMcSendFn.mockRejectedValueOnce(new Error('MediaConvert error'));

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(1);

      expect(mockUpdateHighlightReel).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        { highlightReelStatus: 'failed' }
      );
    });

    it('should fail validation when sessionId is missing', async () => {
      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: {},
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should fail validation when detail is missing', async () => {
      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
      };

      const result = await handler(makeSqsEvent(ebEvent));
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });

  describe('Output configuration', () => {
    it('should include landscape output with 1920x1080 resolution', async () => {
      const sessionId = 'output-config-test';
      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [{ title: 'Ch1', startTimeMs: 0, endTimeMs: 60000 }],
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      await handler(makeSqsEvent(ebEvent));

      const landscapeOutput = lastCreateJobInput.Settings.OutputGroups[0].Outputs[0];
      expect(landscapeOutput.VideoDescription.Width).toBe(1920);
      expect(landscapeOutput.VideoDescription.Height).toBe(1080);
      expect(landscapeOutput.NameModifier).toBe('-landscape');
    });

    it('should include vertical output with 1080x1920 resolution', async () => {
      const sessionId = 'vertical-config-test';
      mockGetSessionById.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
        chapters: [{ title: 'Ch1', startTimeMs: 0, endTimeMs: 60000 }],
      } as any);

      const ebEvent = {
        source: 'custom.vnl',
        detailType: 'Chapters Stored',
        detail: { sessionId },
      };

      await handler(makeSqsEvent(ebEvent));

      const verticalOutput = lastCreateJobInput.Settings.OutputGroups[1].Outputs[0];
      expect(verticalOutput.VideoDescription.Width).toBe(1080);
      expect(verticalOutput.VideoDescription.Height).toBe(1920);
      expect(verticalOutput.VideoDescription.ScalingBehavior).toBe('STRETCH_TO_OUTPUT');
      expect(verticalOutput.NameModifier).toBe('-vertical');
    });
  });
});
