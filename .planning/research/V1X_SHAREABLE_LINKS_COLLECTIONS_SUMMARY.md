# Research Summary: Shareable Links & Collections

**Milestone:** Post-v1.4 (Shareable Links & Collections)
**Researched:** 2026-03-05
**Overall Confidence:** HIGH

---

## Executive Summary

Shareable links and collections are **low-risk, high-value additions** to the VideoNowAndLater platform that reuse existing architectural patterns from v1.3 (private sessions + JWT tokens) and extend single-table DynamoDB design. No refactoring required; all changes are additive.

**Key finding:** The platform already has all primitives needed:
- ES384 JWT token signing (v1.3 Phase 22)
- GSI-based querying for resource discovery
- Session authorization patterns via cognito:username
- Single-table DynamoDB with flexible SK patterns

Implementing shareable links requires **one new handler + one repository function set**. Implementing collections requires **three handlers + standard repository CRUD**. Both fit cleanly into existing architecture without touching session lifecycle.

---

## Key Findings

### Stack
- **Shareable Links:** Reuse ES384 JWT from v1.3; add SHARE_LINK# DynamoDB entity + short URL lookup
- **Collections:** New COLLECTION# entity + SESSION membership records (single-table pattern)
- **No new services needed:** Everything stays within Lambda, DynamoDB, API Gateway
- **Token pattern:** JWT with custom `link_id` + `purpose` claims for tracking and validation

### Architecture
- **Integration:** Minimal surface area; zero changes to existing Session model, handlers, or auth
- **New components:** ShareLinkRepository + CollectionRepository (pure data layer)
- **New handlers:** 4-6 Lambda functions (create-link, revoke-link, get-playback-from-link, create-collection, add-to-collection, get-collection)
- **Index additions:** Add GSI2 to session-stack CDK for `OWNER#{userId}` queries (enables efficient "all my collections" listing)

### Features
- **Shareable Links:** Time-limited URLs (default 7 days) with optional revocation; no account creation required
- **Collections:** Named playlists with privacy controls (private/public); optional password protection; cross-collection session sharing
- **MVP:** Share links + basic collection CRUD (add/remove sessions, list collections)
- **Future enhancements:** Collaborative collections, collection templates, nested collections

### Critical Pitfall
**Permission escalation via JWT tampering:** If `link_id` claim not validated against SHARE_LINK# record, attacker could forge tokens for arbitrary sessions. **Mitigation:** Always validate token signature + link_id claim before serving playback.

---

## Implications for Roadmap

### Phase Structure (Recommended)

**v1.X Phase 1: Shareable Links Foundation**
- Implement create-share-link handler (generates ES384 JWT + SHARE_LINK# record)
- Implement get-playback-from-link handler (validates token + serves playback)
- Add revoke-share-link handler (marks revoked flag)
- Wire GET /sessions/{id}/share-link, POST /sessions/{id}/share-link, DELETE /sessions/{id}/share-link endpoints
- **Delivers:** Users can share private sessions with time-limited links without account creation
- **Avoids pitfall:** Full JWT validation + link_id claim verification prevents token forgery
- **Risk:** LOW (reuses proven v1.3 JWT pattern; minimal new code)

**v1.X Phase 2: Collections Core**
- Implement create-collection, add-to-collection, get-collection handlers
- Add collection repository functions (createCollection, addSessionToCollection, getCollectionSessions)
- Add GSI2 to session-stack CDK for owner-based queries
- Wire POST /collections, POST /collections/{id}/sessions, GET /collections/{id} endpoints
- **Delivers:** Users can organize sessions into named groups with privacy controls
- **Avoids pitfall:** Default isPrivate=true + clear privacy UI prevents accidental public collections
- **Risk:** LOW (standard CRUD patterns; single-table design battle-tested in v1.0-v1.3)

**v1.X Phase 3: Collections Polish**
- Implement delete-collection, remove-from-collection, update-collection handlers
- Add list-collections-for-user handler
- Frontend: collection management UI, add-to-collection modal, collection browsing
- **Delivers:** Full collection lifecycle management
- **Risk:** MEDIUM (cascading deletes need careful testing; recommend comprehensive test suite)

### Build Order Rationale

1. **Shareable links first** — Standalone feature; delivers immediate value (share private sessions instantly)
2. **Collections next** — Builds on existing session model; enables organizing multiple sessions
3. **Polish last** — Full lifecycle (delete/update) can iterate after core functionality ships

**Phase dependencies:**
- Requires v1.3 complete (ES384 tokens already deployed)
- Independent from v1.4 (stream quality + spotlight)
- Can ship v1.X in parallel with v1.4 if team splits work

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| **Share link JWT pattern** | HIGH | Identical to v1.3 Phase 22 (already in production); RFC 7519 standard |
| **Single-table DynamoDB design** | HIGH | Proven at scale in v1.0-v1.3 (chat, reactions, sessions all use pattern) |
| **Handler authorization** | HIGH | Reuses existing cognito:username extraction; no new auth complexity |
| **GSI2 for collections** | HIGH | Standard DynamoDB pattern; no special tuning needed at 10K user scale |
| **Collection privacy logic** | MEDIUM-HIGH | Straightforward boolean checks; needs test coverage for edge cases |
| **Token revocation** | MEDIUM | Race condition possible if user revokes link while viewer fetching token; requires careful test |
| **Cascading deletes** | MEDIUM | Deleting collection must clean up all SESSION# records; needs comprehensive testing |
| **Cross-component integration** | HIGH | Minimal surface area; new code isolated to repositories + handlers |

---

## Research Flags for Phases

**Phase 1 (Share Links):**
- ✓ Standard: JWT signature validation (proven in v1.3)
- ✓ Standard: Short URL generation via DynamoDB lookup
- ⚠️ Needs testing: Concurrent token revocation (race condition: revoke vs fetch)

**Phase 2 (Collections):**
- ✓ Standard: CRUD operations (well-documented DynamoDB patterns)
- ✓ Standard: GSI2 querying (identical to existing GSI1 pattern)
- ⚠️ Needs testing: Collection membership scalability (max sessions per collection before UI/query slowdown)
- ⚠️ Needs testing: Permission checks (ensure non-owner can't modify)

**Phase 3 (Polish):**
- ⚠️ Critical: Cascading deletes (must clean up all membership records)
- ⚠️ Needs testing: Password-protected collection access (hash validation, timing attack prevention)

---

## Technology Decisions

| Decision | Rationale |
|----------|-----------|
| **JWT tokens with custom claims** | Reuses v1.3 ES384 signing; cryptographically sound; no additional infrastructure |
| **SHARE_LINK# separate entity** | Enables revocation tracking; avoids denormalizing tokens into Session (which bloats item size) |
| **Collections as COLLECTION# entity** | Single-table design consistent with existing pattern; enables atomic operations |
| **SESSION# membership records (not JSON array)** | Scales to 100K+ sessions per collection; DynamoDB item size limit doesn't apply |
| **GSI2 for owner queries** | O(1) lookup for "all my collections"; sort by createdAt enables efficient pagination |
| **Default isPrivate=true** | Privacy-first default; matches industry best practice; prevents accidental public sharing |

---

## Out of Scope (Future Iterations)

- Collaborative collections (shared ownership)
- Collection sharing (share entire collection with link)
- Nested collections
- Collection analytics (view counts per session)
- Collection recommendation/discovery
- Expiring collections (auto-delete after X days)
- Collection templates
- Bulk operations (add 100 sessions at once)

---

## Next Steps (Roadmap Integration)

1. **Finalize phase breakdown** — Split into 2-3 phases; assign story points
2. **Handler specifications** — Write detailed handler plans (input/output, error cases)
3. **Repository specifications** — DynamoDB key structure, query patterns, indexes
4. **Test plan** — Unit tests, integration tests, permission tests, edge case tests
5. **API contracts** — OpenAPI specs for frontend integration
6. **Frontend design** — Share link UI, collection management pages, collection browsing

---

## Validation Checklist

- [x] All domains investigated (stack, features, architecture, pitfalls)
- [x] Negative claims verified (e.g., "no new AWS services needed" checked against project memory)
- [x] Multiple sources for critical claims (JWT pattern from RFC + v1.3 impl, DynamoDB from existing code)
- [x] URLs provided for authoritative sources (RFC 7519, OneDrive API, YouTube API)
- [x] Publication dates checked (RFC 7519 mature standard; v1.3 recently shipped)
- [x] Confidence levels assigned honestly (HIGH for proven patterns, MEDIUM for new patterns needing testing)
- [x] "What might I have missed?" review:
  - Have we considered mobile playback edge cases? ✓ (noted in anti-patterns)
  - Are there auth edge cases? ✓ (JWT tampering, permission escalation covered)
  - What about large-scale collections? ✓ (scalability section addresses 1M users)
  - Any compliance concerns (privacy, data retention)? Not for MVP (future iterations)
