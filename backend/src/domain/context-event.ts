import { v4 as uuidv4 } from 'uuid';

export enum ContextEventType {
  DOCUMENT_SWITCH = 'DOCUMENT_SWITCH',
  DOCUMENT_EDIT = 'DOCUMENT_EDIT',
  PARTICIPANT_ACTION = 'PARTICIPANT_ACTION',
  SYSTEM_EVENT = 'SYSTEM_EVENT',
}

export interface ContextEvent {
  contextId: string;
  sessionId: string;
  sourceAppId: string;
  eventType: ContextEventType;
  timestamp: number;          // session-relative ms
  metadata: {
    documentId?: string;
    documentTitle?: string;
    editSummary?: string;
    editCount?: number;
    userId?: string;
    [key: string]: any;
  };
  createdAt: string;
}

export interface IntentFlowStep {
  stepId: string;
  prompt: string;
  intentSlot: string;
  slotType?: 'text' | 'date' | 'number' | 'boolean' | 'choice';
  choices?: string[];
  required: boolean;
  filledValue?: string;
  filledAt?: string;
  confidence?: number;
  attempts?: number;
  maxAttempts?: number;
}

export interface IntentFlow {
  flowId: string;
  sessionId: string;
  sourceAppId: string;
  name: string;
  steps: IntentFlowStep[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  callbackUrl?: string;
  createdAt: string;
  completedAt?: string;
}

export interface IntentResult {
  intentSlot: string;
  value: string;
  confidence: number;
  extractedAt: string;
  sourceSegmentIndex?: number;
}

export type AgentStatus = 'idle' | 'joining' | 'speaking' | 'listening' | 'completed' | 'failed' | 'disconnected';

export function createContextId(): string {
  return uuidv4();
}
