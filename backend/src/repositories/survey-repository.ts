/**
 * Post-call survey repository.
 *
 * A survey is captured at most once per (session, user). Rows live on the
 * session partition for per-session aggregation, and project into GSI5 under
 * a single `SURVEY_QUEUE` partition for cross-session admin queries.
 *
 * PK:     SESSION#<sessionId>
 * SK:     SURVEY#<userId>
 * GSI5PK: SURVEY_QUEUE
 * GSI5SK: <submittedAt>  (ISO-8601 — lexicographic order == chronological)
 */

import { PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({
  serviceName: 'vnl-repository',
  persistentKeys: { repo: 'survey' },
});

export const SURVEY_QUEUE_GSI5PK = 'SURVEY_QUEUE';

export interface Survey {
  sessionId: string;
  userId: string;
  nps: number;
  freeText?: string;
  submittedAt: string;
  sessionType?: string;
  // Raw composite keys — exposed for admin surfaces that round-trip them.
  PK: string;
  SK: string;
}

export interface WriteSurveyInput {
  sessionId: string;
  userId: string;
  nps: number;
  freeText?: string;
  sessionType?: string;
  submittedAt?: string;
}

export interface SurveyAggregate {
  count: number;
  npsAvg: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Standard NPS = %promoters − %detractors, rounded to the nearest integer */
  npsScore: number;
}

function surveyPk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

function surveySk(userId: string): string {
  return `SURVEY#${userId}`;
}

/**
 * Write a new survey for (sessionId, userId). Conditional put — if the user has
 * already submitted a survey for this session, throws `ConditionalCheckFailedException`.
 * Caller is responsible for translating that to a 409.
 */
export async function writeSurvey(
  tableName: string,
  input: WriteSurveyInput,
): Promise<Survey> {
  const submittedAt = input.submittedAt ?? new Date().toISOString();
  const PK = surveyPk(input.sessionId);
  const SK = surveySk(input.userId);

  const item: Record<string, unknown> = {
    PK,
    SK,
    entityType: 'SURVEY',
    sessionId: input.sessionId,
    userId: input.userId,
    nps: input.nps,
    submittedAt,
    GSI5PK: SURVEY_QUEUE_GSI5PK,
    GSI5SK: submittedAt,
  };
  if (input.freeText !== undefined) item.freeText = input.freeText;
  if (input.sessionType !== undefined) item.sessionType = input.sessionType;

  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        // Reject writes when a survey already exists for this (session, user)
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (err) {
    logger.info('writeSurvey failed', {
      sessionId: input.sessionId,
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return {
    PK,
    SK,
    sessionId: input.sessionId,
    userId: input.userId,
    nps: input.nps,
    freeText: input.freeText,
    submittedAt,
    sessionType: input.sessionType,
  };
}

/** Fetch one user's survey for a session; returns null when not present. */
export async function getSurveyForSession(
  tableName: string,
  sessionId: string,
  userId: string,
): Promise<Survey | null> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: surveyPk(sessionId), SK: surveySk(userId) },
    }),
  );
  if (!result.Item) return null;
  return mapItemToSurvey(result.Item);
}

/** List every survey submitted for a single session (all participants). */
export async function listSurveysForSession(
  tableName: string,
  sessionId: string,
): Promise<Survey[]> {
  const result = await getDocumentClient().send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': surveyPk(sessionId),
        ':skPrefix': 'SURVEY#',
      },
    }),
  );
  return (result.Items ?? []).map(mapItemToSurvey);
}

/**
 * List recent surveys across every session via GSI5. Newest first.
 * `since` is an inclusive ISO timestamp used to narrow the GSI5SK range.
 */
export async function listRecentSurveys(
  tableName: string,
  options: { limit?: number; since?: string } = {},
): Promise<Survey[]> {
  const limit = options.limit ?? 100;

  const keyConditionExpression = options.since
    ? 'GSI5PK = :pk AND GSI5SK >= :since'
    : 'GSI5PK = :pk';

  const values: Record<string, unknown> = { ':pk': SURVEY_QUEUE_GSI5PK };
  if (options.since) values[':since'] = options.since;

  try {
    const result = await getDocumentClient().send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI5',
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: values,
        ScanIndexForward: false, // newest first
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map(mapItemToSurvey);
  } catch (err) {
    logger.error('listRecentSurveys failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Pure aggregate computation — no I/O. Safe to run on any slice of surveys.
 * Definitions (standard NPS):
 *  - promoter:  nps >= 9
 *  - passive:   nps 7 or 8
 *  - detractor: nps <= 6
 *  - npsScore:  (%promoters − %detractors), rounded to the nearest integer
 *  - npsAvg:    mean of raw nps values
 * Empty input returns all zeros (no NaNs).
 */
export function computeAggregate(surveys: Survey[]): SurveyAggregate {
  const count = surveys.length;
  if (count === 0) {
    return { count: 0, npsAvg: 0, promoters: 0, passives: 0, detractors: 0, npsScore: 0 };
  }
  let sum = 0;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of surveys) {
    sum += s.nps;
    if (s.nps >= 9) promoters += 1;
    else if (s.nps >= 7) passives += 1;
    else detractors += 1;
  }
  const npsAvg = Number((sum / count).toFixed(2));
  const npsScore = Math.round(((promoters - detractors) / count) * 100);
  return { count, npsAvg, promoters, passives, detractors, npsScore };
}

function mapItemToSurvey(item: Record<string, any>): Survey {
  return {
    PK: item.PK,
    SK: item.SK,
    sessionId: item.sessionId,
    userId: item.userId,
    nps: typeof item.nps === 'number' ? item.nps : Number(item.nps ?? 0),
    freeText: typeof item.freeText === 'string' ? item.freeText : undefined,
    submittedAt: item.submittedAt,
    sessionType: typeof item.sessionType === 'string' ? item.sessionType : undefined,
  };
}
