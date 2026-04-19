/**
 * Tests for create-clip Lambda handler
 * POST /sessions/{sessionId}/clips — submit a MediaConvert clip job
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler, secondsToTimecode } from '../create-clip';
import * as sessionRepository from '../../repositories/session-repository';
import * as clipRepository from '../../repositories/clip-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/clip-repository');
jest.mock('uuid', () => ({ v4: () => 'clip-uuid' }));

// Mock the MediaConvertClient so tests don't make real calls.
var mockMcSend: jest.Mock;
var lastCreateJobInput: any;
jest.mock('@aws-sdk/client-mediaconvert', () => {
  mockMcSend = jest.fn().mockResolvedValue({ Job: { Id: 'mc-job-1' } });
  return {
    MediaConvertClient: jest.fn().mockImplementation(() => ({ send: mockMcSend })),
    CreateJobCommand: jest.fn().mockImplementation((input: any) => {
      lastCreateJobInput = input;
      return { input };
    }),
  };
});

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockCreateClip = clipRepository.createClip as jest.MockedFunction<typeof clipRepository.createClip>;

function makeEvent(
  sessionId: string | undefined,
  body: object | null,
  userId?: string,
  groups?: string,
): APIGatewayProxyEvent {
  return {
    pathParameters: sessionId ? { sessionId } : null,
    requestContext: {
      authorizer: userId
        ? { claims: { 'cognito:username': userId, ...(groups ? { 'cognito:groups': groups } : {}) } }
        : undefined,
    },
    headers: {},
    body: body ? JSON.stringify(body) : null,
    httpMethod: 'POST',
  } as any;
}

const endedPublicSession: Session = {
  sessionId: 'sess-1',
  userId: 'owner-user',
  sessionType: SessionType.BROADCAST,
  status: SessionStatus.ENDED,
  claimedResources: { chatRoom: 'room-1' },
  createdAt: '2026-01-01T00:00:00Z',
  version: 3,
  recordingDuration: 600_000, // 600s = 10 min
};

describe('create-clip handler', () => {
  const TABLE = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
    process.env.RECORDINGS_BUCKET = 'recordings-bucket';
    process.env.MEDIACONVERT_ROLE_ARN = 'arn:aws:iam::123:role/mc';
    process.env.TRANSCRIPTION_BUCKET = 'transcription-bucket';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCOUNT_ID = '123456789012';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockMcSend.mockResolvedValue({ Job: { Id: 'mc-job-1' } });
    mockCreateClip.mockResolvedValue(undefined);
  });

  it('secondsToTimecode converts 30.5s at 30fps', () => {
    expect(secondsToTimecode(30.5)).toBe('00:00:30:15');
    expect(secondsToTimecode(0)).toBe('00:00:00:00');
    expect(secondsToTimecode(3661)).toBe('01:01:01:00');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 30 }));
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on missing sessionId', async () => {
    const res = await handler(makeEvent(undefined, { title: 'T', startSec: 0, endSec: 30 }, 'viewer'));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when body missing title', async () => {
    const res = await handler(makeEvent('sess-1', { startSec: 0, endSec: 30 }, 'viewer'));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when clip length below minimum', async () => {
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 2 }, 'viewer'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/5 and 180/);
  });

  it('returns 400 when clip length exceeds maximum', async () => {
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 500 }, 'viewer'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/5 and 180/);
  });

  it('returns 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 30 }, 'viewer'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when session is private and caller is not owner/admin', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...endedPublicSession, isPrivate: true });
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 30 }, 'viewer'));
    expect(res.statusCode).toBe(403);
  });

  it('allows admin on private session', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...endedPublicSession, isPrivate: true });
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 30 }, 'admin-user', 'admin'));
    expect(res.statusCode).toBe(202);
  });

  it('returns 409 when session not ended', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...endedPublicSession, status: SessionStatus.LIVE });
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 30 }, 'viewer'));
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when endSec exceeds recording duration', async () => {
    mockGetSessionById.mockResolvedValueOnce(endedPublicSession);
    // recordingDuration = 600s — request endSec 700
    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 680, endSec: 700 }, 'viewer'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/exceeds recording duration/i);
  });

  it('happy path: public session + regular viewer → submits MediaConvert job, creates clip row, 202', async () => {
    mockGetSessionById.mockResolvedValueOnce(endedPublicSession);

    const res = await handler(
      makeEvent('sess-1', { title: '  My clip  ', startSec: 10, endSec: 40 }, 'viewer-user'),
    );

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ clipId: 'clip-uuid', status: 'processing' });

    // MediaConvert CreateJob was called with InputClippings
    expect(mockMcSend).toHaveBeenCalledTimes(1);
    expect(lastCreateJobInput.Settings.Inputs[0].InputClippings).toEqual([
      { StartTimecode: '00:00:10:00', EndTimecode: '00:00:40:00' },
    ]);
    expect(lastCreateJobInput.UserMetadata).toMatchObject({ type: 'clip', clipId: 'clip-uuid', sessionId: 'sess-1' });

    // createClip persisted with isPublic=true and title trimmed
    expect(mockCreateClip).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({
        clipId: 'clip-uuid',
        sessionId: 'sess-1',
        authorId: 'viewer-user',
        title: 'My clip',
        startSec: 10,
        endSec: 40,
        durationSec: 30,
        status: 'processing',
        mediaConvertJobId: 'mc-job-1',
      }),
      { isPublic: true },
    );
  });

  it('returns 502 when MediaConvert rejects the job', async () => {
    mockGetSessionById.mockResolvedValueOnce(endedPublicSession);
    mockMcSend.mockRejectedValueOnce(new Error('boom'));

    const res = await handler(makeEvent('sess-1', { title: 'T', startSec: 0, endSec: 30 }, 'viewer'));
    expect(res.statusCode).toBe(502);
    expect(mockCreateClip).not.toHaveBeenCalled();
  });
});
