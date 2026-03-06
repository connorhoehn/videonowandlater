---
created: 2026-03-06T02:31:00Z
title: Create activity card variants for uploads, broadcasts, and hangouts with audit logs
area: ui
files:
  - web/src/features/activity/ActivityFeed.tsx
  - web/src/features/activity/BroadcastActivityCard.tsx
  - web/src/features/activity/HangoutActivityCard.tsx
  - web/src/features/activity/SessionAuditLog.tsx
  - web/src/features/upload/VideoUploadForm.tsx
---

## Problem

Activity feed only shows broadcasts and hangouts. Missing:
- **Video upload cards** - Show pending/processing uploads with progress
- **Card variants** - Different styling for uploads vs past broadcasts vs hangouts
- **Processing visibility** - Users can't see upload/transcription progress on dashboard
- **Redirect behavior** - Uploads currently redirect to replay page instead of dashboard

## Solution

1. **Create UploadActivityCard** component:
   - Show upload progress (0-100%)
   - Status: pending → processing → converting → available → failed
   - Audit log showing: "Upload started" → "Converting to MP4" → "Available for playback"

2. **Extend ActivitySession type** to include upload fields:
   - `uploadStatus`, `uploadProgress`, `sourceFileName`, `sourceFileSize`

3. **Update ActivityFeed** to render card variants:
   ```
   if (sessionType === 'BROADCAST') → BroadcastActivityCard
   if (sessionType === 'HANGOUT') → HangoutActivityCard
   if (sessionType === 'UPLOAD') → UploadActivityCard
   ```

4. **Fix VideoUploadForm** redirect:
   - Change from `/replay/{sessionId}` to `/` (dashboard)
   - Let users see upload card in activity feed with progress

5. **Add audit log to all cards**:
   - BroadcastActivityCard: already has SessionAuditLog (compact)
   - HangoutActivityCard: already has SessionAuditLog (compact)
   - UploadActivityCard: add SessionAuditLog showing upload→convert→available

## Result

Users can now:
- Upload videos and immediately see progress on dashboard
- Watch conversion/transcription pipeline in real-time via audit logs
- See all content types (broadcasts, hangouts, uploads) with appropriate cards
