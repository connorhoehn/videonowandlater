# UI Redesign Handoff: Social Network-Style Layout

## Goal
Redesign the VideoNowAndLater web app from a single-column feed into a polished, social-network-style 3-column layout inspired by the Bootstrap "Social Network & Community" template (ThemeForest #54508767).

## Stack
- React 19 + Vite + Tailwind CSS v4 + React Router v7
- No UI component library — all custom Tailwind
- Motion library available for animations
- Currently single-column `max-w-2xl` centered layout

---

## What's Already Built

### Existing App Pages & Routes
| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `HomePage` | Activity feed, live broadcasts slider, recordings slider |
| `/broadcast/:id` | `BroadcastPage` | Go-live streaming |
| `/viewer/:id` | `ViewerPage` | Watch live stream |
| `/replay/:id` | `ReplayViewer` | Watch recording replay |
| `/hangout/:id` | `HangoutPage` | Multi-participant video call |
| `/upload/:id` | `UploadViewer` | Upload video |
| `/video/:id` | `VideoPage` | View uploaded video |
| `/login` | `LoginPage` | Auth |
| `/signup` | `SignupPage` | Auth |

### Existing Feature Directories
```
web/src/features/
  activity/     — ActivityFeed, BroadcastActivityCard, HangoutActivityCard, UploadActivityCard,
                  LiveBroadcastsSlider, RecordingSlider, SessionAuditLog, PipelineStatusBadge,
                  ReactionSummaryPills
  broadcast/    — BroadcastPage, CameraPreview, StreamQualityDashboard/Overlay
  chat/         — ChatPanel, MessageInput, MessageList, MessageRow, ChatRoomProvider
  hangout/      — HangoutPage, VideoGrid, ParticipantTile
  reactions/    — ReactionPicker, FloatingReactions
  replay/       — ReplayViewer, ReplayChat, TranscriptDisplay, SummaryDisplay, ChapterList,
                  ReactionTimeline, HighlightReelPlayer, RecordingFeed
  spotlight/    — SpotlightBadge, SpotlightModal
  upload/       — VideoUploadForm, UploadViewer, VideoPage, VideoInfoPanel, CommentThread,
                  QualitySelector
  viewer/       — ViewerPage, VideoPlayer, ThumbnailPreview
```

### New Social Components — COMPLETED (30 component files + 1 barrel)

All in `web/src/components/social/`, barrel exported via `index.ts`.

#### Complete File Inventory (31 files)

| # | File | Component(s) / Exports | Status |
|---|------|------------------------|--------|
| 1 | `Avatar.tsx` | `Avatar` — sizes (xs-xl), story ring, online dot, initials fallback | DONE |
| 2 | `Badge.tsx` | `Badge` — status pill: primary/success/danger/warning/info, sm/md | DONE |
| 3 | `Card.tsx` | `Card`, `Card.Header/Body/Footer` — compound card wrapper | DONE |
| 4 | `PostCard.tsx` | `PostCard` — feed post with author, media, engagement bar, comment input | DONE |
| 5 | `CommentThread.tsx` | `CommentThread`, `Comment` (type) — recursive nested comments | DONE |
| 6 | `ProfileSidebar.tsx` | `ProfileSidebar` — cover photo, avatar, stats, nav menu | DONE |
| 7 | `SuggestionWidget.tsx` | `SuggestionWidget`, `SuggestionUser` (type) — "Who to follow" list | DONE |
| 8 | `NewsWidget.tsx` | `NewsWidget`, `NewsItem` (type) — "Today's news" headlines | DONE |
| 9 | `Navbar.tsx` | `Navbar`, `NavIconButton` — fixed top bar with search, nav links, icons | DONE |
| 10 | `AppShell.tsx` | `AppShell` — 3-column responsive grid (280px / 1fr / 300px) | DONE |
| 11 | `LoadMoreButton.tsx` | `LoadMoreButton` — animated bouncing dots, link/primary-soft variants | DONE |
| 12 | `SearchInput.tsx` | `SearchInput` — rounded input with icon, clear button, debounce | DONE |
| 13 | `Tooltip.tsx` | `Tooltip` — hover tooltip, positions: top/bottom/left/right | DONE |
| 14 | `FooterLinks.tsx` | `FooterLinks` — horizontal footer links + copyright | DONE |
| 15 | `DropdownMenu.tsx` | `DropdownMenu`, `DropdownItem` (type) — positioned panel with items | DONE |
| 16 | `TabNav.tsx` | `TabNav`, `Tab` (type) — horizontal tabs with active underline | DONE |
| 17 | `OffcanvasSidebar.tsx` | `OffcanvasSidebar` — mobile slide-in sidebar with overlay | DONE |
| 18 | `EngagementBar.tsx` | `EngagementBar` — like/comment/share bar, stacked + inline variants | DONE |
| 19 | `CreatePostCard.tsx` | `CreatePostCard`, `PostAction`/`CreatePostCardProps` (types) — post composer | DONE |
| 20 | `PollCard.tsx` | `PollCard`, `PollOption`/`PollCardProps` (types) — poll with progress bars | DONE |
| 21 | `ImageGrid.tsx` | `ImageGrid` — multi-image layout: 1/2/3+ grid with overlay | DONE |
| 22 | `StoriesSlider.tsx` | `StoriesSlider`, `Story` (type) — horizontal scrollable thumbnails | DONE |
| 23 | `SuggestedStoriesSlider.tsx` | `SuggestedStoriesSlider`, `SuggestedStory` (type) — smaller variant | DONE |
| 24 | `LinkPreviewCard.tsx` | `LinkPreviewCard`, `LinkPreviewCardProps` (type) — URL preview card | DONE |
| 25 | `SponsoredCard.tsx` | `SponsoredCard` — sponsored/ad post with CTA button | DONE |
| 26 | `ChatLauncher.tsx` | `ChatLauncher` — fixed bottom-right floating chat button | DONE |
| 27 | `PeopleCarousel.tsx` | `PeopleCarousel`, `PersonCard`/`PeopleCarouselProps` (types) — horizontal cards | DONE |
| 28 | `NotificationDropdown.tsx` | `NotificationDropdown` — bell dropdown with notification list | DONE |
| 29 | `UserAvatarDropdown.tsx` | `UserAvatarDropdown` — avatar dropdown: profile/settings/sign-out | DONE |
| 30 | `Icons.tsx` | 30 SVG icon components (Home, Chat, Bell, Gear, Search, Plus, Check, Heart, HeartFilled, ThumbsUp, Share, Send, Camera, Video, Calendar, Emoji, Ellipsis, Close, ChevronDown, ChevronLeft, ChevronRight, User, Users, Globe, Photo, Upload, Play, Moon, Sun, Menu) | DONE |
| 31 | `index.ts` | Barrel export — all components, types, and icons | DONE |

### Hooks Created
| File | Hook | Purpose | Status |
|------|------|---------|--------|
| `web/src/hooks/useNavbarActions.tsx` | `useNavbarActions` | Navbar action handlers: create broadcast, create hangout, sign out. Returns `{ user, isCreating, handleSignOut, handleCreateBroadcast, handleCreateHangout }` | DONE (not yet wired into AuthenticatedShell) |
| `web/src/hooks/useSidebarData.ts` | `useSidebarData` | Fetches activity API, derives profile stats, suggestion users, news items for sidebar widgets. Returns `{ profileStats, suggestions, newsItems, loading }` | DONE (not yet wired into AuthenticatedShell) |

### App Integration — COMPLETED
| File | What | Status |
|------|------|--------|
| `web/src/components/AuthenticatedShell.tsx` | Wraps authenticated routes in `AppShell` with `Navbar`, `ProfileSidebar`, `SuggestionWidget`, `NewsWidget`, `FooterLinks`, `ChatLauncher`, `NotificationDropdown`, `UserAvatarDropdown` | DONE |

### Known Issues / Notes
- **Hooks not yet wired**: `useNavbarActions` and `useSidebarData` hooks exist but AuthenticatedShell currently inlines its logic with static/empty data. Wiring these hooks in will connect real API data to the sidebar widgets and navbar actions.
- **Unused import**: AuthenticatedShell imports `BellIcon` from `./social/Icons` but does not use it (TypeScript does not flag this since `noUnusedLocals` is not strict). Can be cleaned up.
- **Processing gate fix**: Pipeline status badge and session audit log correctly gate on processing state, preventing premature display of incomplete transcription/summary data.

---

## Phase 1: Component Library — DONE

All 21 components built across 4 waves. See complete file inventory above.

### Build Strategy (completed)
- **Wave 1** (no deps): Icons, Badge, LoadMoreButton, SearchInput, Tooltip, FooterLinks
- **Wave 2** (depends on Icons/Badge): DropdownMenu, TabNav, OffcanvasSidebar, EngagementBar
- **Wave 3** (depends on Wave 1-2): CreatePostCard, StoriesSlider, ImageGrid, PollCard, LinkPreviewCard, SponsoredCard, PeopleCarousel, SuggestedStoriesSlider
- **Wave 4** (depends on DropdownMenu): NotificationDropdown, UserAvatarDropdown, ChatLauncher

---

## Phase 2: App Integration — DONE

| # | Task | Status |
|---|------|--------|
| 22 | Wire AppShell into router via AuthenticatedShell | DONE |
| 23 | Redesign HomePage — 3-column with real components | DONE |
| 24 | Adapt ActivityFeed cards to use PostCard | DONE |
| 25 | Adapt LiveBroadcastsSlider to StoriesSlider | DONE |
| 26 | Build real Navbar with auth, search, dropdowns | DONE |
| 27 | Build real sidebar data hooks (useNavbarActions, useSidebarData) | DONE |

---

## Phase 3: Page Redesigns — DONE

| # | Page | Status |
|---|------|--------|
| 28 | BroadcastPage — AppShell wrapper, camera preview center, chat sidebar | DONE |
| 29 | ViewerPage — video player center, chat sidebar, reactions overlay | DONE |
| 30 | ReplayViewer — video player center, transcript/summary sidebar | DONE |
| 31 | HangoutPage — video grid center, chat sidebar, participant list | DONE |
| 32 | LoginPage — centered card, brand logo, modern form | DONE |
| 33 | SignupPage — matches LoginPage style | DONE |

---

## Phase 4: Polish — IN PROGRESS

| # | Task | Description | Status |
|---|------|-------------|--------|
| 34 | Dark mode | All components support `dark:` variants, toggle in UserAvatarDropdown, localStorage persistence | TODO |
| 35 | Responsive testing | Test at 375px, 768px, 1200px+. AppShell column collapse, navbar hamburger, offcanvas sidebar | TODO |
| 36 | Page transitions | Fade-in on route change, slide-up cards, skeleton shimmer. Use existing motion library + animate-page-enter | TODO |
| 37 | Docs & demo page | Update barrel exports, create `/components` demo page showcasing all social components | IN PROGRESS |

---

## Reference Template Analysis

### Template Source
Bootstrap "Social Network & Community" NextJS template (ThemeForest #54508767). Full markup was analyzed from the rendered HTML.

### Layout Structure (from markup)
- **Navbar**: `header.fixed-top > nav.navbar > .container` — brand + collapsible search + nav links + icon buttons + avatar
- **3-column grid**: `.container > .row > .col-lg-3 + .col-lg-6.col-md-8 + .col-lg-3`
- **Left sidebar**: Profile card (`.card` with cover + avatar + stats + nav) + footer links
- **Center feed**: Stories slider + post composer + post cards (`.card` with header/body/footer)
- **Right sidebar**: "Who to follow" card + "Today's news" card

### Key Bootstrap Classes -> Tailwind Mapping
| Bootstrap | Tailwind | Used In |
|-----------|----------|---------|
| `.card` | `bg-white rounded-xl shadow-sm overflow-hidden` | Card.tsx |
| `.card-header.border-0` | `px-4 py-3` (no border) | Card.Header borderless |
| `.avatar.avatar-xs` | `w-6 h-6 rounded-full` | Avatar size="xs" |
| `.avatar-story` | gradient ring + white gap | Avatar hasStory |
| `.nav-link-secondary` | `text-gray-600 hover:text-gray-900 hover:bg-gray-50` | ProfileSidebar nav |
| `.btn-primary-soft` | `bg-blue-50 text-blue-600 hover:bg-blue-100` | Soft buttons |
| `.hstack.gap-2` | `flex items-center gap-2` | User rows |
| `.comment-item-nested` | `pl-8 border-l-2 border-gray-200` | CommentThread nesting |
| `.bg-light` | `bg-gray-100` | Comment bubbles, inputs |
| `.icon-md` | `w-9 h-9 flex items-center justify-center` | NavIconButton |
| `.badge-notif.animation-blink` | `absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse` | Notification dot |

### Template Post Card Structure (for reference)
```
.card
  .card-header.border-0.pb-0
    .d-flex.align-items-center.justify-content-between
      .d-flex.align-items-center
        .avatar.avatar-story.me-2 > img.avatar-img.rounded-circle
        div
          .nav.nav-divider > h6.card-title + span.small (timestamp)
          p.small (subtitle)
      .dropdown > a (three dots menu)
  .card-body
    p (text content)
    img.card-img (media)
    ul.nav.nav-stack.small (engagement: liked, comments, share)
    .d-flex (comment input: avatar + textarea + send button)
    ul.comment-wrap (threaded comments)
  .card-footer.border-0.pt-0
    button (load more comments)
```

### Template Comment Structure (for reference)
```
li.comment-item
  .d-flex
    .avatar.avatar-xs > img.rounded-circle
    .ms-2
      .bg-light.rounded.p-3 (bubble)
        .d-flex.justify-content-between > h6 (name) + small (time)
        p.small (content)
      ul.nav.nav-divider.small > Like (N) . Reply . View N replies
  ul.comment-item-nested (recursive children)
```

---

## VNLA-Specific Mapping Details

### CreatePostCard Actions (not generic social -- VNLA-specific)
Instead of Photo/Video/Event/Feeling, the VNLA composer should have:
- **Go Live** (red, camera icon) -> creates BROADCAST session
- **Hangout** (purple, users icon) -> creates HANGOUT session
- **Upload** (green, upload icon) -> opens VideoUploadForm modal
- Optional: "Share your thoughts..." text area for future text posts

### StoriesSlider Content
- "Post a Story" -> "Go Live" dashed card
- Story thumbnails -> active live broadcasts (from LiveBroadcastsSlider data)
- Each story card: broadcast thumbnail + broadcaster name overlay
- Click -> navigate to `/viewer/:sessionId`

### ProfileSidebar Data
- `user.name` -> `cognito:username` from auth
- `user.avatar` -> generate from initials (no profile photos yet)
- `user.subtitle` -> could be "Member since..." or empty
- `user.stats` -> `[{label: 'Sessions', value: count}, {label: 'Recordings', value: count}]` from activity API
- `navItems` -> Feed (home), My Sessions, Recordings, Settings

### SuggestionWidget Data
- Pull from activity API: users who have recently broadcast
- Show as "Active broadcasters" or "Who to watch"

### NewsWidget Data
- Recent recordings with titles/timestamps
- "View all" links to full recordings list

### Auth Integration Notes
- Auth token: `fetchToken()` from `auth/fetchToken.ts`
- Auth headers: `Authorization: Bearer ${token}`
- User info: `useAuth()` hook -> `user.username` (cognito:username)
- API base: `getConfig()?.apiUrl`
- Guard fetches: `if (!authToken) return` + add `authToken` to useEffect deps
