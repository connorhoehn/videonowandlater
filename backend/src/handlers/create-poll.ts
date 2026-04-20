import type { APIGatewayProxyHandler } from 'aws-lambda';
import { resp, requireUserId, parseJsonBody, mapKnownError } from '../lib/http';
import { getSessionById } from '../repositories/session-repository';
import { createPoll } from '../repositories/poll-repository';
import { broadcastPollCreated } from '../services/poll-service';
import { SessionStatus } from '../domain/session';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'create-poll' } });

interface Body {
  question?: unknown;
  options?: unknown;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  try {
    const userId = requireUserId(event);
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) return resp(400, { error: 'sessionId required' });

    const parsed = parseJsonBody<Body>(event);
    if (!parsed.ok) return parsed.response;
    const question = typeof parsed.data.question === 'string' ? parsed.data.question.trim() : '';
    const options = Array.isArray(parsed.data.options)
      ? parsed.data.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim())
      : [];

    if (!question) return resp(400, { error: 'question is required' });
    if (options.length < 2) return resp(400, { error: 'at least 2 options required' });
    if (options.length > 4) return resp(400, { error: 'at most 4 options allowed' });

    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });
    if (session.userId !== userId) return resp(403, { error: 'Only the session owner can create polls' });
    if (session.status !== SessionStatus.LIVE) return resp(400, { error: 'Session must be live' });

    const poll = await createPoll(tableName, sessionId, userId, question, options);

    const chatRoomArn = session.claimedResources?.chatRoom;
    if (chatRoomArn) {
      try { await broadcastPollCreated(chatRoomArn, poll); }
      catch (err) { logger.warn('poll-created broadcast failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) }); }
    }

    return resp(201, { poll });
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    logger.error('create-poll failed', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal error' });
  }
};
