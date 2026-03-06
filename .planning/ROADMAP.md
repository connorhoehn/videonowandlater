# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- 🚧 **v1.4 Creator Studio & Stream Quality** - Phases 23-24 (in progress)

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

### v1.4 Creator Studio & Stream Quality (In Progress)

**Milestone Goal:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

**Phases:**
- [ ] Phase 23: Stream Quality Monitoring Dashboard
- [ ] Phase 24: Creator Spotlight Selection & Display

See milestones/v1.4-ROADMAP.md for full details.

---

## Progress

**Latest Milestone:** v1.4 Creator Studio & Stream Quality
- **Status:** 🚧 Planning
- **Phases:** 2 (23-24)
- **Plans:** 0/? started
- **Tests:** 169/169 backend tests passing (from v1.3)

