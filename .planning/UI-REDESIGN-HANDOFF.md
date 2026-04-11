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

### New Social Components — COMPLETED (9 files)
All in `web/src/components/social/`, barrel exported via `index.ts`:

| File | Component(s) | Status |
|------|-------------|--------|
| `Avatar.tsx` | `Avatar` — sizes (xs-xl), story ring, online dot, initials fallback | DONE |
| `Card.tsx` | `Card`, `Card.Header/Body/Footer` — compound card wrapper | DONE |
| `PostCard.tsx` | `PostCard` — feed post with author, media, engagement bar, comment input | DONE |
| `CommentThread.tsx` | `CommentThread` — recursive nested comments, like/reply/load-more | DONE |
| `ProfileSidebar.tsx` | `ProfileSidebar` — cover photo, avatar, stats, nav menu | DONE |
| `SuggestionWidget.tsx` | `SuggestionWidget` — "Who to follow" user list with follow buttons | DONE |
| `NewsWidget.tsx` | `NewsWidget` — "Today's news" headlines with timestamps | DONE |
| `Navbar.tsx` | `Navbar`, `NavIconButton` — fixed top bar with search, nav links, icon buttons | DONE |
| `AppShell.tsx` | `AppShell` — 3-column responsive grid (280px / 1fr / 300px) | DONE |

---

## Phase 1: Remaining Component Library

### Feed Components
| # | Component | File | Description |
|---|-----------|------|-------------|
| 1 | `CreatePostCard` | `CreatePostCard.tsx` | Post composer: avatar + textarea + action buttons (Photo, Video, Event, Feeling). For VNLA: "Go Live" / "Hangout" / "Upload" actions |
| 2 | `StoriesSlider` | `StoriesSlider.tsx` | Horizontal scrollable story thumbnails with "Post a Story" dashed card. Maps to LiveBroadcastsSlider |
| 3 | `ImageGrid` | `ImageGrid.tsx` | Multi-image layout: 1=full, 2=side-by-side, 3+=grid with "View all" overlay |
| 4 | `PollCard` | `PollCard.tsx` | Poll post: radio options (pre-vote) or progress bars (post-vote) with percentages |
| 5 | `LinkPreviewCard` | `LinkPreviewCard.tsx` | URL preview card: image + link + title + description |
| 6 | `SponsoredCard` | `SponsoredCard.tsx` | Sponsored/ad post: brand avatar, "Sponsored" label, CTA button |
| 7 | `PeopleCarousel` | `PeopleCarousel.tsx` | "People you may know" horizontal card carousel with prev/next arrows |
| 8 | `SuggestedStoriesSlider` | `SuggestedStoriesSlider.tsx` | "Suggested stories" slider at bottom of feed (smaller variant) |
| 9 | `EngagementBar` | `EngagementBar.tsx` | Standalone like/comment/share bar. Two variants: stacked and inline-fill |

### UI Primitives
| # | Component | File | Description |
|---|-----------|------|-------------|
| 10 | `Icons` | `Icons.tsx` | Centralized SVG icon set: home, chat, bell, gear, search, plus, check, heart, thumbsUp, share, send, camera, video, calendar, emoji, ellipsis, close, chevron, user, users, globe, photo |
| 11 | `LoadMoreButton` | `LoadMoreButton.tsx` | "Load more" with animated bouncing dots. Variants: link-style, primary-soft |
| 12 | `DropdownMenu` | `DropdownMenu.tsx` | Trigger + positioned panel with items, dividers, submenu support |
| 13 | `SearchInput` | `SearchInput.tsx` | Rounded search input with icon, clear button, debounced onChange |
| 14 | `Badge` | `Badge.tsx` | Status pill: primary/success/danger/warning/info, sizes sm/md |
| 15 | `Tooltip` | `Tooltip.tsx` | Hover tooltip, positions: top/bottom/left/right |
| 16 | `TabNav` | `TabNav.tsx` | Horizontal tabs with active underline. For profile/settings pages |
| 17 | `OffcanvasSidebar` | `OffcanvasSidebar.tsx` | Mobile slide-in sidebar with overlay backdrop |

### Interactive Widgets
| # | Component | File | Description |
|---|-----------|------|-------------|
| 18 | `ChatLauncher` | `ChatLauncher.tsx` | Fixed bottom-right floating chat button, opens ChatPanel |
| 19 | `NotificationDropdown` | `NotificationDropdown.tsx` | Navbar bell dropdown: notification list with avatar/message/timestamp, read/unread |
| 20 | `UserAvatarDropdown` | `UserAvatarDropdown.tsx` | Navbar avatar dropdown: user info, Profile/Settings/Sign Out, dark mode toggle |
| 21 | `FooterLinks` | `FooterLinks.tsx` | Small horizontal footer links + copyright |

### Build Strategy
- Launch parallel agents grouped by dependency:
  - **Wave 1** (no deps): Icons, Badge, LoadMoreButton, SearchInput, Tooltip, FooterLinks
  - **Wave 2** (depends on Icons/Badge): DropdownMenu, TabNav, OffcanvasSidebar, EngagementBar
  - **Wave 3** (depends on Wave 1-2): CreatePostCard, StoriesSlider, ImageGrid, PollCard, LinkPreviewCard, SponsoredCard, PeopleCarousel, SuggestedStoriesSlider
  - **Wave 4** (depends on DropdownMenu): NotificationDropdown, UserAvatarDropdown, ChatLauncher

---

## Phase 2: App Integration

| # | Task | Description |
|---|------|-------------|
| 22 | Wire AppShell into router | Update `App.tsx` so authenticated routes wrap in `AppShell`. Login/signup stay standalone. Remove unused `Layout.tsx` |
| 23 | Redesign HomePage | 3-column: left=ProfileSidebar (real user), center=CreatePostCard + StoriesSlider + ActivityFeed, right=SuggestionWidget + NewsWidget. Remove inline header |
| 24 | Adapt ActivityFeed cards | Refactor BroadcastActivityCard, HangoutActivityCard, UploadActivityCard to use PostCard. Map session data → PostCard props. Keep PipelineStatusBadge |
| 25 | Adapt LiveBroadcastsSlider | Replace with StoriesSlider. "Post a Story" becomes "Go Live". Map live sessions to story cards |
| 26 | Build real Navbar | Wire with auth: brand, search (filter sessions), nav links, NotificationDropdown, UserAvatarDropdown with sign-out, action buttons (Go Live/Hangout/Upload) |
| 27 | Build real sidebar data | ProfileSidebar → auth user data. SuggestionWidget → recent broadcasters. NewsWidget → recent recordings/trending. All from real API |

---

## Phase 3: Page Redesigns

| # | Page | Key Changes |
|---|------|-------------|
| 28 | BroadcastPage | AppShell wrapper, camera preview center, chat in right sidebar, stream controls in Card components |
| 29 | ViewerPage | Video player center, chat right sidebar, reactions overlay, viewer info below player |
| 30 | ReplayViewer | Video player center, transcript/summary sidebar, chapters list, reaction timeline |
| 31 | HangoutPage | Video grid center, chat sidebar, participant list in Cards |
| 32 | LoginPage | Centered card, brand logo, modern form styling, social login buttons |
| 33 | SignupPage | Match LoginPage style, terms checkbox, link to login |

---

## Phase 4: Polish

| # | Task | Description |
|---|------|-------------|
| 34 | Dark mode | All components support `dark:` variants, toggle in UserAvatarDropdown, localStorage persistence |
| 35 | Responsive testing | Test at 375px, 768px, 1200px+. AppShell column collapse, navbar hamburger, offcanvas sidebar |
| 36 | Page transitions | Fade-in on route change, slide-up cards, skeleton shimmer. Use existing motion library + animate-page-enter |
| 37 | Docs & demo page | Update barrel exports, create `/components` demo page showcasing all social components |

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

### Key Bootstrap Classes → Tailwind Mapping
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
      ul.nav.nav-divider.small > Like (N) · Reply · View N replies
  ul.comment-item-nested (recursive children)
```

---

## VNLA-Specific Mapping Details

### CreatePostCard Actions (not generic social — VNLA-specific)
Instead of Photo/Video/Event/Feeling, the VNLA composer should have:
- **Go Live** (red, camera icon) → creates BROADCAST session
- **Hangout** (purple, users icon) → creates HANGOUT session  
- **Upload** (green, upload icon) → opens VideoUploadForm modal
- Optional: "Share your thoughts..." text area for future text posts

### StoriesSlider Content
- "Post a Story" → "Go Live" dashed card
- Story thumbnails → active live broadcasts (from LiveBroadcastsSlider data)
- Each story card: broadcast thumbnail + broadcaster name overlay
- Click → navigate to `/viewer/:sessionId`

### ProfileSidebar Data
- `user.name` → `cognito:username` from auth
- `user.avatar` → generate from initials (no profile photos yet)
- `user.subtitle` → could be "Member since..." or empty
- `user.stats` → `[{label: 'Sessions', value: count}, {label: 'Recordings', value: count}]` from activity API
- `navItems` → Feed (home), My Sessions, Recordings, Settings

### SuggestionWidget Data  
- Pull from activity API: users who have recently broadcast
- Show as "Active broadcasters" or "Who to watch"

### NewsWidget Data
- Recent recordings with titles/timestamps
- "View all" links to full recordings list

### Auth Integration Notes
- Auth token: `fetchToken()` from `auth/fetchToken.ts`
- Auth headers: `Authorization: Bearer ${token}`
- User info: `useAuth()` hook → `user.username` (cognito:username)
- API base: `getConfig()?.apiUrl`
- Guard fetches: `if (!authToken) return` + add `authToken` to useEffect deps
