/**
 * Q&A service - IVS Chat SendEvent integration for live Q&A broadcasting.
 *
 * Mirrors the pattern of reaction-service: custom events on the IVS chat room
 * so every connected viewer gets a low-latency signal without polling the API.
 */

import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { Logger } from '@aws-lambda-powertools/logger';
import { getIVSChatClient } from '../lib/ivs-clients';
import type { Question } from '../domain/question';

const logger = new Logger({ serviceName: 'vnl-api' });

/**
 * Broadcast 'question-submitted' so the creator's queue refreshes in real-time.
 *
 * Only minimal fields are sent in attributes — the creator panel will fetch
 * the full list (or the event consumer can rely on these fields alone to
 * append an optimistic row).
 */
export async function broadcastQuestionSubmitted(
  chatRoomArn: string,
  question: Question
): Promise<string | undefined> {
  if (!chatRoomArn) return undefined;

  const chatClient = getIVSChatClient();
  const command = new SendEventCommand({
    roomIdentifier: chatRoomArn,
    eventName: 'question-submitted',
    attributes: {
      questionId: question.questionId,
      sessionId: question.sessionId,
      askedBy: question.askedBy,
      text: question.text,
      status: question.status,
      createdAt: question.createdAt,
    },
  });

  try {
    const response = await chatClient.send(command);
    return response.id;
  } catch (error) {
    logger.error('Error broadcasting question-submitted', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Broadcast 'question-status-changed' when the creator toggles answering/answered.
 * Payload includes the full question (as JSON string in the attributes map, since
 * IVS chat event attributes are string-valued).
 */
export async function broadcastQuestionStatusChanged(
  chatRoomArn: string,
  question: Question
): Promise<string | undefined> {
  if (!chatRoomArn) return undefined;

  const chatClient = getIVSChatClient();
  const command = new SendEventCommand({
    roomIdentifier: chatRoomArn,
    eventName: 'question-status-changed',
    attributes: {
      questionId: question.questionId,
      sessionId: question.sessionId,
      askedBy: question.askedBy,
      text: question.text,
      status: question.status,
      createdAt: question.createdAt,
      ...(question.answeredAt ? { answeredAt: question.answeredAt } : {}),
    },
  });

  try {
    const response = await chatClient.send(command);
    return response.id;
  } catch (error) {
    logger.error('Error broadcasting question-status-changed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
