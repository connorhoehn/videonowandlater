/**
 * Lambda handler for SNS-triggered MediaConvert job submission
 * Receives upload completion events from complete-upload handler
 * Submits MediaConvert job for adaptive bitrate HLS transcoding
 */

import type { SNSEvent } from 'aws-lambda';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { getSessionById, updateConvertStatus } from '../repositories/session-repository';

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

      console.log(`Starting MediaConvert job for session: ${sessionId}`);

      // Verify session exists
      const session = await getSessionById(tableName, sessionId);
      if (!session) {
        console.error(`Session not found: ${sessionId}`);
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
                  },
                },
                Outputs: [
                  {
                    NameModifier: '1080p',
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          MaxBitrate: 5000000, // 5 Mbps
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                    AudioDescriptions: [
                      {
                        CodecSettings: {
                          Codec: 'AAC',
                          AacSettings: {
                            Bitrate: 128000,
                            CodingMode: 'CODING_MODE_2_0',
                            SampleRate: 48000,
                          },
                        },
                      },
                    ],
                  },
                  {
                    NameModifier: '720p',
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          MaxBitrate: 2500000, // 2.5 Mbps
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                    AudioDescriptions: [
                      {
                        CodecSettings: {
                          Codec: 'AAC',
                          AacSettings: {
                            Bitrate: 128000,
                            CodingMode: 'CODING_MODE_2_0',
                            SampleRate: 48000,
                          },
                        },
                      },
                    ],
                  },
                  {
                    NameModifier: '480p',
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          MaxBitrate: 1200000, // 1.2 Mbps
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                    AudioDescriptions: [
                      {
                        CodecSettings: {
                          Codec: 'AAC',
                          AacSettings: {
                            Bitrate: 128000,
                            CodingMode: 'CODING_MODE_2_0',
                            SampleRate: 48000,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          Tags: {
            sessionId,
            phase: '21-uploads',
          },
          UserMetadata: {
            sessionId,
            phase: '21-uploads',
          },
        })
      );

      const jobId = response.Job?.Id!;
      console.log(`MediaConvert job submitted: ${jobName} (ID: ${jobId})`);

      // Store job name in session for later correlation
      console.log(`Job name stored in session for correlation: ${jobName}`);

      // Update session with job name and pending status
      await updateConvertStatus(tableName, sessionId, jobName, 'pending');
    }
  } catch (error) {
    console.error('start-mediaconvert error:', error);
    // Don't rethrow; SNS message is consumed even if handler fails
  }
};
