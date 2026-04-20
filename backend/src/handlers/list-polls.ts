import type { APIGatewayProxyHandler } from 'aws-lambda';
import { resp, mapKnownError } from '../lib/http';
import { listPolls } from '../repositories/poll-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-polls' } });

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  try {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) return resp(400, { error: 'sessionId required' });
    const polls = await listPolls(tableName, sessionId);
    return resp(200, { polls });
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    logger.error('list-polls failed', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal error' });
  }
};
