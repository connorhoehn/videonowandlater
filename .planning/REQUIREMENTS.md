# Requirements: VideoNowAndLater v1.3

**Defined:** 2026-03-06
**Core Value:** Users can go live instantly and every session is automatically preserved with its full context for later replay.

## v1.3 Requirements: Secure Sharing

### Shareable Links

- [ ] **SHARE-01**: User can generate a public shareable link for any broadcast or recording
- [ ] **SHARE-02**: Shareable link contains session metadata in URL (title, duration, thumbnail)
- [ ] **SHARE-03**: Shared links are accessible without user account creation
- [ ] **SHARE-04**: Shared link shows video player with reaction summary and chat history
- [ ] **SHARE-05**: Shared link is copyable one-click to clipboard

### Collections

- [ ] **COLL-01**: User can create a named collection (playlist)
- [ ] **COLL-02**: User can add sessions to collections
- [ ] **COLL-03**: User can remove sessions from collections
- [ ] **COLL-04**: Collections are private by default (only visible to creator)
- [ ] **COLL-05**: User can view their collections on homepage

## v2 Requirements

### Time-Limited Shares

- **SHARE-06**: User can set expiration time on shared links (7 days, 30 days, never)
- **SHARE-07**: Expired shared links return 404 or "link expired" message

### Share Link Security

- **SHARE-08**: User can revoke/disable a previously generated shared link
- **SHARE-09**: Share links support optional password protection

### Collection Discovery

- **COLL-06**: User can make collections public/shareable
- **COLL-07**: Public collections appear in browse/search
- **COLL-08**: User can generate shareable links for entire collections

## Out of Scope

| Feature | Reason |
|---------|--------|
| User profiles | Constraint: "Don't get into users" — deferred to future |
| Permission-based access (granular) | Complex auth model; defer to v2 |
| Collaborative editing | Requires user presence/conflict resolution |
| Email/social sharing | Deferred to future milestone |
| Mobile app | Web-first approach |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SHARE-01 | Phase 23 | Pending |
| SHARE-02 | Phase 23 | Pending |
| SHARE-03 | Phase 23 | Pending |
| SHARE-04 | Phase 24 | Pending |
| SHARE-05 | Phase 23 | Pending |
| COLL-01 | Phase 24 | Pending |
| COLL-02 | Phase 24 | Pending |
| COLL-03 | Phase 24 | Pending |
| COLL-04 | Phase 24 | Pending |
| COLL-05 | Phase 25 | Pending |

**Coverage:**
- v1.3 requirements: 10 total
- Mapped to phases: 10 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after roadmap creation*
