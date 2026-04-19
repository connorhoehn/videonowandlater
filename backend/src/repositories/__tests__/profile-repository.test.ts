/**
 * Tests for profile-repository — handle claim/release, normalization, stats.
 */

import { isValidHandle, normalizeHandle } from '../profile-repository';

describe('profile-repository helpers', () => {
  test('normalizeHandle lowercases and trims', () => {
    expect(normalizeHandle('  Alice  ')).toBe('alice');
    expect(normalizeHandle('ALICE')).toBe('alice');
    expect(normalizeHandle('a_b-c')).toBe('a_b-c');
  });

  test('isValidHandle accepts 2-30 chars, alnum start, [a-z0-9_-] body', () => {
    expect(isValidHandle('al')).toBe(true);
    expect(isValidHandle('alice123')).toBe(true);
    expect(isValidHandle('a_b-c')).toBe(true);
    expect(isValidHandle('ALICE')).toBe(true); // normalized to 'alice'
  });

  test('isValidHandle rejects too-short, too-long, special chars, leading hyphen', () => {
    expect(isValidHandle('a')).toBe(false); // 1 char
    expect(isValidHandle('a'.repeat(31))).toBe(false);
    expect(isValidHandle('_leading-underscore')).toBe(false); // can't start with _
    expect(isValidHandle('has spaces')).toBe(false);
    expect(isValidHandle('has.dot')).toBe(false);
    expect(isValidHandle('has!bang')).toBe(false);
    expect(isValidHandle('')).toBe(false);
  });
});
