# Integration Points: v1.4 Stream Quality & Spotlight

**Project:** VideoNowAndLater
**Target Milestone:** v1.4 Creator Studio & Stream Quality
**Date:** 2026-03-05

---

## Summary

This document maps all integration points between new stream quality and creator spotlight features and existing codebase components. Use this as a checklist when implementing phases 24-28.

---

## Phase 24: Client-Side Metrics Collection

### NEW Files to Create

```
web/src/features/broadcast/StreamQualityDashboard.tsx
├── Component: StreamQualityDashboard
├── Props: { metrics: StreamQualityMetrics | null }
├── Displays: Bitrate, FPS, resolution, quality limitation warnings
└── Dependencies: React, Tailwind utilities

web/src/features/broadcast/useStreamMetrics.ts (optional hook)
├── Responsibility: Extract metrics polling logic from useBroadcast
├── Exports: useStreamMetrics(client, onMetricsUpdate)
├── Calculates: Bitrate from bytesSent delta, network health, etc.
└── Dependencies: (none — pure client-side)
```

### MODIFIED Files

**File:** `web/src/features/broadcast/useBroadcast.ts`

```typescript
// Add to hook state:
const [metrics, setMetrics] = useState<StreamQualityMetrics | null>(null);

// Add to useEffect (when isLive):
useEffect(() => {
  if (!isLive || !client) return;

  let lastBytesSent = 0;
  let lastTimestamp = Date.now();

  const metricsInterval = setInterval(async () => {
    try {
      // Get underlying RTCPeerConnection from IVS SDK
      // NOTE: This assumes SDK exposes stats method; needs verification
      const stats = await client.getStats?.();
      if (!stats) return;

      const outboundStats = findOutboundVideoStats(stats);
      if (!outboundStats) return;

      // Calculate bitrate
      const now = Date.now();
      const timeDeltaSeconds = (now - lastTimestamp) / 1000;
      const bytesDelta = outboundStats.bytesSent - lastBytesSent;
      const bitrate = Math.round((bytesDelta * 8) / (timeDeltaSeconds * 1000)); // Kbps

      lastBytesSent = outboundStats.bytesSent;
      lastTimestamp = now;

      // Determine network health
      const networkHealth = deriveNetworkHealth(outboundStats, bitrate);

      const newMetrics: StreamQualityMetrics = {
        bitrate,
        frameRate: outboundStats.framesPerSecond || 0,
        resolution: `${outboundStats.frameWidth}x${outboundStats.frameHeight}`,
        qualityLimitation: outboundStats.qualityLimitationReason || 'none',
        networkHealth,
        targetBitrate: outboundStats.targetBitrate || 0,
      };

      setMetrics(newMetrics);
    } catch (err) {
      console.warn('[metrics] failed to poll:', err);
    }
  }, 1000); // Poll every 1 second

  return () => clearInterval(metricsInterval);
}, [isLive, client]);

// Export metrics in return value:
return {
  // ... existing exports ...
  metrics,
};

// Helper functions to add:
function findOutboundVideoStats(stats: any): any {
  // Depends on exact SDK API; likely:
  // stats.forEach(stat => stat.type === 'outbound-rtp' && stat.kind === 'video')
}

function deriveNetworkHealth(stats: any, bitrate: number): 'good' | 'warning' | 'critical' {
  // good: quality='none', bitrate > 2000 Kbps
  // warning: quality limited OR bitrate 1000-2000
  // critical: quality limited AND bitrate < 1000
}
```

**File:** `web/src/features/broadcast/BroadcastPage.tsx`

```typescript
// Add import:
import { StreamQualityDashboard } from './StreamQualityDashboard';

// In BroadcastContent component, after ParticipantsPanel:
{/* Quality Dashboard */}
{isLive && metrics && (
  <div className="mt-3">
    <StreamQualityDashboard metrics={metrics} />
  </div>
)}

// Get metrics from useBroadcast hook:
const { metrics, /* ... rest of destructuring ... */ } = useBroadcast({
  sessionId,
  apiBaseUrl,
  authToken,
});
```

### TypeScript Types to Add

```typescript
// web/src/features/broadcast/types.ts or in BroadcastPage.tsx

interface StreamQualityMetrics {
  bitrate: number;                                      // Kbps
  frameRate: number;                                    // FPS
  resolution: string;                                   // "1920x1080"
  qualityLimitation: 'none' | 'cpu' | 'bandwidth' | 'other';
  networkHealth: 'good' | 'warning' | 'critical';
  targetBitrate: number;                               // Kbps
}
```

### No Backend Changes in Phase 24
- No API endpoints added
- No database schema changes
- No CDK modifications

---

## Phase 25: Metrics Backend Ingestion

### NEW Files to Create

**File:** `backend/src/handlers/store-stream-metrics.ts`

```typescript
import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

interface StreamMetricsPayload {
  timestamp: number;                          // epoch ms
  bytesSent: number;
  framesPerSecond: number;
  frameHeight: number;
  frameWidth: number;
  qualityLimitationReason: string;           // 'none', 'cpu', 'bandwidth', 'other'
  qualityLimitationDurations?: Record<string, number>;
  targetBitrate: number;
  nackCount: number;
  totalEncodeTime: number;
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  const sessionId = event.pathParameters?.sessionId;

  // Auth checks
  if (!userId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'sessionId required' }) };
  }

  // Validate session ownership (read session first)
  const docClient = getDocumentClient();
  const sessionResult = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    })
  );

  if (!sessionResult.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  const session = sessionResult.Item;
  if (session.userId !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Parse metrics payload
  let metrics: StreamMetricsPayload;
  try {
    metrics = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!metrics.timestamp) {
    return { statusCode: 400, body: JSON.stringify({ error: 'timestamp required' }) };
  }

  // Store metrics to DynamoDB
  try {
    const expirationTime = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `METRICS#${metrics.timestamp.toString().padStart(13, '0')}`,
          recordedAt: metrics.timestamp,
          bytesSent: metrics.bytesSent,
          framesPerSecond: metrics.framesPerSecond,
          frameHeight: metrics.frameHeight,
          frameWidth: metrics.frameWidth,
          qualityLimitationReason: metrics.qualityLimitationReason,
          qualityLimitationDurations: metrics.qualityLimitationDurations,
          targetBitrate: metrics.targetBitrate,
          nackCount: metrics.nackCount,
          totalEncodeTime: metrics.totalEncodeTime,
          TTL: expirationTime,
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'recorded' }),
    };
  } catch (error: any) {
    console.error('[store-stream-metrics] DynamoDB error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to store metrics' }),
    };
  }
};
```

### MODIFIED Files

**File:** `infra/lib/stacks/api-stack.ts`

```typescript
// Add new handler integration:
const storeMetricsHandler = new nodejs.NodejsFunction(this, 'StoreStreamMetrics', {
  entry: path.join(__dirname, '../../backend/src/handlers/store-stream-metrics.ts'),
  handler: 'handler',
  environment: {
    TABLE_NAME: sessionTable.tableName,
  },
  // ... rest of lambda config
});

// Wire to API Gateway:
const metricsResource = api.root.resourceForPath('/sessions/{sessionId}/metrics');
metricsResource.addMethod('PUT', new LambdaIntegration(storeMetricsHandler), {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: cognitoAuthorizer,
});

// Grant lambda read/write access to session table:
sessionTable.grantReadWriteData(storeMetricsHandler);
```

**File:** `backend/src/domain/session.ts`

```typescript
// Add optional metrics-related fields to Session interface (if tracking in session metadata):
export interface Session {
  // ... existing fields ...

  // Metrics tracking (Phase 25 - optional)
  lastMetricsAt?: string;        // ISO timestamp of most recent metrics record
  metricsRecordCount?: number;   // Count of metrics records for this session (for analytics)
}
```

### FRONTEND UPDATE (optional — fire-and-forget metrics sending)

**File:** `web/src/features/broadcast/useBroadcast.ts`

```typescript
// In metrics polling interval, add send-to-backend:
// After calculating newMetrics, fire-and-forget request:

fetch(`${apiBaseUrl}/sessions/${sessionId}/metrics`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    timestamp: Date.now(),
    bytesSent: outboundStats.bytesSent,
    framesPerSecond: outboundStats.framesPerSecond,
    frameHeight: outboundStats.frameHeight,
    frameWidth: outboundStats.frameWidth,
    qualityLimitationReason: outboundStats.qualityLimitationReason,
    qualityLimitationDurations: outboundStats.qualityLimitationDurations,
    targetBitrate: outboundStats.targetBitrate,
    nackCount: outboundStats.nackCount,
    totalEncodeTime: outboundStats.totalEncodeTime,
  }),
}).catch(err => {
  // Silently ignore errors; dashboard still works from client-side stats
  console.debug('[metrics] backend ingestion failed (non-blocking):', err);
});
```

---

## Phase 26: Creator Spotlight Core APIs

### NEW Files to Create

**File:** `backend/src/handlers/add-spotlight.ts`

```typescript
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { SessionStatus } from '../domain/session';

interface AddSpotlightRequest {
  targetSessionId: string;
  expirationMinutes?: number;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  const sessionId = event.pathParameters?.sessionId;
  const body: AddSpotlightRequest = JSON.parse(event.body || '{}');

  if (!userId || !sessionId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const docClient = getDocumentClient();

  // Validate broadcaster owns session
  const sessionResult = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    })
  );

  if (!sessionResult.Item || sessionResult.Item.userId !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Validate target session exists and is live
  const targetResult = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${body.targetSessionId}`, SK: 'METADATA' },
    })
  );

  if (!targetResult.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Target session not found' }) };
  }

  const targetSession = targetResult.Item;
  if (targetSession.status !== SessionStatus.LIVE) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Target session not live' }),
    };
  }

  // Update session with spotlight metadata
  const expiresAt = new Date(
    Date.now() + (body.expirationMinutes ?? 30) * 60 * 1000
  ).toISOString();
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET spotlightSessionId = :spotId, spotlightDisplayName = :dispName, ' +
        'spotlightChannelArn = :chanArn, spotlightFeaturedAt = :featAt, ' +
        'spotlightExpiresAt = :expAt, #v = #v + :inc',
      ExpressionAttributeNames: {
        '#v': 'version',
      },
      ExpressionAttributeValues: {
        ':spotId': body.targetSessionId,
        ':dispName': targetSession.userId,
        ':chanArn': targetSession.claimedResources?.channel,
        ':featAt': now,
        ':expAt': expiresAt,
        ':inc': 1,
      },
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'spotlight_added', expiresAt }),
  };
};
```

**File:** `backend/src/handlers/remove-spotlight.ts`

```typescript
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  const sessionId = event.pathParameters?.sessionId;

  if (!userId || !sessionId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const docClient = getDocumentClient();

  // Validate ownership
  const sessionResult = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    })
  );

  if (!sessionResult.Item || sessionResult.Item.userId !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Clear spotlight fields
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression:
        'REMOVE spotlightSessionId, spotlightDisplayName, spotlightChannelArn, ' +
        'spotlightFeaturedAt, spotlightExpiresAt SET #v = #v + :inc',
      ExpressionAttributeNames: { '#v': 'version' },
      ExpressionAttributeValues: { ':inc': 1 },
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'spotlight_removed' }),
  };
};
```

**File:** `backend/src/handlers/list-featured-creators.ts`

```typescript
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { SessionType, SessionStatus } from '../domain/session';

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '10'), 100);
  const search = (event.queryStringParameters?.search || '').toLowerCase();

  const docClient = getDocumentClient();

  // Query all LIVE BROADCAST sessions
  const response = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `STATUS#${SessionStatus.LIVE}#${SessionType.BROADCAST}`,
      },
      Limit: limit * 2, // Over-fetch to account for filtering
    })
  );

  // Filter by search term and map response
  let results = (response.Items || []).map(item => ({
    sessionId: item.sessionId,
    userId: item.userId,
    viewerCount: item.liveViewerCount || 0,
    startedAt: item.startedAt,
  }));

  if (search) {
    results = results.filter(s =>
      s.userId.toLowerCase().includes(search)
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      creators: results.slice(0, limit),
      total: results.length,
    }),
  };
};
```

### MODIFIED Files

**File:** `backend/src/domain/session.ts`

```typescript
export interface Session {
  // ... existing fields ...

  // Creator spotlight (Phase 26 - optional, backward compatible)
  spotlightSessionId?: string;
  spotlightDisplayName?: string;
  spotlightChannelArn?: string;
  spotlightFeaturedAt?: string;
  spotlightExpiresAt?: string;
}
```

**File:** `infra/lib/stacks/api-stack.ts`

```typescript
// Add three new handlers:

const addSpotlightHandler = new nodejs.NodejsFunction(this, 'AddSpotlight', {
  entry: path.join(__dirname, '../../backend/src/handlers/add-spotlight.ts'),
  handler: 'handler',
  environment: { TABLE_NAME: sessionTable.tableName },
  // ... config
});

const removeSpotlightHandler = new nodejs.NodejsFunction(this, 'RemoveSpotlight', {
  entry: path.join(__dirname, '../../backend/src/handlers/remove-spotlight.ts'),
  handler: 'handler',
  environment: { TABLE_NAME: sessionTable.tableName },
  // ... config
});

const listFeaturedCreatorsHandler = new nodejs.NodejsFunction(this, 'ListFeaturedCreators', {
  entry: path.join(__dirname, '../../backend/src/handlers/list-featured-creators.ts'),
  handler: 'handler',
  environment: { TABLE_NAME: sessionTable.tableName },
  // ... config
});

// Wire to API Gateway:
const spotlightResource = api.root.resourceForPath('/sessions/{sessionId}/spotlight');
spotlightResource.addMethod('PUT', new LambdaIntegration(addSpotlightHandler), {
  authorizationType: AuthorizationType.COGNITO,
});
spotlightResource.addMethod('DELETE', new LambdaIntegration(removeSpotlightHandler), {
  authorizationType: AuthorizationType.COGNITO,
});

const creatorsResource = api.root.resourceForPath('/sessions/featured-creators');
creatorsResource.addMethod('GET', new LambdaIntegration(listFeaturedCreatorsHandler), {
  authorizationType: AuthorizationType.COGNITO,
});

// Grant permissions:
sessionTable.grantReadWriteData(addSpotlightHandler);
sessionTable.grantReadWriteData(removeSpotlightHandler);
sessionTable.grantReadData(listFeaturedCreatorsHandler);
```

---

## Phase 27: Creator Spotlight UI

### NEW Files to Create

**File:** `web/src/features/broadcast/SpotlightOverlay.tsx`

```typescript
import React from 'react';
import IVSPlayer from 'amazon-ivs-web-broadcast'; // or appropriate import

interface SpotlightOverlayProps {
  spotlightSessionId: string;
  spotlightDisplayName: string;
  spotlightChannelArn: string;
  isLive: boolean;
  onRemove: () => Promise<void>;
}

export function SpotlightOverlay({
  spotlightSessionId,
  spotlightDisplayName,
  spotlightChannelArn,
  isLive,
  onRemove,
}: SpotlightOverlayProps) {
  const [isRemoving, setIsRemoving] = React.useState(false);

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      await onRemove();
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="absolute bottom-4 right-4 w-48 h-28 bg-gray-900 rounded-lg overflow-hidden shadow-xl border border-blue-500">
      {/* IVS Player */}
      <div className="w-full h-full">
        <IVSPlayer streamUrl={spotlightChannelArn} muted autoPlay controls={false} />
      </div>

      {/* Overlay UI */}
      <div className="absolute inset-0 flex flex-col justify-between p-2 bg-gradient-to-t from-black/50 to-transparent">
        <div className="flex justify-between items-start">
          <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded font-semibold">
            Featured
          </div>
          <button
            onClick={handleRemove}
            disabled={isRemoving}
            className="text-white hover:bg-black/50 rounded p-1 transition"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-1">
          {isLive && (
            <span className="flex items-center gap-1 bg-red-600 text-white text-xs px-2 py-1 rounded">
              <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          <span className="text-white text-xs font-semibold truncate">
            {spotlightDisplayName}
          </span>
        </div>
      </div>
    </div>
  );
}
```

**File:** `web/src/features/broadcast/SpotlightSelector.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { getConfig } from '../../config/aws-config';

interface Creator {
  sessionId: string;
  userId: string;
  viewerCount: number;
  startedAt: string;
}

interface SpotlightSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sessionId: string, displayName: string) => Promise<void>;
  authToken: string;
}

export function SpotlightSelector({
  isOpen,
  onClose,
  onSelect,
  authToken,
}: SpotlightSelectorProps) {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !authToken) return;

    const fetchCreators = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ search, limit: '20' });
        const response = await fetch(
          `${getConfig()?.apiUrl}/sessions/featured-creators?${query}`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
          }
        );
        const data = await response.json();
        setCreators(data.creators || []);
      } catch (err) {
        console.error('[spotlight] fetch creators failed:', err);
        setCreators([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCreators();
  }, [search, isOpen, authToken]);

  const handleSelect = async (creator: Creator) => {
    setSelecting(creator.sessionId);
    try {
      await onSelect(creator.sessionId, creator.userId);
      onClose();
    } finally {
      setSelecting(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-bold mb-4">Feature a Creator</h2>

        <input
          type="text"
          placeholder="Search creators..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
          {loading ? (
            <div className="text-center text-gray-500 text-sm py-4">Loading creators...</div>
          ) : creators.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-4">No creators live</div>
          ) : (
            creators.map(creator => (
              <button
                key={creator.sessionId}
                onClick={() => handleSelect(creator)}
                disabled={selecting === creator.sessionId}
                className="w-full p-3 border rounded hover:bg-gray-50 disabled:opacity-50 text-left transition flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-gray-900">{creator.userId}</div>
                  <div className="text-xs text-gray-600">
                    {creator.viewerCount} {creator.viewerCount === 1 ? 'viewer' : 'viewers'}
                  </div>
                </div>
                {selecting === creator.sessionId && (
                  <span className="text-sm text-blue-600 font-semibold">Adding...</span>
                )}
              </button>
            ))
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

### MODIFIED Files

**File:** `web/src/features/broadcast/BroadcastPage.tsx`

```typescript
// Add imports:
import { SpotlightSelector } from './SpotlightSelector';
import { SpotlightOverlay } from './SpotlightOverlay';

// In BroadcastContent component state:
const [isSpotlightSelectorOpen, setIsSpotlightSelectorOpen] = useState(false);

// Add handler to add spotlight:
const handleAddSpotlight = async (targetSessionId: string) => {
  try {
    const response = await fetch(
      `${getConfig()?.apiUrl}/sessions/${sessionId}/spotlight`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetSessionId,
          expirationMinutes: 30,
        }),
      }
    );
    if (response.ok) {
      // Refetch session to get updated spotlight metadata
      await fetchSession();
    }
  } catch (err) {
    console.error('[spotlight] add failed:', err);
  }
};

// Add handler to remove spotlight:
const handleRemoveSpotlight = async () => {
  try {
    await fetch(`${getConfig()?.apiUrl}/sessions/${sessionId}/spotlight`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    await fetchSession();
  } catch (err) {
    console.error('[spotlight] remove failed:', err);
  }
};

// In JSX, add selector modal and overlay:
<SpotlightSelector
  isOpen={isSpotlightSelectorOpen}
  onClose={() => setIsSpotlightSelectorOpen(false)}
  onSelect={handleAddSpotlight}
  authToken={authToken}
/>

{session?.spotlightSessionId && session?.spotlightChannelArn && (
  <SpotlightOverlay
    spotlightSessionId={session.spotlightSessionId}
    spotlightDisplayName={session.spotlightDisplayName || 'Unknown'}
    spotlightChannelArn={session.spotlightChannelArn}
    isLive={isLive}
    onRemove={handleRemoveSpotlight}
  />
)}

// Add button to open selector (e.g., in toolbar):
<button
  onClick={() => setIsSpotlightSelectorOpen(true)}
  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
>
  Feature Creator
</button>
```

---

## Phase 28: Viewer Spotlight Highlight

### MODIFIED Files

**File:** `web/src/features/viewer/ViewerPage.tsx`

```typescript
// Add to JSX, near top of video player:
{session?.spotlightSessionId && (
  <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
    <div className="text-sm text-gray-700">
      <span className="font-semibold">Featured Creator:</span>{' '}
      <button
        onClick={() => navigate(`/viewer/${session.spotlightSessionId}`)}
        className="text-blue-600 hover:underline font-semibold"
      >
        {session.spotlightDisplayName}
      </button>
    </div>
  </div>
)}
```

---

## Summary of New Routes (CDK API Stack)

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| PUT | `/sessions/{sessionId}/metrics` | store-stream-metrics.ts | Cognito | Ingest client metrics (Phase 25) |
| PUT | `/sessions/{sessionId}/spotlight` | add-spotlight.ts | Cognito | Set spotlight (Phase 26) |
| DELETE | `/sessions/{sessionId}/spotlight` | remove-spotlight.ts | Cognito | Clear spotlight (Phase 26) |
| GET | `/sessions/featured-creators` | list-featured-creators.ts | Cognito | Discover live broadcasters (Phase 26) |

---

## DynamoDB Access Pattern Summary

**Metrics storage:**
```
PK: SESSION#{sessionId}
SK: METRICS#{ISO_TIMESTAMP}
TTL: expirationTime (24 hours)
```

**Session spotlight metadata:**
```
PK: SESSION#{sessionId}
SK: METADATA
Fields: spotlightSessionId, spotlightDisplayName, spotlightChannelArn, etc.
```

**Featured creators discovery:**
```
Query GSI1:
  GSI1PK = STATUS#LIVE#BROADCAST
  → Returns all live broadcast sessions (no SK needed for listing)
```

---

## Backward Compatibility Checklist

- [x] All new Session fields are optional (`?`)
- [x] Existing session creation/ending flows unaffected
- [x] Metrics endpoint is new (no impact on existing endpoints)
- [x] Spotlight API endpoints are new
- [x] DynamoDB schema changes are additive only
- [x] No schema migrations required
- [x] Existing frontend pages unchanged (only new components added)

---

## Testing Checklist by Phase

**Phase 24:** Verify IVS SDK `getStats()` method works; test metrics calculations
**Phase 25:** Verify metrics endpoint receives and stores data; check TTL cleanup
**Phase 26:** Test add/remove/list spotlight handlers; verify session updates
**Phase 27:** Test spotlight UI interactions; verify multi-player rendering performance
**Phase 28:** Test viewer navigation to featured creator; verify link resolution

---

## Files Summary

### New Backend Handlers (Phase 26)
- `store-stream-metrics.ts` (25)
- `add-spotlight.ts` (26)
- `remove-spotlight.ts` (26)
- `list-featured-creators.ts` (26)

### New Frontend Components (Phase 27)
- `StreamQualityDashboard.tsx` (24)
- `SpotlightOverlay.tsx` (27)
- `SpotlightSelector.tsx` (27)

### Modified Files
- `backend/src/domain/session.ts` (add spotlight fields)
- `web/src/features/broadcast/useBroadcast.ts` (add metrics polling + send)
- `web/src/features/broadcast/BroadcastPage.tsx` (integrate dashboard + spotlight)
- `web/src/features/viewer/ViewerPage.tsx` (show spotlight link)
- `infra/lib/stacks/api-stack.ts` (wire new handlers + routes)

### Total LOC Estimate
- Backend: ~400 LOC (4 handlers)
- Frontend: ~300 LOC (3 components)
- CDK: ~100 LOC (handler wiring)
- **Total: ~800 LOC**
