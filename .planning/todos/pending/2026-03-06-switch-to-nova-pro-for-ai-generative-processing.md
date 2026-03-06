---
created: 2026-03-06T03:31:22.979Z
title: Switch to Nova Pro for AI generative processing
area: backend
files:
  - backend/src/handlers/transcription-complete.ts
  - infra/lib/stacks/processing-stack.ts
---

## Problem

The current transcription pipeline uses Claude (via AWS Bedrock) for generating AI summaries of video transcripts. Need to switch to Nova Pro for all AI generative processing, likely for cost or performance reasons.

Currently, when a transcription completes:
1. The transcription-complete Lambda is triggered
2. It calls Bedrock with Claude model to generate summary
3. The summary is stored in DynamoDB

This needs to be updated to use Nova Pro instead of Claude.

## Solution

1. Update the transcription-complete Lambda handler to use Nova Pro API instead of Bedrock Claude
2. Update any environment variables or configuration for Nova Pro endpoints/credentials
3. Modify the CDK stack to include Nova Pro configuration
4. Test the pipeline end-to-end with Nova Pro integration
5. Consider any prompt adjustments needed for Nova Pro vs Claude