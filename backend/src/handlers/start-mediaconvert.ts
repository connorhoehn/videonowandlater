/**
 * Lambda handler for SNS-triggered MediaConvert job submission
 * Receives upload completion events from complete-upload handler
 * Submits MediaConvert job for adaptive bitrate HLS transcoding
 */

import type { SNSEvent } from 'aws-lambda';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { getSessionById, updateConvertStatus } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'start-mediaconvert' } });

interface MediaConvertInput {
  sessionId: string;
  s3Bucket: string;
  s3Key: string;
  sourceFileName: string;
  sourceFileSize: number;
}

export const handler = async (event: SNSEvent): Promise<void> => {
  try {
    const tableName = process.env.TABLE_NAME!;
    const roleArn = process.env.MEDIACONVERT_ROLE_ARN!;
    const outputBucket = process.env.RECORDINGS_BUCKET!;

    for (const record of event.Records) {
      const message = JSON.parse(record.Sns.Message) as MediaConvertInput;
      const { sessionId, s3Bucket, s3Key, sourceFileName } = message;

      logger.info('Starting MediaConvert job', { sessionId });

      // Verify session exists
      const session = await getSessionById(tableName, sessionId);
      if (!session) {
        logger.error('Session not found', { sessionId });
        continue;
      }

      // Generate job name (matches Phase 19 pattern: vnl-{sessionId}-{epochMs})
      const jobName = `vnl-${sessionId}-${Date.now()}`;

      const mediaConvert = new MediaConvertClient({ region: process.env.AWS_REGION });

      const response = await mediaConvert.send(
        new CreateJobCommand({
          Role: roleArn,
          Queue: `arn:aws:mediaconvert:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:queues/Default`,
          Settings: {
            Inputs: [
              {
                FileInput: `s3://${s3Bucket}/${s3Key}`,
                AudioSelectors: {
                  default: {
                    DefaultSelection: 'DEFAULT',
                  },
                },
              },
            ],
            OutputGroups: [
              {
                Name: 'Apple HLS',
                OutputGroupSettings: {
                  Type: 'HLS_GROUP_SETTINGS',
                  HlsGroupSettings: {
                    Destination: `s3://${outputBucket}/hls/${sessionId}/`,
                    SegmentLength: 10,
                    MinSegmentLength: 0,
                  },
                },
                Outputs: [
                  {
                    NameModifier: '1080p',
                    ContainerSettings: {
                      Container: 'M3U8',
                    },
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          Bitrate: 5000000, // 5 Mbps
                          MaxBitrate: 5000000,
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                  },
                  {
                    NameModifier: '720p',
                    ContainerSettings: {
                      Container: 'M3U8',
                    },
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          Bitrate: 2500000, // 2.5 Mbps
                          MaxBitrate: 2500000,
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                  },
                  {
                    NameModifier: '480p',
                    ContainerSettings: {
                      Container: 'M3U8',
                    },
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          Bitrate: 1200000, // 1.2 Mbps
                          MaxBitrate: 1200000,
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
          Tags: {
            sessionId,
            phase: '19-transcription',
          },
          UserMetadata: {
            sessionId,
            phase: '19-transcription',
          },
        })
      );

      const jobId = response.Job?.Id!;
      logger.info('MediaConvert job submitted', { jobName, jobId });

      // Store job name in session for later correlation
      logger.info('Job name stored in session for correlation', { jobName });

      // Update session with job name and pending status
      await updateConvertStatus(tableName, sessionId, jobName, 'pending');
    }
  } catch (error) {
    logger.error('start-mediaconvert error', { error: error instanceof Error ? error.message : String(error) });
    // Don't rethrow; SNS message is consumed even if handler fails
  }
};
