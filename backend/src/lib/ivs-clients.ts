/**
 * IVS client singletons
 * Lazy initialization pattern for Lambda execution optimization
 *
 * All clients are wrapped with AWS X-Ray tracing via Powertools so that
 * IVS / IVS-Realtime / IVS-Chat SDK calls appear as subsegments in the
 * trace tree produced by Lambdas running with `tracing: ACTIVE`.
 */

import { IvsClient } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient } from '@aws-sdk/client-ivschat';
import { Tracer } from '@aws-lambda-powertools/tracer';

const tracer = new Tracer({ serviceName: 'vnl' });

let ivsClient: IvsClient | null = null;
let ivsRealTimeClient: IVSRealTimeClient | null = null;
let ivsChatClient: IvschatClient | null = null;

/**
 * Get singleton IVS client for Low-Latency streaming (channels)
 */
export function getIVSClient(): IvsClient {
  if (!ivsClient) {
    ivsClient = tracer.captureAWSv3Client(new IvsClient({}));
  }
  return ivsClient;
}

/**
 * Get singleton IVS RealTime client for interactive stages
 */
export function getIVSRealTimeClient(): IVSRealTimeClient {
  if (!ivsRealTimeClient) {
    ivsRealTimeClient = tracer.captureAWSv3Client(new IVSRealTimeClient({}));
  }
  return ivsRealTimeClient;
}

/**
 * Get singleton IVS Chat client for chat rooms
 */
export function getIVSChatClient(): IvschatClient {
  if (!ivsChatClient) {
    ivsChatClient = tracer.captureAWSv3Client(new IvschatClient({}));
  }
  return ivsChatClient;
}
