---
phase: 18-homepage-redesign-activity-feed
verified: 2026-03-05T19:52:00Z
status: gaps_found
score: 7/7 truths verified, 1 gap (missing frontend test files declared in plan)
re_verification:
  previous_status: passed
  previous_score: 23/23
  gaps_closed: []
  gaps_remaining:
    - "Plan 18-02 declared 5 frontend test files in files_modified but none were created"
  regressions: []
gaps:
  - truth: "All activity components have declared test coverage from Plan 18-02"
    status: failed
    reason: "Plan 18-02 declared 5 test files in files_modified but none were created. The web/src/features/activity/__tests__/ directory exists but is empty."
    artifacts:
      - path: web/src/features/activity/__tests__/ReactionSummaryPills.test.tsx
        issue: "MISSING - declared in plan 18-02 files_modified but does not exist"
      - path: web/src/features/activity/__tests__/RecordingSlider.test.tsx
        issue: "MISSING - declared in plan 18-02 files_modified but does not exist"
      - path: web/src/features/activity/__tests__/ActivityFeed.test.tsx
        issue: "MISSING - declared in plan 18-02 files_modified but does not exist"
      - path: web/src/features/activity/__tests__/BroadcastActivityCard.test.tsx
        issue: "MISSING - declared in plan 18-02 files_modified but does not exist"
      - path: web/src/features/activity/__tests__/HangoutActivityCard.test.tsx
        issue: "MISSING - declared in plan 18-02 files_modified but does not exist"
    missing:
      - "Create unit tests for ReactionSummaryPills (renders pills, empty state, correct counts)"
      - "Create unit tests for RecordingSlider (broadcasts only filter, scroll-snap class, navigation)"
      - "Create unit tests for ActivityFeed (sort order, card type dispatch, empty state)"
      - "Create unit tests for BroadcastActivityCard (all fields rendered, duration format, navigation)"
      - "Create unit tests for HangoutActivityCard (all fields rendered, participant/message counts, navigation)"
---

# Phase 18: Homepage Redesign & Activity Feed Verification Report

**Phase Goal:** The homepage is redesigned with a two-zone layout -- a horizontal scrollable recording slider and an activity feed below it -- and a GET /activity API endpoint returns all session types with full activity metadata
**Verified:** 2026-03-05T19:52:00Z
**Status:** gaps_found
**Re-verification:** Yes -- correcting previous verification that marked as passed but missed 5 missing test files

## Previous Verification Correction

The previous verification (2026-03-06T20:15:00Z) marked this phase as "passed" with 23/23 must-haves verified. Upon re-verification, I found that the previous verifier did not verify the existence of 5 frontend test files declared in Plan 18-02's `files_modified` frontmatter. The `web/src/features/activity/__tests__/` directory exists but is empty. The 5 test files were never created despite being listed in the plan.

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The homepage displays broadcast recordings in a horizontal slider with 3-4 cards visible and peek-scrolling -- hangout sessions do not appear in this slider | VERIFIED | `RecordingSlider.tsx` line 38 filters `sessionType === 'BROADCAST'`; line 49 uses `overflow-x-auto snap-x snap-mandatory scroll-smooth`; cards are `w-56 flex-shrink-0 snap-center` (line 54). `HomePage.tsx` line 150 renders `<RecordingSlider sessions={sessions} />`. |
| 2 | Below the slider, a unified activity feed lists all recent sessions (broadcasts and hangouts) in reverse chronological order | VERIFIED | `ActivityFeed.tsx` lines 16-19 sort by `endedAt` DESC. Lines 33-38 render `BroadcastActivityCard` for BROADCAST and `HangoutActivityCard` for HANGOUT. `HomePage.tsx` line 151 renders `<ActivityFeed sessions={sessions} />` immediately after RecordingSlider. |
| 3 | Broadcast entries in the activity feed show title, duration, reaction summary counts by emoji type, and a relative timestamp ("2 hours ago") | VERIFIED | `BroadcastActivityCard.tsx`: line 49 renders `session.userId` (title), line 51 renders `formatDuration` + `formatDate` (duration and relative timestamp), line 56 renders `<ReactionSummaryPills reactionSummary={session.reactionSummary} />`. `formatDate()` returns "just now", "2m", "2h", "3d" etc. (lines 20-33). |
| 4 | Hangout entries in the activity feed show participant list, message count, duration, and a relative timestamp | VERIFIED | `HangoutActivityCard.tsx`: line 52 renders `participantCount` with plural handling, line 53 renders `messageCount` with plural handling, `formatDuration()` and `formatDate()` (line 54). |
| 5 | Reaction summary counts (per emoji type) are visible on recording cards in the slider | VERIFIED | `RecordingSlider.tsx` line 79: `<ReactionSummaryPills reactionSummary={session.reactionSummary} />` inside each broadcast card. `ReactionSummaryPills.tsx` line 21 maps `EMOJI_MAP[emojiType]` + count. |
| 6 | Reaction summary counts are displayed in the replay info panel when viewing a recording | VERIFIED | `ReplayViewer.tsx` line 18 imports `ReactionSummaryPills`; lines 328-331 render "Reactions" heading + `<ReactionSummaryPills reactionSummary={session?.reactionSummary} />` in the metadata panel. Session interface at line 28 includes `reactionSummary?: Record<string, number>`. 4 vitest tests confirm behavior. |
| 7 | GET /activity returns recent sessions with all activity metadata in a single API call -- the frontend does not aggregate counts at read time | VERIFIED | `list-activity.ts` line 25 calls `getRecentActivity(tableName, 20)`, line 34 returns `{ sessions }`. `getRecentActivity()` in `session-repository.ts` (lines 596-635) scans ended sessions, sorts DESC by endedAt, returns Session[] with reactionSummary, participantCount, messageCount fields. `HomePage.tsx` line 26 fetches from `/activity`, line 29 sets `sessions` state. No frontend aggregation logic present. |

**Score:** 7/7 truths verified

### Required Artifacts

#### Plan 18-01: Activity Feed API

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/src/handlers/list-activity.ts` | GET /activity Lambda handler | VERIFIED | 48 lines; imports getRecentActivity; returns { sessions }; CORS headers; error handling for 500 and missing TABLE_NAME |
| `backend/src/handlers/__tests__/list-activity.test.ts` | Unit tests for list-activity | VERIFIED | 247 lines; 9 tests all passing (ordering, reactionSummary, participantCount, messageCount, limit, empty, error, env var, CORS) |
| `backend/src/repositories/session-repository.ts` | getRecentActivity() function | VERIFIED | Lines 596-635; ScanCommand with filter for ended/ending sessions; sorts DESC by endedAt; slices to limit |
| `backend/src/handlers/send-message.ts` | messageCount atomic increment | VERIFIED | Lines 119-132; UpdateCommand with `SET messageCount = if_not_exists(messageCount, :zero) + :inc` |
| `backend/src/domain/session.ts` | messageCount field on Session | VERIFIED | Line 72: `messageCount?: number` with comment "Chat activity (tracked atomically in send-message handler)" |
| `infra/lib/stacks/api-stack.ts` | GET /activity CDK route | VERIFIED | Lines 352-368; NodejsFunction for list-activity.ts; public endpoint (no authorizer); grantReadData |

#### Plan 18-02: Homepage UI Components

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `web/src/features/activity/ReactionSummaryPills.tsx` | Emoji + count pill component | VERIFIED | 27 lines; accepts `reactionSummary?: Record<string, number>`; renders EMOJI_MAP pills; "No reactions" empty state |
| `web/src/features/activity/RecordingSlider.tsx` | Horizontal broadcast slider | VERIFIED | 88 lines; exports ActivitySession interface; filters BROADCAST; CSS scroll-snap; cards navigate to /replay/:sessionId |
| `web/src/features/activity/ActivityFeed.tsx` | Vertical activity feed | VERIFIED | 43 lines; sorts DESC; dispatches BroadcastActivityCard vs HangoutActivityCard; "No activity yet" empty state |
| `web/src/features/activity/BroadcastActivityCard.tsx` | Broadcast activity card | VERIFIED | 60 lines; renders userId, formatDuration, ReactionSummaryPills, formatDate; navigates on click |
| `web/src/features/activity/HangoutActivityCard.tsx` | Hangout activity card | VERIFIED | 60 lines; renders userId, participantCount, messageCount (with plural), formatDuration, formatDate; navigates on click |
| `web/src/pages/HomePage.tsx` | Homepage with two-zone layout | VERIFIED | 157 lines; fetches GET /activity; renders RecordingSlider + ActivityFeed; loading spinner; error handling |
| `web/src/features/activity/__tests__/ReactionSummaryPills.test.tsx` | Component tests | MISSING | Declared in plan 18-02 files_modified but file does not exist |
| `web/src/features/activity/__tests__/RecordingSlider.test.tsx` | Component tests | MISSING | Declared in plan 18-02 files_modified but file does not exist |
| `web/src/features/activity/__tests__/ActivityFeed.test.tsx` | Component tests | MISSING | Declared in plan 18-02 files_modified but file does not exist |
| `web/src/features/activity/__tests__/BroadcastActivityCard.test.tsx` | Component tests | MISSING | Declared in plan 18-02 files_modified but file does not exist |
| `web/src/features/activity/__tests__/HangoutActivityCard.test.tsx` | Component tests | MISSING | Declared in plan 18-02 files_modified but file does not exist |

#### Plan 18-03: Replay Viewer Reaction Summary

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `web/src/features/replay/ReplayViewer.tsx` | Extended info panel with reactions | VERIFIED | Line 18 imports ReactionSummaryPills; lines 328-331 render in info panel with "Reactions" heading |
| `web/src/features/replay/__tests__/ReplayViewer.test.tsx` | Unit tests for reaction display | VERIFIED | 225 lines; 4 tests passing (reaction display, empty state, broadcaster info, duration) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| list-activity.ts | getRecentActivity() | import and invoke | WIRED | Line 6 import; line 25 `getRecentActivity(tableName, 20)` |
| getRecentActivity() | DynamoDB | ScanCommand with filter | WIRED | Lines 602-613: ScanCommand; FilterExpression `#status IN (:ended, :ending) AND begins_with(PK, :pk)` |
| send-message.ts | session.messageCount | UpdateCommand atomic increment | WIRED | Lines 121-132: `SET messageCount = if_not_exists(messageCount, :zero) + :inc` |
| api-stack.ts | list-activity.ts | CDK LambdaIntegration | WIRED | Line 355 NodejsFunction entry; line 365 grantReadData; line 368 GET method with no authorizer |
| HomePage.tsx | GET /activity | fetch in useEffect | WIRED | Line 26 `fetch(\`${config.apiUrl}/activity\`)`; line 29 `setSessions(data.sessions)` |
| RecordingSlider.tsx | BROADCAST filter | filter in render | WIRED | Line 38: `sessions.filter((s) => s.sessionType === 'BROADCAST')` |
| BroadcastActivityCard.tsx | ReactionSummaryPills | import and render | WIRED | Line 7 import; line 56 `<ReactionSummaryPills reactionSummary={session.reactionSummary} />` |
| ReplayViewer.tsx | ReactionSummaryPills | import and render | WIRED | Line 18 import; line 330 `<ReactionSummaryPills reactionSummary={session?.reactionSummary} />` |
| ReplayViewer.tsx | session.reactionSummary | existing GET /sessions/:id fetch | WIRED | Line 28 Session interface includes reactionSummary; line 94 setSession(data) from fetch |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ACTV-01 | 18-02 | Homepage displays broadcast recordings in horizontal scrollable slider (3-4 visible with peek) | SATISFIED | RecordingSlider.tsx with scroll-snap CSS, w-56 cards, BROADCAST filter |
| ACTV-02 | 18-02 | Homepage displays unified activity feed below slider showing all recent sessions | SATISFIED | ActivityFeed.tsx rendered after RecordingSlider in HomePage.tsx |
| ACTV-03 | 18-02 | Broadcast entries show title, duration, reaction summary counts, relative timestamp | SATISFIED | BroadcastActivityCard.tsx renders userId, formatDuration, ReactionSummaryPills, formatDate |
| ACTV-04 | 18-02 | Hangout entries show participant list, message count, duration, relative timestamp | SATISFIED | HangoutActivityCard.tsx renders participantCount, messageCount, formatDuration, formatDate |
| ACTV-05 | 18-02 | Hangout sessions filtered out of recording slider | SATISFIED | RecordingSlider.tsx line 38: `sessions.filter(s => s.sessionType === 'BROADCAST')` |
| ACTV-06 | 18-01 | GET /activity API endpoint returns recent sessions with all activity metadata | SATISFIED | list-activity.ts handler + getRecentActivity repo + CDK wiring; 9 backend tests pass |
| RSUMM-02 | 18-02 | Reaction summary counts displayed on recording cards on homepage | SATISFIED | RecordingSlider.tsx line 79 and BroadcastActivityCard.tsx line 56 both render ReactionSummaryPills |
| RSUMM-03 | 18-03 | Reaction summary counts displayed in replay info panel | SATISFIED | ReplayViewer.tsx lines 328-331 render ReactionSummaryPills in metadata panel |

**Coverage: 8/8 requirements satisfied (100%)**

No orphaned requirements found -- all 8 IDs from REQUIREMENTS.md assigned to Phase 18 are claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No TODO, FIXME, placeholder, or empty implementation patterns found in any Phase 18 files |

### Test Results

**Backend:** 214/214 tests passing (includes 9 list-activity tests)
**Frontend vitest:** 4/4 ReplayViewer tests passing
**Frontend build:** Succeeds in 1.93s with no errors

### Human Verification Required

### 1. Recording Slider Visual Layout
**Test:** Navigate to homepage with at least 3-4 ended broadcast sessions. Scroll the horizontal slider.
**Expected:** 3-4 cards visible with partial peek of next card. CSS scroll-snap aligns cards smoothly on scroll release. Thumbnails display if available.
**Why human:** CSS scroll-snap visual behavior and peek-scrolling effect cannot be verified programmatically.

### 2. Activity Feed Card Differentiation
**Test:** With both broadcast and hangout sessions ended, view the activity feed below the slider.
**Expected:** Broadcast cards show reaction summary pills with emoji counts. Hangout cards show participant and message counts with correct plural handling. Both show relative timestamps.
**Why human:** Visual distinction, spacing, and readability between card types require human judgment.

### 3. Card Navigation
**Test:** Click a broadcast card in the slider and a hangout card in the activity feed.
**Expected:** Both navigate to `/replay/:sessionId` page. Back button returns to homepage.
**Why human:** Navigation flow and route transitions need interactive testing.

### 4. Replay Info Panel Reactions
**Test:** View a replay of a session that has reaction data. Check the metadata panel below the video.
**Expected:** "Reactions" heading visible with emoji pills showing per-type counts (e.g., heart: 42, fire: 17). Sessions with no reactions show "No reactions" text.
**Why human:** Visual placement within the info panel alongside existing metadata.

### Gaps Summary

All 7 ROADMAP success criteria are verified in the codebase. All 8 requirements are satisfied. The core phase goal is achieved: the homepage has a functioning two-zone layout (recording slider + activity feed) and GET /activity returns all session types with full activity metadata.

**One gap identified:** Plan 18-02 declared 5 frontend test files in its `files_modified` frontmatter (ReactionSummaryPills.test.tsx, RecordingSlider.test.tsx, ActivityFeed.test.tsx, BroadcastActivityCard.test.tsx, HangoutActivityCard.test.tsx), but none were created. The `web/src/features/activity/__tests__/` directory exists but is empty. The 18-02 SUMMARY claims "All 3 tasks completed successfully" but the test files from Tasks 1 and 2 are absent. This is an incomplete plan execution issue rather than a phase goal blocker -- the components themselves are substantive, wired, and the web build succeeds. However, declared artifacts should exist.

The previous verification incorrectly marked this phase as "passed" without checking for the existence of these test files.

---

_Verified: 2026-03-05T19:52:00Z_
_Verifier: Claude (gsd-verifier)_
