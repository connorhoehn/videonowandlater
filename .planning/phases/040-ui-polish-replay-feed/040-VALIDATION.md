---
phase: 40
slug: ui-polish-replay-feed
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + @testing-library/react |
| **Config file** | `web/vitest.config.ts` |
| **Quick run command** | `cd web && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd web && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd web && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd web && npx vitest run && cd ../backend && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 40-01-01 | 01 | 1 | UI-01 | unit | `cd web && npx vitest run src/features/replay/TranscriptDisplay.test.tsx` | ❌ W0 | ⬜ pending |
| 40-01-02 | 01 | 1 | UI-02 | unit | `cd web && npx vitest run src/features/replay/SummaryDisplay.test.tsx` | ✅ (needs update) | ⬜ pending |
| 40-02-01 | 02 | 1 | UI-03 | unit | `cd web && npx vitest run src/features/activity/__tests__/BroadcastActivityCard.test.tsx` | ✅ (needs update) | ⬜ pending |
| 40-02-02 | 02 | 1 | UI-04 | unit | `cd web && npx vitest run src/features/activity/__tests__/BroadcastActivityCard.test.tsx` | ✅ (needs update) | ⬜ pending |
| 40-02-03 | 02 | 1 | UI-05 | unit | `cd web && npx vitest run src/features/activity/__tests__/PipelineStatusBadge.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/src/features/replay/TranscriptDisplay.test.tsx` — stubs for UI-01 (click-to-seek callback)
- [ ] `web/src/features/activity/__tests__/PipelineStatusBadge.test.tsx` — stubs for UI-05 (status badge)
- [ ] Update `web/src/features/replay/SummaryDisplay.test.tsx` — covers UI-02 (verify distinct visual elements)
- [ ] Update `web/src/features/activity/__tests__/BroadcastActivityCard.test.tsx` — covers UI-03, UI-04 (thumbnail, human duration)

*Existing infrastructure covers framework setup; only test file stubs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Video seeks to correct timestamp on click | UI-01 | Requires IVS Player runtime | Click transcript segment, verify player position matches segment startTime |
| Polling stops after navigation | UI-05 | Requires browser navigation lifecycle | Navigate away from HomePage, verify no console errors from stale interval |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
