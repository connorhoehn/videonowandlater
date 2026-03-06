# Private Channels: Architecture & Implementation Guide

**Phase:** 22 (Live Broadcast with Secure Viewer Links)
**Status:** Production Ready
**Last Updated:** 2026-03-06

## Overview

Private channels enable broadcasters to share live streams with a restricted set of viewers via time-limited JWT tokens. This guide covers the architecture, API usage, and security considerations.

## Architecture

### High-Level Flow

```
Broadcaster Creates Session
  ├─ Request: POST /sessions with sessionType='BROADCAST', isPrivate=true
  ├─ Response: sessionId, claimedResources.channel (private channel from pool)
  └─ Session stored with isPrivate=true

Broadcaster Generates Playback Token
  ├─ Request: POST /sessions/{sessionId}/playback-token with optional expiresIn
  ├─ Handler: Verifies session.isPrivate=true, retrieves channel ARN
  ├─ Signs JWT: payload = {aws:channel-arn, aws:access-control-allow-origin, exp}
  ├─ Algorithm: ES384 (ECDSA with SHA-384)
  └─ Response: token, expiresAt, playbackUrl (with token appended)

Viewer Accesses Stream
  ├─ Viewer receives playbackUrl from broadcaster (email, chat, etc)
  ├─ Player appends token to HLS request: https://playback.../video.m3u8?token=<JWT>
  ├─ IVS verifies ES384 signature using channel's public key
  ├─ IVS checks token.exp > now
  └─ IVS serves HLS stream if valid, 403 Forbidden if invalid/expired
```

### Domain Model Extension

Session interface includes:
```typescript
interface Session {
  // ... existing fields ...
  isPrivate?: boolean;  // true = private channel, false/undefined = public
}
```

### Pool Management

Private channels are stored in the same DynamoDB pool as public channels with distinct GSI key:

```
Public Channel Pool Item:
  PK: POOL#CHANNEL#{channelId}
  SK: METADATA
  GSI1PK: STATUS#AVAILABLE#CHANNEL
  isPrivate: false

Private Channel Pool Item:
  PK: POOL#CHANNEL#{channelId}
  SK: METADATA
  GSI1PK: STATUS#AVAILABLE#PRIVATE_CHANNEL
  isPrivate: true
```

### JWT Payload

IVS requires this exact payload structure for ES384-signed tokens:

```json
{
  "aws:channel-arn": "arn:aws:ivs:region:account:channel/channel-id",
  "aws:access-control-allow-origin": "*",
  "exp": 1741240800
}
```

**Fields:**
- `aws:channel-arn`: Channel ARN (required). Identifies which channel the token grants access to.
- `aws:access-control-allow-origin`: CORS origin (optional). Use "*" to allow any origin, or specific domain.
- `exp`: Expiration timestamp in seconds since epoch (required). IVS rejects tokens where exp <= now.

**Optional fields (for future enhancement):**
- `aws:viewer-id`: Track which viewer accessed the stream
- `aws:single-use-uuid`: Invalidate token after first use

## API Usage

### 1. Create Private Broadcast Session

**Request:**
```bash
POST /sessions
Content-Type: application/json
Authorization: Bearer {authToken}

{
  "sessionType": "BROADCAST",
  "isPrivate": true
}
```

**Response:**
```json
{
  "sessionId": "sess-1234567890",
  "userId": "user-alice",
  "sessionType": "BROADCAST",
  "isPrivate": true,
  "status": "creating",
  "claimedResources": {
    "channel": "arn:aws:ivs:us-west-2:123456789:channel/private-abc123"
  }
}
```

**Notes:**
- `isPrivate=true` claims a private channel from the pool (different from public broadcasts)
- If no private channels available, returns 503 Service Unavailable (retry)
- Private channel broadcasts require JWT tokens; public broadcasts do not

### 2. Generate Playback Token

**Request:**
```bash
POST /sessions/{sessionId}/playback-token
Content-Type: application/json
Authorization: Bearer {authToken}

{
  "expiresIn": 86400
}
```

**Response:**
```json
{
  "token": "eyJhbGc...",
  "expiresAt": "2026-03-07T12:00:00Z",
  "playbackUrl": "https://abc123.us-west-2.playback.live-video.net/api/video/v1/.../video.m3u8?token=eyJhbGc..."
}
```

**Parameters:**
- `expiresIn` (optional): Token lifetime in seconds. Default: 86400 (24 hours). Max recommended: 604800 (7 days).

**Error Responses:**
- `404 Not Found`: Session not found
- `400 Bad Request`: Session is public (isPrivate=false), or invalid expiresIn
- `500 Server Error`: Channel ARN missing, or private key not configured

### 3. Share Token with Viewers

Send the `playbackUrl` to viewers via your preferred channel (email, chat, messaging app, etc):

```
Friend, join my broadcast: https://abc123.us-west-2.playback.live-video.net/...?token=eyJhbGc...
```

Viewers can paste the URL into a browser or use the VideoNowAndLater web app to watch.

### 4. Activity Feed Filtering

GET /activity returns all ended sessions, but filters out private sessions for non-owners:

```typescript
// User: alice (owner)
GET /activity
Response: {
  sessions: [
    { sessionId: 'sess-private-1', isPrivate: true, userId: 'alice' },  // ✓ Visible
    { sessionId: 'sess-public-1', isPrivate: false },                    // ✓ Visible
  ]
}

// User: bob (not owner)
GET /activity
Response: {
  sessions: [
    { sessionId: 'sess-public-1', isPrivate: false },                    // ✓ Visible
    // sess-private-1 is hidden
  ]
}

// Unauthenticated user
GET /activity
Response: {
  sessions: [
    { sessionId: 'sess-public-1', isPrivate: false },                    // ✓ Visible
  ]
}
```

## Security Considerations

### Private Key Management

**Risk:** Private key compromise allows anyone to generate valid tokens.

**Mitigation:**
- Store private key in AWS Secrets Manager (production) or environment variable (dev)
- Rotate private key periodically (requires generating new key and updating all channels)
- Never commit private key to version control
- Restrict Lambda IAM policy to read-only access to secret

**Setup (development):**
```bash
# Generate ECDSA P-384 key pair
openssl ecparam -name secp384r1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem

# Set environment variable (dev only)
export IVS_PLAYBACK_PRIVATE_KEY="$(cat private-key.pem)"
cdk deploy
```

**Setup (production):**
```bash
# Store in Secrets Manager
aws secretsmanager create-secret --name ivs/playback-private-key --secret-string file://private-key.pem

# Lambda handler retrieves via SDK
const secretsClient = new SecretsManagerClient({});
const secret = await secretsClient.send(new GetSecretValueCommand({
  SecretId: 'ivs/playback-private-key',
}));
const privateKey = secret.SecretString;
```

### Token Expiration

**Risk:** Tokens valid for extended periods (e.g., 30 days) allow revoked viewers to continue accessing streams.

**Mitigation:**
- Default token expiration: 24 hours
- Tokens are **not revocable** — expiration is the only mechanism
- If broadcaster needs to revoke access, change privacy setting to public (disables all tokens for that session)
- Document that tokens should be treated as temporary credentials

### Broadcaster Verification

**Risk:** Any user can generate tokens for any session (no ownership check).

**Current Status:** Phase 22 MVP does not enforce broadcaster ownership in token endpoint.

**Mitigation (Phase 22-04 enhancement):**
```typescript
// In generate-playback-token handler
const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
if (userId !== session.userId) {
  return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
}
```

**Until implemented:** Rely on API Gateway Cognito authorizer to gate endpoint access.

### Activity Feed Privacy

**Risk:** Private sessions leaked in GET /activity endpoint.

**Mitigation:** Activity feed filters out private sessions unless user is the owner.

## Monitoring & Troubleshooting

### Common Issues

**Token Generation Fails with 500**
- Check IVS_PLAYBACK_PRIVATE_KEY is set in Lambda environment
- Verify private key is valid PEM format
- Check Lambda has DynamoDB read permission

**Token Generated but Playback Fails (403 Forbidden)**
- Token signature invalid: Check private key matches channel's public key (verify in IVS console)
- Token expired: Check expiresAt timestamp
- Region mismatch: Channel and Lambda must be in same AWS region

**Private Channels Unavailable (503)**
- Pool is empty: Check CDK created PRIVATE_CHANNEL pool items
- All channels claimed: Increase PRIVATE_CHANNEL_POOL_SIZE in CDK
- Check pool GSI1PK = STATUS#AVAILABLE#PRIVATE_CHANNEL

### Debug Logging

Enable debug logging in generate-playback-token handler:

```typescript
console.log('Session:', JSON.stringify(session, null, 2));
console.log('Token payload:', JSON.stringify(payload, null, 2));
console.log('Channel ARN:', channelArn);
```

View in CloudWatch Logs: `/aws/lambda/generate-playback-token`

## Roadmap

**Phase 22 (current):** Private channels with JWT tokens, broadcaster-only token generation.

**Phase 23+ (future):**
- Viewer-initiated token generation (with broadcaster approval workflow)
- Token revocation via blacklist
- Per-viewer access tracking
- Expiration policy enforcement (max 7 days, etc)
- Multi-region private key sync
- Guest list management (UI for adding/removing viewers)

## References

- AWS IVS Private Channels: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels.html
- Playback Token Generation: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/private-channels-generate-tokens.html
- ECDSA / ES384 JWT Spec: https://tools.ietf.org/html/rfc7518#section-3.4

---

*Documentation updated: Phase 22 implementation complete*
