/**
 * Ruleset repository tests — DynamoDB is mocked.
 */

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: () => ({ send: mockDocSend }),
}));

import {
  getCurrentVersion,
  getRuleset,
  createRulesetVersion,
  setCurrentVersion,
  listRulesets,
  seedDefaultRulesets,
  listRulesetVersions,
  parseVersion,
} from '../ruleset-repository';

describe('ruleset-repository', () => {
  const TABLE = 'test-table';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseVersion', () => {
    it('parses padded version keys', () => {
      expect(parseVersion('V#0001')).toBe(1);
      expect(parseVersion('V#0042')).toBe(42);
      expect(parseVersion('CURRENT')).toBeNaN();
    });
  });

  describe('getCurrentVersion', () => {
    it('returns null when pointer missing', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: undefined });
      expect(await getCurrentVersion(TABLE, 'classroom')).toBeNull();
    });

    it('returns activeVersion when pointer present', async () => {
      mockDocSend.mockResolvedValueOnce({
        Item: { PK: 'RULESET#classroom', SK: 'CURRENT', activeVersion: 3 },
      });
      expect(await getCurrentVersion(TABLE, 'classroom')).toBe(3);
    });
  });

  describe('getRuleset', () => {
    it('resolves via CURRENT pointer when version not provided', async () => {
      mockDocSend
        .mockResolvedValueOnce({ Item: { activeVersion: 2 } }) // CURRENT lookup
        .mockResolvedValueOnce({
          Item: {
            PK: 'RULESET#classroom',
            SK: 'V#0002',
            name: 'classroom',
            version: 2,
            description: 'x',
            disallowedItems: ['phone'],
            severity: 'high',
            createdBy: 'admin',
            createdAt: 'now',
            active: true,
          },
        });

      const ruleset = await getRuleset(TABLE, 'classroom');
      expect(ruleset?.version).toBe(2);
      expect(ruleset?.disallowedItems).toEqual(['phone']);
    });

    it('returns null when explicit version missing', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: undefined });
      expect(await getRuleset(TABLE, 'classroom', 5)).toBeNull();
    });
  });

  describe('createRulesetVersion', () => {
    it('creates V#1 and flips CURRENT when no prior versions', async () => {
      mockDocSend
        .mockResolvedValueOnce({ Item: undefined }) // getCurrentVersion
        .mockResolvedValueOnce({}) // Put V#0001
        .mockResolvedValueOnce({}); // Put CURRENT

      const row = await createRulesetVersion(TABLE, {
        name: 'classroom',
        description: 'desc',
        disallowedItems: ['phone'],
        severity: 'high',
        createdBy: 'admin-1',
      });

      expect(row.version).toBe(1);
      expect(mockDocSend).toHaveBeenCalledTimes(3);
      const putVersionCall = mockDocSend.mock.calls[1][0].input;
      expect(putVersionCall.Item.SK).toBe('V#0001');
      const putCurrentCall = mockDocSend.mock.calls[2][0].input;
      expect(putCurrentCall.Item.SK).toBe('CURRENT');
      expect(putCurrentCall.Item.activeVersion).toBe(1);
    });

    it('increments version when prior exists', async () => {
      mockDocSend
        .mockResolvedValueOnce({ Item: { activeVersion: 4 } })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const row = await createRulesetVersion(TABLE, {
        name: 'hangout',
        description: 'desc',
        disallowedItems: ['weapons'],
        severity: 'med',
        createdBy: 'admin',
      });

      expect(row.version).toBe(5);
      const putVersionCall = mockDocSend.mock.calls[1][0].input;
      expect(putVersionCall.Item.SK).toBe('V#0005');
    });
  });

  describe('setCurrentVersion', () => {
    it('throws when target version does not exist', async () => {
      // getRuleset -> direct version GET returns undefined
      mockDocSend.mockResolvedValueOnce({ Item: undefined });
      await expect(setCurrentVersion(TABLE, 'classroom', 99)).rejects.toThrow(/no version 99/);
    });

    it('updates pointer when version exists', async () => {
      mockDocSend
        .mockResolvedValueOnce({ Item: { version: 2, name: 'classroom' } }) // getRuleset
        .mockResolvedValueOnce({}); // Update CURRENT

      await setCurrentVersion(TABLE, 'classroom', 2);
      expect(mockDocSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('listRulesets', () => {
    it('scans CURRENT pointers and joins version rows', async () => {
      // Scan: returns 2 CURRENT pointers
      mockDocSend.mockResolvedValueOnce({
        Items: [
          { name: 'classroom', activeVersion: 1 },
          { name: 'hangout', activeVersion: 2 },
        ],
      });
      // Each getRuleset: CURRENT lookup is skipped because version is supplied,
      // then a single version GET.
      mockDocSend.mockResolvedValueOnce({
        Item: {
          name: 'classroom', version: 1, description: '', disallowedItems: [],
          severity: 'high', createdBy: 's', createdAt: 'n', active: true,
        },
      });
      mockDocSend.mockResolvedValueOnce({
        Item: {
          name: 'hangout', version: 2, description: '', disallowedItems: [],
          severity: 'med', createdBy: 's', createdAt: 'n', active: true,
        },
      });

      const rulesets = await listRulesets(TABLE);
      expect(rulesets).toHaveLength(2);
      expect(rulesets[0].name).toBe('classroom');
      expect(rulesets[1].name).toBe('hangout');
    });

    it('returns empty list when table has no CURRENT pointers', async () => {
      mockDocSend.mockResolvedValueOnce({ Items: [] });
      expect(await listRulesets(TABLE)).toEqual([]);
    });
  });

  describe('listRulesetVersions', () => {
    it('queries all V# rows for a ruleset', async () => {
      mockDocSend.mockResolvedValueOnce({
        Items: [
          { name: 'classroom', version: 1 },
          { name: 'classroom', version: 2 },
        ],
      });
      const list = await listRulesetVersions(TABLE, 'classroom');
      expect(list).toHaveLength(2);
      const queryInput = mockDocSend.mock.calls[0][0].input;
      expect(queryInput.KeyConditionExpression).toContain('PK = :pk');
    });
  });

  describe('seedDefaultRulesets', () => {
    it('creates only missing rulesets', async () => {
      // For each of the 3 defaults: getCurrentVersion call.
      // classroom exists, hangout missing, broadcast missing.
      mockDocSend
        .mockResolvedValueOnce({ Item: { activeVersion: 1 } }) // classroom exists
        .mockResolvedValueOnce({ Item: undefined }) // hangout missing: getCurrentVersion inside createRulesetVersion
        .mockResolvedValueOnce({ Item: undefined }) // hangout: second getCurrentVersion
        .mockResolvedValueOnce({}) // hangout: Put V
        .mockResolvedValueOnce({}) // hangout: Put CURRENT
        .mockResolvedValueOnce({ Item: undefined }) // broadcast missing
        .mockResolvedValueOnce({ Item: undefined }) // broadcast: second getCurrentVersion
        .mockResolvedValueOnce({}) // broadcast: Put V
        .mockResolvedValueOnce({}); // broadcast: Put CURRENT

      await seedDefaultRulesets(TABLE);

      // 4 Put calls total (2 per new ruleset)
      const putCalls = mockDocSend.mock.calls.filter(
        (call) => call[0]?.input?.Item !== undefined,
      );
      expect(putCalls).toHaveLength(4);
    });
  });
});
