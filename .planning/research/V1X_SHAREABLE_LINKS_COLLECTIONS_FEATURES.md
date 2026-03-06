# Feature Landscape: Shareable Links & Collections

**Milestone:** Post-v1.4 (Shareable Links & Collections)
**Researched:** 2026-03-05
**Confidence:** HIGH

---

## Table Stakes

Features users expect in a video platform with sharing capabilities.

| Feature | Why Expected | Complexity | MVP | Notes |
|---------|--------------|------------|-----|-------|
| **Share session with link** | All video platforms support link sharing | Low | ✓ | Users want to share recordings instantly without complex permissions |
| **Time-limited access** | Security best practice for temp sharing | Low | ✓ | Links expire by default (default 7 days) to prevent indefinite access |
| **No account required for viewers** | Reduces friction for shared viewers | Low | ✓ | Viewers click link → play video immediately (no signup) |
| **Organize sessions into folders/playlists** | YouTube, Vimeo, TikTok all support collections | Medium | ✓ | Users expect to group related recordings (course modules, event series, etc) |
| **Privacy control per collection** | Public vs private collections | Low | ✓ | Users want some collections public (share with team) and others private (family) |
| **View who shared with you** | Transparency in sharing | Low | ✓ | Users can see "shared by @alice" metadata on collection/link |
| **Revoke access to shared link** | Users want to "unshare" | Low | ✓ | Delete link before expiration if accidentally shared or content becomes sensitive |
| **Search/browse public collections** | Discovery of user-created content | High | ✗ | Out of MVP scope; added in polish phase after core sharing works |

---

## Differentiators

Features that set platform apart from basic sharing.

| Feature | Value Proposition | Complexity | MVP | Notes |
|---------|-------------------|------------|-----|-------|
| **No-copy share links** | Generate short URL instantly vs copy/paste raw link | Low | ✓ | User clicks "Share" → gets `vnl.me/link/abc123` in clipboard |
| **Share link with expiration countdown** | UX shows "link expires in 3 days" | Low | ✓ | Frontend displays remaining time before link expires |
| **Bulk collection sharing** | Share entire collection as one link (vs individual links) | High | ✗ | "Share collection" → generates single token for all sessions in collection (future iteration) |
| **Collaborative collections** | Invite users to co-manage collection | High | ✗ | Multiple users can add/remove sessions from collection (future iteration) |
| **Collection templates** | Pre-built collection structures (course syllabus, conference agenda) | High | ✗ | Templates for common use cases (e.g., "5-module course") (future) |
| **Optional password on collection** | Secondary auth layer for sensitive groups | Medium | ✓ | Private collections can optionally require password (family, closed team) |
| **One-click embedding** | Generate embed code for iframe | Medium | ✗ | "Embed this collection" → iframe HTML snippet (future iteration) |
| **Collection analytics** | See view counts per session in collection | Medium | ✗ | "This module was viewed 45 times" (future iteration) |
| **Smart recommendations** | Suggest sessions to add to collection | High | ✗ | "Sessions similar to this one" (future, requires ML) |

---

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Send email notifications when link shared** | Out of scope for MVP; adds email infrastructure | Users manage sharing manually; document link best practices |
| **Automatic link expiration** | Adds background job complexity | Manual expiration (user revokes or link expires naturally) |
| **Nested collections** | Adds complexity to UI and querying | Flat collection hierarchy for MVP; encourage broad categorization |
| **Per-session download restrictions** | Complicates DRM/IP protection | Not a focus; raw HLS URL is already public (IVS doesn't provide DRM) |
| **Watermark shared videos** | Not video transformation platform | Recommend external tools (FFmpeg, MediaConvert) for watermarking |
| **Granular permission per session in collection** | Over-complicated access control | Privacy is collection-level (all sessions in collection = same privacy) |
| **Admin dashboard for link analytics** | Out of scope for MVP | Users manage their own collections and links via personal dashboard |
| **Automatic collection recommendations** | Requires ML/analytics | Hand-curated for MVP; explore in future |
| **Collection versioning** | Not needed for MVP | Collections are mutable; edits are immediate |

---

## Feature Dependencies

```
Core Sharing:
- Share Link → needs Session lookup
- Share Link → needs ES384 JWT signing (from v1.3)
- Share Link → needs SHARE_LINK# DynamoDB entity

Collections:
- Collection → needs Session lookup
- Collection → needs COLLECTION# DynamoDB entity
- Add Session to Collection → needs Session + Collection lookup + write permission check

Public Features:
- List Public Collections → needs Collection privacy check
- Search Sessions in Collection → needs GSI2 + pagination

Future:
- Bulk Share Collection → depends on Collection (core feature)
- Collaborative Collections → depends on Collection + permission model expansion
- Password-Protected Collection → depends on Collection + bcrypt hashing
```

---

## MVP Recommendation

### Phase 1: Shareable Links (1-2 weeks)

**Prioritize:**
1. Create share link endpoint (POST /sessions/{id}/share-link)
2. Fetch playback from link (GET /playback/link/{shareId})
3. Revoke link endpoint (DELETE /sessions/{id}/share-link/{shareId})
4. Frontend: "Share" button on session detail, display link with copy-to-clipboard

**Defer:**
- Link analytics (view count tracking)
- Advanced revocation settings (e.g., revoke after X views)
- Bulk link creation

**Delivers:** Users can share private sessions instantly without requiring viewers to create accounts.

---

### Phase 2: Collections Core (2-3 weeks)

**Prioritize:**
1. Create collection endpoint (POST /collections)
2. Add session to collection (POST /collections/{id}/sessions)
3. Get collection with sessions (GET /collections/{id})
4. List user's collections (GET /collections with pagination)
5. Frontend: Create collection modal, collection detail page with session list, add-to-collection modal

**Defer:**
- Delete collection (implement in Phase 3)
- Update collection metadata
- Collection search
- Collaborative collections
- Password protection

**Delivers:** Users can organize their sessions into named collections with privacy controls.

---

### Phase 3: Collections Polish (1-2 weeks)

**Prioritize:**
1. Delete collection (DELETE /collections/{id})
2. Remove session from collection (DELETE /collections/{id}/sessions/{sessionId})
3. Update collection metadata (PATCH /collections/{id})
4. Comprehensive permission testing (non-owners can't modify)
5. Cascading delete testing (collection deletion cleans up membership records)

**Delivers:** Full collection lifecycle management with safe deletion.

---

## Feature Scope by Scale

| User Scale | Feature Expectations | Implementation Notes |
|------------|---------------------|----------------------|
| **10-100 users** (alpha/beta) | Share links + basic collections | No performance optimization needed; focus on correctness |
| **100-1K users** (soft launch) | Add collection search + public discovery | GSI2 queries scale fine; no caching needed |
| **1K-10K users** (growth) | Add analytics (view counts) + recommendations | Consider adding token cache layer if playback token validation becomes bottleneck |
| **10K-100K users** (scale phase) | Add collaborative collections, bulk operations | Implement pagination for large collections (max 500 items per page) |
| **100K+ users** (enterprise) | Advanced sharing (expiring collections, templates, embeds) | Add Redis cache for token validation; consider S3 CloudFront for link handling |

---

## Comparison to Competitor Features

### YouTube Playlists
- **What they do:** Create playlists with privacy (Private/Unlisted/Public), add videos, share via URL
- **We do:** Collections + share links (similar model)
- **Difference:** We don't require viewers to have account (vs YouTube requires Google login for private playlists)

### Vimeo Folders
- **What they do:** Organize videos into folders, share folder with granular permissions (view, edit, download)
- **We do:** Collections with simple privacy (all sessions in collection inherit privacy)
- **Difference:** We keep it simpler for MVP; collaborative permissions future iteration

### Google Drive Shared Links
- **What they do:** Generate share link with expiration and permission level (Viewer/Commenter/Editor)
- **We do:** Share links with simple permission (View only; no edit capability for shared links)
- **Difference:** Simpler model; editing only via direct session management (not via shared link)

### Instagram Stories/Highlights
- **What they do:** Organize stories into highlights (collections); highlights visible on profile
- **We do:** Collections visible via dedicated collection URL (no profile page yet)
- **Difference:** Future iteration adds profile pages; for MVP, collections are standalone

---

## Success Metrics (Post-Launch Telemetry)

After shipping, track:
- **Share links created per user** — Indicates feature adoption
- **Share link click-through rate** — Indicates sharing effectiveness
- **Collection creation rate** — Indicates organization value
- **Avg sessions per collection** — Indicates collection depth
- **Collection view frequency** — Indicates collection reuse

**Target:** >20% of active users create at least one share link within 30 days; >10% create at least one collection within 60 days.

---

## Open Questions (For Phase Planning)

1. **Should share links include session metadata (title, thumbnail) in the shared view?** Or just video player?
   - **Answer:** Include metadata (title, owner, duration, description) to give context before clicking play

2. **Should collections have a description/cover image?**
   - **Answer:** Yes; optional description field. Cover image = thumbnail of first session (no upload).

3. **Should viewers see who created the collection?**
   - **Answer:** Yes; display "Created by @alice" on collection detail page.

4. **Should collection privacy cascade to sessions, or override session privacy?**
   - **Answer:** Collection privacy overrides session privacy. If collection is public, all sessions visible. If collection is private, all sessions hidden (unless viewer is owner).

5. **Should we support removing yourself from a shared collection?**
   - **Answer:** No; viewers can't "remove" a collection. Viewers can only view. Only owner can remove sessions.

---

## Notes

- All features assume v1.3 (private sessions + JWT tokens) is complete
- No email notifications in MVP (future iteration)
- No mobile app specific features (web-first approach)
- Collections are immutable from viewer perspective (viewers can only view, not modify)
- Share links are view-only (no edit capability even for owner when using share link)
