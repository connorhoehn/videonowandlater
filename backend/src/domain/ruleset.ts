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
