/**
 * POST /sessions/{sessionId}/reactions handler - create and broadcast reaction
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { SessionStatus } from '../domain/session';
import { EmojiType, ReactionType, calculateShardId, calculateSessionRelativeTime } from '../domain/reaction';
import type { Reaction } from '../domain/reaction';
import { getSessionById } from '../repositories/session-repository';
import { persistReaction } from '../repositories/reaction-repository';
import { broadcastReaction } from '../services/reaction-service';

const VALID_EMOJI_TYPES = ['heart', 'fire', 'clap', 'laugh', 'surprised'];

interface CreateReactionRequest {
  emojiType: string;
  reactionType?: 'live' | 'replay';
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // Parse request body
  let body: CreateReactionRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'sessionId required' }),
    };
  }

  // Validate emojiType
  if (!body.emojiType) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'emojiType required' }),
    };
  }

  if (!VALID_EMOJI_TYPES.includes(body.emojiType)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid emojiType. Must be one of: heart, fire, clap, laugh, surprised' }),
    };
  }

  // Extract userId from Cognito authorizer
  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    // Fetch session to get startedAt timestamp and status
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    // Validate session has startedAt timestamp
    if (!session.startedAt) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session has no startedAt timestamp' }),
      };
    }

    // Determine reaction type
    let reactionType: ReactionType;
    if (body.reactionType === 'replay') {
      reactionType = ReactionType.REPLAY;
    } else {
      // Default to live, but validate session is actually live
      if (session.status !== SessionStatus.LIVE) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Session must be live to send live reactions. Use reactionType="replay" for replay reactions.' }),
        };
      }
      reactionType = ReactionType.LIVE;
    }

    const reactionId = uuid();
    const reactedAt = new Date().toISOString();
    const sessionRelativeTime = calculateSessionRelativeTime(session.startedAt, reactedAt);
    const shardId = calculateShardId(userId);

    // Map string to EmojiType enum
    const emojiType = body.emojiType as EmojiType;

    // Build Reaction object
    const reaction: Reaction = {
      reactionId,
      sessionId,
      userId,
      emojiType,
      reactionType,
      reactedAt,
      sessionRelativeTime,
      shardId,
    };

    // Broadcast if live reaction
    let eventId: string | undefined;
    if (reactionType === ReactionType.LIVE) {
      eventId = await broadcastReaction(
        session.claimedResources.chatRoom,
        userId,
        emojiType,
        sessionRelativeTime
      );
    }

    // Persist reaction (both live and replay)
    await persistReaction(tableName, reaction);

    // Build response
    const response: any = {
      reactionId,
      sessionRelativeTime,
    };

    if (eventId) {
      response.eventId = eventId;
    }

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error: any) {
    console.error('Error creating reaction:', { sessionId, error });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to create reaction' }),
    };
  }
};
