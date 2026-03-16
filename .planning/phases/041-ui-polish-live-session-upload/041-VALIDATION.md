---
phase: 41
slug: ui-polish-live-session-upload
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 41 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + @testing-library/react |
| **Config file** | `web/vitest.config.ts` |
| **Quick run command** | `cd web && npx vitest run --reporter=verbose 2>&1 \| tail -20` |
| **Full suite command** | `cd web && npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd web && npx vitest run --reporter=verbose 2>&1 | tail -20`
- **After every plan wave:** Run `cd web && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| UI-06 | Clicking Stop Broadcast shows ConfirmDialog (not stopBroadcast) | unit | `cd web && npx vitest run src/features/broadcast/__tests__/BroadcastPage.test.tsx` | ✅ exists | ⬜ pending |
| UI-06 | Clicking Leave Hangout (both buttons) shows ConfirmDialog | unit | `cd web && npx vitest run src/features/hangout/__tests__/HangoutPage.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-06 | ConfirmDialog cancel does not call stopBroadcast/handleLeave | unit | `cd web && npx vitest run src/features/broadcast/__tests__/BroadcastPage.test.tsx` | ✅ exists | ⬜ pending |
| UI-06 | ConfirmDialog confirm calls stopBroadcast/handleLeave | unit | `cd web && npx vitest run src/components/__tests__/ConfirmDialog.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-07 | ReactionPicker renders in HangoutPage when isJoined | unit | `cd web && npx vitest run src/features/hangout/__tests__/HangoutPage.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-07 | Clicking emoji calls sendReaction | unit | `cd web && npx vitest run src/features/hangout/__tests__/HangoutPage.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-08 | VideoPage starts polling when session not terminal | unit | `cd web && npx vitest run src/features/upload/__tests__/VideoPage.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-08 | VideoPage stops polling when session becomes terminal | unit | `cd web && npx vitest run src/features/upload/__tests__/VideoPage.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-09 | Clicking transcript segment calls seekVideo | unit | `cd web && npx vitest run src/features/replay/TranscriptDisplay.test.tsx` | ✅ exists | ✅ passing |
| UI-09 | Clicking comment row calls onSeek with videoPositionMs | unit | `cd web && npx vitest run src/features/upload/__tests__/CommentThread.test.tsx` | ❌ W0 gap | ⬜ pending |
| UI-09 | Comment submission succeeds when video has played | unit | `cd web && npx vitest run src/features/upload/__tests__/CommentThread.test.tsx` | ❌ W0 gap | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/src/components/__tests__/ConfirmDialog.test.tsx` — covers UI-06 ConfirmDialog component behavior
- [ ] `web/src/features/hangout/__tests__/HangoutPage.test.tsx` — covers UI-06 leave confirm guard, UI-07 reaction parity
- [ ] `web/src/features/upload/__tests__/VideoPage.test.tsx` — covers UI-08 polling behavior
- [ ] `web/src/features/upload/__tests__/CommentThread.test.tsx` — covers UI-09 comment seek + submission

**Note:** `web/src/features/replay/TranscriptDisplay.test.tsx` covers UI-09 transcript seek and is already passing. `web/src/features/broadcast/__tests__/BroadcastPage.test.tsx` exists and will receive new tests for the confirmation dialog.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Floating reactions animate and appear near cursor | UI-07 | Animation behavior requires visual inspection | Open HangoutPage in browser, click emoji in ReactionPicker, confirm animated floating reaction appears near click point and fades out |
| Confirmation dialog styling matches design system | UI-06 | Visual consistency across app theme | Open BroadcastPage, click Stop Broadcast, verify dialog styling (colors, spacing, typography) matches existing dialogs (SpotlightModal) |
| Polling feed refresh feels responsive | UI-08 | Perceived latency varies by network/machine | Start a new recording upload, watch feed cards update within ~15 seconds, then confirm interval backs off to 30/60s as time passes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
