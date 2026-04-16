export interface ModerationLabel {
  name: string;
  confidence: number;
  parentName?: string;
}

export interface ModerationRecord {
  sessionId: string;
  actionType: 'ADMIN_KILL' | 'ML_FLAG' | 'ML_AUTO_KILL';
  actorId: string;
  reason: string;
  labels?: ModerationLabel[];
  thumbnailS3Key?: string;
  reviewStatus?: 'pending' | 'dismissed' | 'confirmed';
  createdAt: string;
  sessionType: string;
  previousStatus: string;
}

export interface ModerationConfig {
  autoKillThreshold: number;
  flagThreshold: number;
  samplingIntervalMinSeconds: number;
  samplingIntervalMaxSeconds: number;
  blockedCategories: string[];
}

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  autoKillThreshold: 90,
  flagThreshold: 70,
  samplingIntervalMinSeconds: 3,
  samplingIntervalMaxSeconds: 6,
  blockedCategories: [
    'Explicit Nudity',
    'Violence',
    'Visually Disturbing',
    'Drugs & Tobacco & Alcohol',
  ],
};

/** Returns a random sampling interval between min and max seconds */
export function getRandomSamplingInterval(config = DEFAULT_MODERATION_CONFIG): number {
  const { samplingIntervalMinSeconds, samplingIntervalMaxSeconds } = config;
  return samplingIntervalMinSeconds + Math.random() * (samplingIntervalMaxSeconds - samplingIntervalMinSeconds);
}
