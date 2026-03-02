/**
 * IVS client singletons
 * Lazy initialization pattern for Lambda execution optimization
 */

import { IvsClient } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient } from '@aws-sdk/client-ivschat';

let ivsClient: IvsClient | null = null;
let ivsRealTimeClient: IVSRealTimeClient | null = null;
let ivsChatClient: IvschatClient | null = null;

/**
 * Get singleton IVS client for Low-Latency streaming (channels)
 */
export function getIVSClient(): IvsClient {
  if (!ivsClient) {
    ivsClient = new IvsClient({});
  }
  return ivsClient;
}

/**
 * Get singleton IVS RealTime client for interactive stages
 */
export function getIVSRealTimeClient(): IVSRealTimeClient {
  if (!ivsRealTimeClient) {
    ivsRealTimeClient = new IVSRealTimeClient({});
  }
  return ivsRealTimeClient;
}

/**
 * Get singleton IVS Chat client for chat rooms
 */
export function getIVSChatClient(): IvschatClient {
  if (!ivsChatClient) {
    ivsChatClient = new IvschatClient({});
  }
  return ivsChatClient;
}
