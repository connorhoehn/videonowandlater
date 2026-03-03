/**
 * stream-hangout command
 * Streams MP4/MOV file into active hangout session via WHIP protocol
 */

import { IVSRealTimeClient, CreateParticipantTokenCommand, ParticipantTokenCapability } from '@aws-sdk/client-ivs-realtime';
import { getSessionById } from '../../repositories/session-repository';
import { SessionType } from '../../domain/session';
import { streamToWHIP } from '../lib/ffmpeg-streamer';

/**
 * Stream video file into hangout session
 *
 * @param sessionId Session ID to stream into
 * @param videoFile Path to video file
 */
export async function streamHangout(sessionId: string, videoFile: string): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable not set');
  }

  console.log(`Looking up session: ${sessionId}...`);

  // Fetch session and validate type
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (session.sessionType !== SessionType.HANGOUT) {
    throw new Error(`Session ${sessionId} is not a HANGOUT session`);
  }

  if (!session.claimedResources.stage) {
    throw new Error(`Session ${sessionId} does not have a stage ARN`);
  }

  console.log(`Session type: HANGOUT`);
  console.log(`Stage ARN: ${session.claimedResources.stage}`);

  // Create participant token for streaming
  const ivsClient = new IVSRealTimeClient({ region: process.env.AWS_REGION || 'us-west-2' });

  console.log('Creating participant token...');

  const tokenResponse = await ivsClient.send(
    new CreateParticipantTokenCommand({
      stageArn: session.claimedResources.stage,
      capabilities: [ParticipantTokenCapability.PUBLISH, ParticipantTokenCapability.SUBSCRIBE],
      duration: 720, // 12 hours
      userId: 'cli-stream',
      attributes: {
        displayName: 'CLI Stream',
      },
    })
  );

  if (!tokenResponse.participantToken?.token) {
    throw new Error('Failed to create participant token');
  }

  const participantToken = tokenResponse.participantToken.token;

  // IVS RealTime WHIP endpoint follows pattern:
  // https://{stage-id}.global-realtime.live-video.net:443/v1/whip
  // Extract stage ID from ARN (last segment after /)
  const stageId = session.claimedResources.stage.split('/').pop();
  const whipUrl = `https://${stageId}.global-realtime.live-video.net:443/v1/whip`;

  console.log(`\nStreaming to hangout session: ${sessionId}`);
  console.log(`Video file: ${videoFile}`);
  console.log(`WHIP URL: ${whipUrl}`);
  console.log(`\nPress Ctrl+C to stop streaming\n`);

  // Stream to WHIP endpoint
  await streamToWHIP({
    videoFile,
    whipUrl,
    participantToken,
    onProgress: (data: string) => {
      // Only log frame count updates (filter out verbose FFmpeg output)
      if (data.includes('frame=')) {
        const frameMatch = data.match(/frame=\s*(\d+)/);
        const fpsMatch = data.match(/fps=\s*([\d.]+)/);
        if (frameMatch && fpsMatch) {
          process.stdout.write(`\rFrame: ${frameMatch[1]} | FPS: ${fpsMatch[1]}    `);
        }
      }
    },
  });

  console.log('\n\nStreaming completed.');
}
