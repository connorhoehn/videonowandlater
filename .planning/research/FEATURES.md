# Feature Research: Shareable Links & Collections

**Domain:** Video sharing platform — shareable session links and private/public collections
**Researched:** 2026-03-05
**Confidence:** MEDIUM — based on existing JWT playback token infrastructure (Phase 22), industry patterns from video platforms, and project constraint ("don't get into users")

---

## Executive Summary

Shareable links and collections address a core user need: "How do I share what I've recorded with others?" and "How do I organize my recordings?"

**Shareable links** enable frictionless sharing without account creation. The project already has JWT playback tokens for private broadcasts (Phase 22) — shareable links extend this infrastructure to enable password-free access via simple copyable URLs.

**Collections** (playlists/folders) address the organizational challenge of managing multiple recordings. Users need to group related sessions (e.g., "Conference 2026", "Team standups", "Tuesday hangouts") for easy discovery and sharing.

The table stakes are straightforward: publicly copyable links + basic grouping. Differentiators emerge in access control granularity (expiration, passwords), sharing intelligence, and discovery features. Anti-features include complex permission models (contradicts "don't get into users" constraint) and email/social infrastructure (out of scope).

---

## Context: What Exists Today

**From v1.3 (just shipped):**
- Private broadcasts with `isPrivate` flag on Session
- ES384 JWT token generation with time-limited access
- Playback tokens validated at viewer access time
- Private broadcast filtering from activity feed

**From v1.2:**
- Auto-transcription of all recordings (Phase 19)
- AI summaries via Bedrock (Phase 20)
- Video uploads with adaptive bitrate encoding (Phase 21)
- Activity feed with rich session metadata

**Infrastructure in place:**
- DynamoDB Session entity with extensible fields
- Lambda handlers for session operations
- API Gateway endpoints for playback token generation
- Frontend pages for broadcast, hangout, replay, viewer

**Constraint:** "Don't get into users" — shareable links must NOT lead to user profiles, followers, or collaboration features that require user management.

---

## Table Stakes

Features users expect from a video sharing platform. Missing these makes the product feel incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Shareable public links** | Every video platform allows copying a link to share. Without this, users share via messaging app links or screenshots — friction. | Low | Generate unique slug (`session.slug = nanoid(7)`); store in DynamoDB; serve via public endpoint. Extends existing private broadcast JWT model. |
| **Direct playback from shared link** | Shared link must open video player directly, no login required for public videos. Non-negotiable UX. | Low | Public playback endpoint: `GET /playback/{slug}` (no auth required). Returns playback token if session is public. |
| **Link preview metadata (OG tags)** | When shared on social platforms (Twitter, Slack, Discord), preview should show title, thumbnail, duration. Open Graph tags in HTML. | Low | Add OG meta tags to playback page; fetch session metadata server-side on page load. |
| **Copy link from player** | Easy one-click copy of shareable URL from within playback UI. Users shouldn't need to manually construct URLs. | Trivial | Add copy button to player controls. Use clipboard API. |
| **Collections / playlists** | Users expect to group related recordings (e.g., "Conference talks", "Monday standups"). Discoverability mechanism. | Medium | DynamoDB collection entity: `{ id, userId, name, description, isPublic, sessionIds[] }`. CRUD API endpoints. |
| **Public collections viewable** | Users need to browse public playlists created by others. Discoverable via direct link. | Low | Public collections endpoint: `GET /collections/{collectionId}` (no auth if public). Returns collection + session metadata. |
| **Organize collection playback** | Collections should play videos in order, not shuffle. Session order matters. | Low | Store `sessionIds` array in collection; preserve order in playback. |

---

## Differentiators

Features that genuinely set platform apart from competitors. Not expected, but valued when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Time-limited share links** | Creator can generate expiring links (e.g., "valid for 7 days"). Useful for time-sensitive content (webinars, workshops). High sense of control. | Low | Use JWT `exp` claim (already implemented). Add UI to set expiration when generating link; store link metadata (created_at, expires_at). |
| **Password-protected public links** | Secondary auth layer for sensitive sharing. "Private but shareable via link." | Medium | Generate random password; hash + store; prompt for password before playback. Combines JWT + password auth. Separate from account passwords. |
| **Public collection discovery** | Platform suggests or indexes public collections (e.g., search "AI talks" → find collection). | High | Requires search index (GSI or OpenSearch). Out of MVP scope; future iteration. |
| **Reaction previews in collections** | Show top reactions across all videos in collection. "See what people loved." | Low | Aggregate reaction counts from all sessions; display top 2-3 emoji on collection card. |
| **Collection thumbnails** | Display grid of first 4 video thumbnails as collection cover. Visual scanning. | Low | Client-side grid of first 4 session thumbnails in collection. |
| **Share entire collection as single link** | Generate one link that contains all sessions in collection (vs individual session links). | Low | Share link includes collection ID; playback shows collection metadata + session list. |
| **Collection download** | Batch download all videos in collection as ZIP (presigned S3 URLs). | High | Requires S3 presigned URL generation for each session + ZIP creation. Out of MVP. |
| **Collaborative collections** | Multiple users can edit a shared collection (add/remove videos, reorder). | High | Requires permission model, edit tracking, conflict resolution. **OUT OF SCOPE** — contradicts "don't get into users" constraint. |
| **Collection analytics** | Creator sees view count per video in collection, total viewers. | Medium | Track collection views in DynamoDB; aggregate per session. Out of MVP; add post-validation. |
| **Auto-generated collections** | Platform suggests collections based on tags, date ranges, participant overlap. | High | Requires ML/heuristics. Out of scope. |

---

## Anti-Features

Features to explicitly NOT build. These create confusion, scope creep, or contradict project constraints.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **User profiles / creator pages** | Explicitly out of scope ("don't get into users"). Profile pages create account management debt and user discovery algorithms. | Use collections as the discovery mechanism. Creator's name stays with collection; users find content via public collections, not profiles. |
| **Granular role-based sharing** | "Editor", "viewer", "commenter" roles on collections. Adds permission model complexity and ties to user management. | Use simple binary: owner (can edit) vs viewer (can watch). No collaborative editing in MVP. |
| **Email invitations** | "Share this collection with: alice@example.com". Requires email infrastructure + invite management. | Use copyable links. Platform doesn't manage invites or email notifications. |
| **Expired link management dashboard** | Dashboard showing all generated links with expirations and revocation history. | Generate link once; trust it; no link inventory. Revocation only by deleting the session or collection. |
| **Public profile collections** | Collections page at `/creators/alice/collections`. Leads to full user profiles and social graph. | Collections linked directly (e.g., `/collections/abc123`). No "creator collections" index. |
| **Collection versioning** | Ability to revert collection to prior state (add/remove video, reorder). | Collections are mutable; no version history. Same as Google Docs — live edit, no rollback. |
| **Auto-post to social media** | Native "Share to Twitter" buttons that auto-post link + description. | Let users copy link; social sharing happens outside platform. Reduces social media integration debt. |
| **Thumbnail upload for collections** | Upload custom cover image for collection. | Use first video's thumbnail or auto-generated grid of first 4 thumbnails. No asset management. |
| **Comments on collections** | Thread-based comments on collection level (separate from video comments). | Comments stay on individual videos only. Not aggregated at collection level. |
| **Collection tags / categorization** | Tag collections with metadata ("AI", "conference", "live") for discovery. | No tagging in MVP. Basic search by collection name only. |

---

## Feature Dependencies

```
Shareable Public Links (core feature)
  ├─> Requires: Session lookup by slug
  ├─> Requires: Public playback endpoint
  ├─> Requires: JWT playback token (already implemented in Phase 22)
  └─> Extends: Existing private broadcast model

Time-Limited Share Links (differentiator)
  ├─> Requires: Shareable Public Links
  └─> Requires: JWT `exp` claim validation (already in Phase 22)

Password-Protected Links (differentiator)
  ├─> Requires: Shareable Public Links
  └─> Requires: Password hashing + comparison logic

Collections / Playlists (core feature)
  ├─> Requires: DynamoDB collection entity
  ├─> Requires: `isPublic` flag on collection
  ├─> Requires: Collection CRUD API endpoints
  └─> Requires: Frontend collection builder UI

Public Collections Index (table stakes)
  ├─> Requires: Collections core feature
  ├─> Requires: Public collections API endpoint
  └─> Requires: Collections listing/browsing UI

Collection Batch Share Link (differentiator)
  ├─> Requires: Collections core feature
  ├─> Requires: Public collections endpoint
  └─> Requires: Ability to include multiple sessions in one playback token

Reaction Previews in Collections (differentiator)
  ├─> Requires: Collections core feature
  ├─> Requires: Session reaction counts (Phase 17, already complete)
  └─> Requires: Frontend aggregation of reaction counts from all sessions

Collection Download (future)
  ├─> Requires: Collections core feature
  ├─> Requires: S3 presigned URL generation
  └─> Requires: ZIP file creation or external download service

Collection Analytics (future)
  ├─> Requires: Collections core feature
  └─> Requires: View tracking infrastructure
```

---

## Recommended MVP

**Phase focus:** Shareable public links + basic collections for organization.

### Phase 1: Shareable Public Links
**Goal:** Enable sharing individual sessions without account creation.

**Deliverables:**
1. Add `slug` field to Session DynamoDB entity (unique, URL-safe)
2. Create `POST /sessions/{sessionId}/make-public` endpoint (set `isPublic = true`, generate slug)
3. Create `GET /playback/{slug}` endpoint — returns playback token if session is public
4. Add OG meta tags to playback HTML page (title, thumbnail, duration, creator name)
5. Add "Share" button in player UI with copy-to-clipboard
6. Handle slug uniqueness (retry with new slug if collision)

**Complexity:** Low — extends existing Phase 22 private broadcast JWT infrastructure
**API additions:**
```
POST /sessions/{sessionId}/make-public
  Input: (no body)
  Output: { slug, publicUrl }

GET /playback/{slug}
  Input: (no params)
  Output: { playbackToken, sessionMetadata } (no auth required)
```

**Database changes:**
```typescript
Session {
  // existing fields...
  isPublic?: boolean;
  slug?: string; // unique index
  publicCreatedAt?: ISO8601;
}
```

**Frontend changes:**
- Add share button to ReplayViewer component
- Display share modal with copy button
- Add OG meta tags to index.html (dynamic server-side rendering recommended)

**Testing:**
- Manual: create session, make public, share link in browser URL bar, verify playback works
- OG tag verification: use Twitter/Slack card preview tool
- Slug uniqueness: generate 1000 sessions, verify no collisions

**Estimate:** 1 phase (3-4 days)

---

### Phase 2: Collections Data Model & CRUD
**Goal:** Store collection metadata; enable basic organization.

**Deliverables:**
1. Create DynamoDB Collection entity
2. `POST /collections` — create new collection (owner only)
3. `GET /collections/{collectionId}` — fetch collection + session metadata
4. `GET /users/{userId}/collections` — list user's collections (paginated)
5. `PUT /collections/{collectionId}` — update name, description, isPublic
6. `POST /collections/{collectionId}/sessions` — add session to collection (append to array)
7. `DELETE /collections/{collectionId}/sessions/{sessionId}` — remove session from collection
8. `DELETE /collections/{collectionId}` — delete collection (owner only)

**Complexity:** Medium — standard CRUD + permission checks
**Database schema:**
```typescript
Collection {
  id: string; // PK: COLLECTION#{id}
  userId: string; // owner (GSI: USER#{userId})
  name: string;
  description?: string;
  isPublic: boolean; // default: false
  sessionIds: string[]; // ordered array of session IDs
  createdAt: ISO8601;
  updatedAt: ISO8601;
}
```

**API additions:**
```
POST /collections
  Input: { name, description?, isPublic? }
  Output: Collection

GET /collections/{collectionId}
  Input: (no params)
  Output: Collection with denormalized session data

PUT /collections/{collectionId}
  Input: { name?, description?, isPublic? }
  Output: updated Collection

POST /collections/{collectionId}/sessions
  Input: { sessionId, position?: number }
  Output: updated Collection

DELETE /collections/{collectionId}/sessions/{sessionId}
  Output: updated Collection

GET /users/{userId}/collections?isPublic=true&limit=20&cursor=...
  Output: { items: Collection[], cursor }

DELETE /collections/{collectionId}
  Output: { success: true }
```

**Permission logic:**
- Create: any authenticated user
- Read: any user if collection is public; owner only if private
- Update/Delete: owner only
- Add/Remove session: owner only

**Testing:**
- CRUD tests for all endpoints
- Permission tests: verify non-owners can't modify
- Pagination tests: test cursor-based pagination with >100 collections

**Estimate:** 1 phase (3-4 days)

---

### Phase 3: Collections UI (Frontend)
**Goal:** Users can create, browse, manage collections in web app.

**Deliverables:**
1. Collection browser modal/sidebar (in player or dedicated page)
2. "Add to collection" button in ReplayViewer
3. Create collection modal with name + description + privacy toggle
4. Collections listing page (user's own collections)
5. Public collections detail page (`/collections/{collectionId}`)
6. Collection session grid/list view (read-only for non-owners)
7. Edit collection modal (owner only)
8. Drag-to-reorder sessions in collection (owner only)

**Complexity:** Medium — new UI, state management, form handling
**Components:**
```
<CollectionBrowser />
  - Sidebar or modal showing user's collections
  - "Create collection" button
  - List of user's collections with edit/delete buttons
  - "Add to collection" action (closes and returns)

<PublicCollectionDetail />
  - Collection metadata (name, creator, description)
  - Session grid showing all videos in collection
  - Play button on each session (navigates to replay)

<CreateCollectionModal />
  - Form: name (required), description (optional), isPublic (toggle)
  - Submit + Cancel buttons

<CollectionSessionGrid />
  - Grid of session cards with thumbnail + title + duration
  - Reorder UI (drag-and-drop or buttons) for owner only
  - Remove session button (owner only)
```

**Testing:**
- E2E: create collection, add session, view collection, reorder
- Permissions: verify non-owner can't reorder/delete
- Navigation: verify clicking session navigates to replay

**Estimate:** 2 phases (5-7 days)

---

### Phase 4: Time-Limited Share Links (Differentiator)
**Goal:** Creators can share with expiration for security.

**Deliverables:**
1. UI in player to "Generate shareable link" with optional expiration selector
2. Store link metadata: `{ slug, expiresAt, createdAt, createdBy }`
3. Validate expiration on each playback request
4. Error UI: "This link has expired" message with refresh suggestion

**Complexity:** Low — leverages existing JWT expiration
**API additions:**
```
POST /sessions/{sessionId}/make-public?expiresIn=7days
  Input: { expiresIn?: '1day' | '7days' | '30days' | never }
  Output: { slug, publicUrl, expiresAt }

GET /playback/{slug}
  - Validate: if slug.expiresAt < now, return 410 Gone with "Link expired" message
  - Otherwise: return playback token as before
```

**Database changes:**
```typescript
Session {
  // ...
  publicExpiresAt?: ISO8601;
}
```

**Frontend changes:**
- Add expiration selector dropdown in share modal
- Display "Link expires on [date]" or "Link never expires"
- Handle 410 error in playback with friendly message

**Testing:**
- Create link with 1-second expiration, verify it expires
- Create link with no expiration, verify it doesn't expire
- Test error UI when accessing expired link

**Estimate:** 1 phase (2-3 days)

---

### Defer (Post-MVP)

**Password-protected links:**
- Adds password auth complexity
- Deferred until user feedback indicates need

**Collection download:**
- Requires S3 presigned URL generation + ZIP creation
- Deferred to future iteration

**Collection discovery / search:**
- Requires search index (GSI or OpenSearch)
- Deferred until collection corpus grows

**Collection analytics:**
- Requires view tracking + aggregation infrastructure
- Deferred to future iteration

**Collaborative collections:**
- Requires permission model — contradicts "don't get into users"
- Out of scope

---

## Implementation Considerations

### Slug Generation & Uniqueness
```typescript
// Use nanoid for short, URL-safe slugs
import { nanoid } from 'nanoid';

const slug = nanoid(7); // 7 chars = ~117 billion combinations
// verify uniqueness: query DynamoDB with GSI on slug
// if collision: retry with new slug
```

### DynamoDB GSI Design for Collections
```typescript
// GSI1: USER#{userId} for listing user's collections
// GSI2: PUBLIC#${isPublic} for listing all public collections (if needed later)

// Single-table design:
// PK: COLLECTION#{id}
// GSI1PK: USER#{userId}, GSI1SK: createdAt (for sort by date)
// GSI2PK: PUBLIC#{isPublic}, GSI2SK: createdAt (for discovery, future)
```

### Denormalization Strategy
```typescript
// Store denormalized session metadata in collection for fast list rendering
Collection {
  sessionIds: string[]; // Primary refs
  denormalizedSessions?: {
    [sessionId]: {
      title: string;
      thumbnailUrl: string;
      duration: number;
      createdAt: ISO8601;
    }
  }
}

// Update denormalized data when session is added/updated
// Risk: eventual consistency if session is edited after being added
// Mitigation: fetch fresh session data on playback, not from collection cache
```

### Frontend State Management
```typescript
// In ReplayViewer or dedicated collections page:
// - Store list of user's collections (fetched once on page load)
// - When user adds session to collection, update local state + API call
// - Optimistic UI: show session added immediately, sync backend asynchronously

const [collections, setCollections] = useState<Collection[]>([]);

const addSessionToCollection = async (collectionId: string, sessionId: string) => {
  // Optimistic update
  setCollections(prev =>
    prev.map(c => c.id === collectionId
      ? { ...c, sessionIds: [...c.sessionIds, sessionId] }
      : c
    )
  );

  // Backend sync
  try {
    await api.post(`/collections/${collectionId}/sessions`, { sessionId });
  } catch (err) {
    // Rollback on error
    setCollections(prev =>
      prev.map(c => c.id === collectionId
        ? { ...c, sessionIds: c.sessionIds.filter(id => id !== sessionId) }
        : c
      )
    );
  }
};
```

---

## Complexity & Risk Assessment

| Feature | Complexity | Risk | Mitigation |
|---------|------------|------|-----------|
| **Shareable links** | Low | Low | Reuse existing JWT infrastructure; slug uniqueness is trivial at scale <1M sessions |
| **Collections CRUD** | Medium | Low | Standard REST patterns; permission checks straightforward |
| **Collections UI** | Medium | Medium | Frontend state management; test reorder logic carefully |
| **Time-limited links** | Low | Low | JWT `exp` claim already validated in Phase 22 |
| **Password protection** | Medium | Medium | Bcrypt hashing; ensure password prompt UX doesn't break playback flow |
| **Collection download** | High | High | S3 presigned URLs + ZIP creation; deferred |
| **Discovery/Search** | High | High | Requires index infrastructure; deferred |

---

## Scale Considerations

| User Scale | Recommendations | Concern |
|------------|-----------------|---------|
| **10-100 users** (alpha) | Ship MVP with basic collections | None — trivial scale |
| **100-1K users** | Add slug uniqueness verification | Collision probability <0.001% at 1K sessions |
| **1K-10K users** | Add collection search (GSI query) | DynamoDB GSI scans are fast; no caching needed |
| **10K-100K users** | Consider denormalization caching | Collection metadata cache invalidation if session is edited |
| **100K+ users** | Add Redis cache for popular collections | Cache popular public collections to reduce DynamoDB queries |

---

## Competitor Feature Comparison

| Platform | Shareable Links | Collections | Collaboration | Discovery |
|----------|-----------------|-------------|----------------|-----------|
| **YouTube** | ✓ (public by default) | ✓ Playlists | ✓ Shared playlists | ✓ Playlist search |
| **Vimeo** | ✓ (link sharing) | ✓ Folders | ✓ Shared folders with permissions | ✗ Limited |
| **Loom** | ✓ (link sharing) | ✓ Collections | ✗ No sharing | ✗ Limited |
| **Twitch** | ✓ (VOD links) | ✗ No playlists | N/A | ✓ VOD search |
| **VideoNowAndLater v1.x** | ✓ (time-limited) | ✓ Private/public | ✗ By design | Deferred to v2 |

---

## Success Metrics (Post-Launch)

Track adoption via:
- **Share links created per user** — Indicates feature discovery and usage
- **Share link click-through rate** — Indicates sharing effectiveness (measure via playback tokens)
- **Collection creation rate** — Indicates organization value
- **Average sessions per collection** — Indicates collection depth
- **Collection view frequency** — Indicates reuse/value

**Target:** >20% of active users create at least one share link within 30 days; >10% create at least one collection within 60 days.

---

## Sources

**Research method:** Domain knowledge + existing project architecture review + industry pattern inference

**High confidence (verified):**
- Existing JWT playback tokens (Phase 22, documented in PROJECT.md)
- AWS IVS private broadcast architecture (Phase 22)
- DynamoDB patterns for collections (single-table design, GSI querying)

**Medium confidence (based on patterns):**
- Shareable links patterns: YouTube/Vimeo/Loom all implement (access restricted, inferred from public product)
- Collections patterns: Standard feature in playlist systems
- Time-limited link patterns: Stripe, Google Drive, AWS pre-signed URLs

**Gaps identified:**
- Specific bcrypt configuration for password-protected links
- Large-scale collection pagination patterns (>10k items per collection)
- Real-world expiration UX patterns in competing platforms

---

**Next steps for downstream:** Requirements scoping should address:
- UI mockups for collection browser modal
- Collection session order preservation (use array index or explicit position field?)
- Password complexity/requirements for protected links (if approved as MVP feature)
- Expiration default (7 days? 30 days? Creator's choice?)
