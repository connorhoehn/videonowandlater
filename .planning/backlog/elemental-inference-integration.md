# AWS Elemental Inference — Future Integration Plan

**Status:** Backlog (v2.0+)
**Created:** 2026-03-30

## Summary

AWS Elemental Inference (GA Feb 2026) provides AI-powered real-time video transformation. Two key features at launch: Smart Crop (landscape to vertical 9:16) and Clip Generation (auto-detect highlight moments). Consumption-based pricing, 6-10s latency.

## Why Not Now

- Elemental Inference integrates with **MediaLive only**, not IVS
- Our streaming pipeline uses IVS (fully managed, no access to underlying MediaLive channel)
- No IVS integration announced or on AWS roadmap

## Integration Options

### Option A: Dual Ingest (Real-time)
- Split RTMP ingest to both IVS (low-latency playback) and MediaLive (Elemental Inference)
- **Pros:** Real-time vertical video + clip detection (6-10s latency)
- **Cons:** Double encoding cost, complex architecture, two ingest paths
- **Best for:** High-value live events where real-time vertical output matters

### Option B: Post-VOD Processing
- After broadcast ends, route the MP4 through a MediaLive channel with Elemental Inference
- **Pros:** Simpler, uses existing recording pipeline
- **Cons:** Not real-time, adds processing time after broadcast
- **Best for:** Generating vertical clips for social sharing after broadcast

### Option C: Wait for IVS Support
- Monitor AWS announcements for native IVS + Elemental Inference integration
- **Pros:** Zero architecture changes
- **Cons:** No timeline, may never happen

## Recommended Path

Option B for v2.0 — add a post-processing step after MediaConvert that runs the MP4 through Elemental Inference for vertical cropping and highlight clip extraction. This complements our existing highlight reel pipeline.

## Prerequisites

- Mobile app launched (vertical video becomes a priority)
- Highlight reel pipeline stable (completed in current milestone)
- Cost analysis of MediaLive channel-hours for post-processing

## API Reference

- **Service:** `elementalinference` (API version 2018-11-14)
- **SDK:** `@aws-sdk/client-elementalinference`
- **Operations:** CreateFeed, GetFeed, UpdateFeed, DeleteFeed, ListFeeds, AssociateFeed, DisassociateFeed + tagging (10 total)
- **Feed states:** CREATING → AVAILABLE → ACTIVE → UPDATING → DELETING → DELETED → ARCHIVED
- **Regions:** us-east-1, us-west-2, eu-west-1, ap-south-1

## Resources

- [Product page](https://aws.amazon.com/elemental-inference/)
- [Launch blog post](https://aws.amazon.com/blogs/aws/transform-live-video-for-mobile-audiences-with-aws-elemental-inference/)
- [User guide](https://docs.aws.amazon.com/elemental-inference/latest/userguide/what-is.html)
- [API reference](https://docs.aws.amazon.com/elemental-inference/latest/APIReference/Welcome.html)
- [Fox Sports case study](https://aws.amazon.com/blogs/media/how-aws-built-a-live-ai-powered-vertical-video-capability-for-fox-sports-with-aws-elemental-inference/)
- [MediaConvert thumbnails blog](https://aws.amazon.com/blogs/media/create-a-poster-frame-and-thumbnail-images-for-videos-using-aws-elemental-mediaconvert/)
