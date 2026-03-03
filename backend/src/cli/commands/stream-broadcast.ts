/**
 * stream-broadcast command - Stream video file to active broadcast session
 */

import { GetChannelCommand, GetStreamKeyCommand } from '@aws-sdk/client-ivs';
import { getIVSClient } from '../../lib/ivs-clients';
import { getSessionById } from '../../repositories/session-repository';
import { SessionType } from '../../domain/session';
import { streamToRTMPS } from '../lib/ffmpeg-streamer';

export interface StreamBroadcastOptions {
  loop?: boolean;
}

/**
 * Stream video file into active broadcast session
 *
 * @param sessionId Session ID to stream into
 * @param videoFile Path to MP4/MOV file
 * @param options Streaming options
 */
export async function streamBroadcast(
  sessionId: string,
  videoFile: string,
  options: StreamBroadcastOptions
): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable not set');
  }

  // Fetch session
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Validate session type
  if (session.sessionType !== SessionType.BROADCAST) {
    throw new Error(
      `Session ${sessionId} is not a BROADCAST session (type: ${session.sessionType})`
    );
  }

  // Get channel ingest endpoint and stream key
  const ivsClient = getIVSClient();
  const channelArn = session.claimedResources.channel;

  if (!channelArn) {
    throw new Error(`Session ${sessionId} has no channel resource`);
  }

  const channelResponse = await ivsClient.send(
    new GetChannelCommand({ arn: channelArn })
  );

  const channel = channelResponse.channel as any;
  const ingestEndpoint = channel?.ingestEndpoint;
  const streamKeyArn = channel?.streamKey;

  if (!ingestEndpoint || !streamKeyArn) {
    throw new Error(`Failed to retrieve ingest endpoint or stream key ARN for channel ${channelArn}`);
  }

  // Get stream key value
  const streamKeyResponse = await ivsClient.send(
    new GetStreamKeyCommand({ arn: streamKeyArn })
  );

  const streamKey = streamKeyResponse.streamKey?.value;

  if (!streamKey) {
    throw new Error(`Failed to retrieve stream key value for ARN ${streamKeyArn}`);
  }

  // Construct RTMPS URL
  const rtmpUrl = `rtmps://${ingestEndpoint}:443/app/${streamKey}`;

  console.log(`Streaming to session: ${sessionId}`);
  console.log(`Endpoint: rtmps://${ingestEndpoint}:443/app/***`);
  console.log(`Video file: ${videoFile}`);
  console.log(`Loop: ${options.loop ? 'enabled' : 'disabled'}`);
  console.log('');
  console.log('Press Ctrl+C to stop streaming');
  console.log('');

  // Start streaming
  await streamToRTMPS({
    videoFile,
    rtmpUrl,
    loop: options.loop,
    onProgress: (data) => {
      // Write progress to stdout (FFmpeg outputs to stderr)
      const lines = data.split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.includes('frame=') || line.includes('fps=')) {
          process.stdout.write(`\r${line.trim()}`);
        }
      }
    },
  });

  console.log('\nStreaming completed');
}
