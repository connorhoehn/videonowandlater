/**
 * ad-repository tests — focus on the single-active-ad invariant that the
 * AD#ACTIVE pointer-row pattern is supposed to enforce, plus the contentHash
 * dedup path used by admin-create-ad.
 */

const mockSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockSend })),
}));

import {
  putAd,
  getAdById,
  getAdByContentHash,
  listAds,
  activate,
  deactivate,
  deleteAd,
  getActiveAd,
} from '../ad-repository';
import type { Ad } from '../../domain/ad';

function mkAd(id: string, overrides: Partial<Ad> = {}): Ad {
  return {
    id,
    source: 'polly',
    mediaUrl: `https://cdn/${id}.mp4`,
    durationSec: 8,
    contentHash: `hash-${id}`,
    label: `ad ${id}`,
    placement: 'story-inline',
    active: false,
    createdAt: `2026-04-20T00:00:${id.slice(-2).padStart(2, '0')}Z`,
    createdBy: 'admin',
    ...overrides,
  };
}

describe('ad-repository', () => {
  beforeEach(() => { mockSend.mockReset(); });

  test('putAd writes the Ad row without the computed `active` field', async () => {
    mockSend.mockResolvedValueOnce({});
    await putAd('test-table', mkAd('01'));
    const call = mockSend.mock.calls[0][0];
    // PutCommand input on the SDK: call.input.Item
    expect(call.input.Item.id).toBe('01');
    expect(call.input.Item.active).toBeUndefined();
  });

  test('getActiveAd returns null when no pointer row exists', async () => {
    mockSend.mockResolvedValueOnce({}); // getActiveAdId → no Item
    const ad = await getActiveAd('test-table');
    expect(ad).toBeNull();
  });

  test('getActiveAd hydrates the pointer + looked-up row and marks active=true', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { adId: '01' } })                 // pointer
      .mockResolvedValueOnce({ Item: { ...mkAd('01'), entityType: 'AD' } }) // ad row
      .mockResolvedValueOnce({ Item: { adId: '01' } });                // activeId lookup inside getAdById
    const ad = await getActiveAd('test-table');
    expect(ad?.id).toBe('01');
    expect(ad?.active).toBe(true);
  });

  test('listAds marks exactly one ad active based on the pointer row', async () => {
    const items = [
      { ...mkAd('01'), entityType: 'AD' },
      { ...mkAd('02'), entityType: 'AD' },
      { ...mkAd('03'), entityType: 'AD' },
    ];
    mockSend
      .mockResolvedValueOnce({ Items: items })            // scan
      .mockResolvedValueOnce({ Item: { adId: '02' } });   // pointer
    const ads = await listAds('test-table');
    expect(ads).toHaveLength(3);
    expect(ads.filter((a) => a.active)).toHaveLength(1);
    expect(ads.find((a) => a.id === '02')?.active).toBe(true);
    // Sorted createdAt desc
    expect(ads.map((a) => a.id)).toEqual(['03', '02', '01']);
  });

  test('activate is a single PutItem on AD#ACTIVE', async () => {
    mockSend.mockResolvedValueOnce({});
    await activate('test-table', '42');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('AD#ACTIVE');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.adId).toBe('42');
  });

  test('activate overwrites any previous active — single PutItem means no two-ads-active window', async () => {
    // First activate ad 'A'
    mockSend.mockResolvedValueOnce({});
    await activate('test-table', 'A');
    // Then activate ad 'B' — overwriting the pointer row
    mockSend.mockResolvedValueOnce({});
    await activate('test-table', 'B');
    // Both are independent PutItem writes; the second overwrites the first
    // atomically from DynamoDB's perspective. No transaction needed.
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].input.Item.adId).toBe('A');
    expect(mockSend.mock.calls[1][0].input.Item.adId).toBe('B');
  });

  test('deactivate deletes the AD#ACTIVE row', async () => {
    mockSend.mockResolvedValueOnce({});
    await deactivate('test-table');
    const input = mockSend.mock.calls[0][0].input;
    expect(input.Key.PK).toBe('AD#ACTIVE');
    expect(input.Key.SK).toBe('METADATA');
  });

  test('deleteAd clears the pointer first when the victim was active', async () => {
    // getActiveAdId → adId='vic', then deactivate (DeleteCommand on pointer), then DeleteCommand on the ad
    mockSend
      .mockResolvedValueOnce({ Item: { adId: 'vic' } })
      .mockResolvedValueOnce({})  // deactivate
      .mockResolvedValueOnce({}); // delete ad row
    await deleteAd('test-table', 'vic');
    expect(mockSend).toHaveBeenCalledTimes(3);
    // Second call (deactivate) should target AD#ACTIVE
    expect(mockSend.mock.calls[1][0].input.Key.PK).toBe('AD#ACTIVE');
    // Third call (delete ad) should target AD#vic
    expect(mockSend.mock.calls[2][0].input.Key.PK).toBe('AD#vic');
  });

  test('deleteAd skips the deactivate step when the victim was not active', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { adId: 'other' } })
      .mockResolvedValueOnce({}); // delete ad row only
    await deleteAd('test-table', 'vic');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].input.Key.PK).toBe('AD#vic');
  });

  test('getAdByContentHash returns null when no ad matches', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const ad = await getAdByContentHash('test-table', 'nope');
    expect(ad).toBeNull();
  });

  test('getAdByContentHash returns the first matching ad with computed active flag', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ ...mkAd('01'), entityType: 'AD' }] })
      .mockResolvedValueOnce({ Item: { adId: '01' } }); // pointer
    const ad = await getAdByContentHash('test-table', 'hash-01');
    expect(ad?.id).toBe('01');
    expect(ad?.active).toBe(true);
  });

  test('getAdById returns null when row missing', async () => {
    mockSend.mockResolvedValueOnce({});
    const ad = await getAdById('test-table', 'missing');
    expect(ad).toBeNull();
  });
});
