# Constitution: videonowandlater

> Living document. Operator-edits override; agent-proposed edits go via
> handoff to operator (don't silent-commit). Workers re-read on every
> `/clear`. This is the north star when no task is dispatched.

## Mission

Live + recorded video streaming app built on AWS IVS — broadcast
sessions (one-to-many), hangout sessions (multi-participant), chat,
reactions, replay, broadcaster filters, live engagement, creator
notifications. Continue shipping user-facing video features without
operating the AWS cloud account.

## Scope

**This project IS:**
- A monorepo with three workspaces:
  - `web/` — React + Vite frontend (IVS player/broadcaster, AWS Amplify auth)
  - `backend/` — TypeScript Lambda handlers, DynamoDB repos, domain models, dev CLI
  - `infra/` — AWS CDK stacks (Cognito, API Gateway, Lambda, DynamoDB, IVS)
- Plus an `ios/` native app.
- Real production code on origin/main (not greenfield).

**This project IS NOT:**
- A library — there are no consumers besides the end-user.
- A place to roll your own consensus / queueing primitives — that's
  `distributed-core`'s job (and may someday be consumed here, but only
  on a real pull signal).

## Hard rules (non-negotiable, in addition to worker-template.md)

1. **NEVER run cloud apply.** Specifically:
   - `cdk deploy`, `cdk destroy`, `cdk bootstrap` — operator only.
   - `aws ... create / update / delete / put / sync` — operator only
     (read-only `aws ... describe / list / get` is OK for diagnostics).
   - `npm run deploy`, `npm run destroy`, `./scripts/deploy.sh`,
     `./scripts/destroy-all.sh` — operator only.
   - Any IAM, Cognito user-pool, or API Gateway change that lands in
     a real AWS account.
   You may *write* IaC (CDK code), *run synth*, *run unit tests*. You
   may NOT execute apply.
2. **NEVER alter production data** — DynamoDB items, S3 objects, IVS
   channels live, replay assets — even via "dev" tooling.
3. **No direct credentials in code or commits.** Existing patterns
   (Cognito, AWS SDK, SSM-backed JWT) are fine to extend; new secrets
   go in env or SSM, never inline.
4. The "no AWS deploys" hard rule already in worker-template.md
   applies fully here — these are amplifications, not exceptions.

## Current phase

**Unknown — to be determined.** First task should audit:
- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/MILESTONES.md`,
  `.planning/v1.1-MILESTONE-AUDIT.md`, `.planning/v1.3-MILESTONE-CONTEXT.md`
- Recent git log — last 10 commits show recent feature focus
  (filters, live engagement, ads/JWT/Polly, UI polish from QA pass).
- Open `.planning/HANDOFF-*` and `*-HANDOFF.md` documents.

…then propose a `## Current phase` and `## Phase north-star` edit to
this constitution via handoff to orchestrator.

## Self-driven backlog (placeholder — refresh after the audit)

Until the audit kickoff task lands, idle when the dispatched queue is
empty. Don't self-generate against this placeholder list.

The audit task will populate this section. Likely candidate buckets
based on a quick skim:
1. Roadmap items still queued in `.planning/ROADMAP.md`.
2. Open follow-ups from `RETROSPECTIVE.md` and the QA pass commits.
3. iOS app gaps surfaced in `MOBILE-APP-HANDOFF.md` /
   `iOS-BUILD-GUIDE.md`.
4. Stories system follow-ups (`STORIES-SYSTEM-PLAN.md`).
5. UI redesign follow-ups (`UI-REDESIGN-HANDOFF.md`).

## User-facing framing

Three personas (same shape as websocket-gateway):
- **End-user (creator/viewer)**: people broadcasting + people watching
  + people in hangout sessions. What they see, what works, what stops
  breaking.
- **Tenant operator (creator-admin)**: people managing their channel,
  ads, monetization, replay library.
- **Platform operator (you, on-call)**: what they can debug from
  CloudWatch / DynamoDB inspect / the dev CLI.

Frame `User impact:` summaries in the right persona for the change.
For pure infra refactors with no user-visible change, say so
explicitly.

## Good-enhancement criteria

A self-driven task is worth claiming if it satisfies AT LEAST ONE of:
- Closes a `.planning/` follow-up older than 2 weeks.
- Removes a documented techdebt / QA-pass item.
- Adds tests for a code path with thin coverage.
- Hardens a recently-shipped feature surface.
- Improves operator visibility (CloudWatch metric names, log
  structure, dev CLI ergonomics).

A self-driven task is **NOT** worth claiming if it:
- Adds an exported symbol with no consumer.
- Refactors a green code path with no measured benefit.
- Touches CDK infra without a corresponding user-facing reason
  (refactor-for-refactor on infra is high-blast-radius).
- Spends >200 LOC across implementation. Larger ⇒ raise a blocker
  for operator scope review.

## Daily cap

**Default: up to 30 self-driven tasks per UTC day per agent session.**
Override file: `$AGENT_HUB_ROOT/.budget-videonowandlater` (integer)
supersedes the default when present. Read every `/clear`.

Anthropic weekly limit handled separately via `.cooldown_until`.

## Constitution review cadence

After every 5 self-driven `task.done` events, run a constitution
review per worker-template.md. Propose edits via handoff to
orchestrator — never silent-commit constitution changes.

## Cross-repo contracts

Today: none. This project is a leaf application; no other agent pins
to its source. Producers it depends on:
- AWS APIs (external, versioned by AWS).
- AWS Amplify libraries (external).
- `@aws-sdk/client-rekognition` and other AWS SDK pins (in
  `package.json`).

If `distributed-core` ever surfaces a primitive useful here (e.g.,
T9 DLQ for video-processing pipelines), adopt deliberately as a
phase-scoped task — don't pre-adopt.

## Kill-switch

If `$AGENT_HUB_ROOT/.no_self_driven` exists, do NOT enter the
self-generation step. Only execute dispatched work. Idle when the
dispatched queue is empty.
