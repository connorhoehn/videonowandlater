---
phase: 37
slug: event-schema-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30 + ts-jest |
| **Config file** | `backend/jest.config.js` |
| **Quick run command** | `cd backend && npm test -- --testNamePattern="validation" --maxWorkers=4` |
| **Full suite command** | `cd backend && npm test` |
| **Estimated runtime** | ~60 seconds full, ~30 seconds validation-only |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && npm test -- --testNamePattern="validation" --maxWorkers=4`
- **After every plan wave:** Run `cd backend && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 01 | 0 | VALID-01 | unit (schema defs) | `npm test -- --testNamePattern="validation"` | ❌ W0 | ⬜ pending |
| 37-01-02 | 01 | 0 | VALID-02 | unit (validation failure) | `npm test -- recording-ended.test.ts -t "validation.*failure"` | ❌ W0 | ⬜ pending |
| 37-01-03 | 01 | 0 | VALID-03 | unit (transient error) | `npm test -- start-transcribe.test.ts -t "transient"` | ❌ W0 | ⬜ pending |
| 37-01-04 | 01 | 0 | VALID-04 | unit (structured logging) | `npm test -- --testNamePattern="logs.*validation"` | ❌ W0 | ⬜ pending |
| 37-02-01 | 02 | 1 | VALID-01, VALID-02 | unit | `npm test -- recording-ended.test.ts` | ✅ extend | ⬜ pending |
| 37-02-02 | 02 | 1 | VALID-01, VALID-02 | unit | `npm test -- transcode-completed.test.ts` | ✅ extend | ⬜ pending |
| 37-03-01 | 03 | 1 | VALID-01, VALID-02 | unit | `npm test -- transcribe-completed.test.ts` | ✅ extend | ⬜ pending |
| 37-03-02 | 03 | 1 | VALID-01, VALID-02 | unit | `npm test -- store-summary.test.ts` | ✅ extend | ⬜ pending |
| 37-04-01 | 04 | 2 | VALID-03 | unit | `npm test -- start-transcribe.test.ts -t "transient\|ThrottlingException"` | ✅ extend | ⬜ pending |
| 37-04-02 | 04 | 2 | VALID-03 | integration | `npm test -- start-transcribe.test.ts` | ✅ extend | ⬜ pending |
| 37-05-01 | 05 | 2 | VALID-01 | unit | `npm test -- on-mediaconvert-complete.test.ts` | ✅ extend | ⬜ pending |
| 37-05-02 | 05 | 2 | VALID-04 | unit | `npm test -- --testNamePattern="logs.*error"` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/handlers/schemas/recording-ended.schema.ts` — Zod discriminated union for broadcast/hangout/recovery EventBridge envelopes
- [ ] `backend/src/handlers/schemas/transcode-completed.schema.ts` — MediaConvertJobDetail with userMetadata.sessionId extraction
- [ ] `backend/src/handlers/schemas/transcribe-completed.schema.ts` — TranscribeJobDetail with job status enum
- [ ] `backend/src/handlers/schemas/store-summary.schema.ts` — TranscriptStoreDetail with sessionId + transcriptS3Uri validation
- [ ] `backend/src/handlers/schemas/start-transcribe.schema.ts` — UploadRecordingAvailableDetail with sessionId + recordingHlsUrl required
- [ ] `backend/src/handlers/schemas/on-mediaconvert-complete.schema.ts` — MediaConvertJobDetail with jobName validation
- [ ] `backend/package.json` — add `zod@^3.23` dependency
- [ ] Test files: Add validation failure and transient error test cases to all 5 handler test files

*(Schema definitions and test extensions needed; handler code refactoring in Plans 02-05.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Invalid JSON in SQS message is acknowledged without retry | VALID-01 | SQS batch semantics visible in CloudWatch; no automated check needed | Send malformed JSON to pipeline SQS queue; verify in CloudWatch Logs that message was acknowledged (not retried) and logged with specific validation error |
| Transient Transcribe error triggers SQS retry (not DLQ) | VALID-03 | SQS retry behavior visible in metrics; DLQ placement indicates max retries exhausted | In test: mock TranscribeClient to throw ThrottlingException; verify handler rethrows (not returns); SQS will retry automatically |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
