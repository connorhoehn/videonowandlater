/**
 * Integration test for the approve-lobby-request handler.
 *
 * POST /sessions/{sessionId}/lobby/{userId}/approve — host approves a
 * pending lobby join request. Mints a PUBLISH+SUBSCRIBE participant token,
 * persists participant row, flips lobby status to 'approved', emits chat
 * lobby_update event.
 *
 * Runs against DynamoDB Local (spun up by @shelf/jest-dynamodb). IVS
 * Realtime + IVS Chat SDK clients are mocked via aws-sdk-client-mock.
 *
 * Scenarios covered:
 *  1. Happy path: seeded pending lobby row → approved + participant written.
 *  2. No lobby row seeded — handler still succeeds (best-effort update),
 *     token is minted, participant row is still created.
 *  3. Non-host 403.
 *  4. Re-approval (already-approved lobby row): returns 200; row still
 *     'approved'; mint happens again (handler does not short-circuit).
 */

import 'aws-sdk-client-mock-jest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  IVSRealTimeClient,
  CreateParticipantTokenCommand,
} from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'vnl-sessions';
const DDB_ENDPOINT = `http://localhost:${process.env.MOCK_DYNAMODB_PORT ?? '8000'}`;

// Set env BEFORE the handler module is imported.
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

const ivsRealtimeMock = mockClient(IVSRealTimeClient);
const ivsChatMock = mockClient(IvschatClient);

// Import AFTER env vars are set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handler } = require('../approve-lobby-request');

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
  userId: string,
) {
  return {
    pathParameters: { sessionId, userId },
    requestContext: {
      authorizer: { claims: { 'cognito:username': actorId } },
    },
  } as any;
}

async function seedHangoutWithApproval(
  sessionId: string,
  ownerId: string,
): Promise<{ stageArn: string; chatRoomArn: string }> {
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
        requireApproval: true,
        stageArn,
        claimedResources: { stage: stageArn, chatRoom: chatRoomArn },
        version: 1,
      },
    }),
  );
  return { stageArn, chatRoomArn };
}

async function seedLobbyRequest(
  sessionId: string,
  userId: string,
  status: 'pending' | 'approved' | 'denied' = 'pending',
) {
  await rawClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: `LOBBY#${userId}`,
        entityType: 'LOBBY_REQUEST',
        GSI1PK: `SESSION#${sessionId}#LOBBY`,
        GSI1SK: nowIso,
        sessionId,
        userId,
        displayName: userId,
        requestedAt: nowIso,
        status,
      },
    }),
  );
}

async function getLobbyRow(sessionId: string, userId: string) {
  const res = await rawClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SESSION#${sessionId}`, SK: `LOBBY#${userId}` },
    }),
  );
  return res.Item;
}

async function getParticipantRow(sessionId: string, userId: string) {
  const res = await rawClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SESSION#${sessionId}`, SK: `PARTICIPANT#${userId}` },
    }),
  );
  return res.Item;
}

// ---- tests ---------------------------------------------------------------

describe('approve-lobby-request integration', () => {
  beforeEach(async () => {
    ivsRealtimeMock.reset();
    ivsChatMock.reset();

    ivsRealtimeMock.on(CreateParticipantTokenCommand).resolves({
      participantToken: {
        token: 'minted-token-xyz',
        participantId: 'pid-integration',
        expirationTime: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    ivsChatMock.on(SendEventCommand).resolves({});

    await clearTable();
  });

  afterEach(async () => {
    await clearTable();
  });

  test(
    'happy path: host approves pending lobby request',
    async () => {
      const sessionId = 'lobby-ok-1';
      const owner = 'host-alice';
      const target = 'guest-greg';
      const { stageArn, chatRoomArn } = await seedHangoutWithApproval(
        sessionId,
        owner,
      );
      await seedLobbyRequest(sessionId, target, 'pending');

      const res = await handler(createEvent(owner, sessionId, target));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('approved');
      expect(body.userId).toBe(target);
      expect(body.token).toBe('minted-token-xyz');
      expect(body.participantId).toBe('pid-integration');

      // Lobby row flipped to approved
      const lobby = await getLobbyRow(sessionId, target);
      expect(lobby).toBeDefined();
      expect(lobby!.status).toBe('approved');

      // Participant row written
      const participant = await getParticipantRow(sessionId, target);
      expect(participant).toBeDefined();
      expect(participant!.userId).toBe(target);
      expect(participant!.participantId).toBe('pid-integration');

      // IVS Realtime: CreateParticipantToken called with PUBLISH+SUBSCRIBE
      expect(ivsRealtimeMock).toHaveReceivedCommandWith(
        CreateParticipantTokenCommand,
        {
          stageArn,
          userId: target,
          capabilities: ['PUBLISH', 'SUBSCRIBE'],
        },
      );

      // IVS Chat: lobby_update event with approved action
      expect(ivsChatMock).toHaveReceivedCommandWith(SendEventCommand, {
        roomIdentifier: chatRoomArn,
        eventName: 'lobby_update',
        attributes: {
          userId: target,
          action: 'approved',
          approvedBy: owner,
        },
      });
    },
    60_000,
  );

  test(
    'no lobby row seeded: handler still 200s (best-effort status update)',
    async () => {
      const sessionId = 'lobby-no-row-2';
      const owner = 'host-alice';
      const target = 'never-requested-ned';
      await seedHangoutWithApproval(sessionId, owner);
      // No lobby row seeded for `target`.

      const res = await handler(createEvent(owner, sessionId, target));
      // Handler does not gate on an existing lobby row — returns 200.
      expect(res.statusCode).toBe(200);

      // Token was still minted + participant row written.
      expect(ivsRealtimeMock).toHaveReceivedCommand(
        CreateParticipantTokenCommand,
      );
      const participant = await getParticipantRow(sessionId, target);
      expect(participant).toBeDefined();
    },
    60_000,
  );

  test(
    'non-host attempt returns 403 and does not mint token',
    async () => {
      const sessionId = 'lobby-forbid-3';
      const owner = 'host-alice';
      const target = 'guest-greg';
      await seedHangoutWithApproval(sessionId, owner);
      await seedLobbyRequest(sessionId, target, 'pending');

      const res = await handler(createEvent('mallory', sessionId, target));
      expect(res.statusCode).toBe(403);

      // No IVS calls, no participant row written, lobby row still pending.
      expect(ivsRealtimeMock).not.toHaveReceivedCommand(
        CreateParticipantTokenCommand,
      );
      expect(ivsChatMock).not.toHaveReceivedCommand(SendEventCommand);

      const participant = await getParticipantRow(sessionId, target);
      expect(participant).toBeUndefined();

      const lobby = await getLobbyRow(sessionId, target);
      expect(lobby!.status).toBe('pending');
    },
    60_000,
  );

  test(
    'already-approved lobby row: re-approval returns 200; row stays approved',
    async () => {
      const sessionId = 'lobby-reapprove-4';
      const owner = 'host-alice';
      const target = 'guest-greg';
      await seedHangoutWithApproval(sessionId, owner);
      await seedLobbyRequest(sessionId, target, 'approved');

      const res = await handler(createEvent(owner, sessionId, target));
      expect(res.statusCode).toBe(200);

      // Lobby row remains in approved state.
      const lobby = await getLobbyRow(sessionId, target);
      expect(lobby!.status).toBe('approved');
    },
    60_000,
  );
});
