# Research Summary: Shareable Links & Collections (v1.3)

**Project:** VideoNowAndLater — Shareable Links & Collections Milestone
**Domain:** Session sharing and content organization for video streaming platform
**Researched:** 2026-03-05
**Confidence:** HIGH

## Executive Summary

Shareable links and collections represent a natural extension of v1.3's private session architecture, leveraging proven JWT token patterns already deployed in production. The research confirms that both features can be implemented with **minimal stack additions** (only bcrypt for optional password hashing) and **zero refactoring** to existing components—they extend via new DynamoDB entity types and API endpoints. The recommended approach prioritizes shareable links first (1-2 weeks), then collections (2-3 weeks), then polish and delete operations (1-2 weeks), following clear dependency chains in architecture.

The key risk is **security-first design discipline**: token claim tampering, collection privacy escalation, and permission bypass must be prevented through rigorous validation and testing. Research identifies 10 specific pitfalls with concrete prevention strategies. All pitfalls are avoidable through defensive coding patterns (permission checks on every write, signature validation on every token, cascading deletes) and comprehensive testing (security tests for tampering, concurrency tests for race conditions).

Operationally, the platform reuses single-table DynamoDB design, Lambda handlers, and Cognito auth; no new infrastructure components required. Stack is proven, scalable to 10K+ users without optimization, and requires only one new GSI for efficient collection queries.

## Key Findings

### Recommended Stack

From STACK.md: **No new dependencies beyond v1.3**. Core technologies already in place:

**Proven technologies (extend from v1.3):**
- **jsonwebtoken (^9.0.0)** — ES384 JWT signing; already used in v1.3 Phase 22; extend with `link_id` custom claim for share link tracking
- **AWS DynamoDB (managed)** — Single-table design; add SHARE_LINK# and COLLECTION# entity types; add GSI2 for owner-based collection queries
- **Lambda (Node.js 20.x)** — Existing runtime; new handlers for link/collection operations follow existing patterns
- **API Gateway (managed)** — Extend with 6 new endpoints (create-link, revoke-link, get-link-playback, create-collection, add-session, get-collection)

**Optional for Phase 3:**
- **bcrypt (^5.1.0)** — Hash collection passwords if optional password protection implemented; OWASP-compliant security practice

**Performance targets:** Share link creation <200ms, playback token fetch <100ms, collection queries <500ms. On-demand DynamoDB pricing sufficient; no pre-provisioned capacity needed.

### Expected Features

From FEATURES.md summary:

**Must have (table stakes) — MVP Phase 1-2:**
- Share session with time-limited link (7-day default expiration)
- No account required for viewers (link-based access)
- Organize sessions into named collections with privacy controls
- Revoke access to shared links (prevent indefinite sharing)
- View collection with all sessions inside

**Should have (differentiators) — MVP Phase 1-3:**
- Generate short, copy-paste share URLs (not long JWT strings)
- Display link expiration countdown on shared link
- Optional password protection on private collections
- Clear "Created by @owner" metadata on shared content
- Delete collections safely (cascading cleanup)

**Defer to v2+ (out of MVP scope):**
- Bulk collection sharing (single token for entire collection)
- Collaborative collections (multiple owners)
- Search/browse public collections
- Collection analytics (view counts)
- Embed collections via iframe

### Architecture Approach

From ARCHITECTURE.md: Integration strategy is **surface-level extension** of existing architecture. No refactoring required; two orthogonal new features built cleanly alongside v1.3 foundation.

**Share links** reuse ES384 JWT playback token pattern from v1.3. Extend with:
- Custom `link_id` claim for tracking/revocation
- `purpose` claim distinguishing share tokens from owner tokens
- 7-day default TTL (vs 24h for owners)
- SHARE_LINK# DynamoDB records storing token metadata + revoked flag

**Collections** introduce new entity type:
- COLLECTION# records for metadata (title, description, privacy, owner)
- SESSION# membership records (no JSON arrays; supports atomic operations)
- GSI2 index (OWNER#{userId}) for efficient "all user's collections" queries

**Major components added:**
1. ShareLink domain model + repository functions (CRUD)
2. Collection domain model + repository functions (CRUD + membership)
3. 6 new Lambda handlers (create-link, revoke-link, get-playback-from-link, create-collection, add-to-collection, get-collection)
4. GSI2 index on sessions table

**Integration:** No changes to Session model or existing handlers. Collections and share links reference sessions by ID only.

### Critical Pitfalls

From PITFALLS.md, ranked by severity:

1. **JWT Token Claim Tampering** — Attacker modifies `link_id` claim in captured JWT to access unintended sessions. **Prevention:** Always validate signature + verify link_id matches SHARE_LINK# record + check revoked flag.

2. **Collection Privacy Escalation** — Default `isPrivate=false` makes sensitive collections public without user awareness. **Prevention:** Default `isPrivate=true` (private by default); explicit confirmation dialog to publish; audit log privacy changes.

3. **Cascading Delete Orphans** — Deleting collection doesn't clean up COLLECTION_SESSION# membership records; orphaned records persist. **Prevention:** Transaction: query all memberships → delete each → delete metadata. Verify count before returning success.

4. **Race Condition in Revocation** — User revokes link while viewer fetches playback; timing race may allow revoked token to serve content. **Prevention:** Conditional writes + always read latest record state before serving.

5. **Permission Bypass on Modifications** — Missing owner check allows User B to modify User A's collection. **Prevention:** Owner check on every write endpoint (POST/DELETE); return 403 Forbidden if not owner.

## Implications for Roadmap

Based on research, recommended phase structure with clear dependencies:

### Phase 1: Shareable Links (1-2 weeks)
**Rationale:** Foundational feature extending proven v1.3 JWT pattern; no new complexity or dependencies. Must ship before collections (collections rely on stable session references).

**Delivers:**
- POST /sessions/{id}/share-link (create link with custom JWT)
- GET /playback/link/{shareId} (fetch playback from share link)
- DELETE /sessions/{id}/share-link/{shareId} (revoke link)
- Frontend: "Share" button, copy-to-clipboard UI, expiration countdown

**Addresses features:** Share session with time-limited link, No account required for viewers, Revoke access to shared links, Short copy-paste URLs

**Avoids pitfalls:** JWT claim tampering (comprehensive token validation tests), Race condition in revocation (conditional writes), Permission escalation (verify ownership)

### Phase 2: Collections Core (2-3 weeks)
**Rationale:** Depends on Phase 1 (share links work correctly first); introduces collection entity type with GSI2 index; requires careful permission checks.

**Delivers:**
- POST /collections (create collection, default private)
- POST /collections/{id}/sessions (add session to collection)
- GET /collections/{id} (fetch collection + all sessions with privacy check)
- GET /collections?userId=X (list user's collections, paginated)
- Frontend: Create collection modal, collection detail page, session list, add-to-collection UI

**Addresses features:** Organize sessions into named collections, Privacy control per collection, View who shared with you (owner metadata), Cursor-based pagination

**Avoids pitfalls:** Privacy escalation (default isPrivate=true + explicit confirmation), Permission bypass (owner check on every write), Large collections (pagination implemented)

### Phase 3: Collections Polish & Password Protection (1-2 weeks)
**Rationale:** Non-blocking features that depend on Phases 1-2 working correctly. Includes delete operations with cascading cleanup, optional password hashing.

**Delivers:**
- DELETE /collections/{id} (safe cascading delete with orphan prevention)
- PATCH /collections/{id} (update metadata)
- DELETE /collections/{id}/sessions/{sessionId} (remove session from collection)
- Optional password protection (bcrypt hashing)
- Frontend: Delete with confirmation, edit collection metadata, remove session from collection
- Comprehensive security testing suite

**Avoids pitfalls:** Cascading delete orphans (transaction delete + verification), Password plain-text storage (bcrypt hashing + code review)

### Phase Ordering Rationale

1. **Phase 1 before Phase 2:** Share links are simpler, foundational, and prove JWT/token patterns work correctly. Collections need stable sessions + proven token patterns.

2. **Phase 2 core before Phase 3 polish:** Phase 2 delivers core read/create operations; Phase 3 adds delete/update + optional features. Phased approach reduces risk.

3. **Pagination from Phase 1:** Large collection queries identified as pitfall; implementing early prevents v1 → v2 migration pain.

4. **Permission checks in every write:** Phases 2-3 must emphasize owner/privacy validation; consistent testing across all write endpoints.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Collections):** Permission model and privacy enforcement — recommend threat modeling session + comprehensive test plan before implementation starts. Identify edge cases (non-owner attempts modification, session deletion while in collections, etc.).

**Phases with standard patterns:**
- **Phase 1 (Shareable Links):** JWT token pattern proven in v1.3; ES384 signing well-documented. Standard implementation, no research needed.
- **Phase 3 (Password Protection):** Bcrypt hashing is OWASP standard; DynamoDB cascading deletes follow established patterns. Standard implementation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | All technologies already in v1.3 or standard (bcrypt). No unproven choices. Reuses existing patterns. |
| **Features** | HIGH | MVP clearly defined with must-have/should-have/defer. Dependencies explicit. Feature scope well-bounded. |
| **Architecture** | HIGH | Extends existing v1.3 without refactoring. DynamoDB design proven at scale. New entities follow single-table pattern. Component boundaries clear. |
| **Pitfalls** | MEDIUM-HIGH | 10 specific pitfalls identified with prevention strategies. 5 are critical (security); 3 are operational (scale/UX); 2 are minor (denormalization/naming). All preventable with discipline + testing. |

**Overall confidence:** HIGH — Research builds on established v1.3 foundation. No unproven technologies or untested patterns. Pitfalls well-understood and actionable.

### Gaps to Address

1. **Permission model edge cases** — Research identifies permission patterns but doesn't exhaustively enumerate all edge cases (e.g., session deletion cascading to collections, user deactivation). **Mitigation:** During Phase 2 planning, create detailed threat model + test matrix for non-owner scenarios.

2. **Token caching performance** — Research suggests token validation may become bottleneck at 100K+ concurrent users; recommends cache layer. **Mitigation:** MVP doesn't need caching (target 10K users); profile during phase execution; add Redis cache only if DynamoDB becomes bottleneck.

3. **Mobile playback token refresh** — Research notes iOS IVS player may cache tokens; share link expiration unnoticed. **Mitigation:** Phase 3 includes mobile testing; implement token refresh every 5min on mobile; handle 401 by fetching new token.

## Sources

### Primary (HIGH confidence)
- **v1.3 Phase 22 implementation** — ES384 JWT playback token generation; existing production pattern
- **DynamoDB single-table design** — v1.0-v1.3 proven; GSI patterns documented in existing infrastructure code
- **Cognito authorization** — Existing auth system; reused for new endpoints
- **RFC 7519 (IETF)** — JWT standard claims structure (iss, sub, aud, exp)

### Secondary (MEDIUM confidence)
- **YouTube Playlists** — Collection/sharing UX patterns
- **AWS DynamoDB best practices** — Cascading deletes, transaction patterns
- **OWASP Top 10** — Security pitfalls and prevention (auth, data exposure, race conditions)

### Tertiary (LOW confidence, requires validation)
- **Mobile token caching behavior** — iOS IVS player behavior; needs testing during phase execution

---

**Research completed:** 2026-03-05
**Status:** Ready for roadmap creation
**Next step:** Create requirements and phase plans based on research findings
