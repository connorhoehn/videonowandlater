---
phase: 33-pipeline-alarms-dashboard
plan: "01"
subsystem: infra
tags: [cloudwatch, alarms, sns, dashboard, observability]
dependency_graph:
  requires: [31-sqs-pipeline-buffers]
  provides: [OBS-01, OBS-02, OBS-03, OBS-04]
  affects: [infra/lib/stacks/session-stack.ts]
tech_stack:
  added: [aws-cdk-lib/aws-cloudwatch, aws-cdk-lib/aws-cloudwatch-actions]
  patterns: [CloudWatch Alarm loop pattern, SNS alarm action, GraphWidget dashboard rows]
key_files:
  modified: [infra/lib/stacks/session-stack.ts]
decisions:
  - "Use GREATER_THAN_THRESHOLD (not GTE) with threshold:0 — GTE fires at Errors=0 which always trips"
  - "Use NOT_BREACHING for treatMissingData — idle periods produce no datapoints, BREACHING causes spurious night alarms"
  - "DLQ alarms use 1-min period for fast detection; Lambda error alarms use 5-min period per requirements"
  - "Single shared pipelineAlarmTopic for all 10 alarms — simpler subscription management than per-handler topics"
metrics:
  duration_seconds: 351
  completed_date: "2026-03-11"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 33 Plan 01: Pipeline Alarms & Dashboard Summary

**One-liner:** 10 CloudWatch alarms (5 DLQ depth + 5 Lambda error) wired to a single SNS topic, plus a VNL-Pipeline dashboard with 5 handler rows × 3 GraphWidgets each, all in session-stack.ts.

## What Was Built

### Alarm Infrastructure (OBS-01, OBS-02, OBS-03)

**SNS Topic:** `vnl-pipeline-alarms` (PipelineAlarmTopic)
- Optional email subscription via `cdk deploy -c alertEmail=you@example.com VNL-Session`
- `CfnOutput PipelineAlarmTopicArn` exposes topic ARN for post-deploy subscriptions

**10 CloudWatch Alarms:**

| Handler | DLQ Alarm | Error Alarm |
|---------|-----------|-------------|
| recording-ended | `vnl-pipeline-recording-ended-dlq` | `vnl-pipeline-recording-ended-errors` |
| transcode-completed | `vnl-pipeline-transcode-completed-dlq` | `vnl-pipeline-transcode-completed-errors` |
| transcribe-completed | `vnl-pipeline-transcribe-completed-dlq` | `vnl-pipeline-transcribe-completed-errors` |
| store-summary | `vnl-pipeline-store-summary-dlq` | `vnl-pipeline-store-summary-errors` |
| start-transcribe | `vnl-pipeline-start-transcribe-dlq` | `vnl-pipeline-start-transcribe-errors` |

All alarms:
- `threshold: 0`, `GREATER_THAN_THRESHOLD`, `evaluationPeriods: 1`
- `treatMissingData: NOT_BREACHING`
- DLQ alarms: `period: 1 minute` (fast detection)
- Error alarms: `period: 5 minutes`
- All use `addAlarmAction(new actions.SnsAction(pipelineAlarmTopic))`

### Dashboard (OBS-04)

**Dashboard name:** `VNL-Pipeline`
- 5 rows (one per handler), 3 GraphWidgets per row (24-unit width each)
- Columns: Invocations (5-min Sum) | Errors (5-min Sum) | DLQ Depth (1-min Sum)

### Key Variables Added to session-stack.ts

- `pipelineAlarmTopic` — SNS Topic resource
- `pipelineDashboard` — CloudWatch Dashboard resource
- `pipelineHandlers` — typed array of `{ id, fn, dlq, label }` for the 5 pipeline stages
- `alertEmail` — CDK context variable read via `this.node.tryGetContext('alertEmail')`

## Deployment Note

To activate email alerts:
```bash
npx cdk deploy -c alertEmail=you@example.com VNL-Session
```

To subscribe additional endpoints after deploy:
```bash
aws sns subscribe --topic-arn $(cat cdk-outputs.json | jq -r '.["VNL-Session"].PipelineAlarmTopicArn') \
  --protocol email --notification-endpoint ops@example.com
```

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS (no errors) |
| `npx cdk synth VNL-Session` | PASS |
| CloudWatch alarm count | 10 (5 DLQ + 5 Lambda error) |
| Dashboard name | VNL-Pipeline confirmed |
| Backend tests | 456/457 pass (1 pre-existing flaky recording-ended suite interaction, passes in isolation) |

## Deviations from Plan

None — plan executed exactly as written. The `recording-ended.test.ts` failure in the full suite is pre-existing (visible in git status before this plan began) and passes when run in isolation.

## Self-Check: PASSED

- `infra/lib/stacks/session-stack.ts` modified and committed
- Task 1 commit: `9c7b270`
- Task 2 commit: `17993dc`
- CDK synth confirms 10 `AWS::CloudWatch::Alarm` resources and `DashboardName: VNL-Pipeline`
