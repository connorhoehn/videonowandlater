/**
 * Unit tests for parseClassificationJson — the load-bearing bit of Nova Lite
 * response handling. We must never crash on malformed model output.
 */

import { parseClassificationJson } from '../nova-moderation';

describe('parseClassificationJson', () => {
  it('parses a clean JSON response', () => {
    const out = parseClassificationJson(
      '{"flagged": true, "items": ["phone"], "confidence": 0.85, "reasoning": "visible"}',
    );
    expect(out).toEqual({
      flagged: true,
      items: ['phone'],
      confidence: 0.85,
      reasoning: 'visible',
    });
  });

  it('strips markdown code fences', () => {
    const out = parseClassificationJson(
      '```json\n{"flagged": false, "items": [], "confidence": 0.0, "reasoning": "ok"}\n```',
    );
    expect(out?.flagged).toBe(false);
  });

  it('extracts JSON from surrounding prose', () => {
    const out = parseClassificationJson(
      'Here is the result: {"flagged": true, "items": ["x"], "confidence": 0.5, "reasoning": "r"} Hope that helps.',
    );
    expect(out?.flagged).toBe(true);
    expect(out?.items).toEqual(['x']);
  });

  it('returns null on garbage', () => {
    expect(parseClassificationJson('no json here')).toBeNull();
    expect(parseClassificationJson('')).toBeNull();
  });

  it('clamps confidence to 0..1 and coerces missing fields', () => {
    const out = parseClassificationJson(
      '{"flagged": true, "items": ["a", 42, "b"], "confidence": 2.0}',
    );
    expect(out?.confidence).toBe(1);
    expect(out?.items).toEqual(['a', 'b']);
    expect(out?.reasoning).toBe('');
  });

  it('treats non-true flagged as false', () => {
    const out = parseClassificationJson('{"flagged": "yes"}');
    expect(out?.flagged).toBe(false);
  });
});
