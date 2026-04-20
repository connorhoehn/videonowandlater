import type { APIGatewayProxyHandler } from 'aws-lambda';
import { resp, requireUserId, parseJsonBody, mapKnownError } from '../lib/http';
import { getSessionById } from '../repositories/session-repository';
import { castVote } from '../repositories/poll-repository';
import { broadcastPollVote } from '../services/poll-service';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'vote-poll' } });

interface Body { optionId?: unknown }

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  try {
    const userId = requireUserId(event);
    const sessionId = event.pathParameters?.sessionId;
    const pollId = event.pathParameters?.pollId;
    if (!sessionId || !pollId) return resp(400, { error: 'sessionId and pollId required' });

    const parsed = parseJsonBody<Body>(event);
    if (!parsed.ok) return parsed.response;
    const optionId = typeof parsed.data.optionId === 'string' ? parsed.data.optionId : '';
    if (!optionId) return resp(400, { error: 'optionId is required' });

    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    let poll;
    try {
      poll = await castVote(tableName, sessionId, pollId, userId, optionId);
    } catch (err) {
      const code = (err as any)?.code ?? (err instanceof Error ? err.message : String(err));
      if (code === 'ALREADY_VOTED') return resp(409, { error: 'Already voted' });
      if (code === 'POLL_NOT_FOUND') return resp(404, { error: 'Poll not found' });
      if (code === 'POLL_CLOSED') return resp(400, { error: 'Poll is closed' });
      if (code === 'INVALID_OPTION') return resp(400, { error: 'Invalid option' });
      throw err;
    }

    const chatRoomArn = session.claimedResources?.chatRoom;
    if (chatRoomArn) {
      try { await broadcastPollVote(chatRoomArn, poll); }
      catch (err) { logger.warn('poll-vote broadcast failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) }); }
    }

    return resp(200, { pollId, voteCounts: poll.voteCounts, totalVotes: poll.totalVotes });
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    logger.error('vote-poll failed', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal error' });
  }
};
