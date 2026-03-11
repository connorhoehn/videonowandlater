#!/usr/bin/env node
'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

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

function fmt(val) {
  return val !== undefined && val !== null ? val : '(not set)';
}

function fmtPreview(val, maxLen) {
  if (val === undefined || val === null) return '(not set)';
  const str = String(val);
  if (str.length > maxLen) return str.slice(0, maxLen) + '...';
  return str;
}

async function main() {
  const args = parseArgs();

  if (!args.sessionId) {
    console.error('Usage: node tools/debug-pipeline.js --sessionId <id> [--table <tableName>]');
    console.error('');
    console.error('Options:');
    console.error('  --sessionId  (required) The session UUID to inspect');
    console.error('  --table      (optional) DynamoDB table name (default: vnl-sessions)');
    process.exit(1);
  }

  const sessionId = args.sessionId;
  const tableName = args.table || 'vnl-sessions';
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!result.Item) {
    console.error(`ERROR: Session not found: ${sessionId}`);
    process.exit(1);
  }

  const s = result.Item;

  console.log('=== Pipeline Debug Report ===');
  console.log(`Session: ${sessionId}`);
  console.log(`Table:   ${tableName}`);
  console.log('');

  console.log('--- Identity ---');
  console.log(`userId:        ${fmt(s.userId)}`);
  console.log(`sessionType:   ${fmt(s.sessionType)}`);
  console.log(`status:        ${fmt(s.status)}`);
  console.log(`createdAt:     ${fmt(s.createdAt)}`);
  console.log(`startedAt:     ${fmt(s.startedAt)}`);
  console.log(`endedAt:       ${fmt(s.endedAt)}`);
  console.log(`version:       ${fmt(s.version)}`);
  console.log('');

  console.log('--- Recording ---');
  console.log(`recordingStatus:   ${fmt(s.recordingStatus)}`);
  console.log(`recordingHlsUrl:   ${fmt(s.recordingHlsUrl)}`);
  console.log(`recordingS3Path:   ${fmt(s.recordingS3Path)}`);
  console.log(`recordingDuration: ${fmt(s.recordingDuration)}`);
  console.log(`thumbnailUrl:      ${fmt(s.thumbnailUrl)}`);
  console.log('');

  console.log('--- Pipeline State ---');
  console.log(`mediaconvertJobId:        ${fmt(s.mediaconvertJobId)}    [broadcast transcription pipeline]`);
  console.log(`transcriptStatus:         ${fmt(s.transcriptStatus)}`);
  console.log(`transcriptS3Path:         ${fmt(s.transcriptS3Path)}`);
  console.log(`diarizedTranscriptS3Path: ${fmt(s.diarizedTranscriptS3Path)}`);
  console.log(`aiSummaryStatus:          ${fmt(s.aiSummaryStatus)}`);
  console.log(`recoveryAttemptCount:     ${fmt(s.recoveryAttemptCount)}`);
  console.log(`transcript (preview):     ${fmtPreview(s.transcript, 200)}`);
  console.log(`aiSummary (preview):      ${fmtPreview(s.aiSummary, 200)}`);
  console.log('');

  console.log('--- Upload Pipeline ---');
  console.log(`uploadStatus:        ${fmt(s.uploadStatus)}`);
  console.log(`convertStatus:       ${fmt(s.convertStatus)}`);
  console.log(`mediaConvertJobName: ${fmt(s.mediaConvertJobName)}    [upload pipeline]`);

  process.exit(0);
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
