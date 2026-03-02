/**
 * Resource pool domain model
 * Defines the structure for pre-provisioned IVS resources
 */

import type { Status, ResourceType } from './types';

/**
 * Resource pool item entity
 * Represents a single IVS resource (Channel, Stage, or Chat Room) in the pool
 */
export interface ResourcePoolItem {
  resourceType: ResourceType;
  resourceArn: string;
  resourceId: string;
  status: Status;
  version: number;
  createdAt: string;
  claimedAt: string | null;
  claimedBy: string | null;

  // Channel-specific fields
  ingestEndpoint?: string;
  playbackUrl?: string;
  streamKey?: string;

  // Stage-specific fields
  endpoints?: {
    playback: string;
    ingest: string;
  };
}

// Re-export enums for convenience
export { Status, ResourceType } from './types';
