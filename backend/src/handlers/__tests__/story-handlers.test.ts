/**
 * Tests for Story handlers
 * Validates create-story-session, add-story-segment, publish-story,
 * get-stories-feed, view-story, react-to-story, reply-to-story,
 * get-story-viewers, and expire-stories handlers
 */

import type { APIGatewayProxyEvent, ScheduledEvent } from 'aws-lambda';
import { SessionStatus, SessionType } from '../../domain/session';
import type { Session } from '../../domain/session';

// Mock dependencies
jest.mock('../../repositories/story-repository');
jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.presigned.url/upload'),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234'),
}));

import { createStorySession, addStorySegment, publishStory, recordStoryView, getActiveStories, hasUserViewedStory, reactToStory, createStoryReply, getStoryViewers, expireOldStories } from '../../repositories/story-repository';
import { getSessionById } from '../../repositories/session-repository';

const mockCreateStorySession = createStorySession as jest.MockedFunction<typeof createStorySession>;
const mockAddStorySegment = addStorySegment as jest.MockedFunction<typeof addStorySegment>;
const mockPublishStory = publishStory as jest.MockedFunction<typeof publishStory>;
const mockRecordStoryView = recordStoryView as jest.MockedFunction<typeof recordStoryView>;
const mockGetActiveStories = getActiveStories as jest.MockedFunction<typeof getActiveStories>;
const mockHasUserViewedStory = hasUserViewedStory as jest.MockedFunction<typeof hasUserViewedStory>;
const mockReactToStory = reactToStory as jest.MockedFunction<typeof reactToStory>;
const mockCreateStoryReply = createStoryReply as jest.MockedFunction<typeof createStoryReply>;
const mockGetStoryViewers = getStoryViewers as jest.MockedFunction<typeof getStoryViewers>;
const mockExpireOldStories = expireOldStories as jest.MockedFunction<typeof expireOldStories>;
const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;

const TABLE_NAME = 'test-table';

beforeAll(() => {
  process.env.TABLE_NAME = TABLE_NAME;
  process.env.STORY_BUCKET = 'test-story-bucket';
  process.env.CLOUDFRONT_DOMAIN = 'd123.cloudfront.net';
  process.env.AWS_REGION = 'us-east-1';
});

beforeEach(() => {
  jest.clearAllMocks();
});

// --- Helpers ---

const createEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: null,
  pathParameters: null,
  requestContext: {
    authorizer: {
      claims: {
        'cognito:username': 'user-123',
      },
    },
  } as any,
  ...overrides,
} as any as APIGatewayProxyEvent);

const createUnauthEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: null,
  pathParameters: null,
  requestContext: {
    authorizer: {
      claims: {},
    },
  } as any,
  ...overrides,
} as any as APIGatewayProxyEvent);

const makeStorySession = (overrides: Partial<Session> = {}): Session => ({
  sessionId: 'session-123',
  userId: 'user-123',
  sessionType: SessionType.STORY,
  status: SessionStatus.CREATING,
  claimedResources: { chatRoom: '' },
  createdAt: '2026-04-10T10:00:00Z',
  version: 1,
  storyExpiresAt: '2026-04-11T10:00:00Z',
  storySegments: [],
  storyViewCount: 0,
  storyReplyCount: 0,
  ...overrides,
});

// ===========================
// create-story-session handler
// ===========================
describe('create-story-session handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../create-story-session')).handler;
  });

  it('should return 401 when userId is missing', async () => {
    const event = createUnauthEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Unauthorized');
  });

  it('should return 201 on success with sessionId and storyExpiresAt', async () => {
    const mockSession = makeStorySession({ sessionId: 'new-session-id', storyExpiresAt: '2026-04-11T10:00:00Z' });
    mockCreateStorySession.mockResolvedValue(mockSession);

    const event = createEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.sessionId).toBe('new-session-id');
    expect(body.storyExpiresAt).toBe('2026-04-11T10:00:00Z');
    expect(mockCreateStorySession).toHaveBeenCalledWith(TABLE_NAME, 'user-123');
  });

  it('should return 500 when repository throws', async () => {
    mockCreateStorySession.mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Failed to create story session');
  });

  it('should include CORS headers', async () => {
    mockCreateStorySession.mockResolvedValue(makeStorySession());

    const event = createEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});

// ===========================
// add-story-segment handler
// ===========================
describe('add-story-segment handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../add-story-segment')).handler;
  });

  const segmentEvent = (body: any, sessionId = 'session-123', authed = true) =>
    authed
      ? createEvent({
          body: JSON.stringify(body),
          pathParameters: { sessionId },
        })
      : createUnauthEvent({
          body: JSON.stringify(body),
          pathParameters: { sessionId },
        });

  it('should return 401 when userId is missing', async () => {
    const event = segmentEvent({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' }, 'session-123', false);

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' }),
      pathParameters: null,
    });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sessionId');
  });

  it('should return 400 when type is not image or video', async () => {
    const event = segmentEvent({ type: 'audio', filename: 'test.mp3', contentType: 'audio/mp3' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('type must be');
  });

  it('should return 400 when contentType is unsupported', async () => {
    const event = segmentEvent({ type: 'image', filename: 'test.gif', contentType: 'image/gif' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('contentType');
  });

  it('should return 400 when filename is missing', async () => {
    const event = segmentEvent({ type: 'image', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('filename');
  });

  it('should return 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = segmentEvent({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toContain('Session not found');
  });

  it('should return 400 when session is not STORY type', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ sessionType: SessionType.BROADCAST }));
    const event = segmentEvent({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not a STORY');
  });

  it('should return 403 when user does not own the story', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ userId: 'other-user' }));
    const event = segmentEvent({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toContain('Forbidden');
  });

  it('should return 400 when session status is not CREATING', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    const event = segmentEvent({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not in CREATING status');
  });

  it('should return 400 when max segments (10) reached', async () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({
      segmentId: `seg-${i}`,
      type: 'image' as const,
      s3Key: `stories/session-123/seg-${i}.jpg`,
      order: i,
      createdAt: '2026-04-10T10:00:00Z',
    }));
    mockGetSessionById.mockResolvedValue(makeStorySession({ storySegments: segments }));

    const event = segmentEvent({ type: 'image', filename: 'test.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Maximum 10 segments');
  });

  it('should return 200 on success with segmentId and uploadUrl', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession());
    mockAddStorySegment.mockResolvedValue();

    const event = segmentEvent({ type: 'image', filename: 'photo.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.segmentId).toBe('mock-uuid-1234');
    expect(body.uploadUrl).toBe('https://s3.presigned.url/upload');
    expect(body.s3Key).toContain('stories/session-123/');
    expect(mockAddStorySegment).toHaveBeenCalledWith(TABLE_NAME, 'session-123', expect.objectContaining({
      segmentId: 'mock-uuid-1234',
      type: 'image',
    }));
  });

  it('should return 400 for invalid JSON body', async () => {
    const event = createEvent({
      body: 'not-json',
      pathParameters: { sessionId: 'session-123' },
    });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid JSON');
  });

  it('should return 500 when repository throws', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession());
    mockAddStorySegment.mockRejectedValue(new Error('DynamoDB error'));

    const event = segmentEvent({ type: 'image', filename: 'photo.jpg', contentType: 'image/jpeg' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Failed to add story segment');
  });
});

// ===========================
// publish-story handler
// ===========================
describe('publish-story handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../publish-story')).handler;
  });

  const publishEvent = (sessionId = 'session-123', authed = true) =>
    authed
      ? createEvent({ pathParameters: { sessionId } })
      : createUnauthEvent({ pathParameters: { sessionId } });

  it('should return 401 when userId is missing', async () => {
    const event = publishEvent('session-123', false);

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent({ pathParameters: null });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sessionId');
  });

  it('should return 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(404);
  });

  it('should return 400 when session is not STORY type', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ sessionType: SessionType.HANGOUT }));
    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not a STORY');
  });

  it('should return 403 when user does not own the story', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ userId: 'other-user' }));
    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(403);
  });

  it('should return 400 when session is not in CREATING status', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not in CREATING status');
  });

  it('should return 400 when no segments exist', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ storySegments: [] }));
    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('at least 1 segment');
  });

  it('should return 200 on success with published segments and CloudFront URLs', async () => {
    const segments = [
      { segmentId: 'seg-1', type: 'image' as const, s3Key: 'stories/session-123/seg-1.jpg', order: 0, createdAt: '2026-04-10T10:00:00Z' },
      { segmentId: 'seg-2', type: 'video' as const, s3Key: 'stories/session-123/seg-2.mp4', order: 1, createdAt: '2026-04-10T10:01:00Z' },
    ];
    mockGetSessionById.mockResolvedValue(makeStorySession({ storySegments: segments }));
    mockPublishStory.mockResolvedValue();

    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('published');
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0].url).toBe('https://d123.cloudfront.net/stories/session-123/seg-1.jpg');
    expect(body.segments[1].url).toBe('https://d123.cloudfront.net/stories/session-123/seg-2.mp4');
    expect(mockPublishStory).toHaveBeenCalledWith(TABLE_NAME, 'session-123');
  });

  it('should return 500 when repository throws', async () => {
    const segments = [{ segmentId: 'seg-1', type: 'image' as const, s3Key: 'stories/session-123/seg-1.jpg', order: 0, createdAt: '2026-04-10T10:00:00Z' }];
    mockGetSessionById.mockResolvedValue(makeStorySession({ storySegments: segments }));
    mockPublishStory.mockRejectedValue(new Error('DynamoDB error'));

    const event = publishEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
  });
});

// ===========================
// get-stories-feed handler
// ===========================
describe('get-stories-feed handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../get-stories-feed')).handler;
  });

  it('should return 401 when userId is missing', async () => {
    const event = createUnauthEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 200 with empty array when no stories exist', async () => {
    mockGetActiveStories.mockResolvedValue([]);

    const event = createEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.storyUsers).toEqual([]);
  });

  it('should return 200 with grouped stories and seen/unseen state', async () => {
    const story1 = makeStorySession({ sessionId: 'story-1', userId: 'alice', status: SessionStatus.LIVE, createdAt: '2026-04-10T09:00:00Z' });
    const story2 = makeStorySession({ sessionId: 'story-2', userId: 'alice', status: SessionStatus.LIVE, createdAt: '2026-04-10T10:00:00Z' });
    const story3 = makeStorySession({ sessionId: 'story-3', userId: 'bob', status: SessionStatus.LIVE, createdAt: '2026-04-10T11:00:00Z' });

    mockGetActiveStories.mockResolvedValue([story3, story2, story1]);
    // alice's latest story (story-2) has been viewed, bob's (story-3) has not
    mockHasUserViewedStory.mockImplementation(async (_table, sessionId, _userId) => {
      return sessionId === 'story-2';
    });

    const event = createEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.storyUsers).toHaveLength(2);
    // Bob has unseen stories, should come first
    expect(body.storyUsers[0].userId).toBe('bob');
    expect(body.storyUsers[0].hasUnseenStories).toBe(true);
    // Alice's stories have been seen
    expect(body.storyUsers[1].userId).toBe('alice');
    expect(body.storyUsers[1].hasUnseenStories).toBe(false);
  });

  it('should return 500 when repository throws', async () => {
    mockGetActiveStories.mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
  });
});

// ===========================
// view-story handler
// ===========================
describe('view-story handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../view-story')).handler;
  });

  it('should return 401 when userId is missing', async () => {
    const event = createUnauthEvent({ pathParameters: { sessionId: 'session-123' } });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent({ pathParameters: null });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sessionId');
  });

  it('should return 200 on success', async () => {
    mockRecordStoryView.mockResolvedValue();

    const event = createEvent({ pathParameters: { sessionId: 'session-123' } });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ok).toBe(true);
    expect(mockRecordStoryView).toHaveBeenCalledWith(TABLE_NAME, 'session-123', 'user-123');
  });

  it('should return 500 when repository throws', async () => {
    mockRecordStoryView.mockRejectedValue(new Error('DynamoDB error'));

    const event = createEvent({ pathParameters: { sessionId: 'session-123' } });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
  });
});

// ===========================
// react-to-story handler
// ===========================
describe('react-to-story handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../react-to-story')).handler;
  });

  const reactEvent = (body: any, sessionId = 'session-123', authed = true) =>
    authed
      ? createEvent({ body: JSON.stringify(body), pathParameters: { sessionId } })
      : createUnauthEvent({ body: JSON.stringify(body), pathParameters: { sessionId } });

  it('should return 401 when userId is missing', async () => {
    const event = reactEvent({ segmentId: 'seg-1', emoji: '🔥' }, 'session-123', false);

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ segmentId: 'seg-1', emoji: '🔥' }),
      pathParameters: null,
    });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sessionId');
  });

  it('should return 400 when emoji is missing', async () => {
    const event = reactEvent({ segmentId: 'seg-1' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('emoji');
  });

  it('should return 400 when emoji is invalid', async () => {
    const event = reactEvent({ segmentId: 'seg-1', emoji: '💀' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid emoji');
  });

  it('should return 400 when segmentId is missing', async () => {
    const event = reactEvent({ emoji: '🔥' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('segmentId');
  });

  it('should return 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = reactEvent({ segmentId: 'seg-1', emoji: '🔥' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(404);
  });

  it('should return 400 when session is not STORY type', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ sessionType: SessionType.BROADCAST }));
    const event = reactEvent({ segmentId: 'seg-1', emoji: '🔥' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not a story');
  });

  it('should return 201 on success', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    mockReactToStory.mockResolvedValue();

    const event = reactEvent({ segmentId: 'seg-1', emoji: '🔥' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).ok).toBe(true);
    expect(mockReactToStory).toHaveBeenCalledWith(TABLE_NAME, 'session-123', 'seg-1', 'user-123', '🔥');
  });

  it('should return 500 when repository throws', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    mockReactToStory.mockRejectedValue(new Error('DynamoDB error'));

    const event = reactEvent({ segmentId: 'seg-1', emoji: '😂' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
  });
});

// ===========================
// reply-to-story handler
// ===========================
describe('reply-to-story handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../reply-to-story')).handler;
  });

  const replyEvent = (body: any, sessionId = 'session-123', authed = true) =>
    authed
      ? createEvent({ body: JSON.stringify(body), pathParameters: { sessionId } })
      : createUnauthEvent({ body: JSON.stringify(body), pathParameters: { sessionId } });

  it('should return 401 when userId is missing', async () => {
    const event = replyEvent({ segmentId: 'seg-1', message: 'cool!' }, 'session-123', false);

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent({
      body: JSON.stringify({ segmentId: 'seg-1', message: 'cool!' }),
      pathParameters: null,
    });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sessionId');
  });

  it('should return 400 when segmentId is missing', async () => {
    const event = replyEvent({ message: 'cool!' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('segmentId');
  });

  it('should return 400 when message is empty', async () => {
    const event = replyEvent({ segmentId: 'seg-1', message: '' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('message');
  });

  it('should return 400 when message is whitespace only', async () => {
    const event = replyEvent({ segmentId: 'seg-1', message: '   ' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('message');
  });

  it('should return 400 when message exceeds 500 characters', async () => {
    const longMessage = 'a'.repeat(501);
    const event = replyEvent({ segmentId: 'seg-1', message: longMessage });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('500 characters');
  });

  it('should return 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = replyEvent({ segmentId: 'seg-1', message: 'cool!' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(404);
  });

  it('should return 400 when session is not STORY type', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ sessionType: SessionType.UPLOAD }));
    const event = replyEvent({ segmentId: 'seg-1', message: 'cool!' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not a story');
  });

  it('should return 201 on success with replyId', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    mockCreateStoryReply.mockResolvedValue();

    const event = replyEvent({ segmentId: 'seg-1', message: 'Great story!' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.replyId).toBe('mock-uuid-1234');
    expect(mockCreateStoryReply).toHaveBeenCalledWith(TABLE_NAME, 'session-123', expect.objectContaining({
      replyId: 'mock-uuid-1234',
      sessionId: 'session-123',
      segmentId: 'seg-1',
      senderId: 'user-123',
      content: 'Great story!',
    }));
  });

  it('should trim message whitespace', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    mockCreateStoryReply.mockResolvedValue();

    const event = replyEvent({ segmentId: 'seg-1', message: '  hello  ' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(201);
    expect(mockCreateStoryReply).toHaveBeenCalledWith(TABLE_NAME, 'session-123', expect.objectContaining({
      content: 'hello',
    }));
  });

  it('should return 500 when repository throws', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ status: SessionStatus.LIVE }));
    mockCreateStoryReply.mockRejectedValue(new Error('DynamoDB error'));

    const event = replyEvent({ segmentId: 'seg-1', message: 'nice!' });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
  });
});

// ===========================
// get-story-viewers handler
// ===========================
describe('get-story-viewers handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../get-story-viewers')).handler;
  });

  const viewersEvent = (sessionId = 'session-123', authed = true) =>
    authed
      ? createEvent({ pathParameters: { sessionId } })
      : createUnauthEvent({ pathParameters: { sessionId } });

  it('should return 401 when userId is missing', async () => {
    const event = viewersEvent('session-123', false);

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(401);
  });

  it('should return 400 when sessionId is missing', async () => {
    const event = createEvent({ pathParameters: null });

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('sessionId');
  });

  it('should return 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = viewersEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(404);
  });

  it('should return 400 when session is not STORY type', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ sessionType: SessionType.BROADCAST }));
    const event = viewersEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('not a story');
  });

  it('should return 403 when non-owner requests viewers', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession({ userId: 'other-user' }));
    const event = viewersEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toContain('owner');
  });

  it('should return 200 with viewers array', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession());
    const viewers = [
      { sessionId: 'session-123', userId: 'viewer-1', viewedAt: '2026-04-10T10:05:00Z' },
      { sessionId: 'session-123', userId: 'viewer-2', viewedAt: '2026-04-10T10:10:00Z' },
    ];
    mockGetStoryViewers.mockResolvedValue(viewers);

    const event = viewersEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.viewers).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(mockGetStoryViewers).toHaveBeenCalledWith(TABLE_NAME, 'session-123');
  });

  it('should return 200 with empty viewers array when no views', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession());
    mockGetStoryViewers.mockResolvedValue([]);

    const event = viewersEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.viewers).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('should return 500 when repository throws', async () => {
    mockGetSessionById.mockResolvedValue(makeStorySession());
    mockGetStoryViewers.mockRejectedValue(new Error('DynamoDB error'));

    const event = viewersEvent();

    const result = await handler(event, {} as any, {} as any);

    expect(result.statusCode).toBe(500);
  });
});

// ===========================
// expire-stories handler
// ===========================
describe('expire-stories handler', () => {
  let handler: any;

  beforeEach(async () => {
    handler = (await import('../expire-stories')).handler;
  });

  const scheduledEvent: ScheduledEvent = {
    version: '0',
    id: 'event-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2026-04-10T12:00:00Z',
    region: 'us-east-1',
    resources: ['arn:aws:events:us-east-1:123456789012:rule/expire-stories'],
    detail: {},
  };

  it('should call expireOldStories and complete successfully', async () => {
    mockExpireOldStories.mockResolvedValue(3);

    await handler(scheduledEvent, {} as any, {} as any);

    expect(mockExpireOldStories).toHaveBeenCalledWith(TABLE_NAME);
  });

  it('should call expireOldStories when no stories need expiring', async () => {
    mockExpireOldStories.mockResolvedValue(0);

    await handler(scheduledEvent, {} as any, {} as any);

    expect(mockExpireOldStories).toHaveBeenCalledWith(TABLE_NAME);
  });

  it('should throw when repository throws', async () => {
    mockExpireOldStories.mockRejectedValue(new Error('DynamoDB error'));

    await expect(handler(scheduledEvent, {} as any, {} as any)).rejects.toThrow('DynamoDB error');
  });
});
