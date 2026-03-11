#!/usr/bin/env node
'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const VALID_STAGES = ['recording-ended', 'mediaconvert', 'transcribe', 'summary'];
const TRANSCRIPTION_BUCKET = 'vnl-transcription-vnl-session';

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function buildEntry(stage, sessionId, session) {
  switch (stage) {
    case 'recording-ended': {
      if (!session.recordingS3Path) {
        console.error('ERROR: Session has no recordingS3Path. Cannot publish Recording Recovery event.');
        process.exit(1);
      }
      return {
        Source: 'custom.vnl',
        DetailType: 'Recording Recovery',
        Detail: JSON.stringify({
          sessionId,
          recoveryAttempt: true,
          recoveryAttemptCount: 0,
          recordingHlsUrl: session.recordingHlsUrl,
          recordingS3Path: session.recordingS3Path,
        }),
      };
    }

    case 'mediaconvert': {
      return {
        Source: 'aws.mediaconvert',
        DetailType: 'MediaConvert Job State Change',
        Detail: JSON.stringify({
          status: 'COMPLETE',
          jobId: session.mediaconvertJobId ?? 'manual-replay',
          userMetadata: { sessionId, phase: '19-transcription' },
          outputGroupDetails: [{
            outputDetails: [{
              outputFilePaths: [
                `s3://${TRANSCRIPTION_BUCKET}/${sessionId}/${sessionId}recording.mp4`,
              ],
            }],
          }],
        }),
      };
    }

    case 'transcribe': {
      console.log(`NOTE: This event assumes transcript.json already exists at s3://${TRANSCRIPTION_BUCKET}/${sessionId}/transcript.json. If not, transcribe-completed will fail with NoSuchKey.`);
      return {
        Source: 'aws.transcribe',
        DetailType: 'Transcribe Job State Change',
        Detail: JSON.stringify({
          TranscriptionJobStatus: 'COMPLETED',
          TranscriptionJobName: `vnl-${sessionId}-${Date.now()}`,
        }),
      };
    }

    case 'summary': {
      const transcriptUri = session.transcriptS3Path
        || `s3://${TRANSCRIPTION_BUCKET}/${sessionId}/transcript.json`;
      return {
        Source: 'custom.vnl',
        DetailType: 'Transcript Stored',
        Detail: JSON.stringify({
          sessionId,
          transcriptS3Uri: transcriptUri,
        }),
      };
    }

    default:
      console.error(`ERROR: Unknown stage '${stage}'. Valid stages: ${VALID_STAGES.join(', ')}`);
      process.exit(1);
  }
}

async function main() {
  const args = parseArgs();

  if (!args.sessionId || !args.from) {
    console.error('Usage: node tools/replay-pipeline.js --sessionId <id> --from <stage> [--table <tableName>]');
    console.error('');
    console.error('Options:');
    console.error('  --sessionId  (required) The session UUID to resume');
    console.error(`  --from       (required) Pipeline stage to replay: ${VALID_STAGES.join(', ')}`);
    console.error('  --table      (optional) DynamoDB table name (default: vnl-sessions)');
    process.exit(1);
  }

  const sessionId = args.sessionId;
  const stage = args.from;
  const tableName = args.table || 'vnl-sessions';
  const region = process.env.AWS_REGION ?? 'us-east-1';

  if (!VALID_STAGES.includes(stage)) {
    console.error(`ERROR: Unknown stage '${stage}'. Valid stages: ${VALID_STAGES.join(', ')}`);
    process.exit(1);
  }

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const ebClient = new EventBridgeClient({ region });

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!result.Item) {
    console.error(`ERROR: Session not found: ${sessionId}`);
    process.exit(1);
  }

  const session = result.Item;
  const entry = buildEntry(stage, sessionId, session);

  const response = await ebClient.send(new PutEventsCommand({
    Entries: [entry],
  }));

  if (response.FailedEntryCount > 0) {
    console.error('ERROR: EventBridge rejected the event:', response.Entries[0].ErrorMessage);
    process.exit(1);
  }

  console.log('Event published to EventBridge default bus.');
  console.log(`  Stage:       ${stage}`);
  console.log(`  Source:      ${entry.Source}`);
  console.log(`  Detail-Type: ${entry.DetailType}`);
  console.log('');
  console.log('NOTE: Lambda execution may take up to 20 seconds due to SQS buffering (Phase 31).');

  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
