/**
 * Group repository — user-created groups in the single-table `vnl-sessions` DynamoDB.
 *
 * Schema:
 *   PK: GROUP#<groupId>, SK: META
 *     { groupId, ownerId, name, description, visibility, createdAt }
 *   PK: GROUP#<groupId>, SK: MEMBER#<userId>
 *     { userId, groupRole: owner|admin|member, addedAt, addedBy }
 *     GSI1PK: USER#<userId>, GSI1SK: GROUPMEMBERSHIP#<groupId>
 */

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocumentClient } from '../lib/dynamodb-client';

export type GroupVisibility = 'private' | 'public';
export type GroupRole = 'owner' | 'admin' | 'member';

export interface Group {
  groupId: string;
  ownerId: string;
  name: string;
  description?: string;
  visibility: GroupVisibility;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  groupRole: GroupRole;
  addedAt: string;
  addedBy: string;
}

export interface CreateGroupInput {
  ownerId: string;
  name: string;
  description?: string;
  visibility?: GroupVisibility;
}

/** Create a new group + seed the owner member row. */
export async function createGroup(
  tableName: string,
  input: CreateGroupInput,
): Promise<Group> {
  const docClient = getDocumentClient();
  const groupId = uuidv4();
  const createdAt = new Date().toISOString();

  const group: Group = {
    groupId,
    ownerId: input.ownerId,
    name: input.name,
    description: input.description,
    visibility: input.visibility ?? 'private',
    createdAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `GROUP#${groupId}`,
        SK: 'META',
        entityType: 'GROUP',
        ...group,
      },
    }),
  );

  await addMember(tableName, {
    groupId,
    userId: input.ownerId,
    groupRole: 'owner',
    addedBy: input.ownerId,
  });

  return group;
}

export async function getGroupById(
  tableName: string,
  groupId: string,
): Promise<Group | null> {
  const docClient = getDocumentClient();
  const res = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `GROUP#${groupId}`, SK: 'META' },
    }),
  );
  if (!res.Item) return null;
  const { PK, SK, entityType, ...group } = res.Item as any;
  return group as Group;
}

export async function updateGroup(
  tableName: string,
  groupId: string,
  patch: Partial<Pick<Group, 'name' | 'description' | 'visibility'>>,
): Promise<Group | null> {
  const docClient = getDocumentClient();
  const fields: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, any> = {};

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = v;
  }

  if (!fields.length) return getGroupById(tableName, groupId);

  const res = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `GROUP#${groupId}`, SK: 'META' },
      UpdateExpression: `SET ${fields.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }),
  );

  if (!res.Attributes) return null;
  const { PK, SK, entityType, ...group } = res.Attributes as any;
  return group as Group;
}

/** Delete the group META row + all member rows in batches. */
export async function deleteGroup(
  tableName: string,
  groupId: string,
): Promise<void> {
  const docClient = getDocumentClient();
  const members = await listMembers(tableName, groupId);

  // Collect every row (META + MEMBER#...) for deletion.
  const keys = [
    { PK: `GROUP#${groupId}`, SK: 'META' },
    ...members.map((m) => ({ PK: `GROUP#${groupId}`, SK: `MEMBER#${m.userId}` })),
  ];

  // BatchWrite caps at 25 items.
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map((k) => ({ DeleteRequest: { Key: k } })),
        },
      }),
    );
  }
}

export interface AddMemberInput {
  groupId: string;
  userId: string;
  groupRole: GroupRole;
  addedBy: string;
}

export async function addMember(
  tableName: string,
  input: AddMemberInput,
): Promise<GroupMember> {
  const docClient = getDocumentClient();
  const member: GroupMember = {
    groupId: input.groupId,
    userId: input.userId,
    groupRole: input.groupRole,
    addedAt: new Date().toISOString(),
    addedBy: input.addedBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `GROUP#${input.groupId}`,
        SK: `MEMBER#${input.userId}`,
        entityType: 'GROUP_MEMBER',
        GSI1PK: `USER#${input.userId}`,
        GSI1SK: `GROUPMEMBERSHIP#${input.groupId}`,
        ...member,
      },
    }),
  );

  return member;
}

export async function getMember(
  tableName: string,
  groupId: string,
  userId: string,
): Promise<GroupMember | null> {
  const docClient = getDocumentClient();
  const res = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
    }),
  );
  if (!res.Item) return null;
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...member } = res.Item as any;
  return member as GroupMember;
}

export async function removeMember(
  tableName: string,
  groupId: string,
  userId: string,
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
    }),
  );
}

export async function promoteMember(
  tableName: string,
  groupId: string,
  userId: string,
  newRole: GroupRole,
): Promise<GroupMember | null> {
  const docClient = getDocumentClient();
  const res = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
      UpdateExpression: 'SET groupRole = :r',
      ExpressionAttributeValues: { ':r': newRole },
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }),
  );
  if (!res.Attributes) return null;
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...member } = res.Attributes as any;
  return member as GroupMember;
}

export async function listMembers(
  tableName: string,
  groupId: string,
): Promise<GroupMember[]> {
  const docClient = getDocumentClient();
  const res = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GROUP#${groupId}`,
        ':sk': 'MEMBER#',
      },
    }),
  );
  return (res.Items ?? []).map((item: any) => {
    const { PK, SK, GSI1PK, GSI1SK, entityType, ...member } = item;
    return member as GroupMember;
  });
}

/** List groups a user is a member of via GSI1. */
export async function listGroupsForUser(
  tableName: string,
  userId: string,
): Promise<Array<{ groupId: string; groupRole: GroupRole; addedAt: string }>> {
  const docClient = getDocumentClient();
  const res = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'GROUPMEMBERSHIP#',
      },
    }),
  );
  return (res.Items ?? []).map((item: any) => ({
    groupId: item.groupId,
    groupRole: item.groupRole,
    addedAt: item.addedAt,
  }));
}

/** Bulk-load group metas for a list of groupIds. Uses parallel Gets. */
export async function getGroupsByIds(
  tableName: string,
  groupIds: string[],
): Promise<Group[]> {
  if (!groupIds.length) return [];
  const results = await Promise.all(
    groupIds.map((id) => getGroupById(tableName, id)),
  );
  return results.filter((g): g is Group => g !== null);
}
