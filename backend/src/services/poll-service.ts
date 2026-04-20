import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { Logger } from '@aws-lambda-powertools/logger';
import { getIVSChatClient } from '../lib/ivs-clients';
import type { Poll } from '../domain/poll';

const logger = new Logger({ serviceName: 'vnl-api' });

async function sendEvent(chatRoomArn: string, eventName: string, attributes: Record<string, string>) {
  try {
    const res = await getIVSChatClient().send(new SendEventCommand({
      roomIdentifier: chatRoomArn,
      eventName,
      attributes,
    }));
    return res.id;
  } catch (err) {
    logger.error(`Error broadcasting ${eventName}`, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function broadcastPollCreated(chatRoomArn: string, poll: Poll) {
  return sendEvent(chatRoomArn, 'poll-created', {
    pollId: poll.pollId,
    question: poll.question,
    options: JSON.stringify(poll.options),
    createdAt: poll.createdAt,
  });
}

export async function broadcastPollVote(chatRoomArn: string, poll: Poll) {
  return sendEvent(chatRoomArn, 'poll-vote', {
    pollId: poll.pollId,
    voteCounts: JSON.stringify(poll.voteCounts),
    totalVotes: String(poll.totalVotes),
  });
}

export async function broadcastPollClosed(chatRoomArn: string, poll: Poll) {
  return sendEvent(chatRoomArn, 'poll-closed', {
    pollId: poll.pollId,
    voteCounts: JSON.stringify(poll.voteCounts),
    totalVotes: String(poll.totalVotes),
  });
}
