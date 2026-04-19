/**
 * Ruleset domain model (Phase 4: image moderation with configurable rulesets)
 *
 * DynamoDB schema:
 *   PK: RULESET#<name>   SK: V#<version>   { name, version, description, disallowedItems[], severity, createdBy, createdAt, active }
 *   PK: RULESET#<name>   SK: CURRENT       { activeVersion: <int> }
 */

export type RulesetSeverity = 'low' | 'med' | 'high';

export interface Ruleset {
  name: string;
  version: number;
  description: string;
  disallowedItems: string[];
  severity: RulesetSeverity;
  createdBy: string;
  createdAt: string;
  active: boolean;
  /**
   * Frame capture interval (seconds). Client samples a video frame every N seconds,
   * uploads to S3, triggers a Nova Lite classification. Lower = more aggressive,
   * higher cost. Default 10s. Valid range: 3-60.
   */
  frameIntervalSec?: number;
  /**
   * Auto-bounce strike threshold. When a user's flagged-frame count on a session
   * reaches this value, they get kicked. Default 3. Valid range: 1-10.
   */
  autoBounceThreshold?: number;
}

export const DEFAULT_FRAME_INTERVAL_SEC = 10;
export const DEFAULT_AUTO_BOUNCE_THRESHOLD = 3;
export const FRAME_INTERVAL_MIN = 3;
export const FRAME_INTERVAL_MAX = 60;
export const AUTO_BOUNCE_THRESHOLD_MIN = 1;
export const AUTO_BOUNCE_THRESHOLD_MAX = 10;

export function clampFrameInterval(v: number | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return DEFAULT_FRAME_INTERVAL_SEC;
  return Math.max(FRAME_INTERVAL_MIN, Math.min(FRAME_INTERVAL_MAX, Math.round(v)));
}

export function clampAutoBounceThreshold(v: number | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return DEFAULT_AUTO_BOUNCE_THRESHOLD;
  return Math.max(AUTO_BOUNCE_THRESHOLD_MIN, Math.min(AUTO_BOUNCE_THRESHOLD_MAX, Math.round(v)));
}

export interface RulesetCurrentPointer {
  name: string;
  activeVersion: number;
}

/**
 * Moderation confidence threshold by severity.
 * Higher severity → lower threshold → more aggressive flagging.
 */
export function thresholdForSeverity(severity: RulesetSeverity): number {
  switch (severity) {
    case 'high':
      return 0.6;
    case 'med':
      return 0.75;
    case 'low':
      return 0.9;
  }
}

/**
 * Seed rulesets created on first admin-list-rulesets call if table is empty.
 */
export const DEFAULT_RULESETS: Array<Omit<Ruleset, 'version' | 'createdBy' | 'createdAt' | 'active'>> = [
  {
    name: 'classroom',
    description: 'Quiz/exam environment — flag unauthorized aids.',
    disallowedItems: [
      'phone',
      'smartwatch',
      'television',
      'tablet',
      'textbook',
      'smart speaker',
      'another person',
    ],
    severity: 'high',
  },
  {
    name: 'hangout',
    description: 'Social video chat — standard community guidelines.',
    disallowedItems: ['nudity', 'weapons', 'drug paraphernalia'],
    severity: 'high',
  },
  {
    name: 'broadcast',
    description: 'Public livestream — platform TOS.',
    disallowedItems: ['nudity', 'weapons', 'explicit drug use', 'hate symbols'],
    severity: 'med',
  },
];
