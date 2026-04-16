/**
 * Cost domain model
 * Defines cost tracking structures and pure calculation functions for AWS service usage
 */

/**
 * AWS services that incur costs in the video streaming platform
 */
export enum CostService {
  IVS_REALTIME = 'IVS_REALTIME',
  IVS_LOW_LATENCY = 'IVS_LOW_LATENCY',
  MEDIACONVERT = 'MEDIACONVERT',
  TRANSCRIBE = 'TRANSCRIBE',
  BEDROCK_SONNET = 'BEDROCK_SONNET',
  BEDROCK_NOVA = 'BEDROCK_NOVA',
  S3 = 'S3',
  CLOUDFRONT = 'CLOUDFRONT',
  POLLY_TTS = 'POLLY_TTS',
  ECS_FARGATE = 'ECS_FARGATE',
  TRANSCRIBE_STREAMING = 'TRANSCRIBE_STREAMING',
}

/**
 * Individual cost line item for a specific service usage event
 */
export interface CostLineItem {
  sessionId: string;
  service: CostService;
  costUsd: number;
  quantity: number;
  unit: string; // e.g., 'participant-minutes', 'seconds', 'tokens', 'GB'
  rateApplied: number;
  sessionType: string;
  userId: string;
  createdAt: string;
}

/**
 * Aggregated cost summary for a session across all services
 */
export interface CostSummary {
  sessionId: string;
  totalCostUsd: number;
  breakdown: Record<CostService, number>;
  sessionType: string;
  userId: string;
  lastUpdatedAt: string;
}

/**
 * Current AWS pricing rates used for cost calculations
 */
export const PRICING_RATES = {
  IVS_REALTIME: 0.01,             // per participant-minute
  IVS_LOW_LATENCY: 0.005,         // per hour
  MEDIACONVERT: 0.012,            // per minute output
  TRANSCRIBE: 0.0001,             // per second
  BEDROCK_SONNET_INPUT: 3.0,      // per million tokens
  BEDROCK_SONNET_OUTPUT: 15.0,    // per million tokens
  BEDROCK_NOVA_INPUT: 0.075,      // per million tokens
  BEDROCK_NOVA_OUTPUT: 0.30,      // per million tokens
  S3_STORAGE: 0.023,              // per GB/month
  CLOUDFRONT_TRANSFER: 0.085,     // per GB
  POLLY_TTS_NEURAL: 4.0,              // per 1M characters
  ECS_FARGATE_VCPU_HOUR: 0.04048,     // per vCPU-hour
  ECS_FARGATE_MEMORY_GB_HOUR: 0.004445, // per GB-hour
  TRANSCRIBE_STREAMING: 0.0125,         // per minute
} as const;

/**
 * Calculate IVS Real-Time stage cost
 * @param participantMinutes Total participant-minutes consumed
 */
export function calculateIvsRealtimeCost(participantMinutes: number): number {
  return Math.max(0, participantMinutes) * PRICING_RATES.IVS_REALTIME;
}

/**
 * Calculate IVS Low-Latency channel cost
 * @param hoursInput Total hours of input streaming
 */
export function calculateIvsLowLatencyCost(hoursInput: number): number {
  return Math.max(0, hoursInput) * PRICING_RATES.IVS_LOW_LATENCY;
}

/**
 * Calculate MediaConvert transcoding cost
 * @param outputMinutes Total minutes of output video
 */
export function calculateMediaConvertCost(outputMinutes: number): number {
  return Math.max(0, outputMinutes) * PRICING_RATES.MEDIACONVERT;
}

/**
 * Calculate Amazon Transcribe cost
 * @param audioSeconds Total seconds of audio transcribed
 */
export function calculateTranscribeCost(audioSeconds: number): number {
  return Math.max(0, audioSeconds) * PRICING_RATES.TRANSCRIBE;
}

/**
 * Calculate Amazon Bedrock cost based on model and token usage
 * Detects Sonnet vs Nova pricing from the modelId string
 * @param modelId Bedrock model identifier (e.g., 'anthropic.claude-3-sonnet...' or 'amazon.nova...')
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 */
export function calculateBedrockCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const modelLower = modelId.toLowerCase();
  const isNova = modelLower.includes('nova');

  const inputRate = isNova ? PRICING_RATES.BEDROCK_NOVA_INPUT : PRICING_RATES.BEDROCK_SONNET_INPUT;
  const outputRate = isNova ? PRICING_RATES.BEDROCK_NOVA_OUTPUT : PRICING_RATES.BEDROCK_SONNET_OUTPUT;

  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * inputRate;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * outputRate;

  return inputCost + outputCost;
}

/**
 * Calculate S3 storage cost
 * @param sizeGb Size in GB
 */
export function calculateS3StorageCost(sizeGb: number): number {
  return Math.max(0, sizeGb) * PRICING_RATES.S3_STORAGE;
}

/**
 * Calculate CloudFront data transfer cost
 * @param transferGb Transfer volume in GB
 */
export function calculateCloudFrontCost(transferGb: number): number {
  return Math.max(0, transferGb) * PRICING_RATES.CLOUDFRONT_TRANSFER;
}

/**
 * Calculate Amazon Polly TTS cost (Neural engine)
 * @param characters Number of characters synthesized
 */
export function calculatePollyCost(characters: number): number {
  return Math.max(0, characters / 1_000_000) * PRICING_RATES.POLLY_TTS_NEURAL;
}

/**
 * Calculate ECS Fargate cost
 * @param durationSeconds Task duration in seconds
 * @param vcpu vCPU allocation (default 0.25)
 * @param memoryGb Memory allocation in GB (default 0.5)
 */
export function calculateEcsFargateCost(durationSeconds: number, vcpu = 0.25, memoryGb = 0.5): number {
  const hours = Math.max(0, durationSeconds) / 3600;
  return hours * vcpu * PRICING_RATES.ECS_FARGATE_VCPU_HOUR
       + hours * memoryGb * PRICING_RATES.ECS_FARGATE_MEMORY_GB_HOUR;
}

/**
 * Calculate Amazon Transcribe Streaming cost
 * @param minutes Minutes of streaming audio
 */
export function calculateTranscribeStreamingCost(minutes: number): number {
  return Math.max(0, minutes) * PRICING_RATES.TRANSCRIBE_STREAMING;
}
