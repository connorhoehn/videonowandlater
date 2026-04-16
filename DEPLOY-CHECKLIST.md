# Deploy Checklist — Screen Share, Recording Pipeline, Admin Dashboard

## Pre-Deploy

### 1. Review CDK Changes
```bash
cd infra && npx cdk diff
```

Key infrastructure additions:
- IVS StorageConfiguration (per-participant stage recording)
- DynamoDB GSI5 (cost/moderation queries) + GSI6 (per-user costs)
- 12 new Lambda functions (admin, moderation, cost, budget)
- SNS topic for budget alerts
- EventBridge rules: moderation sampler (1min), budget check (hourly)
- Cognito admin group

### 2. Verify GSI Safety
- GSI5 and GSI6 are NEW additions (not modifications)
- DynamoDB adds GSIs online — no table recreation, no downtime
- Allow 5-10 minutes for GSI backfill after deploy

### 3. Build Check
```bash
cd backend && npx tsc --noEmit && npx jest
cd web && npx tsc --noEmit && npm run build
```

## Deploy

```bash
cd infra && npx cdk deploy --all
```

## Post-Deploy

### 1. Assign Admin Group
```bash
# Replace with your user pool ID and username
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username <YOUR_USERNAME> \
  --group-name admin
```

Find your user pool ID:
```bash
aws cognito-idp list-user-pools --max-results 10 | grep -A1 'vnl'
```

### 2. Drain Old Stage Pool
Existing pooled stages don't have recording enabled. They'll cycle out naturally as sessions claim and release them. To force immediate refresh:
```bash
# Optional: temporarily reduce pool, wait 5min, restore
# Edit MIN_STAGES in session-stack.ts to 0, deploy, wait, set back to 2, deploy
```

### 3. Verify Moderation Sampler
Check CloudWatch logs for the moderation-frame-sampler Lambda:
```bash
aws logs tail /aws/lambda/vnl-ModerationFrameSampler --follow
```
Should see "Found live sessions" every 60 seconds.

### 4. Verify Budget Check
```bash
aws logs tail /aws/lambda/vnl-CheckBudget --follow
```

## Smoke Tests

### Screen Sharing
1. Open a hangout with 2 browser tabs (different users)
2. Click "Share" button — should show screen picker
3. Other participant should see shared screen as main tile
4. Sharer should see their camera as PiP overlay
5. Click "Stop Share" — should revert to camera
6. Browser "Stop sharing" button should also work

### Per-Participant Recording
1. Start a hangout with 2 participants
2. Talk for 30+ seconds
3. End the hangout
4. Check CloudWatch logs for recording-ended: should see 2 Recording End events
5. Check for 2 MediaConvert jobs in the MediaConvert console
6. Wait for transcription: check DynamoDB for speaker-segments.json with real usernames
7. Verify session appears in activity feed with replay link

### Admin Dashboard
1. Navigate to /admin (or click shield icon in navbar)
2. Verify Active Sessions tab shows any live sessions
3. Verify Costs tab shows data (may be empty initially)
4. Kill a test session — verify toast + redirect on the killed session's page

### Content Moderation
1. Start a broadcast
2. Check CloudWatch logs for moderation-frame-sampler
3. Should see Rekognition calls with "0 labels" for normal content
4. Verify MOD# records appear in DynamoDB for flagged content

### Budget Alerts
1. After some sessions process, check that COST# records exist in DynamoDB
2. Budget check Lambda should log current month spend
