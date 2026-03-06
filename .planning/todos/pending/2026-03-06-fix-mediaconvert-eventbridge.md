---
created: 2026-03-06T02:30:00Z
title: Fix MediaConvert EventBridge rule to trigger transcription pipeline
area: backend
files:
  - infra/lib/stacks/session-stack.ts:693
  - backend/src/handlers/on-mediaconvert-complete.ts
---

## Problem

MediaConvert jobs complete successfully but EventBridge isn't triggering the `on-mediaconvert-complete` handler. This breaks the entire transcription pipeline:
- MediaConvert completes → SHOULD update DynamoDB convertStatus to "available"
- But handler never runs → Transcribe never triggers → No transcripts → No AI summaries

5 test sessions have completed MediaConvert jobs but remain stuck at `convertStatus: pending`.

## Solution

1. **Check EventBridge rule** (`MediaConvertCompleteRule` in session-stack.ts ~line 693):
   - May need to add phase filter: `detail: { Tags: { phase: ['19-transcription'] } }`
   - Ensure rule targets `on-mediaconvert-complete` Lambda
   - Verify status filter includes 'COMPLETE'

2. **Verify handler** (`on-mediaconvert-complete.ts`):
   - Confirm it updates session `convertStatus` to 'available'
   - Check CloudWatch logs: `/aws/lambda/VNL-Session-OnMediaConvertComplete*`

3. **Add phase tags to MediaConvert jobs** in `start-mediaconvert.ts`:
   - Ensure jobs include `Tags: { phase: '19-transcription' }`
   - Rule should filter to only match phase 19 jobs

4. **Redeploy** and re-trigger old sessions (5 affected)

## Test Sessions
- f8781b3d-6782-4639-8299-fee18c2288a0 (COMPLETED in MediaConvert, pending in DynamoDB)
- 8cb61344-0254-414a-826f-d6d22a6f212f
- d174f333-7df4-4dff-8469-5b7d449ce18c
- c78d45cf-4ee2-434f-8d9f-87ac34cf3de7
- 0b17eb75-169f-4de3-b459-ba9b40b99df3
