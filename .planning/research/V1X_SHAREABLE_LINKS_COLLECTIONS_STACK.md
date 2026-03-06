# Technology Stack: Shareable Links & Collections

**Milestone:** Post-v1.4 (Shareable Links & Collections)
**Researched:** 2026-03-05

---

## Recommended Stack

### Core Authentication & Tokens

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **jsonwebtoken (npm)** | ^9.0.0 | ES384 JWT signing for share links | Proven in v1.3 Phase 22; RFC 7519 compliant; no breaking changes |
| **AWS KMS** | (managed) | Store playback private key | Centralized secrets management; rotate keys without redeploying |
| **Cognito** | (managed) | User authentication | Existing; no changes needed |

### Data Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **DynamoDB** | (managed) | Store SHARE_LINK# and COLLECTION# records | Existing single-table design; extends cleanly |
| **DynamoDB GSI2** | (new) | `OWNER#{userId}` index for collection queries | Standard GSI pattern; enables O(1) owner lookups |
| **No new databases** | — | Resist urge to add specialized DB | Single-table keeps operational burden low |

### API Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **API Gateway** | (managed) | REST endpoints for share links + collections | Existing; no changes needed |
| **Lambda (Node.js 20.x)** | 20.x | Handler functions | Existing runtime; no upgrade needed |
| **CDK** | ^2.80.0 | Infrastructure as code | Existing; update stacks for new endpoints |

### Utilities

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **uuid** | ^9.0.0 | Generate collectionId, shareId | Deterministic IDs; collision-resistant |
| **bcrypt** | ^5.1.0 | Hash collection passwords (optional Phase 3) | Industry standard; slow-by-design prevents brute force |
| **aws-sdk/lib-dynamodb** | ^3.400+ | DynamoDB client (already in use) | No new dependency; same as v1.0-v1.3 |

---

## Alternatives Considered

### Alternative 1: Use Redis for Token Caching

| Aspect | Redis | Our Choice (In-Memory Cache) |
|--------|-------|------------------------------|
| **Cost** | $20-100/month (ElastiCache) | Free (Lambda ephemeral) |
| **Latency** | 1-5ms Redis lookup + network | Instant (in-process) |
| **When needed** | 100K+ concurrent playbacks/sec | Not needed for MVP (aim for 10K) |
| **Operational burden** | Manage Redis cluster, monitoring, failover | None |
| **Why not** | Overkill for MVP; adds operational overhead | Sufficient for scale target |

**Decision:** Use Lambda ephemeral storage + local in-memory cache for token validation. Upgrade to Redis only if profiling shows token lookups as bottleneck.

---

### Alternative 2: Use GraphQL Instead of REST

| Aspect | GraphQL | REST (Our Choice) |
|--------|---------|-------------------|
| **Query flexibility** | Powerful for nested queries | Simple one-resource-per-endpoint |
| **Learning curve** | Steeper for team | Familiar REST patterns |
| **Caching** | Complex (query-specific) | Simple (endpoint-based) |
| **Why not** | Added complexity without benefit for simple CRUD | Collections are flat; no deep nesting needs |

**Decision:** Stick with REST (existing pattern in v1.0-v1.3).

---

### Alternative 3: Store Passwords in Plaintext

| Aspect | Plaintext | Bcrypt (Our Choice) |
|--------|-----------|---------------------|
| **Speed** | Instant comparison | ~100ms bcrypt hash+compare |
| **Security** | None (major risk) | Industry standard, slow-by-design |
| **When OK** | Never | Always hash passwords |
| **Why not** | OWASP #2 (broken auth); compliance violation | Must do this right |

**Decision:** Always hash with bcrypt before storing. No shortcuts.

---

### Alternative 4: Use DynamoDB TTL Instead of Manual Cleanup

| Aspect | TTL | Manual Cleanup (Our Choice) |
|--------|-----|------------------------------|
| **How** | Set `ttl` attribute; DynamoDB auto-deletes | Scheduled Lambda job cleans expired |
| **Latency** | 24-48 hours before deletion | Immediate (on-demand) |
| **Cost** | Write TTL attribute (~1KB) | Lambda cost for cleanup job |
| **Why not** | Unpredictable deletion timing; not suitable for share link revocation | Cleaner to revoke on-demand |

**Decision:** For MVP, don't implement cleanup (expired links still work until `exp` verified). Optional cleanup job in Phase 2 optimization.

---

### Alternative 5: Use S3 Pre-Signed URLs Instead of Custom Tokens

| Aspect | S3 Pre-Signed | Custom JWT (Our Choice) |
|--------|---------------|------------------------|
| **Generation** | Requires AWS SDK + credentials | Pure JWT; no AWS calls |
| **Expiration** | Built-in (max 7 days) | Custom exp claim |
| **Revocation** | Not possible (max 7 days) | link_id tracking enables revocation |
| **User identity** | Tied to AWS credentials | Tied to `link_id` claim |
| **Why not** | Couples playback auth to AWS infrastructure; users don't have AWS accounts | Custom JWT decouples auth from AWS; simpler for sharing |

**Decision:** Custom JWT tokens (already used in v1.3).

---

## Installation & Setup

### Backend Dependencies

```bash
# Core (already installed in v1.0-v1.3)
npm install aws-sdk @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

# New for Phase 1-2
npm install jsonwebtoken uuid

# New for Phase 3 (if password-protected collections)
npm install bcrypt

# Dev
npm install -D @types/node jest ts-jest
```

### CDK Infrastructure Updates

```typescript
// infra/lib/stacks/session-stack.ts (existing)
// Add new GSI2 to sessions table:

const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
  // ... existing config ...
  globalSecondaryIndexes: [
    // ... existing GSI1 ...
    {
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    },
  ],
});
```

### API Gateway Endpoints (CDK)

```typescript
// infra/lib/stacks/api-stack.ts (existing)
// Add new routes:

// Share links
const shareLinksResource = sessionIdResource.addResource('share-link');
shareLinksResource.addMethod('POST', new apigateway.LambdaIntegration(createShareLinkHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
shareLinksResource.addMethod('DELETE', new apigateway.LambdaIntegration(revokeShareLinkHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});

// Collections
const collectionsResource = api.root.addResource('collections');
collectionsResource.addMethod('POST', new apigateway.LambdaIntegration(createCollectionHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});

const collectionIdResource = collectionsResource.addResource('{collectionId}');
collectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(getCollectionHandler)); // No auth
collectionIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteCollectionHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});

// Playback from share link (no auth)
const playbackResource = api.root.addResource('playback');
const linkResource = playbackResource.addResource('link');
const shareLinkIdResource = linkResource.addResource('{shareId}');
shareLinkIdResource.addMethod('GET', new apigateway.LambdaIntegration(getPlaybackFromLinkHandler));
```

---

## Environment Variables (Handler Configuration)

### Lambda Handler Env Vars

```typescript
// All handlers get TABLE_NAME from CDK:
export interface ApiStackProps extends StackProps {
  sessionsTable: dynamodb.ITable;
  // ...
}

// New handlers:
const createShareLinkHandler = new NodejsFunction(this, 'CreateShareLinkHandler', {
  environment: {
    TABLE_NAME: props.sessionsTable.tableName,
    IVS_PLAYBACK_PRIVATE_KEY: process.env.IVS_PLAYBACK_PRIVATE_KEY!, // From v1.3
  },
  // ...
});

const getCollectionHandler = new NodejsFunction(this, 'GetCollectionHandler', {
  environment: {
    TABLE_NAME: props.sessionsTable.tableName,
  },
  // ...
});
```

### Secrets Management

- **IVS Playback Private Key** — Stored in AWS Secrets Manager (already done in v1.3)
- **No new secrets needed** for MVP (password hashing uses bcrypt, not stored secrets)

---

## Testing Stack

### Unit Tests

```bash
# Run all handler tests
cd backend && npm test

# Test coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Integration Tests

```bash
# Create test collection + sessions
npm run cli -- seed-collection --userId user1 --sessions 10

# Test playback endpoint
curl -X GET "http://localhost:3000/playback/link/abc123"

# Test collection fetch
curl -X GET "http://localhost:3000/collections/col123"
```

### E2E Tests (Frontend + Backend)

```bash
# Run Cypress tests for collection UI
npm run cypress

# Test flow: create collection → add session → share link → view via link
```

---

## Performance Characteristics

### Latency Targets

| Operation | Target | Reasoning |
|-----------|--------|-----------|
| POST /share-link | < 200ms | JWT signing + DB write |
| GET /playback/link/{id} | < 100ms | DB read + JWT validation |
| GET /collections/{id} | < 500ms | Collection + up to 500 sessions fetch |
| POST /collections | < 100ms | DB write only |
| POST /collections/{id}/sessions | < 200ms | Permission check + DB write |

### DynamoDB Capacity

For MVP (assume 1K-10K users):

```
Share links:
- Writes: ~10 links/day/user × 5K users = ~50 links/day ≈ 0.0006 TPS
- Reads: ~100 playbacks/link × 0.0006 TPS ≈ 0.06 TPS

Collections:
- Writes: ~2 collections/user × 5K users ÷ 30 days ≈ 0.01 TPS
- Reads: ~10 collection views/user × 5K users ÷ 30 days ≈ 0.02 TPS

On-demand DynamoDB pricing sufficient (scales automatically)
```

### DynamoDB Item Size

| Record Type | Typical Size | Max Size | Note |
|-------------|--------------|----------|------|
| SHARE_LINK# | ~500 bytes | 1 KB | JWT token is ~300 bytes |
| COLLECTION# METADATA | ~300 bytes | 500 bytes | title + description + metadata |
| COLLECTION# SESSION# | ~200 bytes | 300 bytes | Just sessionId + timestamp |

---

## Monitoring & Observability

### CloudWatch Metrics (Built-in)

```
Lambda:
- Invocations
- Duration
- Errors
- Throttles

DynamoDB:
- ConsumedReadCapacityUnits
- ConsumedWriteCapacityUnits
- SuccessfulRequestLatency
- UserErrors
```

### Custom Metrics (Add via CloudWatch SDK)

```typescript
// Log share link generation
console.log('Share link created', { shareId, sessionId, expiresAt });

// Log permission errors
console.error('Permission denied', { userId, collectionId, action: 'add_session' });

// Log JWT validation failures
console.warn('JWT validation failed', { reason: 'expired' | 'invalid_signature' | 'link_id_mismatch' });
```

### Alarms

```
- ShareLink validation failures > 10 per hour → Alert (possible attack)
- Collection queries > 5s latency → Alert (scaling issue)
- DynamoDB throttling → Alert (exceed provisioned capacity)
- JWT errors > 1% of requests → Alert (key rotation issue)
```

---

## Version Compatibility

### Breaking Changes (None)

- All changes additive (no modification to existing Session interface)
- Existing handlers unaffected
- Existing tests continue to pass

### Backward Compatibility

```typescript
// v1.3 playback endpoint still works
GET /sessions/{id}/playback → Returns owner-only token (existing behavior)

// v1.X adds new endpoint
GET /playback/link/{shareId} → Returns share link token (new behavior)

// Both endpoints coexist; no migration needed
```

---

## Deployment Strategy

### Phase 1 (Share Links)

```bash
# 1. Update CDK with new handlers + endpoints
cdk deploy

# 2. Run tests
npm test

# 3. Deploy to staging
npm run deploy:staging

# 4. Manual testing
# - Create share link
# - Fetch playback from link
# - Revoke link
# - Verify expired link fails

# 5. Deploy to production
npm run deploy:prod
```

### Phase 2 (Collections)

```bash
# Repeat Phase 1 flow for collection endpoints
# No data migration needed (no changes to existing records)
```

### Phase 3 (Polish)

```bash
# Add delete + update endpoints; no breaking changes
```

---

## Rollback Plan

If critical issue found:

```bash
# 1. Identify which handler is broken
cdk destroy --stack <handler-stack> # Or revert Lambda code

# 2. Existing functionality unaffected (new endpoints isolated)
# - Share link creation halted, but existing links still work
# - Collection operations halted, but existing collections still exist

# 3. Redeploy fixed handler
cdk deploy --stack <handler-stack>

# No data loss (all read-only from DynamoDB's perspective)
```

---

## Security Considerations

### Encryption in Transit

- All API calls over HTTPS (API Gateway enforced)
- DynamoDB uses AWS-managed encryption at rest

### Encryption at Rest

- DynamoDB tables encrypted with AWS managed keys (default)
- Optional: bring your own key (KMS) for enhanced control

### Secrets

- IVS playback private key in Secrets Manager (v1.3 pattern)
- Collection passwords hashed with bcrypt (never plain-text)

### Rate Limiting

Consider adding:
```typescript
// On API Gateway layer:
// - Max 100 share links created per user per hour
// - Max 10 collections created per user per hour
// (Prevents abuse/spam)
```

---

## Cost Estimate (First Year)

| Service | Metric | Est. Cost |
|---------|--------|-----------|
| **DynamoDB** | 10 GB storage + 1 GSI | ~$25/month |
| **Lambda** | 100M invocations × 128 MB | ~$20/month |
| **API Gateway** | 100M requests | ~$35/month |
| **CloudWatch** | Logs + metrics | ~$10/month |
| **Total** | Monthly estimate | ~$90/month |

(Scales linearly; at 10K users, still ~$200/month)

---

## Summary

**No new dependencies beyond what v1.3 already uses.** All technology choices reuse existing patterns (JWT, DynamoDB, Lambda). Single addition is bcrypt for Phase 3 (password hashing). Stack is proven, scalable, and low-operational-overhead.
