---
phase: 36
slug: x-ray-distributed-tracing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30 + ts-jest |
| **Config file** | `backend/jest.config.js` |
| **Quick run command** | `cd backend && npm test -- --testPathPattern "recording-ended|transcode|transcribe|store-summary|on-mediaconvert"` |
| **Full suite command** | `cd backend && npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && npm test -- --testPathPattern "recording-ended|transcode|transcribe|store-summary|on-mediaconvert"`
- **After every plan wave:** Run `cd backend && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 36-01-01 | 01 | 0 | TRACE-02, TRACE-03 | unit (extend) | `cd backend && npm test -- --testPathPattern recording-ended` | ❌ W0 | ⬜ pending |
| 36-01-02 | 01 | 0 | TRACE-02, TRACE-03 | unit (extend) | `cd backend && npm test -- --testPathPattern transcode-completed` | ❌ W0 | ⬜ pending |
| 36-01-03 | 01 | 0 | TRACE-02, TRACE-03 | unit (extend) | `cd backend && npm test -- --testPathPattern transcribe-completed` | ❌ W0 | ⬜ pending |
| 36-01-04 | 01 | 0 | TRACE-02, TRACE-03 | unit (extend) | `cd backend && npm test -- --testPathPattern store-summary` | ❌ W0 | ⬜ pending |
| 36-01-05 | 01 | 0 | TRACE-02, TRACE-03 | unit (extend) | `cd backend && npm test -- --testPathPattern on-mediaconvert` | ❌ W0 | ⬜ pending |
| 36-02-01 | 02 | 1 | TRACE-01 | manual (CDK synth) | `cd infra && npx cdk synth 2>&1 \| grep -i tracing` | ✅ infra exists | ⬜ pending |
| 36-02-02 | 02 | 1 | TRACE-02 | unit | `cd backend && npm test -- --testPathPattern "recording-ended|transcode|transcribe|store-summary|on-mediaconvert"` | ❌ W0 | ⬜ pending |
| 36-03-01 | 03 | 2 | TRACE-03 | unit | `cd backend && npm test -- --testPathPattern "recording-ended|transcode|transcribe|store-summary|on-mediaconvert"` | ❌ W0 | ⬜ pending |
| 36-04-01 | 04 | 3 | TRACE-04 | manual | Open X-Ray console after triggering recording | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/src/handlers/__tests__/recording-ended.test.ts` — extend to mock `Tracer`; assert `captureAWSv3Client` called for `MediaConvertClient` and `DynamoDBClient`; assert `putAnnotation` called with `sessionId` and `pipelineStage`
- [ ] `backend/src/handlers/__tests__/transcode-completed.test.ts` — extend to mock `Tracer`; assert `captureAWSv3Client` for `TranscribeClient`; assert `putAnnotation` with `sessionId` and `pipelineStage`
- [ ] `backend/src/handlers/__tests__/transcribe-completed.test.ts` — extend to mock `Tracer`; assert `captureAWSv3Client` for `S3Client` and `EventBridgeClient`; assert `putAnnotation`
- [ ] `backend/src/handlers/__tests__/store-summary.test.ts` — extend to mock `Tracer`; assert `captureAWSv3Client` for `S3Client` and `BedrockRuntimeClient`; assert `putAnnotation`
- [ ] `backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts` — extend to mock `Tracer`; assert `captureAWSv3Client` for `EventBridgeClient`; assert `putAnnotation`

*(All 5 test files exist — tests need new assertions added, not created from scratch.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CDK deploys Lambda with active tracing enabled | TRACE-01 | Active tracing requires real AWS deployment; CDK synth only verifies property set | After deploy: open Lambda console → Configuration → Monitoring → verify "Active tracing" is enabled for all 5 handlers |
| Service map shows all 5 pipeline nodes | TRACE-04 | X-Ray service map requires real trace emission from live Lambda execution | Trigger a recording → open X-Ray console → Service Map → verify recording-ended, transcode-completed, transcribe-completed, store-summary, on-mediaconvert-complete all appear as nodes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
