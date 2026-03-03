/**
 * Tests for ffmpeg-streamer - FFmpeg RTMPS streaming wrapper
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { streamToRTMPS } from '../lib/ffmpeg-streamer';

// Mock child_process
jest.mock('child_process');
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('ffmpeg-streamer', () => {
  let mockProcess: EventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock process with stderr stream
    mockProcess = new EventEmitter();
    (mockProcess as any).stderr = new EventEmitter();

    mockSpawn.mockReturnValue(mockProcess as any);
  });

  it('should spawn ffmpeg with correct RTMPS arguments', async () => {
    const options = {
      videoFile: '/path/to/test.mp4',
      rtmpUrl: 'rtmps://test.ivs.aws:443/app/streamkey',
    };

    // Start streaming and immediately emit close event
    const streamPromise = streamToRTMPS(options);
    setImmediate(() => mockProcess.emit('close', 0));
    await streamPromise;

    expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
      '-re',
      '-i', '/path/to/test.mp4',
      '-c:v', 'libx264',
      '-b:v', '3500k',
      '-maxrate', '3500k',
      '-bufsize', '7000k',
      '-pix_fmt', 'yuv420p',
      '-s', '1920x1080',
      '-r', '30',
      '-profile:v', 'main',
      '-preset', 'veryfast',
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-x264opts', 'nal-hrd=cbr:no-scenecut',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '44100',
      '-ac', '2',
      '-f', 'flv',
      'rtmps://test.ivs.aws:443/app/streamkey',
    ]));
  });

  it('should include loop arguments when loop option is true', async () => {
    const options = {
      videoFile: '/path/to/test.mp4',
      rtmpUrl: 'rtmps://test.ivs.aws:443/app/streamkey',
      loop: true,
    };

    const streamPromise = streamToRTMPS(options);
    setImmediate(() => mockProcess.emit('close', 0));
    await streamPromise;

    const spawnArgs = mockSpawn.mock.calls[0][1];
    expect(spawnArgs).toContain('-stream_loop');
    expect(spawnArgs).toContain('-1');
  });

  it('should call onProgress callback with FFmpeg stderr data', async () => {
    const progressData: string[] = [];
    const options = {
      videoFile: '/path/to/test.mp4',
      rtmpUrl: 'rtmps://test.ivs.aws:443/app/streamkey',
      onProgress: (data: string) => progressData.push(data),
    };

    const streamPromise = streamToRTMPS(options);

    // Emit stderr data
    (mockProcess as any).stderr.emit('data', Buffer.from('frame=100'));
    (mockProcess as any).stderr.emit('data', Buffer.from('fps=30'));

    setImmediate(() => mockProcess.emit('close', 0));
    await streamPromise;

    expect(progressData).toEqual(['frame=100', 'fps=30']);
  });

  it('should resolve promise when FFmpeg exits with code 0', async () => {
    const options = {
      videoFile: '/path/to/test.mp4',
      rtmpUrl: 'rtmps://test.ivs.aws:443/app/streamkey',
    };

    const streamPromise = streamToRTMPS(options);
    setImmediate(() => mockProcess.emit('close', 0));

    await expect(streamPromise).resolves.toBeUndefined();
  });

  it('should reject promise when FFmpeg exits with non-zero code', async () => {
    const options = {
      videoFile: '/path/to/test.mp4',
      rtmpUrl: 'rtmps://test.ivs.aws:443/app/streamkey',
    };

    const streamPromise = streamToRTMPS(options);
    setImmediate(() => mockProcess.emit('close', 1));

    await expect(streamPromise).rejects.toThrow('FFmpeg exited with code 1');
  });
});
