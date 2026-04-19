/**
 * Tests for get-clip Lambda handler
 * GET /clips/{clipId} — public when the clip's session is public.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-clip';
import * as clipRepository from '../../repositories/clip-repository';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';
import type { Clip } from '../../domain/clip';

jest.mock('../../repositories/clip-repository');
jest.mock('../../repositories/session-repository');

// The shared s3-request-presigner mock already returns a fixed signed URL.
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  GetObjectCommand: jest.fn().mockImplementation((input: any) => ({ input })),
}));

const mockGetClip = clipRepository.getClipById as jest.MockedFunction<typeof clipRepository.getClipById>;
const mockGetSession = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;

function makeEvent(clipId: string | undefined, userId?: string): APIGatewayProxyEvent {
  return {
    pathParameters: clipId ? { clipId } : null,
    requestContext: {
      authorizer: userId ? { claims: { 'cognito:username': userId } } : undefined,
    },
    headers: {},
    body: null,
    httpMethod: 'GET',
  } as any;
}

const readyClip: Clip = {
  clipId: 'clip-1',
  sessionId: 'sess-1',
  authorId: 'viewer-user',
  title: 'Nice moment',
  startSec: 10,
  endSec: 40,
  durationSec: 30,
  createdAt: '2026-04-18T00:00:00Z',
  status: 'ready',
  s3Key: 'clips/clip-1/-clip.mp4',
};

const publicSession: Session = {
  sessionId: 'sess-1',
  userId: 'owner-user',
  sessionType: SessionType.BROADCAST,
  status: SessionStatus.ENDED,
  claimedResources: { chatRoom: 'r' },
  createdAt: '2026-04-01T00:00:00Z',
  version: 2,
  // no isPrivate → public
};

const privateSession: Session = { ...publicSession, isPrivate: true };

describe('get-clip handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.RECORDINGS_BUCKET = 'recordings-bucket';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when clipId missing', async () => {
    const res = await handler(makeEvent(undefined));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when clip not found', async () => {
    mockGetClip.mockResolvedValueOnce(null);
    const res = await handler(makeEvent('clip-1'));
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when clip soft-deleted', async () => {
    mockGetClip.mockResolvedValueOnce({ ...readyClip, status: 'deleted' });
    const res = await handler(makeEvent('clip-1'));
    expect(res.statusCode).toBe(404);
  });

  it('public path: no auth, session public → 200 with signed URL', async () => {
    mockGetClip.mockResolvedValueOnce(readyClip);
    mockGetSession.mockResolvedValueOnce(publicSession);

    const res = await handler(makeEvent('clip-1'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.clipId).toBe('clip-1');
    expect(body.status).toBe('ready');
    expect(body.signedUrl).toBe('https://signed-url.example.com/part');
    expect(body.signedUrlExpiresIn).toBe(15 * 60);
  });

  it('private path: no auth → 401', async () => {
    mockGetClip.mockResolvedValueOnce(readyClip);
    mockGetSession.mockResolvedValueOnce(privateSession);

    const res = await handler(makeEvent('clip-1'));
    expect(res.statusCode).toBe(401);
  });

  it('private path: authed non-owner, non-author → 403', async () => {
    mockGetClip.mockResolvedValueOnce(readyClip);
    mockGetSession.mockResolvedValueOnce(privateSession);

    const res = await handler(makeEvent('clip-1', 'some-other-user'));
    expect(res.statusCode).toBe(403);
  });

  it('private path: session owner → 200', async () => {
    mockGetClip.mockResolvedValueOnce(readyClip);
    mockGetSession.mockResolvedValueOnce(privateSession);

    const res = await handler(makeEvent('clip-1', 'owner-user'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.signedUrl).toBeTruthy();
  });

  it('private path: clip author → 200', async () => {
    mockGetClip.mockResolvedValueOnce(readyClip);
    mockGetSession.mockResolvedValueOnce(privateSession);

    const res = await handler(makeEvent('clip-1', 'viewer-user'));
    expect(res.statusCode).toBe(200);
  });

  it('processing clip: no signed URL but still 200', async () => {
    mockGetClip.mockResolvedValueOnce({ ...readyClip, status: 'processing', s3Key: undefined });
    mockGetSession.mockResolvedValueOnce(publicSession);

    const res = await handler(makeEvent('clip-1'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('processing');
    expect(body.signedUrl).toBeUndefined();
  });
});
