# Deferred Items (Phase 08)

## Out of Scope - Pre-existing Issues

### TypeScript compilation errors in test files
**Found during:** Plan 08-01 Task 3 verification
**Files affected:**
- `src/handlers/__tests__/recording-ended.test.ts` (lines 56, 80)
- `src/handlers/__tests__/stream-started.test.ts` (lines 52, 74)

**Error:** `Expected 1 arguments, but got 3` - appears to be mock function signature mismatch

**Impact:** Tests may be failing in these handlers, but doesn't affect current plan execution

**Resolution:** Deferred - not blocking current task, appears to be from previous phase
