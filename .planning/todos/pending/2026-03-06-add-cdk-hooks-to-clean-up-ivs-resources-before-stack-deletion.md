---
created: 2026-03-06T03:35:45.272Z
title: Add CDK hooks to clean up IVS resources before stack deletion
area: infra
files:
  - infra/lib/stacks/session-stack.ts
  - infra/lib/stacks/vnl-stack.ts
---

## Problem

CloudFormation stack deletion failed because IVS RecordingConfiguration resources were still attached to channels. The error message was:

```
ConflictException: Unable to perform ivs:DeleteRecordingConfiguration while
arn:aws:ivs:us-east-1:264161986065:recording-configuration/7lMarVFL2ni8
is still attached to a channel
```

This required manual intervention to:
1. List all channels with the recording configuration attached (29 channels found)
2. Detach the recording configuration from each channel manually
3. Retry the stack deletion

This is a common issue when tearing down stacks with IVS resources that have dependencies.

## Solution

Implement CDK custom resource or deletion policy to handle cleanup automatically:

1. **Option A - Custom Resource**: Create a CDK custom resource with onDelete handler that:
   - Lists all channels with the recording configuration
   - Detaches the recording configuration from each channel
   - Runs before the RecordingConfiguration deletion

2. **Option B - Lambda-backed Custom Resource**: Add a Lambda function that:
   - Triggers on CloudFormation DELETE events
   - Detaches all IVS resource dependencies
   - Returns success to CloudFormation to proceed

3. **Option C - CDK Aspects**: Use CDK Aspects to add removalPolicy and custom cleanup:
   - Set `removalPolicy: RemovalPolicy.DESTROY` on IVS resources
   - Add custom resource for cleanup logic

4. Consider similar cleanup needs for:
   - IVS Stages (detach from participants)
   - IVS Chat Rooms (disconnect active connections)
   - MediaConvert jobs (cancel running jobs)

Script used for manual cleanup (for reference):
```bash
# Get all channels with recording config
aws ivs list-channels --region us-east-1 \
  --query "channels[?recordingConfigurationArn=='arn:aws:ivs:us-east-1:264161986065:recording-configuration/7lMarVFL2ni8'].arn"

# Detach recording config from each channel
for arn in $channels; do
  aws ivs update-channel --region us-east-1 \
    --arn "$arn" \
    --recording-configuration-arn ""
done
```