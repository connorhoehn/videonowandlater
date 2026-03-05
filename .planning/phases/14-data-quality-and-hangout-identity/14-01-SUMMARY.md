# Summary: Plan 14-01 — Data Quality Filter and Hangout Identity Fix

## Status: completed

## What Was Done
Fixed two data quality and identity gaps from the v1.1 audit (REPLAY-01, HANG-13).

## Changes Made

### backend/src/repositories/session-repository.ts
- **`getRecentRecordings`**: Added `AND recordingStatus = :available` to the DynamoDB `FilterExpression` — fixes REPLAY-01 (sessions with `recordingStatus='processing'|'failed'|'pending'` no longer appear in home feed)

### web/src/features/hangout/HangoutPage.tsx
- **userId extraction**: Changed from `idToken.payload.sub` (UUID) to `idToken.payload['cognito:username']` — fixes HANG-13 (sessionOwnerId now matches `message.sender.userId` in IVS Chat, which also uses `cognito:username`)

## Requirements Completed
- **REPLAY-01**: Home feed only shows sessions with `recordingStatus='available'` — no more "Awaiting recording..." stubs
- **HANG-13**: HangoutPage userId = `cognito:username`, consistent with `create-chat-token.ts` and `create-session.ts`

## Verification
- `npm run build` in `web/` passes (no TypeScript errors)
- `npm run build` in `backend/` passes (no TypeScript errors)
