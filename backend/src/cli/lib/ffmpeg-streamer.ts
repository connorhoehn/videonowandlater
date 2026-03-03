/**
 * FFmpeg RTMPS streaming wrapper
 * Spawns FFmpeg process to stream video files to RTMPS endpoints
 */

import { spawn } from 'child_process';

export interface StreamOptions {
  videoFile: string;
  rtmpUrl: string;
  loop?: boolean;
  onProgress?: (data: string) => void;
}

/**
 * Stream video file to RTMPS endpoint using FFmpeg
 * Uses encoding settings from test-broadcast.sh pattern
 *
 * @param options Streaming options
 * @returns Promise that resolves when streaming completes successfully
 * @throws Error if FFmpeg exits with non-zero code
 */
export function streamToRTMPS(options: StreamOptions): Promise<void> {
  const args = [
    '-re',                           // Read at native frame rate
    ...(options.loop ? ['-stream_loop', '-1'] : []),
    '-i', options.videoFile,
    // Video encoding: H.264 at 3.5 Mbps, 1080p30
    '-c:v', 'libx264',
    '-b:v', '3500k',
    '-maxrate', '3500k',
    '-bufsize', '7000k',
    '-pix_fmt', 'yuv420p',
    '-s', '1920x1080',
    '-r', '30',
    '-profile:v', 'main',
    '-preset', 'veryfast',
    // Key frames every 2 seconds for IVS
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-x264opts', 'nal-hrd=cbr:no-scenecut',
    // Audio encoding: AAC at 160 kbps
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',
    '-ac', '2',
    // Output format and URL
    '-f', 'flv',
    options.rtmpUrl,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);

    // Pipe stderr to progress callback if provided
    ffmpeg.stderr.on('data', (data) => {
      if (options.onProgress) {
        options.onProgress(data.toString());
      }
    });

    // Handle process completion
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}
