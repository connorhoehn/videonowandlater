---
phase: 38
slug: idempotency-gap-coverage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x (TypeScript) |
| **Config file** | `backend/jest.config.js` |
| **Quick run command** | `cd backend && npm test -- transcribe-completed.test` |
| **Full suite command** | `cd backend && npm test` |
| **Estimated runtime** | ~10 seconds (phase tests), ~2 minutes (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- {handler}.test.ts`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green (480+ tests passing)
- **Max feedback latency:** 2 seconds per test run

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 038-01-01 | 01 | 0 | IDEM-01 | unit | `npm test -- transcribe-completed.test.ts` | ✅ | ⬜ pending |
| 038-01-02 | 01 | 0 | IDEM-02 | unit | `npm test -- store-summary.test.ts` | ✅ | ⬜ pending |
| 038-01-03 | 01 | 0 | IDEM-03 | unit | `npm test -- transcribe-completed.test.ts` | ✅ | ⬜ pending |
| 038-02-01 | 02 | 1 | IDEM-01 | integration | `npm test -- transcribe-completed.test.ts` | ✅ | ⬜ pending |
| 038-03-01 | 03 | 1 | IDEM-02 | integration | `npm test -- store-summary.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/handlers/__tests__/transcribe-completed.test.ts` — add IDEM-01 test (verify second invocation skips S3 write)
- [ ] `backend/src/handlers/__tests__/store-summary.test.ts` — add IDEM-02 test (verify second invocation skips Bedrock)
- [ ] `backend/src/handlers/__tests__/transcribe-completed.test.ts` — add IDEM-03 test (concurrent Promise.all delivery)
- [ ] `infra/lib/tables/idempotency.ts` — CDK table definition for `vnl-idempotency` table with TTL

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DLQ re-drive scenario with sessionId stability | IDEM-01, IDEM-02 | Requires real SQS DLQ re-drive workflow | Send test message to SQS, manually trigger re-drive via Phase 39 CLI tools; verify no duplicate S3 writes or Bedrock calls |
| Lambda timeout → INPROGRESS recovery | Concurrent idempotency | Requires Lambda context lifecycle outside unit test | Use Phase 39 DLQ tooling to re-drive a message that times out; verify recovery without second side effect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test cases for IDEM-01, IDEM-02, IDEM-03; CDK table)
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
