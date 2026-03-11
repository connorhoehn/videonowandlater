# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- ✅ **v1.3 Secure Sharing** - Phases 21-22 (shipped 2026-03-06 as part of v1.2)
- ✅ **v1.4 Creator Studio & Stream Quality** - Phases 22.1, 23-24 (shipped 2026-03-10)
- ✅ **v1.5 Pipeline Reliability, Moderation & Upload Experience** - Phases 22.1, 23-30 (shipped 2026-03-11)

## Phases

<details>
<summary>✅ v1.0 Gap Closure (Phases 1-4.2) - SHIPPED 2026-03-02</summary>

Milestone completed. See milestones/v1.0-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.1 Replay, Reactions & Hangouts (Phases 5-15) - SHIPPED 2026-03-05</summary>

Milestone completed. See milestones/v1.1-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.2 Activity Feed & Intelligence (Phases 16-22) - SHIPPED 2026-03-06</summary>

**Milestone Goal:** Surface richer session context on the homepage — hangout activity cards, reaction summary counts, horizontal recording slider, and activity feed — and add an automated transcription and AI summary pipeline to every recording.

**What Was Built:**
- Phase 16: Hangout Participant Tracking — Durably record participant joins in DynamoDB with participantCount field on session
- Phase 17: Reaction Summary at Session End — Pre-compute per-emoji reaction counts when sessions end
- Phase 18: Homepage Redesign & Activity Feed — Two-zone layout with recording slider and activity feed below
- Phase 19: Transcription Pipeline — Automated S3-to-Transcribe pipeline triggered by recording completion
- Phase 20: AI Summary Pipeline — Inline Bedrock call generates one-paragraph summaries for every recording
- Phase 21: Video Uploads — Users can upload pre-recorded videos (MOV/MP4) with automatic adaptive bitrate encoding
- Phase 22: Live Broadcast with Secure Viewer Links — Private broadcasts with ES384 JWT tokens for access control

See milestones/v1.2-ROADMAP.md for full details.

</details>

<details>
<summary>✅ v1.4 Creator Studio & Stream Quality (Phases 22.1, 23-24) - SHIPPED 2026-03-10</summary>

**Milestone Goal:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

**What Was Built:**
- Phase 22.1: Pipeline Fixes & UI Enhancements — Urgent fixes and enhancements from v1.2 completion
- Phase 23: Stream Quality Monitoring Dashboard — Real-time metrics display (bitrate, FPS, resolution, network status, health score) for broadcasters
- Phase 24: Creator Spotlight Selection & Display — Feature another live creator during broadcast with elegant overlay UI

</details>

<details>
<summary>✅ v1.5 Pipeline Reliability, Moderation & Upload Experience (Phases 22.1, 23-30) — SHIPPED 2026-03-11</summary>

**Milestone Goal:** Harden the recording/transcription/AI pipeline with structured observability and automatic recovery, give broadcasters and users moderation tools, and build a rich dedicated player page for uploaded videos.

- [x] Phase 22.1: Pipeline Fixes & UI Enhancements (3/3 plans) — completed 2026-03-06
- [x] Phase 23: Stream Quality Monitoring Dashboard (6/6 plans) — completed 2026-03-06
- [x] Phase 24: Creator Spotlight Selection & Display (3/3 plans) — completed 2026-03-10
- [x] Phase 25: Pipeline Observability (2/2 plans) — completed 2026-03-10
- [x] Phase 26: Stuck Session Recovery Cron (2/2 plans) — completed 2026-03-10
- [x] Phase 27: Speaker-Attributed Transcripts (2/2 plans) — completed 2026-03-10
- [x] Phase 28: Chat Moderation (3/3 plans) — completed 2026-03-10
- [x] Phase 29: Upload Video Player Core (2/2 plans) — completed 2026-03-11
- [x] Phase 30: Upload Video Player Social (3/3 plans) — completed 2026-03-11

See milestones/v1.5-ROADMAP.md for full details.

</details>

## Progress

All milestones shipped. Start next milestone with `/gsd:new-milestone`.
