# Deferred Items - Phase 05

## Out-of-Scope Issues Found During Plan 05-01

### Pre-existing TypeScript Errors in Backend Package

**Found during:** Task 2 - Session domain extension
**Issue:** Backend package has compilation errors unrelated to session.ts changes:
- Test files using incorrect function signatures (recording-ended.test.ts, stream-started.test.ts)
- session-repository.ts has incorrect import path (missing .js extension for ESM)

**Files affected:**
- backend/src/handlers/__tests__/recording-ended.test.ts
- backend/src/handlers/__tests__/stream-started.test.ts
- backend/src/repositories/session-repository.ts

**Status:** Out of scope for Phase 05-01. These are pre-existing issues not caused by current work.
**Note:** session.ts compiles successfully in isolation. These errors do not block recording infrastructure implementation.

---

*These items should be addressed in a separate maintenance plan or during relevant feature work.*
