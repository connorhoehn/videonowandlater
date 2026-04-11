/**
 * Story domain types
 * Stories are ephemeral (24h) short-form content segments
 */

export interface StorySegment {
  segmentId: string;
  type: 'image' | 'video';
  s3Key: string;
  url?: string;           // CloudFront URL (derived at read time)
  duration?: number;       // ms — required for video, default 5000 for image
  thumbnailS3Key?: string; // poster frame for video segments
  order: number;
  createdAt: string;
}

export interface StoryView {
  sessionId: string;
  userId: string;
  viewedAt: string;
}

export interface StoryReaction {
  sessionId: string;
  segmentId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface StoryReply {
  replyId: string;
  sessionId: string;
  segmentId: string;
  senderId: string;
  content: string;
  createdAt: string;
}
