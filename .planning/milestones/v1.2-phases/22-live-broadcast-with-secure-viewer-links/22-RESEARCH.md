# Phase 22: Live Broadcast with Secure Viewer Links — Research

**Researched:** 2026-03-06
**Domain:** IVS private channels, JWT-based playback token generation, secure viewer access control
**Confidence:** HIGH

## Summary

Phase 22 adds secure viewer link functionality to live broadcasts, enabling broadcasters to share access-controlled streams with selected viewers via signed playback tokens. Currently, all live broadcasts are fully public — anyone with a sessionId can watch via `/sessions/{sessionId}/playback` which returns an unauthenticated HLS URL. Phase 22 introduces AWS IVS Private Channels (optional, per-broadcast) and server-side JWT token generation for playback authentication, allowing broadcasters to create share links that work for a limited time and restrict playback to specific viewers.

The implementation is relatively contained: it adds a broadcaster-controlled privacy setting to sessions, switches the channel creation flow to use private channels when requested, stores the channel's playback private key in Cognito or environment variables, and adds a new API endpoint (`POST /sessions/{sessionId}/playback-token`) that generates ES384-signed JWTs for viewer playback. No changes required to recording infrastructure, chat system, reactions, or playback client code — the JWT is simply appended to the HLS URL query string, and IVS verifies the signature server-side.

**Primary recommendation:** Implement as optional per-broadcast privacy setting. Add a `privateChannel` boolean field to Session domain. Extend session creation flow to optionally claim private channels (in addition to regular channels) from pre-warmed pool. Add token generation handler that creates ES384-signed JWTs with channel ARN, expiration, and optional viewer-id field. Store private key as Lambda environment variable (bootstrapped via CDK and Cognito custom attributes or Secrets Manager). Update home feed filtering so private sessions only appear to owner or token holders. Defer channel switching/privacy toggle to v2+ (current design assumes fixed privacy at session creation).

## User Constraints

*No CONTEXT.md exists for Phase 22 — all research is exploratory.*

## Phase Requirements

Phase 22 has no formally defined requirements in REQUIREMENTS.md yet. The roadmap stub indicates the feature scope: "Users can broadcast a live video stream and share a secure viewing link with others for real-time engagement."

Implied requirements from scope:
- Broadcaster can create a live broadcast with optional privacy setting (public or private)
- If private, only viewers with a valid playback token can watch the stream
- Broadcaster can generate shareable viewing links (or tokens) to send to specific viewers
- Tokens have configurable expiration time (e.g., 24 hours)
- Optional: tokens limited to specific viewer IDs or IP origins
- Private broadcasts do not appear in public activity feed
- Token generation is server-side (not client-side) for security

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jsonwebtoken` | `^9.0.0` | Sign ES384 JWTs for IVS playback token generation | Industry standard for JWT signing; ES384 is required by IVS spec |
| `@aws-sdk/client-ivs` | `^3.1000.0` | Create private channels (if using create-channel flow) | Already installed; used for pool management |
| `aws-cdk-lib/aws-ivs` | `^2.0.0` | CDK construct for IVS resources | Already in use for pool infrastructure |
| Native Node.js `crypto` module | Built-in | ECDSA signing if avoiding jsonwebtoken dependency | Lower-level alternative; requires manual JWT assembly |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aws-sdk/client-secrets-manager` | `^3.1000.0` | Retrieve playback private key from Secrets Manager | Alternative to env vars for key storage (more secure for production) |
| `uuid` (existing in project) | Already installed | Generate single-use tokens for `aws:single-use-uuid` field | Optional; increases token security for one-time playback |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JWT-based playback tokens | IP allowlist on channel | IVS does not support IP-based channel access control; JWTs are the only method for private channels |
| Private channels at creation | Pub/Sub access control layer | Would require additional API call to toggle privacy; JWT approach is simpler, no channel re-configuration needed |
| ES384 JWT signing | OAuth2 client credentials | IVS does not accept OAuth2; requires ES384 JWTs per spec |
| Environment variable for private key | Secrets Manager | Env var is simpler for dev/test; Secrets Manager recommended for production. Both supported by same code path. |
| Pre-generate all tokens upfront | On-demand token generation | On-demand (lazy) is better; avoids token expiration issues and reduces token proliferation |

**Installation:**
```bash
npm install jsonwebtoken uuid
# CDK already includes @aws-sdk/client-ivs
# No new npm dependencies required if using native crypto for signing
```

## Architecture Patterns

### Channel Privacy Model

Current architecture (before Phase 22):
```
Broadcaster creates session → Claim AVAILABLE channel from pool → Channel is PUBLIC
                                                                    ↓
                                                          Any viewer with sessionId
                                                          can call GET /playback
                                                          and get unauthenticated HLS URL
```

Phase 22 architecture:
```
Broadcaster creates session with privacy setting
  ├─ Public: Claim AVAILABLE channel from pool (existing)
  │   → Playback URL is unauthenticated (existing endpoint unchanged)
  │
  └─ Private: Claim AVAILABLE PRIVATE channel from pool (new)
      → Channel requires JWT on playback request
      → Broadcaster or authorized viewers call POST /playback-token
      → Lambda signs JWT with private key
      → Viewer appends token to HLS URL: https://playback.../video.m3u8?token=<JWT>
      → IVS verifies signature server-side, serves stream if valid
```

**Key insight:** Private channels use the same IVS infrastructure and pool, just with a different configuration flag (PlaybackPolicy enforcement enabled). No new hardware or IVS subscriptions needed.

### Pre-warmed Private Channel Pool

Current pool includes channels and stages. Phase 22 extends pool management:

```typescript
// Current pool item (public channel)
{
  PK: 'POOL#CHANNEL#resource-id-123',
  SK: 'METADATA',
  status: 'available',
  channelArn: 'arn:aws:ivs:us-west-2:123456789:channel/abc...',
  channelName: 'vnl-pool-channel-0001',
  playbackUrl: 'https://abc.us-west-2.playback.live-video.net/api/video/v1/...',
  ingestEndpoint: 'rtmps://live-123.us-west-2.ingest.live-video.net:443/app/',
  streamKey: 'sk-abc123',
  isPrivate: false,  // NEW FIELD
}

// New pool item (private channel)
{
  PK: 'POOL#CHANNEL#resource-id-456',
  SK: 'METADATA',
  status: 'available',
  channelArn: 'arn:aws:ivs:us-west-2:123456789:channel/def...',
  channelName: 'vnl-pool-private-channel-0001',
  playbackUrl: 'https://def.us-west-2.playback.live-video.net/api/video/v1/...',
  ingestEndpoint: 'rtmps://live-456.us-west-2.ingest.live-video.net:443/app/',
  streamKey: 'sk-def456',
  isPrivate: true,  // NEW FIELD
  // Note: private key is NOT stored in DynamoDB, only in environment/Secrets Manager
}
```

### Session Model Extension

```typescript
export interface Session {
  // ... existing fields ...
  sessionId: string;
  userId: string;
  sessionType: SessionType;
  status: SessionStatus;
  claimedResources: ClaimedResources;

  // NEW: Privacy setting
  isPrivate?: boolean;  // true = private channel, false/undefined = public (backward compatible)
}
```

### Playback Token Handler: POST /sessions/{sessionId}/playback-token

**Purpose:** Generate ES384-signed JWT for viewing private broadcasts

**Input:**
```json
{
  "sessionId": "sess-1234567890-abc123",
  "expiresIn": 86400  // Optional; seconds until token expires (default: 24 hours)
}
```

**Output:**
```json
{
  "token": "eyJhbGc...",
  "expiresAt": "2026-03-07T06:00:00Z",
  "playbackUrl": "https://abc.us-west-2.playback.live-video.net/api/video/v1/.../video.m3u8?token=<JWT>"
}
```

**Implementation (TypeScript):**

```typescript
/**
 * POST /sessions/{sessionId}/playback-token handler
 * Generate JWT for private channel playback
 * Source: AWS IVS playback token documentation + project pattern
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import jwt from 'jsonwebtoken';

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  const privateKey = process.env.IVS_PLAYBACK_PRIVATE_KEY!;  // PEM-encoded ECDSA private key
  const sessionId = event.pathParameters?.sessionId;

  // Parse request
  const body = event.body ? JSON.parse(event.body) : {};
  const expiresIn = body.expiresIn || 86400;  // Default: 24 hours

  // Get session and channel ARN
  const docClient = getDocumentClient();
  const sessionResult = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!sessionResult.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Session not found' }),
    };
  }

  const session = sessionResult.Item;

  // Verify session is private
  if (!session.isPrivate) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Session is public, no token required' }),
    };
  }

  // Get channel ARN
  const channelArn = session.claimedResources?.channel;
  if (!channelArn) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Session has no channel' }),
    };
  }

  // Generate JWT
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    'aws:channel-arn': channelArn,
    'aws:access-control-allow-origin': '*',  // Allow any origin; could restrict per broadcaster
    'exp': now + expiresIn,
  };

  const token = jwt.sign(payload, privateKey, { algorithm: 'ES384' });

  // Get playback URL from pool
  const resourceId = channelArn.split('/').pop();
  const poolResult = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `POOL#CHANNEL#${resourceId}`, SK: 'METADATA' },
  }));

  const playbackUrl = poolResult.Item?.playbackUrl;
  if (!playbackUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Playback URL not found' }),
    };
  }

  // Return token and full playback URL with token
  const expiresAt = new Date(now * 1000 + expiresIn * 1000).toISOString();

  return {
    statusCode: 200,
    body: JSON.stringify({
      token,
      expiresAt,
      playbackUrl: `${playbackUrl}?token=${token}`,
    }),
  };
};
```

**Caller options:**
- **Broadcaster only** (simplest): Only session owner (userId) can call this endpoint. Send token to viewers via email/chat/external link.
- **Authenticated viewers** (moderate): Endpoint authenticated via Cognito; any logged-in user can request a token. Broadcaster later reviews access logs.
- **With optional viewerId** (advanced): Payload includes optional `aws:viewer-id` field; token invalidates after first playback if `aws:single-use-uuid` included. Deferred to v2.

**Recommendation:** Start with **broadcaster-only**; requires minimal changes to existing auth flow. Extend to viewer roles in v2 if needed.

### Session Creation Flow Update

```typescript
// Current POST /sessions handler
interface CreateSessionRequest {
  sessionType: 'BROADCAST' | 'HANGOUT' | 'UPLOAD';
}

// NEW: Optional privacy parameter
interface CreateSessionRequest {
  sessionType: 'BROADCAST' | 'HANGOUT' | 'UPLOAD';
  isPrivate?: boolean;  // For BROADCAST only; defaults to false
}

// In createNewSession service:
if (sessionType === 'BROADCAST' && isPrivate === true) {
  // Claim a private channel from pool
  // Query: GSI1PK = 'STATUS#AVAILABLE#PRIVATE_CHANNEL', GSI1SK begins_with ...
  // Otherwise same as existing flow
} else {
  // Claim a regular channel (existing)
}
```

### Private Key Storage

Three options, in order of production readiness:

**Option 1: Environment Variable (dev/test)**
```bash
# In CDK stack:
new NodejsFunction({
  environment: {
    IVS_PLAYBACK_PRIVATE_KEY: privateKeyPem,  // Read from .env or Secrets Manager in CDK bootstrap
  },
});
```
Pros: Simple, no extra AWS service calls. Cons: Key visible in function logs if not careful.

**Option 2: AWS Secrets Manager (production)**
```typescript
// In Lambda function
const secretsClient = new SecretsManagerClient({});
const secretResult = await secretsClient.send(new GetSecretValueCommand({
  SecretId: 'ivs/playback-private-key',
}));
const privateKey = secretResult.SecretString;
```
Pros: Secure, auditable, rotatable. Cons: Extra AWS API call on every token generation (~50ms latency). Acceptable for token endpoint since not called per video frame.

**Option 3: Cognito Custom Attribute (not recommended)**
Store key as custom attribute on user pool. Cons: Overkill, key should not be per-user.

**Recommendation for Phase 22:** Use environment variable with flag to also support Secrets Manager. Store actual key in Secrets Manager during CDK bootstrap, pass to Lambda via env var or direct fetch.

### Activity Feed Filtering

Current activity feed endpoint (`GET /activity`) returns all ended sessions. Phase 22 requires filtering:

```typescript
// Current: Return all sessions
const sessions = await docClient.send(new ScanCommand({
  TableName,
  FilterExpression: 'sessionStatus = :ended',
}));

// NEW: Filter out private sessions not owned by user
const sessions = await docClient.send(new ScanCommand({
  TableName,
  FilterExpression: '#private = :false OR userId = :userId',
  ExpressionAttributeNames: { '#private': 'isPrivate' },
  ExpressionAttributeValues: { ':false': false, ':userId': userId },
}));
```

Alternatively: Defer to Phase 23 (homepage redesign) if activity feed already has ownership filtering.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT signing with ES384 | Custom ECDSA signing code | `jsonwebtoken` library or native `crypto` module | ECDSA is mathematically complex; library handles edge cases (padding, encoding). IVS spec requires exact format. |
| Private key management | Store key in code or unencrypted env | AWS Secrets Manager or env with rotation policy | Credentials in code = breach risk. Secrets Manager provides audit trail and rotation. |
| Channel create/claim for private | Custom channel creation logic | Extend existing pool management | Channels are stateful AWS resources; pooling prevents resource leaks. Existing pattern proven in Phases 1-2. |
| Playback URL construction | Manual string concatenation | IVS API for channel metadata | IVS provides authoritative playback URL; manual construction risks using stale or region-mismatched URLs. |

**Key insight:** Private channels are a feature flag on existing IVS channels, not a separate resource type. Leverage existing pool infrastructure.

## Common Pitfalls

### Pitfall 1: Private Key Exposure in Logs
**What goes wrong:** Lambda logs accidentally include private key in errors or debug statements.
**Why it happens:** Developers use `console.log(environment)` or `console.error(err)` without sanitizing.
**How to avoid:** Never log private key. Wrap key access in try/catch. Use structured logging with redaction rules. Test key rotation to ensure logs don't contain key.
**Warning signs:** CloudWatch logs show "private key" string; env var name appears in error messages.

### Pitfall 2: Token Expiration Too Long
**What goes wrong:** Tokens valid for 30 days; broadcasters change privacy settings or revoke access, but old tokens still work.
**Why it happens:** Developers set expiration for convenience without considering revocation.
**How to avoid:** Default to 24 hours. Document that tokens are not revocable (broadcast privacy is at session level, not token level). If revocation needed, defer to v2 token blacklist.
**Warning signs:** User complaints "I shared a link, then private, but they can still watch."

### Pitfall 3: Private Key Mismatch Between Regions
**What goes wrong:** Lambda in us-east-1 signs with key from us-west-2; IVS in us-west-2 has different key, rejects tokens.
**Why it happens:** CDK creates channels in one region but Lambda env var points to different region key.
**How to avoid:** Ensure channel creation and token handler are in same region. Store key with channel metadata in pool item (encrypted), not globally. Test token validation in all deployment regions.
**Warning signs:** Playback works in dev region, fails in prod region.

### Pitfall 4: Not Handling Channel Claim Failure
**What goes wrong:** Session created with `isPrivate=true` but no private channels in pool; session stuck in CREATING state.
**Why it happens:** Pool replenishment logic doesn't distinguish public/private channels.
**How to avoid:** Ensure pool replenishment creates both public and private channels. If private channel unavailable, return 503 with "Please try again" (not 400 bad request). Log metrics on public vs private channel utilization.
**Warning signs:** Some broadcasts can't go private; error rate spikes on private broadcast requests.

### Pitfall 5: Audience for Token Endpoint
**What goes wrong:** Endpoint is public; any user can generate tokens for any broadcast.
**Why it happens:** Forgot to add Cognito authorizer and ownership check.
**How to avoid:** Add `authorizer` to endpoint in CDK. Inside handler, verify `userId === session.userId` before signing token.
**Warning signs:** Viewership logs show tokens for sessions created by other users.

## Code Examples

### Example 1: Generate Playback Token (Handler)

Source: [AWS IVS Playback Token Documentation](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels-generate-tokens.html)

```typescript
import jwt from 'jsonwebtoken';

export async function generatePlaybackToken(
  channelArn: string,
  privateKey: string,
  expiresIn: number = 86400  // 24 hours
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    'aws:channel-arn': channelArn,
    'aws:access-control-allow-origin': '*',
    // Optional fields for advanced security:
    // 'aws:single-use-uuid': uuidv4(),  // Invalidate after first use
    // 'aws:viewer-id': userId,           // Track viewer
    'exp': now + expiresIn,
  };

  // Sign with ES384 algorithm (required by IVS)
  const token = jwt.sign(payload, privateKey, { algorithm: 'ES384' });
  return token;
}
```

### Example 2: Claim Private Channel from Pool

```typescript
/**
 * Extend existing pool claiming logic in session-service.ts
 * Source: Phase 2 pool management pattern + IVS channel creation
 */

export async function claimChannelFromPool(
  tableName: string,
  sessionType: SessionType,
  isPrivate: boolean = false
): Promise<ClaimedChannel | null> {
  const docClient = getDocumentClient();

  // Query pool for available channel
  const resourceType = isPrivate ? 'PRIVATE_CHANNEL' : 'CHANNEL';
  const queryResult = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `STATUS#AVAILABLE#${resourceType}`,
    },
    Limit: 1,
  }));

  if (!queryResult.Items?.length) {
    return null;  // No available channels
  }

  const poolItem = queryResult.Items[0];
  const channelArn = poolItem.channelArn;

  // Transition pool item to CLAIMED
  try {
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: poolItem.PK, SK: poolItem.SK },
      UpdateExpression: 'SET GSI1PK = :claimed',
      ExpressionAttributeValues: { ':claimed': `STATUS#CLAIMED#${resourceType}` },
      ConditionExpression: 'GSI1PK = :expected',
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Pool item was claimed by another request; retry
      return null;
    }
    throw err;
  }

  return { channelArn, isPrivate };
}
```

### Example 3: JWT Validation (Frontend Context)

Viewers don't validate tokens client-side; IVS does server-side. But understanding the flow:

```typescript
// Frontend: Fetch token from broadcaster's backend
const response = await fetch('/api/sessions/sess-123/playback-token', {
  method: 'POST',
  headers: { Authorization: `Bearer ${authToken}` },
  body: JSON.stringify({ expiresIn: 86400 }),
});

const { token, playbackUrl } = await response.json();

// Frontend: Use token-appended URL
const player = IVSPlayer.create();
player.load(playbackUrl);  // URL includes ?token=<JWT>
player.play();

// IVS client automatically extracts token from URL
// and includes it in all HLS playlist requests.
// IVS servers verify ES384 signature using channel's public key.
// If valid, stream is served; if invalid, 403 Forbidden.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All broadcasts public | Private channels with JWT auth | 2024 (IVS feature release) | IVS added playback-policy feature for enterprise use cases |
| IP allowlist for access control | JWT-based playback tokens | Same | IVS does not support IP-based restrictions; JWTs are the only method |
| Pre-shared secrets (key on every request) | JWT signed once, verified per request | JWT standard (2015) | Reduces network payload and improves replay compatibility |

**Deprecated/outdated:**
- None for Phase 22. This feature is new to the codebase.

## Open Questions

1. **Should private channels be optional per-broadcast or mandatory globally?**
   - What we know: Current roadmap says "optional" per phase description. Simplest MVP is optional at session creation.
   - What's unclear: Do we need API to toggle privacy after session creation? (Probably not for v1.)
   - Recommendation: Implement as immutable per-session flag set at creation time. Defer toggle to v2 if requested.

2. **Who can generate playback tokens?**
   - What we know: Broadcaster owns the session; makes sense they control token generation.
   - What's unclear: Can broadcasters generate tokens for other users? Should endpoint be public for viewers to self-serve tokens?
   - Recommendation: Phase 22 = broadcaster-only. Add viewer self-serve in v2 with approval workflow.

3. **How should private broadcasts appear in activity feed?**
   - What we know: Privacy implies restricted visibility. Currently activity feed is public.
   - What's unclear: Should private broadcasts be completely hidden, or visible to invited viewers?
   - Recommendation: Completely hidden from activity feed (simpler). Broadcasters can share direct links. Implement sharing UI (guest list) in v2.

4. **Private key rotation and multi-region support?**
   - What we know: Single-region deployment for v1.2. Key stored in env var or Secrets Manager.
   - What's unclear: If we add multi-region, how do we sync private keys across regions?
   - Recommendation: Defer to v2+. For v1, document that private key must be manually synced if replicating to new region.

5. **What if private key is compromised?**
   - What we know: JWT signature validates against public key stored in IVS channel.
   - What's unclear: Can we revoke all tokens without invalidating the channel?
   - Recommendation: Tokens cannot be revoked (no blacklist). Key rotation requires generating new private key and updating all channels. Implement key versioning if this becomes a requirement.

## Validation Architecture

> Skip this section entirely if workflow.nyquist_validation is false in .planning/config.json

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (frontend) + Jest (backend) |
| Config file | `backend/vitest.config.ts` for handler tests; no separate config needed |
| Quick run command | `npm test -- playback-token --run` |
| Full suite command | `npm test -- --run` (all tests) |

### Phase Requirements → Test Map

Phase 22 has no formal requirements in REQUIREMENTS.md yet. Based on implied scope from phase description and existing patterns:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| (implied) | POST /sessions creates broadcast with isPrivate flag | unit | `npm test -- create-session.test.ts --run` | ✅ Wave 0 (extend existing) |
| (implied) | Pool contains mix of public/private channels | unit | `npm test -- session-stack.test.ts --run` | ❌ Wave 0 (CDK tests) |
| (implied) | POST /playback-token generates valid ES384 JWT | unit | `npm test -- playback-token.test.ts --run` | ❌ Wave 1 (new handler) |
| (implied) | JWT validation fails with incorrect signature | unit | `npm test -- playback-token.test.ts --run` | ❌ Wave 1 (new handler) |
| (implied) | GET /activity filters out private sessions not owned by user | integration | `npm test -- activity.test.ts --run` | ✅ Wave 0 (extend existing) |
| (implied) | Playback with valid token works (IVS integration) | integration | Manual test with IVS player | 🟡 Wave 1 (requires IVS dev account) |

### Sampling Rate
- **Per task commit:** `npm test -- playback-token.test.ts --run` (focused)
- **Per wave merge:** `npm test -- --run` (full suite)
- **Phase gate:** Full suite green + manual IVS playback test before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/src/handlers/__tests__/playback-token.test.ts` — covers token generation, ES384 signing, channel ARN inclusion
- [ ] `backend/src/handlers/__tests__/create-session.test.ts` — extend with `isPrivate` parameter and private channel claiming
- [ ] `backend/src/handlers/__tests__/get-activity.test.ts` — extend with private session filtering
- [ ] CDK unit tests for private channel pool creation (`infra/test/stacks/session-stack.test.ts`)
- [ ] Environment variable or Secrets Manager setup for `IVS_PLAYBACK_PRIVATE_KEY`

## Sources

### Primary (HIGH confidence)
- [AWS IVS Playback Token Generation](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels-generate-tokens.html) - JWT structure, ES384 signing, payload fields
- [AWS IVS Private Channels Setup](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels.html) - channel configuration, playback policy requirements
- [AWS IVS Private Channels Workflow](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels-workflow.html) - end-to-end implementation flow
- Project codebase: Phase 1-2 pool management patterns, Phase 21 session model, existing token generation (chat)

### Secondary (MEDIUM confidence)
- [AWS for M&E Blog: Introducing Private Channels](https://aws.amazon.com/blogs/media/introducing-private-channels-for-amazon-interactive-video-service/) - use cases and architecture overview
- [AWS IVS Enable Playback Authorization](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels-enable-playback-auth.html) - enabling playback policy on channels

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - AWS docs are authoritative; jsonwebtoken is industry standard
- Architecture: HIGH - IVS private channels are well-documented; pattern mirrors existing chat token flow
- Pitfalls: MEDIUM - Based on common JWT/security issues; test with actual IVS integration to confirm edge cases

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (IVS API stable, JWT specs immutable)
**Dependencies:** Phase 1-2 (pool infrastructure), Phase 4+ (auth), Phase 21 (session model)
**Blockers:** None identified. IVS private channels available in all AWS regions. Playback private key generation is standard ECDSA (no special prerequisites).

---

*Research complete. Ready for planning.*
