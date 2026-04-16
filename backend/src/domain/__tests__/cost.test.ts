/**
 * Tests for cost calculation domain functions
 * Validates pricing logic for all AWS services used in the platform
 */

import {
  calculateIvsRealtimeCost,
  calculateIvsLowLatencyCost,
  calculateMediaConvertCost,
  calculateTranscribeCost,
  calculateBedrockCost,
  calculateS3StorageCost,
  calculateCloudFrontCost,
  PRICING_RATES,
} from '../cost';

describe('cost domain', () => {
  describe('PRICING_RATES', () => {
    test('should export pricing rates constant', () => {
      expect(PRICING_RATES).toBeDefined();
    });
  });

  describe('calculateIvsRealtimeCost', () => {
    test('30 participant-minutes = $0.30', () => {
      expect(calculateIvsRealtimeCost(30)).toBeCloseTo(0.30, 2);
    });

    test('returns 0 for 0 input', () => {
      expect(calculateIvsRealtimeCost(0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateIvsRealtimeCost(-10)).toBe(0);
    });
  });

  describe('calculateIvsLowLatencyCost', () => {
    test('2 hours = $0.01', () => {
      expect(calculateIvsLowLatencyCost(2)).toBeCloseTo(0.01, 2);
    });

    test('returns 0 for 0 input', () => {
      expect(calculateIvsLowLatencyCost(0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateIvsLowLatencyCost(-5)).toBe(0);
    });
  });

  describe('calculateMediaConvertCost', () => {
    test('10 minutes output = $0.12', () => {
      expect(calculateMediaConvertCost(10)).toBeCloseTo(0.12, 2);
    });

    test('returns 0 for 0 input', () => {
      expect(calculateMediaConvertCost(0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateMediaConvertCost(-3)).toBe(0);
    });
  });

  describe('calculateTranscribeCost', () => {
    test('1800 seconds (30 min) = $0.18', () => {
      expect(calculateTranscribeCost(1800)).toBeCloseTo(0.18, 2);
    });

    test('returns 0 for 0 input', () => {
      expect(calculateTranscribeCost(0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateTranscribeCost(-100)).toBe(0);
    });
  });

  describe('calculateBedrockCost', () => {
    test('Sonnet: 10000 input + 2000 output tokens = $0.06', () => {
      const cost = calculateBedrockCost('anthropic.claude-sonnet', 10000, 2000);
      // (10000 * 3 + 2000 * 15) / 1_000_000 = 0.06
      expect(cost).toBeCloseTo(0.06, 5);
    });

    test('Nova Lite: 10000 input + 2000 output tokens = $0.00135', () => {
      const cost = calculateBedrockCost('amazon.nova-lite', 10000, 2000);
      // (10000 * 0.075 + 2000 * 0.30) / 1_000_000 = 0.00135
      expect(cost).toBeCloseTo(0.00135, 5);
    });

    test('detects Sonnet model from model ID containing anthropic.claude-sonnet', () => {
      const cost = calculateBedrockCost('anthropic.claude-sonnet-v2', 10000, 2000);
      expect(cost).toBeCloseTo(0.06, 5);
    });

    test('detects Nova model from model ID containing amazon.nova-lite', () => {
      const cost = calculateBedrockCost('amazon.nova-lite-v1', 10000, 2000);
      expect(cost).toBeCloseTo(0.00135, 5);
    });

    test('returns 0 for 0 input and 0 output tokens', () => {
      expect(calculateBedrockCost('anthropic.claude-sonnet', 0, 0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateBedrockCost('anthropic.claude-sonnet', -100, -50)).toBe(0);
    });
  });

  describe('calculateS3StorageCost', () => {
    test('100 GB = $2.30', () => {
      expect(calculateS3StorageCost(100)).toBeCloseTo(2.30, 2);
    });

    test('returns 0 for 0 input', () => {
      expect(calculateS3StorageCost(0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateS3StorageCost(-50)).toBe(0);
    });
  });

  describe('calculateCloudFrontCost', () => {
    test('50 GB = $4.25', () => {
      expect(calculateCloudFrontCost(50)).toBeCloseTo(4.25, 2);
    });

    test('returns 0 for 0 input', () => {
      expect(calculateCloudFrontCost(0)).toBe(0);
    });

    test('handles negative input gracefully (returns 0)', () => {
      expect(calculateCloudFrontCost(-20)).toBe(0);
    });
  });
});
