/**
 * Tests for survey-repository — writeSurvey / getSurveyForSession /
 * listSurveysForSession / listRecentSurveys / computeAggregate.
 */

import { PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import * as dynamodbClient from '../../lib/dynamodb-client';
import {
  writeSurvey,
  getSurveyForSession,
  listSurveysForSession,
  listRecentSurveys,
  computeAggregate,
  SURVEY_QUEUE_GSI5PK,
  type Survey,
} from '../survey-repository';

jest.mock('../../lib/dynamodb-client');

const mockGetDocumentClient =
  dynamodbClient.getDocumentClient as jest.MockedFunction<typeof dynamodbClient.getDocumentClient>;

const TABLE = 'test-table';

function makeSurvey(partial: Partial<Survey> & { nps: number }): Survey {
  return {
    PK: `SESSION#${partial.sessionId ?? 's'}`,
    SK: `SURVEY#${partial.userId ?? 'u'}`,
    sessionId: partial.sessionId ?? 's',
    userId: partial.userId ?? 'u',
    nps: partial.nps,
    freeText: partial.freeText,
    submittedAt: partial.submittedAt ?? '2026-04-18T12:00:00.000Z',
    sessionType: partial.sessionType,
  };
}

describe('survey-repository', () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  describe('writeSurvey', () => {
    it('puts a SURVEY item with expected PK/SK + GSI5 projection and conditional put', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await writeSurvey(TABLE, {
        sessionId: 'sess-1',
        userId: 'user-1',
        nps: 9,
        freeText: 'Great!',
        sessionType: 'BROADCAST',
        submittedAt: '2026-04-18T12:00:00.000Z',
      });

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(PutCommand);
      expect(call.input.TableName).toBe(TABLE);
      expect(call.input.ConditionExpression).toBe('attribute_not_exists(PK)');
      const item = call.input.Item;
      expect(item.PK).toBe('SESSION#sess-1');
      expect(item.SK).toBe('SURVEY#user-1');
      expect(item.entityType).toBe('SURVEY');
      expect(item.nps).toBe(9);
      expect(item.freeText).toBe('Great!');
      expect(item.sessionType).toBe('BROADCAST');
      expect(item.GSI5PK).toBe(SURVEY_QUEUE_GSI5PK);
      expect(item.GSI5SK).toBe('2026-04-18T12:00:00.000Z');

      expect(created.PK).toBe('SESSION#sess-1');
      expect(created.SK).toBe('SURVEY#user-1');
      expect(created.nps).toBe(9);
      expect(created.freeText).toBe('Great!');
      expect(created.submittedAt).toBe('2026-04-18T12:00:00.000Z');
    });

    it('omits freeText / sessionType when not provided', async () => {
      mockSend.mockResolvedValueOnce({});
      await writeSurvey(TABLE, { sessionId: 's', userId: 'u', nps: 5 });
      const item = mockSend.mock.calls[0][0].input.Item;
      expect(item.freeText).toBeUndefined();
      expect(item.sessionType).toBeUndefined();
    });

    it('generates submittedAt when not supplied', async () => {
      mockSend.mockResolvedValueOnce({});
      const created = await writeSurvey(TABLE, { sessionId: 's', userId: 'u', nps: 3 });
      expect(created.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('propagates ConditionalCheckFailedException for duplicate submission (idempotency)', async () => {
      const err = Object.assign(new Error('dup'), { name: 'ConditionalCheckFailedException' });
      mockSend.mockRejectedValueOnce(err);
      await expect(
        writeSurvey(TABLE, { sessionId: 's', userId: 'u', nps: 8 }),
      ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
    });
  });

  describe('getSurveyForSession', () => {
    it('returns null when GetItem misses', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(getSurveyForSession(TABLE, 's', 'u')).resolves.toBeNull();
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(GetCommand);
      expect(call.input.Key).toEqual({ PK: 'SESSION#s', SK: 'SURVEY#u' });
    });

    it('maps an existing item into a Survey', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'SESSION#s',
          SK: 'SURVEY#u',
          sessionId: 's',
          userId: 'u',
          nps: 10,
          freeText: 'loved it',
          submittedAt: '2026-04-18T00:00:00Z',
          sessionType: 'HANGOUT',
        },
      });
      const survey = await getSurveyForSession(TABLE, 's', 'u');
      expect(survey).toMatchObject({
        sessionId: 's',
        userId: 'u',
        nps: 10,
        freeText: 'loved it',
        sessionType: 'HANGOUT',
      });
    });
  });

  describe('listSurveysForSession', () => {
    it('queries PK=SESSION#<id> begins_with SURVEY#', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'SESSION#s', SK: 'SURVEY#u1', sessionId: 's', userId: 'u1', nps: 9, submittedAt: 't1' },
          { PK: 'SESSION#s', SK: 'SURVEY#u2', sessionId: 's', userId: 'u2', nps: 6, submittedAt: 't2' },
        ],
      });
      const list = await listSurveysForSession(TABLE, 's');
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': 'SESSION#s',
          ':skPrefix': 'SURVEY#',
        },
      });
      expect(list).toHaveLength(2);
      expect(list[0].nps).toBe(9);
      expect(list[1].userId).toBe('u2');
    });

    it('returns [] when no surveys', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await expect(listSurveysForSession(TABLE, 's')).resolves.toEqual([]);
    });
  });

  describe('listRecentSurveys', () => {
    it('queries GSI5 with default limit=100 and no since filter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await listRecentSurveys(TABLE);
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        IndexName: 'GSI5',
        KeyConditionExpression: 'GSI5PK = :pk',
        ExpressionAttributeValues: { ':pk': SURVEY_QUEUE_GSI5PK },
        ScanIndexForward: false,
        Limit: 100,
      });
    });

    it('narrows the range with GSI5SK >= :since when since is provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await listRecentSurveys(TABLE, { since: '2026-03-01T00:00:00Z', limit: 25 });
      const call = mockSend.mock.calls[0][0];
      expect(call.input.KeyConditionExpression).toBe('GSI5PK = :pk AND GSI5SK >= :since');
      expect(call.input.ExpressionAttributeValues).toEqual({
        ':pk': SURVEY_QUEUE_GSI5PK,
        ':since': '2026-03-01T00:00:00Z',
      });
      expect(call.input.Limit).toBe(25);
    });

    it('maps items through into Survey shape', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'SESSION#s1', SK: 'SURVEY#u1', sessionId: 's1', userId: 'u1', nps: 10, submittedAt: 't' },
        ],
      });
      const list = await listRecentSurveys(TABLE);
      expect(list[0]).toMatchObject({ sessionId: 's1', userId: 'u1', nps: 10 });
    });
  });

  describe('computeAggregate', () => {
    it('returns all zeros for an empty list', () => {
      expect(computeAggregate([])).toEqual({
        count: 0,
        npsAvg: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        npsScore: 0,
      });
    });

    it('classifies each NPS bucket correctly (detractor <=6, passive 7-8, promoter >=9)', () => {
      const surveys: Survey[] = [
        makeSurvey({ nps: 0 }),   // detractor
        makeSurvey({ nps: 6 }),   // detractor
        makeSurvey({ nps: 7 }),   // passive
        makeSurvey({ nps: 8 }),   // passive
        makeSurvey({ nps: 9 }),   // promoter
        makeSurvey({ nps: 10 }),  // promoter
      ];
      const agg = computeAggregate(surveys);
      expect(agg.count).toBe(6);
      expect(agg.promoters).toBe(2);
      expect(agg.passives).toBe(2);
      expect(agg.detractors).toBe(2);
      // promoters 2/6 = 33.33%, detractors 2/6 = 33.33%, so score ~0
      expect(agg.npsScore).toBe(0);
      // avg = (0+6+7+8+9+10)/6 = 6.666... rounded to 2dp = 6.67
      expect(agg.npsAvg).toBeCloseTo(6.67, 2);
    });

    it('computes +100 when all respondents are promoters', () => {
      const surveys: Survey[] = [makeSurvey({ nps: 9 }), makeSurvey({ nps: 10 })];
      const agg = computeAggregate(surveys);
      expect(agg.npsScore).toBe(100);
      expect(agg.promoters).toBe(2);
      expect(agg.detractors).toBe(0);
    });

    it('computes -100 when all respondents are detractors', () => {
      const surveys: Survey[] = [makeSurvey({ nps: 0 }), makeSurvey({ nps: 3 }), makeSurvey({ nps: 6 })];
      const agg = computeAggregate(surveys);
      expect(agg.npsScore).toBe(-100);
      expect(agg.detractors).toBe(3);
    });

    it('computes 0 when all respondents are passives', () => {
      const surveys: Survey[] = [makeSurvey({ nps: 7 }), makeSurvey({ nps: 8 })];
      const agg = computeAggregate(surveys);
      expect(agg.npsScore).toBe(0);
      expect(agg.passives).toBe(2);
    });

    it('mixes buckets: 3 promoters, 1 passive, 1 detractor → score = 40', () => {
      const surveys: Survey[] = [
        makeSurvey({ nps: 10 }),
        makeSurvey({ nps: 9 }),
        makeSurvey({ nps: 9 }),
        makeSurvey({ nps: 8 }),
        makeSurvey({ nps: 4 }),
      ];
      const agg = computeAggregate(surveys);
      expect(agg.promoters).toBe(3);
      expect(agg.passives).toBe(1);
      expect(agg.detractors).toBe(1);
      // 60% - 20% = 40
      expect(agg.npsScore).toBe(40);
    });
  });
});
