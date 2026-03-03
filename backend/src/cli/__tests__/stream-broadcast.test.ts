/**
 * Tests for stream-broadcast command
 */

import { streamBroadcast } from '../commands/stream-broadcast';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import { GetChannelCommand, GetStreamKeyCommand } from '@aws-sdk/client-ivs';
import { getIVSClient } from '../../lib/ivs-clients';
import * as ffmpegStreamer from '../lib/ffmpeg-streamer';

// Mock dependencies
jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ivs-clients');
jest.mock('../lib/ffmpeg-streamer');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockGetIVSClient = getIVSClient as jest.MockedFunction<typeof getIVSClient>;
const mockStreamToRTMPS = ffmpegStreamer.streamToRTMPS as jest.MockedFunction<typeof ffmpegStreamer.streamToRTMPS>;

describe('stream-broadcast command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should fetch session and validate sessionType === BROADCAST', async () => {
    const mockSession = {
      sessionId: 'test-session',
      userId: 'user-1',
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.LIVE,
      claimedResources: {
        channel: 'arn:aws:ivs:us-east-1:123456789012:channel/test-channel',
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
      },
      createdAt: '2026-03-03T00:00:00Z',
      version: 1,
    };

    const mockChannelResponse = {
      channel: {
        ingestEndpoint: 'test-endpoint.ivs.aws',
        streamKey: 'arn:aws:ivs:us-east-1:123456789012:stream-key/test-key',
      },
    };

    const mockStreamKeyResponse = {
      streamKey: {
        value: 'test-stream-key',
      },
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    const mockSend = jest.fn()
      .mockResolvedValueOnce(mockChannelResponse)
      .mockResolvedValueOnce(mockStreamKeyResponse);
    mockGetIVSClient.mockReturnValue({ send: mockSend } as any);

    mockStreamToRTMPS.mockResolvedValue();

    await streamBroadcast('test-session', '/path/to/video.mp4', {});

    expect(mockGetSessionById).toHaveBeenCalledWith('test-table', 'test-session');
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetChannelCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetStreamKeyCommand));
  });

  it('should throw error if session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);

    await expect(
      streamBroadcast('nonexistent-session', '/path/to/video.mp4', {})
    ).rejects.toThrow('Session nonexistent-session not found');
  });

  it('should throw error if session is not BROADCAST type', async () => {
    const mockSession = {
      sessionId: 'test-session',
      userId: 'user-1',
      sessionType: SessionType.HANGOUT,
      status: SessionStatus.LIVE,
      claimedResources: {
        stage: 'arn:aws:ivs:us-east-1:123456789012:stage/test-stage',
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
      },
      createdAt: '2026-03-03T00:00:00Z',
      version: 1,
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    await expect(
      streamBroadcast('test-session', '/path/to/video.mp4', {})
    ).rejects.toThrow('Session test-session is not a BROADCAST session (type: HANGOUT)');
  });

  it('should call GetChannelCommand with session.claimedResources.channel', async () => {
    const channelArn = 'arn:aws:ivs:us-east-1:123456789012:channel/test-channel';
    const mockSession = {
      sessionId: 'test-session',
      userId: 'user-1',
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.LIVE,
      claimedResources: {
        channel: channelArn,
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
      },
      createdAt: '2026-03-03T00:00:00Z',
      version: 1,
    };

    const mockChannelResponse = {
      channel: {
        ingestEndpoint: 'test-endpoint.ivs.aws',
        streamKey: 'arn:aws:ivs:us-east-1:123456789012:stream-key/test-key',
      },
    };

    const mockStreamKeyResponse = {
      streamKey: {
        value: 'test-stream-key',
      },
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    const mockSend = jest.fn()
      .mockResolvedValueOnce(mockChannelResponse)
      .mockResolvedValueOnce(mockStreamKeyResponse);
    mockGetIVSClient.mockReturnValue({ send: mockSend } as any);

    mockStreamToRTMPS.mockResolvedValue();

    await streamBroadcast('test-session', '/path/to/video.mp4', {});

    const getChannelCall = mockSend.mock.calls[0][0];
    expect(getChannelCall).toBeInstanceOf(GetChannelCommand);
    expect(getChannelCall.input.arn).toBe(channelArn);
  });

  it('should construct rtmps URL from ingestEndpoint and streamKey', async () => {
    const mockSession = {
      sessionId: 'test-session',
      userId: 'user-1',
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.LIVE,
      claimedResources: {
        channel: 'arn:aws:ivs:us-east-1:123456789012:channel/test-channel',
        chatRoom: 'arn:aws:ivschat:us-east-1:123456789012:room/test-room',
      },
      createdAt: '2026-03-03T00:00:00Z',
      version: 1,
    };

    const mockChannelResponse = {
      channel: {
        ingestEndpoint: 'test-endpoint.ivs.aws',
        streamKey: 'arn:aws:ivs:us-east-1:123456789012:stream-key/test-key',
      },
    };

    const mockStreamKeyResponse = {
      streamKey: {
        value: 'test-stream-key',
      },
    };

    mockGetSessionById.mockResolvedValue(mockSession);

    const mockSend = jest.fn()
      .mockResolvedValueOnce(mockChannelResponse)
      .mockResolvedValueOnce(mockStreamKeyResponse);
    mockGetIVSClient.mockReturnValue({ send: mockSend } as any);

    mockStreamToRTMPS.mockResolvedValue();

    await streamBroadcast('test-session', '/path/to/video.mp4', { loop: true });

    expect(mockStreamToRTMPS).toHaveBeenCalledWith({
      videoFile: '/path/to/video.mp4',
      rtmpUrl: 'rtmps://test-endpoint.ivs.aws:443/app/test-stream-key',
      loop: true,
      onProgress: expect.any(Function),
    });
  });
});
