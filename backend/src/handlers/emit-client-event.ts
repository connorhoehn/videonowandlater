import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSessionById } from '../repositories/session-repository';
import { SessionEventType } from '../domain/session-event';
import { emitSessionEvent } from '../lib/emit-session-event';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'emit-client-event' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// Only these event types can be emitted from the client
const ALLOWED_CLIENT_EVENTS = new Set<string>([
  SessionEventType.LOBBY_JOINED,
  SessionEventType.LOBBY_LEFT,
  SessionEventType.SCREEN_SHARE_STARTED,
  SessionEventType.SCREEN_SHARE_ENDED,
  SessionEventType.PARTICIPANT_LEFT,
]);

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { eventType, details } = body;

    if (!eventType || !ALLOWED_CLIENT_EVENTS.has(eventType)) {
      return resp(400, { error: `Invalid eventType. Allowed: ${[...ALLOWED_CLIENT_EVENTS].join(', ')}` });
    }

    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    await emitSessionEvent(tableName, {
      eventId: uuidv4(),
      sessionId,
      eventType: eventType as SessionEventType,
      timestamp: new Date().toISOString(),
      actorId: userId,
      actorType: 'user',
      details: details || {},
    });

    return resp(201, { message: 'Event recorded' });
  } catch (err: any) {
    logger.error('Failed to emit client event', { error: err.message });
    return resp(500, { error: err.message });
  }
}
