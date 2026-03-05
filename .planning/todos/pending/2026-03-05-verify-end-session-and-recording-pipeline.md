---
created: 2026-03-05T15:04:23.807Z
title: Verify end-session flow and recording pipeline after deploy
area: api
files:
  - backend/src/handlers/end-session.ts
  - backend/src/handlers/stream-started.ts
  - backend/src/handlers/stream-ended.ts
  - backend/src/handlers/recording-ended.ts
  - web/src/features/broadcast/useBroadcast.ts
  - scripts/diagnose.sh
---

## Problem

Multiple bugs were fixed in one session but not yet verified after deploy:

1. `stream-started` and `stream-ended` Lambdas were reading `event.detail.channel_arn` (undefined) instead of `event.resources[0]` — all invocations errored, sessions never transitioned, recording-ended Lambda never fired
2. No `POST /sessions/:id/end` endpoint existed — frontend had no way to signal session end; relied entirely on EventBridge which was broken
3. Pool leak: `CHANNEL/CLAIMED:4`, `ROOM/CLAIMED:6` from sessions that never released resources
4. Hangout `join-hangout.ts` had no CORS headers on any response

## Solution

After `./scripts/deploy.sh`:

1. Run `./scripts/diagnose.sh 30` — confirm stream-started/stream-ended show 0 errors
2. Do a broadcast, stop it — confirm `[stopBroadcast] end-session API 200` in browser console
3. Check homepage feed shows session as "processing" immediately after stop
4. Wait ~5 min — confirm recording-ended Lambda fires (`diagnose.sh` shows invocation) and session becomes "available" with HLS URL
5. Fix pool leak — sessions `436ca82e`, `f5f2920e`, `107baef5` still `LIVE` with claimed resources that were never released. Either run `./scripts/cleanup-resources.sh` or update `end-session.ts` to also release pool resources when called
