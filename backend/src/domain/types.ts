/**
 * Shared domain types for session management and resource pool
 */

/**
 * Resource status enum for pool items
 */
export enum Status {
  AVAILABLE = 'AVAILABLE',
  CLAIMED = 'CLAIMED',
  ENDED = 'ENDED',
}

/**
 * Type of IVS resources in the pool
 */
export enum ResourceType {
  CHANNEL = 'CHANNEL',
  STAGE = 'STAGE',
  ROOM = 'ROOM',
}
