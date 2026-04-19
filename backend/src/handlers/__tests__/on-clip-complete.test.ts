/**
 * Tests for on-clip-complete Lambda handler
 * EventBridge-triggered MediaConvert clip-job completion handling
 */

import type { SQSEvent } from 'aws-lambda';
import { handler } from '../on-clip-complete';
import * as clipRepository from '../../repositories/clip-repository';

// Tracer mock
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
    addNewSubsegment: jest.fn(() => ({ close: jest.fn(), addError: jest.fn() })),
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

jest.mock('../../repositories/clip-repository');

const mockMarkReady = clipRepository.markClipReady as jest.MockedFunction<typeof clipRepository.markClipReady>;
const mockMarkFailed = clipRepository.markClipFailed as jest.MockedFunction<typeof clipRepository.markClipFailed>;

function makeSqs(ebEvent: Record<string, any>): SQSEvent {
  return {
    Records: [{
      messageId: 'msg-1',
      receiptHandle: 'r',
      body: JSON.stringify(ebEvent),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '0',
        SenderId: 's',
        ApproximateFirstReceiveTimestamp: '0',
      },
      messageAttributes: {},
      md5OfBody: 'm',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123:vnl-on-clip-complete',
      awsRegion: 'us-east-1',
    }],
  };
}

const TABLE = 'test-table';

describe('on-clip-complete handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });
  beforeEach(() => {
    mockMarkReady.mockReset();
    mockMarkFailed.mockReset();
    mockMarkReady.mockResolvedValue(undefined);
    mockMarkFailed.mockResolvedValue(undefined);
  });

  it('marks clip ready on COMPLETE with S3 output path', async () => {
    const event = makeSqs({
      source: 'aws.mediaconvert',
      detailType: 'MediaConvert Job State Change',
      detail: {
        jobId: 'mc-job-1',
        status: 'COMPLETE',
        userMetadata: { type: 'clip', clipId: 'clip-1', sessionId: 'sess-1' },
        outputGroupDetails: [{
          outputDetails: [{
            outputFilePaths: ['s3://recordings/clips/clip-1/video-clip.mp4'],
          }],
        }],
      },
      time: '2026-04-18T00:00:00Z',
      region: 'us-east-1',
      account: '123',
      id: 'e1',
      resources: [],
    });

    const res = await handler(event);
    expect(res.batchItemFailures).toHaveLength(0);
    expect(mockMarkReady).toHaveBeenCalledWith(TABLE, 'sess-1', 'clip-1', 'clips/clip-1/video-clip.mp4');
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it('marks clip ready with fallback key when outputGroupDetails missing', async () => {
    const event = makeSqs({
      detail: {
        jobId: 'mc-job-2',
        status: 'COMPLETE',
        userMetadata: { type: 'clip', clipId: 'clip-2', sessionId: 'sess-2' },
      },
    });
    const res = await handler(event);
    expect(res.batchItemFailures).toHaveLength(0);
    expect(mockMarkReady).toHaveBeenCalledWith(TABLE, 'sess-2', 'clip-2', 'clips/clip-2/-clip.mp4');
  });

  it('marks clip failed on ERROR', async () => {
    const event = makeSqs({
      detail: {
        jobId: 'mc-job-3',
        status: 'ERROR',
        userMetadata: { type: 'clip', clipId: 'clip-3', sessionId: 'sess-3' },
      },
    });
    const res = await handler(event);
    expect(res.batchItemFailures).toHaveLength(0);
    expect(mockMarkFailed).toHaveBeenCalledWith(TABLE, 'sess-3', 'clip-3');
    expect(mockMarkReady).not.toHaveBeenCalled();
  });

  it('marks clip failed on CANCELED', async () => {
    const event = makeSqs({
      detail: {
        jobId: 'mc-job-4',
        status: 'CANCELED',
        userMetadata: { type: 'clip', clipId: 'clip-4', sessionId: 'sess-4' },
      },
    });
    const res = await handler(event);
    expect(res.batchItemFailures).toHaveLength(0);
    expect(mockMarkFailed).toHaveBeenCalledWith(TABLE, 'sess-4', 'clip-4');
  });

  it('drops events whose userMetadata is not type=clip (no retry)', async () => {
    const event = makeSqs({
      detail: {
        jobId: 'mc-job-5',
        status: 'COMPLETE',
        userMetadata: { phase: '19-transcription', sessionId: 'sess-5' },
      },
    });
    const res = await handler(event);
    expect(res.batchItemFailures).toHaveLength(0);
    expect(mockMarkReady).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it('reports failure on SQS record when repository throws', async () => {
    mockMarkReady.mockRejectedValueOnce(new Error('ddb boom'));
    const event = makeSqs({
      detail: {
        jobId: 'mc-job-6',
        status: 'COMPLETE',
        userMetadata: { type: 'clip', clipId: 'clip-6', sessionId: 'sess-6' },
        outputGroupDetails: [{
          outputDetails: [{ outputFilePaths: ['s3://recordings/clips/clip-6/-clip.mp4'] }],
        }],
      },
    });
    const res = await handler(event);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });
});
