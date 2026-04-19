/**
 * Integration test for the bounce-user handler.
 *
 * POST /sessions/{sessionId}/bounce { userId } — broadcaster kicks a user
 * from the chat room and records a BOUNCE moderation row.
 *
 * Runs against DynamoDB Local (spun up by @shelf/jest-dynamodb). IVS Chat
 * SDK client is mocked via aws-sdk-client-mock.
 *
 * Scenarios covered:
 *  1. Happy path: owner bounces a user — MOD row written, user_kicked event
 *     sent, DisconnectUser invoked.
 *  2. Subsequent `isUserBannedInSession` returns true for the target.
 *  3. Non-owner bounce attempt → 403, no MOD row written.
 *  4. Idempotent re-bounce: two successive bounces of the same user both
 *     succeed and produce 2 MOD rows.
 */

import 'aws-sdk-client-mock-jest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  IvschatClient,
  DisconnectUserCommand,
  SendEventCommand,
} from '@aws-sdk/client-ivschat';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'vnl-sessions';
const DDB_ENDPOINT = `http://localhost:${process.env.MOCK_DYNAMODB_PORT ?? '8000'}`;

// Set env BEFORE the handler module is imported so singletons pick them up.
process.env.TABLE_NAME = TABLE_NAME;
process.env.DDB_ENDPOINT = DDB_ENDPOINT;
process.env.AWS_REGION = 'local';
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';

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

const ivsChatMock = mockClient(IvschatClient);

// Import AFTER env vars are set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handler } = require('../bounce-user');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isUserBannedInSession } = require('../../repositories/ban-repository');

const nowIso = new Date().toISOString();

// ---- helpers --------------------------------------------------------------

async function clearTable(): Promise<void> {
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

function createEvent(
  actorId: string,
  sessionId: string,
  targetUserId: string,
) {
  return {
    pathParameters: { sessionId },
    requestContext: {
      authorizer: { claims: { 'cognito:username': actorId } },
    },
    body: JSON.stringify({ userId: targetUserId }),
  } as any;
}

async function seedLiveHangoutSession(
  sessionId: string,
  ownerId: string,
): Promise<string> {
  const stageArn = `arn:aws:ivs:us-east-1:123456789012:stage/${sessionId}-st`;
  const chatRoomArn = `arn:aws:ivschat:us-east-1:123456789012:room/${sessionId}-room`;
  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
        GSI1PK: 'STATUS#LIVE',
        GSI1SK: nowIso,
        entityType: 'SESSION',
        sessionId,
        userId: ownerId,
        sessionType: 'HANGOUT',
        status: 'live',
        createdAt: nowIso,
        stageArn,
        claimedResources: { stage: stageArn, chatRoom: chatRoomArn },
        version: 1,
      },
    }),
  );
  return chatRoomArn;
}

async function listModRows(sessionId: string) {
  const res = await rawClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':sk': 'MOD#',
      },
    }),
  );
  return res.Items ?? [];
}

// ---- tests ---------------------------------------------------------------

describe('bounce-user integration', () => {
  beforeEach(async () => {
    ivsChatMock.reset();
    ivsChatMock.on(SendEventCommand).resolves({});
    ivsChatMock.on(DisconnectUserCommand).resolves({});

    await clearTable();
  });

  afterEach(async () => {
    await clearTable();
  });

  test(
    'happy path: owner bounces user — MOD row, SendEvent, DisconnectUser',
    async () => {
      const sessionId = 'bounce-ok-1';
      const owner = 'alice';
      const target = 'trouble-tom';
      await seedLiveHangoutSession(sessionId, owner);

      const res = await handler(createEvent(owner, sessionId, target));
      expect(res.statusCode).toBe(200);

      // MOD row written
      const modRows = await listModRows(sessionId);
      expect(modRows.length).toBe(1);
      const mod = modRows[0];
      expect(mod.SK).toMatch(/^MOD#/);
      expect(mod.actionType).toBe('BOUNCE');
      expect(mod.userId).toBe(target);
      expect(mod.actorId).toBe(owner);
      expect(mod.entityType).toBe('MODERATION');

      // IVS Chat: user_kicked event + DisconnectUser for target
      expect(ivsChatMock).toHaveReceivedCommandWith(SendEventCommand, {
        eventName: 'user_kicked',
      });
      expect(ivsChatMock).toHaveReceivedCommandWith(DisconnectUserCommand, {
        userId: target,
      });
    },
    60_000,
  );

  test(
    'bounced user shows up as banned via isUserBannedInSession',
    async () => {
      const sessionId = 'bounce-banned-2';
      const owner = 'alice';
      const target = 'banned-bella';
      await seedLiveHangoutSession(sessionId, owner);

      // Before: not banned
      const beforeBanned = await isUserBannedInSession(
        TABLE_NAME,
        target,
        sessionId,
      );
      expect(beforeBanned).toBe(false);

      const res = await handler(createEvent(owner, sessionId, target));
      expect(res.statusCode).toBe(200);

      // After: banned
      const afterBanned = await isUserBannedInSession(
        TABLE_NAME,
        target,
        sessionId,
      );
      expect(afterBanned).toBe(true);

      // Unrelated user is not banned
      const otherBanned = await isUserBannedInSession(
        TABLE_NAME,
        'other-user',
        sessionId,
      );
      expect(otherBanned).toBe(false);
    },
    60_000,
  );

  test(
    'non-owner attempt returns 403 and writes no MOD row',
    async () => {
      const sessionId = 'bounce-forbid-3';
      const owner = 'alice';
      const target = 'innocent-ian';
      await seedLiveHangoutSession(sessionId, owner);

      const res = await handler(createEvent('mallory', sessionId, target));
      expect(res.statusCode).toBe(403);

      const modRows = await listModRows(sessionId);
      expect(modRows.length).toBe(0);

      // No IVS Chat calls made
      expect(ivsChatMock).not.toHaveReceivedCommand(DisconnectUserCommand);
      expect(ivsChatMock).not.toHaveReceivedCommand(SendEventCommand);
    },
    60_000,
  );

  test(
    'idempotent re-bounce: two successive bounces both succeed',
    async () => {
      const sessionId = 'bounce-idempotent-4';
      const owner = 'alice';
      const target = 'persistent-pete';
      await seedLiveHangoutSession(sessionId, owner);

      const first = await handler(createEvent(owner, sessionId, target));
      expect(first.statusCode).toBe(200);

      // Need distinct MOD SK ordering — loop a small sleep so ISO timestamp differs
      await new Promise((r) => setTimeout(r, 5));

      const second = await handler(createEvent(owner, sessionId, target));
      expect(second.statusCode).toBe(200);

      const modRows = await listModRows(sessionId);
      expect(modRows.length).toBe(2);
      for (const mod of modRows) {
        expect(mod.actionType).toBe('BOUNCE');
        expect(mod.userId).toBe(target);
      }

      // Two DisconnectUser calls, both succeeded (mock resolves, no throw).
      expect(ivsChatMock).toHaveReceivedCommandTimes(DisconnectUserCommand, 2);
    },
    60_000,
  );
});
