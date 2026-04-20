import type { APIGatewayProxyHandler } from 'aws-lambda';
import { resp, requireUserId, mapKnownError } from '../lib/http';
import { getSessionById } from '../repositories/session-repository';
import { closePoll } from '../repositories/poll-repository';
import { broadcastPollClosed } from '../services/poll-service';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'close-poll' } });

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  try {
    const userId = requireUserId(event);
    const sessionId = event.pathParameters?.sessionId;
    const pollId = event.pathParameters?.pollId;
    if (!sessionId || !pollId) return resp(400, { error: 'sessionId and pollId required' });

    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });
    if (session.userId !== userId) return resp(403, { error: 'Only the session owner can close polls' });

    const poll = await closePoll(tableName, sessionId, pollId);
    if (!poll) return resp(404, { error: 'Poll not found' });

    const chatRoomArn = session.claimedResources?.chatRoom;
    if (chatRoomArn) {
      try { await broadcastPollClosed(chatRoomArn, poll); }
      catch (err) { logger.warn('poll-closed broadcast failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) }); }
    }

    return resp(200, { poll });
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    logger.error('close-poll failed', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal error' });
  }
};
