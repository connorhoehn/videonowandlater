# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- 🚧 **v1.3 Secure Sharing** - Phases 23-25 (in progress)

## Phases

<details>
<summary>✅ v1.0 Gap Closure (Phases 1-4.2) - SHIPPED 2026-03-02</summary>

Milestone completed. See milestones/v1.0-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.1 Replay, Reactions & Hangouts (Phases 5-15) - SHIPPED 2026-03-05</summary>

Milestone completed. See milestones/v1.1-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.2 Activity Feed & Intelligence (Phases 16-22) - SHIPPED 2026-03-06</summary>

**Milestone Goal:** Surface richer session context on the homepage — hangout activity cards, reaction summary counts, horizontal recording slider, and activity feed — and add an automated transcription and AI summary pipeline to every recording.

**What Was Built:**
- Phase 16: Hangout Participant Tracking — Durably record participant joins in DynamoDB with participantCount field on session
- Phase 17: Reaction Summary at Session End — Pre-compute per-emoji reaction counts when sessions end
- Phase 18: Homepage Redesign & Activity Feed — Two-zone layout with recording slider and activity feed below
- Phase 19: Transcription Pipeline — Automated S3-to-Transcribe pipeline triggered by recording completion
- Phase 20: AI Summary Pipeline — Inline Bedrock call generates one-paragraph summaries for every recording
- Phase 21: Video Uploads — Users can upload pre-recorded videos (MOV/MP4) with automatic adaptive bitrate encoding
- Phase 22: Live Broadcast with Secure Viewer Links — Private broadcasts with ES384 JWT tokens for access control

See milestones/v1.2-ROADMAP.md for full details.

</details>

### v1.3 Secure Sharing (In Progress)

**Milestone Goal:** Enable users to share broadcasts and recordings via permanent links and organize sessions into private collections with granular access control.

**Phases:**

- [ ] **Phase 23: Shareable Links** - Generate time-limited share links with copy-to-clipboard UI and expiration countdown
- [ ] **Phase 24: Collections Core** - Create named collections, add/remove sessions, and view collections with privacy controls
- [ ] **Phase 25: Collections Management** - Delete collections with cascading cleanup, edit metadata, and revoke specific sessions from collections

## Phase Details

### Phase 23: Shareable Links
**Goal:** Users can generate permanent shareable links for any broadcast or recording, with expiration countdown and one-click copy-to-clipboard, accessible without account creation.

**Depends on:** Phase 22 (v1.2) — JWT token patterns established

**Requirements:** SHARE-01, SHARE-02, SHARE-03, SHARE-05

**Success Criteria** (what must be TRUE):
  1. User can click "Share" button and generate a shareable link with title, duration, and thumbnail metadata in URL
  2. Shareable link is accessible from any browser without user login (anonymous viewer can watch)
  3. Shareable link displays full video player with reaction summary and chat history synced to replay
  4. User can copy share link to clipboard with one click and see confirmation

**Plans:** TBD

### Phase 24: Collections Core
**Goal:** Users can organize sessions into named collections (playlists) with privacy controls, view all their collections, and add/remove sessions atomically.

**Depends on:** Phase 23 (shareable links proven stable)

**Requirements:** SHARE-04, COLL-01, COLL-02, COLL-03, COLL-04

**Success Criteria** (what must be TRUE):
  1. User can create a named collection from profile modal with title, description, and privacy toggle (default private)
  2. User can add any session from homepage or replay page to one or more collections with one click
  3. User can remove session from collection without affecting collection or other sessions
  4. User can view all their collections on homepage with session counts and privacy status visible
  5. User can view collection detail page showing all sessions inside with full replay player for each

**Plans:** TBD

### Phase 25: Collections Management
**Goal:** Users can delete collections and modify collection metadata (title, description, privacy), with safe cascading cleanup of membership records and orphan prevention.

**Depends on:** Phase 24 (collection queries working correctly)

**Requirements:** COLL-05

**Success Criteria** (what must be TRUE):
  1. User can delete collection from collection detail or collection list with confirmation dialog
  2. All sessions in deleted collection remain intact and appear in other collections and homepage
  3. No orphaned collection-session records remain after deletion (cascading cleanup verified)
  4. User can edit collection title, description, and privacy setting from collection detail page
  5. Collection privacy changes (private ↔ public) reflect immediately in homepage and activity feeds

**Plans:** TBD

---

## Progress

**Latest Milestone:** v1.3 Secure Sharing
- **Status:** 🚧 Planning
- **Phases:** 3 (23-25)
- **Plans:** 0/? started
- **Tests:** 169/169 backend tests passing (from v1.2)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 23 - Shareable Links | 0/? | Not started | - |
| 24 - Collections Core | 0/? | Not started | - |
| 25 - Collections Management | 0/? | Not started | - |
