/**
 * Integration test for scan-active-sessions handler.
 *
 * Runs against DynamoDB Local spun up by @shelf/jest-dynamodb:
 *  - Real DynamoDB SDK clients talk to the local endpoint.
 *  - IVS / IVS-Realtime / IVS-Chat SDK clients are mocked via aws-sdk-client-mock
 *    (no network calls; every command resolves successfully).
 *
 * Scenario:
 *  - A LIVE session older than the 10-min auto-kill cutoff ⇒ should transition
 *    to ENDING, emit an AUTO_KILL MOD row and release its pool resources.
 *  - A stuck ENDING session older than the 2-min finalize cutoff ⇒ should
 *    transition to ENDED.
 */

import 'aws-sdk-client-mock-jest';
import { mockClient } from 'aws-sdk-client-mock';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import {
  IVSRealTimeClient,
  DisconnectParticipantCommand,
} from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'vnl-sessions';
const DDB_ENDPOINT = `http://localhost:${process.env.MOCK_DYNAMODB_PORT ?? '8000'}`;

// IMPORTANT: set env vars BEFORE the handler module is imported so that
// lazy singletons pick them up correctly.
process.env.TABLE_NAME = TABLE_NAME;
process.env.DDB_ENDPOINT = DDB_ENDPOINT;
process.env.ACTIVE_SESSION_MAX_AGE_MIN = '10';
process.env.ENDING_MAX_AGE_MIN = '2';
process.env.AWS_REGION = 'local';
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';

// Stand-alone doc client for seeding + assertions (bypasses the singleton).
function makeRawDocClient(): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    endpoint: DDB_ENDPOINT,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

const rawClient = makeRawDocClient();

const ivsMock = mockClient(IvsClient);
const ivsRealtimeMock = mockClient(IVSRealTimeClient);
const ivsChatMock = mockClient(IvschatClient);

// Import the handler AFTER env vars are set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handler } = require('../scan-active-sessions');

const nowMs = Date.now();
const fifteenMinAgo = new Date(nowMs - 15 * 60 * 1000).toISOString();
const twoMinAgo = new Date(nowMs - 2 * 60 * 1000 - 30_000).toISOString();

async function clearTable(): Promise<void> {
  // Scan + delete all rows to reset state between tests.
  const scan = await rawClient.send(
    new ScanCommand({ TableName: TABLE_NAME, ProjectionExpression: 'PK, SK' }),
  );
  for (const item of scan.Items ?? []) {
    await rawClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: item.PK, SK: item.SK },
      }),
    );
  }
}

async function seedLiveHangout(sessionId: string): Promise<void> {
  // The handler forwards `claimedResources.{channel|stage|chatRoom}` directly
  // into releasePoolResource(), which parses the value as an ARN to derive
  // the resourceType (channel/stage/room). Use full ARN strings here so pool
  // rows are located at the correct PK.
  const stageArn = 'arn:aws:ivs:us-east-1:123456789012:stage/stage-123';
  const roomArn = 'arn:aws:ivschat:us-east-1:123456789012:room/room-123';

  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
        GSI1PK: 'STATUS#LIVE',
        GSI1SK: fifteenMinAgo,
        entityType: 'SESSION',
        sessionId,
        userId: 'user-1',
        sessionType: 'HANGOUT',
        status: 'live',
        createdAt: fifteenMinAgo,
        stageArn,
        claimedResources: { stage: stageArn, chatRoom: roomArn },
        version: 1,
      },
    }),
  );

  // Pool rows backing the claimed resources (so release can flip them).
  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'POOL#STAGE#stage-123',
        SK: 'METADATA',
        GSI1PK: 'STATUS#CLAIMED',
        GSI1SK: fifteenMinAgo,
        entityType: 'POOL_ITEM',
        resourceArn: stageArn,
        resourceType: 'STAGE',
        status: 'CLAIMED',
        claimedBy: sessionId,
        claimedAt: fifteenMinAgo,
        version: 2,
      },
    }),
  );
  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'POOL#ROOM#room-123',
        SK: 'METADATA',
        GSI1PK: 'STATUS#CLAIMED',
        GSI1SK: fifteenMinAgo,
        entityType: 'POOL_ITEM',
        resourceArn: roomArn,
        resourceType: 'ROOM',
        status: 'CLAIMED',
        claimedBy: sessionId,
        claimedAt: fifteenMinAgo,
        version: 2,
      },
    }),
  );
}

async function seedStuckEnding(sessionId: string): Promise<void> {
  const channelArn = 'arn:aws:ivs:us-east-1:123456789012:channel/channel-stuck';
  const roomArn = 'arn:aws:ivschat:us-east-1:123456789012:room/room-stuck';

  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
        GSI1PK: 'STATUS#ENDING',
        GSI1SK: fifteenMinAgo,
        entityType: 'SESSION',
        sessionId,
        userId: 'user-2',
        sessionType: 'BROADCAST',
        status: 'ending',
        createdAt: fifteenMinAgo,
        endedAt: twoMinAgo,
        channelArn,
        claimedResources: { channel: channelArn, chatRoom: roomArn },
        version: 2,
      },
    }),
  );
  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'POOL#CHANNEL#channel-stuck',
        SK: 'METADATA',
        GSI1PK: 'STATUS#CLAIMED',
        GSI1SK: fifteenMinAgo,
        entityType: 'POOL_ITEM',
        resourceArn: channelArn,
        resourceType: 'CHANNEL',
        status: 'CLAIMED',
        claimedBy: sessionId,
        claimedAt: fifteenMinAgo,
        version: 2,
      },
    }),
  );
  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'POOL#ROOM#room-stuck',
        SK: 'METADATA',
        GSI1PK: 'STATUS#CLAIMED',
        GSI1SK: fifteenMinAgo,
        entityType: 'POOL_ITEM',
        resourceArn: roomArn,
        resourceType: 'ROOM',
        status: 'CLAIMED',
        claimedBy: sessionId,
        claimedAt: fifteenMinAgo,
        version: 2,
      },
    }),
  );
}

describe('scan-active-sessions integration', () => {
  beforeEach(async () => {
    ivsMock.reset();
    ivsRealtimeMock.reset();
    ivsChatMock.reset();

    ivsMock.on(StopStreamCommand).resolves({});
    ivsRealtimeMock.on(DisconnectParticipantCommand).resolves({});
    ivsChatMock.on(SendEventCommand).resolves({});

    await clearTable();
  });

  test(
    'kills stale LIVE session and finalizes stuck ENDING session',
    async () => {
      const liveId = 'live-session-1';
      const stuckId = 'stuck-ending-1';
      await seedLiveHangout(liveId);
      await seedStuckEnding(stuckId);

      await handler({} as any, {} as any, () => {});

      // --- LIVE session should now be ENDING ---
      const live = await rawClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${liveId}`, SK: 'METADATA' },
        }),
      );
      expect(live.Item).toBeDefined();
      expect(live.Item!.status).toBe('ending');
      expect(live.Item!.GSI1PK).toBe('STATUS#ENDING');

      // --- MOD row with actionType=AUTO_KILL should exist for the live session ---
      const modRows = await rawClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${liveId}`,
            ':sk': 'MOD#',
          },
        }),
      );
      expect(modRows.Items?.length).toBeGreaterThanOrEqual(1);
      expect(modRows.Items![0].actionType).toBe('AUTO_KILL');
      expect(modRows.Items![0].actorId).toBe('system');

      // --- Pool rows for the live session should be AVAILABLE again ---
      const stagePool = await rawClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'POOL#STAGE#stage-123', SK: 'METADATA' },
        }),
      );
      expect(stagePool.Item!.status).toBe('AVAILABLE');
      expect(stagePool.Item!.GSI1PK).toBe('STATUS#AVAILABLE#STAGE');

      const roomPool = await rawClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: 'POOL#ROOM#room-123', SK: 'METADATA' },
        }),
      );
      expect(roomPool.Item!.status).toBe('AVAILABLE');
      expect(roomPool.Item!.GSI1PK).toBe('STATUS#AVAILABLE#ROOM');

      // --- stuck ENDING session should now be ENDED ---
      const ended = await rawClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `SESSION#${stuckId}`, SK: 'METADATA' },
        }),
      );
      expect(ended.Item!.status).toBe('ended');
      expect(ended.Item!.GSI1PK).toBe('STATUS#ENDED');

      // --- IVS mocks were exercised for the live HANGOUT kill path ---
      // (no participants in the seed, so Disconnect may be 0; SendEvent should fire
      // for the kill notification on the chat room).
      expect(ivsChatMock).toHaveReceivedCommand(SendEventCommand);
    },
    60_000,
  );
});
