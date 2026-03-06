# Architecture: Shareable Links & Collections Integration

**Project:** VideoNowAndLater (Post-v1.4 Milestone)
**Domain:** Session sharing and content organization
**Researched:** 2026-03-05
**Mode:** Ecosystem integration research
**Confidence:** HIGH

---

## Executive Summary

Integrating shareable links and collections into the existing VideoNowAndLater architecture requires **minimal new components** but **significant data model expansion**. The platform already has a foundation for access control (v1.3 private broadcasts with JWT playback tokens, GSI-indexed resource pool, fine-grained session permissions). Shareable links leverage existing JWT patterns; collections introduce a new DynamoDB entity type with index structures for user ownership and discoverability.

The architecture follows two orthogonal features:

1. **Shareable Links** — Time-limited, cryptographically signed URLs enabling viewers to access private sessions without account creation. Reuses the ES384 JWT playback token pattern from v1.3 (Phase 22), extending it with "public share tokens" that don't require session ownership.

2. **Collections** — User-owned playlists/folders organizing sessions (public or private). New DynamoDB entity with user ownership GSI, optional password protection, and per-collection privacy settings.

Both integrate cleanly with existing handlers, session model, and permission architecture. No refactoring required; surface-level extensions only.

---

## Recommended Architecture

### High-Level Data Flow

```
User creates shareable link         User creates collection
              |                                |
              v                                v
        Generate token               Create Collection entity
    (JWT with custom 'link_id'       (DynamoDB COLLECTION#)
     claim for tracking)                     |
              |                                v
              v                        Add sessions to collection
      Return short link URL                  (COLLECTION_SESSION#)
   (e.g., vnl.me/link/abc123)               |
              |                                v
              v                        Return collection URL
     Viewer clicks link               (e.g., /collections/xyz789)
              |                                v
              v                      Viewer sees all sessions
     Fetch playback token            (with owner's avatar/title)
    (validate exp, link_id)                  |
              |                                v
              v                      Click session → fetch token
  Play video if token valid          (reuse playback handler)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **ShareLink** (new domain model) | Token generation, expiration, tracking | Session (via link_id claim) |
| **Collection** (new domain model) | Ownership, visibility, membership | Sessions via COLLECTION_SESSION# records |
| **ShareLinkRepository** (new) | CRUD for share link metadata | DynamoDB sessions table |
| **CollectionRepository** (new) | CRUD for collections and memberships | DynamoDB sessions table |
| **create-share-link handler** (new) | Generate JWT token + return short URL | ShareLinkRepository, getSessionById |
| **get-collection handler** (new) | Fetch collection + sessions with auth | CollectionRepository, getRecentActivity |
| **add-to-collection handler** (new) | Add session to user's collection | CollectionRepository, getSessionById |
| **delete-share-link handler** (new) | Revoke token (append to revocation list) | ShareLinkRepository |
| **Existing playback handler** (modified) | Validate tokens from both sources | JWT parser (already integrated) |

---

## Recommended Architecture Patterns

### Pattern 1: Share Link as JWT with Custom Claims

**What:** Extend existing ES384 JWT playback token pattern (v1.3) with additional claims to distinguish share links from owner tokens.

**When:** Generating temporary access for viewers who don't own the session.

**Example:**
```typescript
// v1.3 pattern (owner playback token):
const ownerToken = jwt.sign(
  {
    iss: 'vnl',
    sub: sessionId,
    aud: channelArn,
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
    purpose: 'owner_playback'
  },
  privateKey,
  { algorithm: 'ES384' }
);

// v1.X new pattern (share link token):
const shareToken = jwt.sign(
  {
    iss: 'vnl',
    sub: sessionId,
    aud: channelArn,
    exp: Math.floor(Date.now() / 1000) + 604800, // 7 days default
    link_id: uuidv4(), // Track share link identity
    purpose: 'share_link',
    allowedViewers: 'any' // vs 'authenticated_users_only'
  },
  privateKey,
  { algorithm: 'ES384' }
);
```

**Rationale:**
- Reuses battle-tested ES384 signing already deployed in v1.3
- `link_id` claim enables revocation tracking without token invalidation
- `purpose` claim distinguishes token types for validation logic
- Extends token TTL to 7 days (vs 24h for owners) to avoid frequent regeneration
- Aligns with industry standard JWT claims (RFC 7519: `iss`, `sub`, `aud`, `exp`)

**Integration point:** Modify `generate-playback-token.ts` to accept optional `purpose` parameter; when `purpose='share_link'`, create SHARE_LINK# record with link_id.

---

### Pattern 2: Collection as Aggregated View with Membership Records

**What:** Collections stored as separate DynamoDB entities with per-session membership records, enabling efficient membership queries and cross-collection session sharing.

**When:** Organizing sessions into named groups with metadata (title, description, privacy).

**DynamoDB Key Structure:**
```
// Collection metadata:
PK: COLLECTION#{collectionId}
SK: METADATA
GSI1PK: OWNER#{userId}           // Query all collections by user
GSI1SK: createdAt                 // Sort by recency
Attributes: {
  title,
  description,
  isPrivate,
  password?,
  createdAt,
  updatedAt,
  version,
  sessionCount
}

// Collection membership:
PK: COLLECTION#{collectionId}
SK: SESSION#{sessionId}           // No separate table needed
Attributes: {
  sessionId,
  addedAt,
  addedByUserId
}

// Inverse index (optional, for "collections containing session"):
PK: SESSION#{sessionId}
SK: IN_COLLECTION#{collectionId}  // Track reverse relationships
Attributes: {
  collectionId,
  collectionTitle,
  collectionOwner
}
```

**Rationale:**
- Single-table design consistent with existing pattern (v1.0-v1.3)
- GSI1 enables efficient "all collections for user" queries with sort by recency
- Session membership records avoid JSON arrays (which don't scale well in DynamoDB)
- Optional reverse index enables "which collections contain this session?" queries for UI
- Supports multiple ownership models (user-owned, collaborative) without schema change

**Integration point:** Add GSI1 to session-stack CDK; update session-repository with new collection functions.

---

### Pattern 3: Short URLs with Backend Lookup

**What:** Generate short, sharable URLs (e.g., `vnl.me/link/abc123`) that redirect to actual playback token endpoint.

**When:** User creates a share link and wants a simple, copy-paste URL.

**Example:**
```typescript
// Flow:
1. User creates share link for session {sessionId}
2. Backend generates shareId = uuidv4().slice(0, 12)  // "abc123def456"
3. Store mapping: SHARE_LINK#{shareId} -> { sessionId, token, expiresAt, revoked }
4. Return short URL: https://vnl.me/link/abc123def456

// Frontend:
<iframe src="https://api.vnl.local/playback/link/abc123def456" />

// Backend endpoint GET /playback/link/{shareId}:
1. Look up shareId in DynamoDB
2. Validate token isn't revoked, exp not passed
3. Return token + HLS URL for embedding
```

**Rationale:**
- Avoids long, unreadable JWT strings in URLs
- Enables token revocation without invalidating URL
- Supports custom branding (vnl.me domain)
- SHARE_LINK# records are ephemeral (lifecycle can auto-delete after expiration)
- Lookup is O(1) DynamoDB query

**Integration point:** New endpoint GET /playback/link/{shareId}; new handler `get-playback-from-link.ts`.

---

### Pattern 4: Privacy Defaults with Owner Override

**What:** Collections default to private (owner-only visibility) unless explicitly published; sessions in collections inherit collection privacy unless overridden.

**When:** User adds sessions to a collection; collection is fetched by visitor.

**Validation logic:**
```
Can viewer access collection?
├─ If isPrivate=false -> visible to all
├─ If isPrivate=true:
│  ├─ Is viewer the owner? -> visible
│  ├─ Has password? -> prompt for password (optional)
│  └─ Otherwise -> 403 Forbidden
```

**Rationale:**
- Defaults to most restrictive (private), requiring explicit opt-in to share
- Matches YouTube "Private/Unlisted/Public" privacy model
- Optional password adds secondary auth layer for case-sensitive sharing (family, team)
- Consistent with v1.3 private session architecture

**Integration point:** No new components; enforce in `get-collection.ts` handler with privacy check before returning data.

---

## Data Flow Details

### Shareable Link Creation

```
POST /sessions/{sessionId}/share-link
Request: { expiresIn: 604800 (7 days), allowedViewers: 'any' }
Auth: Cognito token (owner verification)

Handler: create-share-link.ts
├─ Get session by ID (verify ownership)
├─ Generate ES384 JWT:
│  ├─ Standard claims: iss, sub, aud, exp, iat
│  ├─ Custom: link_id, purpose='share_link', allowedViewers
├─ Create SHARE_LINK# record in DynamoDB:
│  ├─ PK: SHARE_LINK#{shareId} (short 12-char UUID)
│  ├─ SK: METADATA
│  ├─ GSI1PK: SESSION#{sessionId}
│  ├─ Payload: token, expiresAt, createdBy=userId, revoked=false
├─ Return: { shortUrl: 'https://vnl.me/link/abc123', token, expiresAt }
```

**Integration point:** Modify API stack CDK to add POST /sessions/{sessionId}/share-link endpoint.

---

### Playback with Share Link Token

```
GET /playback/link/{shareId}
Auth: None (share link is public)

Handler: get-playback-from-link.ts
├─ Look up shareId in SHARE_LINK# record
├─ Validate:
│  ├─ Token not revoked
│  ├─ Token not expired
│  ├─ link_id claim matches stored record
├─ Fetch session by PK (from GSI1PK: SESSION#{sessionId})
├─ Return: { token, hlsUrl, recordingHlsUrl, session metadata }

Frontend: <iframe src="...playback/link/abc123def456" />
```

**Integration point:** New handler `get-playback-from-link.ts`; reuse IVS token validation from v1.3.

---

### Collection Creation & Membership

```
POST /collections
Request: { title, description, isPrivate, password? }
Auth: Cognito token (owner)

Handler: create-collection.ts
├─ Generate collectionId = uuidv4()
├─ Store COLLECTION#/METADATA with GSI1PK=OWNER#{userId}
├─ Return: { collectionId, url: '/collections/{collectionId}' }

---

POST /collections/{collectionId}/sessions
Request: { sessionId }
Auth: Cognito token (collection owner)

Handler: add-to-collection.ts
├─ Verify collection ownership
├─ Verify session exists
├─ Create COLLECTION#{collectionId}/SESSION#{sessionId} record
├─ Increment sessionCount on collection METADATA
├─ Return: { success, sessionCount }

---

GET /collections/{collectionId}
Auth: Cognito token (optional; needed if isPrivate=true)

Handler: get-collection.ts
├─ Fetch COLLECTION#/METADATA
├─ Verify privacy (owner-only if isPrivate=true)
├─ Query all SESSION# records in collection
├─ For each session: fetch full metadata via getRecentActivity
├─ Return: { collection, sessions: [{ ...Session }, ...] }
```

**Integration point:** Add three new API Gateway routes; CDK should wire handlers with TABLE_NAME environment variable.

---

## Integration Points with Existing Architecture

### Session Model (Minimal Change)

```typescript
// No changes needed to Session interface (domain/session.ts)
// Collections and share links reference sessions by ID only
// No circular dependencies

// However, optional enhancement for convenience:
// (Not required, but helpful for frontend)
export interface Session {
  // ... existing fields ...
  shareLinks?: Array<{ shareId, expiresAt }>  // Optional denorm
  collectionsContainingThis?: Array<{ collectionId, collectionTitle }>
}
```

**Rationale:** Denormalization optional; frontend can query Collections separately. Keeping Session lean reduces DynamoDB item size.

**Validation:** Zero breaking changes to existing Session interface. Backward compatible.

---

### Session Repository (New Functions Only)

**File:** `backend/src/repositories/session-repository.ts` (add to existing)

```typescript
// Share links
export async function createShareLink(
  tableName: string,
  sessionId: string,
  userId: string,
  token: string,
  expiresAt: number
): Promise<string>  // Returns shareId

export async function getShareLink(tableName: string, shareId: string): Promise<ShareLink | null>

export async function revokeShareLink(tableName: string, shareId: string): Promise<void>

export async function listShareLinksForSession(tableName: string, sessionId: string): Promise<ShareLink[]>

// Collections
export async function createCollection(
  tableName: string,
  userId: string,
  title: string,
  description: string,
  isPrivate: boolean,
  password?: string
): Promise<Collection>

export async function addSessionToCollection(
  tableName: string,
  collectionId: string,
  sessionId: string
): Promise<void>

export async function removeSessionFromCollection(
  tableName: string,
  collectionId: string,
  sessionId: string
): Promise<void>

export async function getCollection(tableName: string, collectionId: string): Promise<Collection | null>

export async function listCollectionsForUser(tableName: string, userId: string): Promise<Collection[]>

export async function getCollectionSessions(tableName: string, collectionId: string): Promise<Session[]>

export async function deleteCollection(tableName: string, collectionId: string): Promise<void>
```

**Rationale:** Separate functions for clarity; DynamoDB queries stay single-table. No refactoring to existing session-repository functions.

**Validation:** All functions use same DocumentClient pattern as v1.0-v1.3; no new dependencies.

---

### Handler Patterns (Reuse Existing)

**Authorization pattern (extend from create-session.ts):**
```typescript
const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
if (!userId) return 401;

// Applied to new handlers:
- POST /sessions/{sessionId}/share-link → verify userId === session.userId
- POST /collections → no verification needed (user owns their own collections)
- POST /collections/{collectionId}/sessions → verify userId === collection.userId
- GET /collections/{collectionId} → public if isPrivate=false, owner-only if isPrivate=true
```

**Token validation (extend playback handler):**
```typescript
// Already handles ES384 JWT validation (v1.3 generate-playback-token.ts)
// Add logic to check 'purpose' claim:
//   if purpose === 'share_link' -> validate link_id against SHARE_LINK# record
//   if purpose === 'owner_playback' -> validate ownership
```

**Rationale:** No handler refactoring; extend existing patterns. Minimal risk of breaking existing functionality.

**Validation:** All four new handlers follow lambda-nodejs pattern from v1.0-v1.3.

---

### GSI Strategy (Add GSI1 for Collections)

**Current GSIs (v1.0-v1.3):**
```
GSI1:
- GSI1PK: STATUS#{status}#[RESOURCE_TYPE]
- GSI1SK: createdAt
- Used for: resource pool queries, session status queries
```

**New GSI additions (add to session-stack CDK):**
```
GSI2:
- GSI2PK: OWNER#{userId}         // Query all collections by owner
- GSI2SK: createdAt              // Sort by recency
- Used for: "all collections owned by user", sorted by recent

No GSI3 needed; collection membership uses:
- PK: COLLECTION#{collectionId}
- SK: SESSION#{sessionId} (query by SK prefix)
```

**Rationale:** Keep indexes minimal; leverage composite SK for collection membership. Existing GSI1 untouched (no risk of performance regression).

**Cost impact:** +1 GSI (predictable write cost; minimal read cost since most queries are by user ownership).

**Validation:** Single-table design scales to millions of collections without hot partition issues (uniform distribution on OWNER#{userId}).

---

### Event Bridge Async Patterns

Share links and collections are **synchronous operations** (no async processing needed). Unlike recording transcription or media conversion, they don't trigger background jobs. All operations complete within Lambda execution time (< 1s typically).

**Exception:** Optional cleanup job to delete expired share links.
```typescript
// Eventbridge scheduler (daily cleanup):
export const expireShareLinkHandler = async () => {
  const tableName = process.env.TABLE_NAME!;
  const now = Math.floor(Date.now() / 1000);

  // Scan SHARE_LINK# records with expiresAt < now
  const expired = await scanExpiredShareLinks(tableName, now);

  // Delete in batches
  for (const link of expired) {
    await deleteShareLink(tableName, link.shareId);
  }
};
```

**Rationale:** Optional optimization; doesn't block sharing functionality. Keeping share links after expiration is safe (token validation still rejects expired tokens).

**Validation:** No impact on critical path; purely housekeeping.

---

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| **Share link creation rate** | <1 TPS (batch DynamoDB writes) | ~10 TPS (add batch operation) | ~100 TPS (partition key hash on shareId) |
| **Collection membership limit** | No hard limit (query by SK range) | ~5K sessions per collection (practical UI limit) | ~10K sessions (requires UI pagination) |
| **Owner's collection list query** | GSI2 query: O(1) + scan to count | GSI2 query: O(1) + scan to count | GSI2 query: O(1) + scan to count (or cache count in METADATA) |
| **Token validation latency** | DynamoDB: 10-50ms | DynamoDB: 50-200ms (cache layer recommended) | **Add in-memory token cache** (Redis or Lambda ephemeral) |

**Scaling recommendations:**

1. **Share link caching:** Cache valid tokens in Lambda memory or ElastiCache for 5-min TTL to reduce DynamoDB reads by 90%
2. **Collection pagination:** Enforce max 500 sessions per page in GET /collections/{id} to avoid large JSON payloads
3. **Ownership index:** GSI2 partition key is `OWNER#{userId}`; uniform distribution (no hot keys) since one user ≠ many collections
4. **Token validation optimization:** At 1M users, JWT signature validation alone costs ~50ms per request; add caching layer before DynamoDB lookup

**Implementation notes:**
- No special tuning needed for v1.0 scale (100-10K users); all O(1) queries
- Consider Redis ElastiCache only if token validation becomes bottleneck at 100K+ concurrent viewers
- Prefer Lambda@Edge for token caching near CloudFront edge (if adding CDN later)

---

## Comparison to Alternatives

### Alternative 1: Temporary Access URLs without Tokens

**Concept:** Generate URLs like `/sessions/{sessionId}?access_key=xyz` without JWT.

**Why not:**
- No expiration built-in (must track in DynamoDB)
- No cryptographic verification (vulnerable to tampering)
- Requires database lookup on every request (vs JWT validation offline)
- Doesn't scale as well; more I/O overhead

**Our choice:** JWT is industry standard, reuses v1.3 pattern, cryptographically sound.

---

### Alternative 2: Embed Collections in Session Model

**Concept:** Store collection membership directly in Session (array of collectionIds).

**Why not:**
- DynamoDB item size limit (400KB); doesn't scale
- No efficient "sessions in collection" queries
- Requires session update every time collection membership changes
- No atomic collection operations (what if collection deleted while adding session?)

**Our choice:** Separate COLLECTION# entities enable atomic operations + efficient queries.

---

### Alternative 3: Use S3 Object ACLs Instead of Custom Tokens

**Concept:** Store recordings in private S3 bucket, use IAM roles for access.

**Why not:**
- Users don't have AWS accounts (no IAM identity)
- S3 presigned URLs require AWS credentials to generate
- Complicates infrastructure (one S3 bucket per user?)
- Playback URLs change if bucket/key structure changes

**Our choice:** Custom JWT tokens decouple playback auth from AWS infrastructure; enables sharing without AWS account creation.

---

### Alternative 4: Collections as Graph Database (Neptune)

**Concept:** Use AWS Neptune for flexible collection relationships.

**Why not:**
- Additional operational burden (another service to manage)
- Neptune queries more expensive than DynamoDB single-table
- Doesn't scale better for this use case (collections are simple parent-child)
- Increases complexity without benefit

**Our choice:** Single-table DynamoDB design proven at scale (v1.0-v1.3 successfully used for all session/chat/reaction data).

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Storing Tokens in Session Record

**What:** Denormalizing token directly in Session.shareLink field.

**Why bad:**
- Session record becomes large (KB each, scales poorly)
- Token expiration requires scheduled updates
- No revocation mechanism short of full session update
- Version conflicts if updating token while recording

**Instead:** Store in separate SHARE_LINK# records, reference by link_id claim.

---

### Anti-Pattern 2: Collection Membership as JSON Array

**What:** Collections.sessionIds = [id1, id2, ...] stored in one item.

**Why bad:**
- DynamoDB 400KB item size limit
- No atomic add/remove operations
- Inefficient to query "is sessionX in collectionY?"
- Violates normalization (array as primary data)

**Instead:** Per-session membership records (COLLECTION#{id}/SESSION#{sessionId}).

---

### Anti-Pattern 3: Unvalidated Token from URL Params

**What:** Accepting token from query string without signature validation.

**Why bad:**
- Tokens can be modified in transit or cached incorrectly
- No non-repudiation (who generated the token?)
- Vulnerable to token forgery

**Instead:** Always verify ES384 signature; reject unsigned tokens.

---

### Anti-Pattern 4: No Revocation Mechanism

**What:** Share links with no way to disable them before expiration.

**Why bad:**
- User deletes session but link still works until exp
- Accidentally shared link can't be unshared
- Privacy violation

**Instead:** SHARE_LINK# record tracks `revoked` flag; check before validating token.

---

### Anti-Pattern 5: Cascading Deletes Without Careful Cleanup

**What:** Deleting a collection without cleaning up COLLECTION_SESSION# membership records.

**Why bad:**
- Orphaned records bloat table
- Inverse index (SESSION#/IN_COLLECTION#) points to non-existent collection
- Eventually slows scans

**Instead:** Delete collection → Query all SESSION# records → Delete each one → Then delete COLLECTION#/METADATA.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| **Initial link generation** | Confusing "owner playback token" vs "share link token" JWT claims | Add clear test suite distinguishing purpose claims; validate in handler before returning |
| **Collection creation UX** | Users create collections but don't understand privacy defaults | Default isPrivate=true; show warning when publishing "Public collections are visible to all users" |
| **Share link revocation** | Revoking link doesn't invalidate existing cached tokens | Document in handler: revocation only affects new playback requests; cached tokens valid until exp |
| **Mobile playback** | iOS IVS player may cache tokens; share link expiration unnoticed | Refresh token every 5min on mobile; handle 401 by fetching new token |
| **Collection membership edge cases** | User deletes session while it's in multiple collections | Cascade delete COLLECTION_SESSION records when session deleted; or soft-delete sessions (mark deleted, keep records) |
| **Rate limiting** | Malicious users spam create-share-link endpoint | Add rate limit per user (e.g., 100 links/hour); charge TTL cost against quota |
| **Permission escalation** | Attacker modifies JWT claims (e.g., link_id) | Always validate token signature; verify link_id against SHARE_LINK# record; reject mismatches |
| **Collection password storage** | Plain-text passwords in DynamoDB | Hash passwords with bcrypt before storage; validate on GET /collections endpoint |
| **Large collections** | Collection with 100K sessions; query hangs | Implement cursor-based pagination; max 500 sessions per page response |
| **Cross-user visibility** | Share link reveals session existence to unauthenticated users | Design is intentional; share links are meant to be public. Document in architecture that link reveals session exists. |

---

## Sources

- **JWT Standard:** RFC 7519 (IETF) — standard claims structure (iss, sub, aud, exp)
- **OneDrive API:** Microsoft Learn createLink documentation — scope/type model for sharing permissions
- **YouTube Playlists API:** Google Developers — collection data model with metadata + membership
- **S3 Presigned URLs:** AWS Documentation — temporary access patterns for cloud storage
- **Cloudinary Media Sharing:** Industry practice for signed URLs + delivery tokens
- **Existing v1.3 implementation:** IVS playback token generation (ES384) — proven pattern in production

---

## Summary: Build Order & Integration Points

**Minimal implementation path:**

1. **Shareable Links** = extend v1.3 playback token pattern + SHARE_LINK# DynamoDB records
2. **Collections** = new COLLECTION# entity + SESSION membership records + GSI2 for owner queries
3. **API handlers** = 4-6 new handlers (create-link, revoke-link, get-link-playback, create-collection, add-session, get-collection)
4. **No refactoring** = existing session-repository, handlers, auth patterns remain unchanged
5. **Safe to scale** = single-table design, GSI partitioning, token caching for performance

Both features integrate cleanly without disrupting v1.3 private broadcast foundation or existing session lifecycle.

**Phase dependencies:**
- v1.3 (private sessions + ES384 tokens) → **MUST complete first**
- v1.4 (stream quality + spotlight) → **independent; can run in parallel**
- Shareable links + Collections → **depends on v1.3; can start after v1.3 ships**

---

## Integration with Session Repository (Code-Level)

**New domain types to add (backend/src/domain/):**

```typescript
// backend/src/domain/share-link.ts
export interface ShareLink {
  shareId: string;
  sessionId: string;
  token: string;
  expiresAt: number;
  createdAt: string;
  createdBy: string;  // userId
  revoked: boolean;
  allowedViewers: 'any' | 'authenticated_users_only';
}

// backend/src/domain/collection.ts
export interface Collection {
  collectionId: string;
  userId: string;
  title: string;
  description?: string;
  isPrivate: boolean;
  password?: string;  // bcrypt hash
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  version: number;
}
```

**New repository functions (backend/src/repositories/session-repository.ts):**

```typescript
// Share links
export async function createShareLink(
  tableName: string,
  sessionId: string,
  userId: string,
  token: string,
  expiresAtUnix: number
): Promise<string> {
  const shareId = uuidv4().slice(0, 12);
  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SHARE_LINK#${shareId}`,
      SK: 'METADATA',
      GSI1PK: `SESSION#${sessionId}`,
      GSI1SK: expiresAtUnix,
      sessionId,
      token,
      expiresAt: expiresAtUnix,
      createdAt: new Date().toISOString(),
      createdBy: userId,
      revoked: false,
      allowedViewers: 'any',
    },
  }));
  return shareId;
}

// Collections
export async function createCollection(
  tableName: string,
  userId: string,
  title: string,
  description: string,
  isPrivate: boolean
): Promise<Collection> {
  const collectionId = uuidv4();
  const now = new Date().toISOString();
  const collection: Collection = {
    collectionId,
    userId,
    title,
    description,
    isPrivate,
    createdAt: now,
    updatedAt: now,
    sessionCount: 0,
    version: 1,
  };

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `COLLECTION#${collectionId}`,
      SK: 'METADATA',
      GSI2PK: `OWNER#${userId}`,
      GSI2SK: now,
      ...collection,
    },
  }));

  return collection;
}
```

**All new functions follow existing v1.0-v1.3 patterns:**
- Use DocumentClient from existing dynamodb-client
- Follow PK/SK/GSI naming convention
- Return typed objects matching domain models
- No breaking changes to existing functions

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **JWT token pattern** | HIGH | Proven in v1.3 (Phase 22); RFC 7519 standard |
| **DynamoDB single-table design** | HIGH | Existing architecture (v1.0-v1.3); tested at scale |
| **Handler authorization** | HIGH | Existing Cognito pattern; no new auth needed |
| **Collection membership queries** | MEDIUM-HIGH | GSI2 efficient for "user's collections"; SessionCount denorm helps scalability |
| **Share link revocation** | MEDIUM | Needs testing for concurrent create+revoke race conditions |
| **Collection privacy enforcement** | MEDIUM | Requires careful handler logic; recommend comprehensive test coverage |
| **Cross-component integration** | HIGH | Minimal surface area; no refactoring required |

---

## Next Steps (After Research Approval)

1. **Phase design:** Break into 2-3 phases (share links → collections → polish/testing)
2. **Handler implementation:** Start with create-share-link; test JWT flow thoroughly
3. **Repository functions:** Add to session-repository.ts; test DynamoDB patterns
4. **API Gateway wiring:** Update api-stack CDK with new endpoints
5. **Frontend integration:** Implement share link UI, collection management pages
6. **E2E testing:** Test privacy controls, token expiration, revocation workflows
