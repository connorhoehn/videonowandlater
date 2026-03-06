# Domain Pitfalls: Shareable Links & Collections

**Milestone:** Post-v1.4 (Shareable Links & Collections)
**Researched:** 2026-03-05
**Confidence:** MEDIUM-HIGH

---

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: JWT Token Claim Tampering

**What goes wrong:** Attacker modifies `link_id` claim in share link JWT, gaining access to arbitrary sessions. Example: Attacker captures share link for Session A, modifies JWT to reference Session B, plays back Session B without authorization.

**Why it happens:** Developers focus on signature validation (correct) but forget to validate that `link_id` claim matches the SHARE_LINK# record in DynamoDB. If validation skipped, any valid signature is accepted.

**Consequences:**
- Privacy violation: users can access sessions they shouldn't
- Data leakage: sensitive recordings exposed
- Trust erosion: sharing feature becomes security liability

**Prevention:**
1. **Always validate token signature** — `jwt.verify()` with public key
2. **Extract link_id from token** — Read custom claim
3. **Look up SHARE_LINK# record by link_id** — Query DynamoDB with exact match
4. **Verify link not revoked** — Check `revoked` flag = false
5. **Verify expiration** — Check `exp` claim < now
6. **Only then serve playback** — Return HLS URL

**Detection:** Log every claim mismatch as SECURITY_EVENT; alert ops if > 10 mismatches in 1 hour.

**Test case:**
```typescript
// Test: Attacker modifies link_id in captured JWT
const validToken = captureValidShareLinkToken(); // From real share link
const tamperedToken = modifyJWTClaim(validToken, 'link_id', uuidv4()); // Change link_id
const response = await GET `/playback/link/${validToken.payload.link_id}`
  with Authorization: tamperedToken;
// Expected: 403 Forbidden (token signature valid, but link_id doesn't match record)
// Actual: Should fail, not 200 OK
```

---

### Pitfall 2: Collection Privacy Escalation via Default

**What goes wrong:** User creates collection intending it to be private, but frontend defaults to `isPrivate=false` (public). Collection contains sensitive recordings (family videos, internal training) suddenly visible to entire internet.

**Why it happens:** Developer sets `isPrivate=false` as default for simplicity (fewer special cases). Frontend UX doesn't emphasize privacy impact. User doesn't carefully check checkbox.

**Consequences:**
- Privacy violation: sensitive content exposed
- User distrust: "Why was my private collection public?"
- Potential legal/compliance issues: user data exposed

**Prevention:**
1. **Default `isPrivate=true`** — Must-have for security-first design
2. **Clear UI warning** — "This collection is PRIVATE (visible to you only). Change to public?" with explicit checkbox
3. **Confirmation dialog** — "Are you sure you want to make this collection public? It will be visible to anyone with the link."
4. **Audit log** — Track privacy changes; log who made change + when

**Detection:** Monitor privacy changes; alert if user changes multiple collections to public in short time.

**Test case:**
```typescript
// Test: Verify default privacy is private
const collection = await POST /collections { title: 'My Videos' };
// Expected: collection.isPrivate = true
// Actual: Should not return false
```

---

### Pitfall 3: Cascading Delete Without Cleanup

**What goes wrong:** Admin/user deletes collection; orphaned COLLECTION_SESSION# records remain in DynamoDB. Later, if inverse index (SESSION#/IN_COLLECTION#) exists, those records point to non-existent collection. Queries become fragile; eventual data corruption.

**Why it happens:** Developer implements delete-collection handler but forgets to query + delete all membership records. DynamoDB doesn't enforce referential integrity (unlike SQL); orphaned records silently persist.

**Consequences:**
- Data bloat: orphaned records waste storage
- Query slowdown: scans include orphaned records
- Bugs in future features: queries assume consistency
- Technical debt: hard to debug after-the-fact

**Prevention:**
1. **Delete transaction** — Use conditional write or transaction to delete collection + all memberships atomically
2. **Query all membership records first** — `Query PK=COLLECTION#{id}, SK begins_with SESSION#`
3. **Delete each membership record** — Batch delete (up to 25 items per batch)
4. **Delete collection METADATA** — After all memberships deleted
5. **Verify count** — Confirm all expected records deleted before returning success

**Detection:** Weekly audit job; query for COLLECTION# records with orphaned SESSION# records; alert if > 10 found.

**Test case:**
```typescript
// Test: Deleting collection cleans up all memberships
const collectionId = await createCollection();
await addSessionToCollection(collectionId, session1);
await addSessionToCollection(collectionId, session2);
await deleteCollection(collectionId);

const orphaned = await queryOrphanedMemberships(collectionId);
// Expected: orphaned.length = 0
// Actual: Should not find any COLLECTION_SESSION# records
```

---

### Pitfall 4: Race Condition in Token Revocation

**What goes wrong:** User clicks "revoke link"; backend sets `revoked=true` on SHARE_LINK# record. At same instant, viewer clicks shared link → handler fetches playback. There's a race: does handler see revoked=true before or after the update?

**Why it happens:** DynamoDB is eventually consistent (sort of); updates don't propagate instantly to all readers. Two concurrent requests hit different partition keys or read before write completes.

**Consequences:**
- Revocation fails silently: revoked link still works for viewers already holding token
- User expectation mismatch: thinks link is disabled but it isn't
- Privacy violation: leaked data continues accessible for minutes/hours

**Prevention:**
1. **Use conditional writes** — Write revoked=true only if current revoked=false; fail if already revoked
2. **Check revoked flag before serving playback** — Always read latest record state
3. **Add version number** — Track record version; reject stale requests
4. **Short-lived tokens** — Even revoked link token expires quickly (default 7 days); limits exposure window
5. **Cache invalidation** — If caching tokens, clear cache on revoke

**Detection:** Log revocation events + playback attempts; correlate timestamps; alert if playback after revocation.

**Test case:**
```typescript
// Test: Concurrent revoke + playback request
const shareId = await createShareLink();
const promises = [
  revokeShareLink(shareId),  // Request 1: revoke
  getPlaybackFromLink(shareId) // Request 2: fetch playback (concurrent)
];
const [revokeResult, playbackResult] = await Promise.allSettled(promises);
// Expected: one succeeds, one fails (or playback gets stale view)
// Actual: Should not both succeed with valid token
```

---

### Pitfall 5: Collection Permission Bypass via Missing Owner Check

**What goes wrong:** User A creates collection. User B discovers collection ID (via URL sniffing or enumeration). User B calls POST /collections/{id}/sessions to add session to User A's collection. Permission check missing → User B modifies User A's collection.

**Why it happens:** Developer implements happy path (user modifies own collection) but forgets to verify `userId` matches collection owner before allowing add/remove operations.

**Consequences:**
- Permission escalation: users modify others' collections
- Data integrity: wrong sessions added to collections
- User distrust: collections sabotaged by other users

**Prevention:**
1. **Owner check on every write** — Verify `userId === collection.userId` before any update
2. **Return 403 if not owner** — Don't return 404 (leaks collection existence); return 403 Forbidden
4. **Audit log** — Log who attempted to modify collection + timestamp
5. **Unit tests** — Every write endpoint tested with both owner + non-owner

**Detection:** Monitor 403 errors on collection modification endpoints; alert if > 10% of requests return 403 (indicates misuse).

**Test case:**
```typescript
// Test: Non-owner can't modify collection
const collection = await createCollection(user1Id, 'My Collection');
const attemptByUser2 = await POST `/collections/${collection.id}/sessions`
  with userId: user2Id;
// Expected: 403 Forbidden
// Actual: Should not succeed with 200 OK
```

---

## Moderate Pitfalls

### Pitfall 6: Large Collection Pagination Not Implemented

**What goes wrong:** Collection with 100K sessions; GET /collections/{id} returns entire session list in JSON response. Response size > 50MB; browser crashes; Lambda times out.

**Why it happens:** Developer doesn't implement pagination initially ("premature optimization"). Works fine with small test collections (10 sessions). Breaks at scale when user adds thousands of sessions.

**Consequences:**
- Service unavailable: collection detail page fails to load
- Memory exhaustion: Lambda + browser run out of memory
- Network slowness: 50MB response takes minutes to download
- Poor UX: users can't access their own large collections

**Prevention:**
1. **Implement cursor-based pagination from start** — Even if MVP has few sessions
2. **Limit max items per page** — 500 sessions max per response
3. **Include next_cursor in response** — Client uses cursor to fetch next page
4. **Test with large collections** — Create collection with 10K sessions during testing

**Detection:** Monitor response sizes; alert if > 10MB response. Monitor query latency; alert if > 5s.

**Test case:**
```typescript
// Test: Pagination works with large collection
const collection = await createCollection();
for (let i = 0; i < 5000; i++) {
  await addSessionToCollection(collection.id, `session-${i}`);
}
const page1 = await GET `/collections/${collection.id}?limit=500`;
// Expected: page1.sessions.length = 500, page1.next_cursor set
// Actual: Should not return all 5000 in one response
```

---

### Pitfall 7: Password Hash Storage

**What goes wrong:** Developer stores collection password as plain text in DynamoDB. If database is breached, all passwords exposed. Even worse, passwords visible in logs/CloudWatch.

**Why it happens:** Developer skips hashing for simplicity ("it's just a password field"). Assumes database is secure (often true, but defense-in-depth principle says hash anyway).

**Consequences:**
- Security breach: passwords compromised
- Compliance violation: OWASP #02 (broken authentication)
- User distrust: collection passwords exposed in breach

**Prevention:**
1. **Never store plain-text passwords** — Always hash before storage
2. **Use bcrypt** — `npm install bcrypt`; hash with cost factor 12
3. **Never log passwords** — Don't log request body or responses containing passwords
4. **Validate on access** — Hash user input; compare hash vs stored hash

**Detection:** Code review; require security sign-off before password feature ships. Database audit; scan for plain-text patterns.

**Test case:**
```typescript
// Test: Password stored as hash, not plain text
const collection = await createCollection({ password: 'secret123' });
const stored = await queryDynamoDB(collection.id);
// Expected: stored.password = '$2b$12$...' (bcrypt hash)
// Actual: Should not contain 'secret123'
```

---

### Pitfall 8: Race Condition: Add Session + Delete Session Concurrently

**What goes wrong:** User A adds Session X to Collection Y at the same time Session X is being deleted. Collection ends up with reference to non-existent session. Frontend displays broken link.

**Why it happens:** No transactional lock between add-to-collection and delete-session operations. DynamoDB doesn't prevent this without careful condition expressions.

**Consequences:**
- Broken links: collection contains deleted sessions
- User confusion: "Why is this session gone?"
- Data inconsistency: inverse index (SESSION#/IN_COLLECTION#) points to nothing

**Prevention:**
1. **Add condition check in add-to-collection** — Verify session exists + is not marked for deletion
2. **Add condition check in delete-session** — Verify session not referenced in any collections (or soft-delete instead)
3. **Use conditional writes** — Both operations must check preconditions
4. **Soft delete sessions** — Mark deleted but keep records; clean up later

**Detection:** Monitor collection queries that return broken links; alert if > 1% of sessions missing.

**Test case:**
```typescript
// Test: Concurrent add + delete doesn't create broken link
const sessionId = await createSession();
const collectionId = await createCollection();
const promises = [
  addSessionToCollection(collectionId, sessionId),
  deleteSession(sessionId)
];
await Promise.allSettled(promises);

const collection = await getCollection(collectionId);
// Expected: collection.sessions contains sessionId OR error is raised
// Actual: Should not have broken reference
```

---

## Minor Pitfalls

### Pitfall 9: Share Link Metadata Denormalization

**What goes wrong:** SHARE_LINK# record stores entire Session object to avoid database lookups. When session is updated (title, description), share link metadata becomes stale.

**Why it happens:** Developer optimizes for read performance; denormalizes session data into SHARE_LINK# record. Forgets to keep denormalized data in sync.

**Consequences:**
- Stale data: shared link shows old session title
- Confusion: user updates title but shared link still shows old title
- Maintenance burden: must update denormalized fields whenever session changes

**Prevention:**
1. **Minimize denormalization** — Only store what's needed (sessionId, expiresAt, revoked)
2. **Look up session separately** — Fetch full session metadata from SESSION# record
3. **Accept eventual consistency** — Metadata updates may take seconds to propagate

**Detection:** Code review; require approval for any denormalization.

---

### Pitfall 10: Collection Name Collisions

**What goes wrong:** User A creates collection "My Videos". Later user A creates another collection "My Videos". Both allowed; system doesn't enforce uniqueness per user. User confusion in UI.

**Why it happens:** Developer doesn't add uniqueness constraint. DynamoDB requires explicit design for uniqueness.

**Consequences:**
- User confusion: which "My Videos" is which?
- UI bugs: can't disambiguate in UI

**Prevention:**
1. **Enforce collection name uniqueness per user** — Add GSI with GSI3PK=`USER#{userId}#COLLECTION_NAME#{title}`, GSI3SK=collectionId
2. **Return 409 Conflict if duplicate** — User gets explicit error
3. **Suggest unique name** — "How about 'My Videos (2)'?"

**Detection:** None needed if enforcement prevents duplicates.

---

## Phase-Specific Warnings

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|-----------|
| **Phase 1** | Share link JWT validation | Token claim tampering (Pitfall 1) | Comprehensive security tests; verify link_id claim every request |
| **Phase 1** | Token revocation | Race condition (Pitfall 4) | Conditional writes; revocation should be atomic |
| **Phase 2** | Collection creation | Privacy escalation (Pitfall 2) | Default isPrivate=true; test default privacy |
| **Phase 2** | Collection modifications | Permission bypass (Pitfall 5) | Owner check on every write; test non-owner access |
| **Phase 3** | Delete collection | Cascading delete (Pitfall 3) | Transactional delete; audit orphaned records |
| **Phase 3** | Large collections | Pagination (Pitfall 6) | Implement from start; test with 10K sessions |
| **Phase 3** | Password collection | Plain-text passwords (Pitfall 7) | Hash with bcrypt; code review required |
| **Phase 2** | Add/delete concurrency | Race condition (Pitfall 8) | Conditional writes; soft delete if needed |

---

## Pre-Launch Security Checklist

- [ ] JWT signature validation tested with tampered tokens
- [ ] Collection privacy defaults verified (isPrivate=true)
- [ ] Collection delete tested with 1K+ sessions (no orphans)
- [ ] Permission checks tested for all write endpoints (owner check on every operation)
- [ ] Concurrent operations tested (revoke + playback, add + delete)
- [ ] Password hashing verified (bcrypt used, plain text never stored)
- [ ] Response sizes capped (collection responses max 500 items)
- [ ] Error messages don't leak information (404 vs 403 used correctly)
- [ ] Audit logging in place (who modified what, when)
- [ ] Rate limiting on share link creation (prevent spam)
- [ ] Code review completed for all handlers + repositories
- [ ] Security team sign-off obtained

---

## Notes

- All pitfalls assume v1.3 (private sessions) is complete
- Most pitfalls are caught by comprehensive testing
- Recommend threat modeling session before Phase 1 launch
- OWASP Top 10 applies: broken auth, data exposure, race conditions
