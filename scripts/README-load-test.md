# Stream Quality Metrics Load Test

## Purpose

This load test validates QUAL-06 requirement from Phase 23: The system must support 50 concurrent broadcasters polling stream quality metrics at 5-second intervals without performance degradation.

## Requirements Tested

- **QUAL-06**: 50 concurrent broadcasters polling metrics
  - API latency p99 < 200ms
  - Zero DynamoDB throttle events
  - Sustained for 5+ minutes

## Usage

### Basic Test (50 broadcasters, 5 minutes)
```bash
./scripts/load-test-metrics.sh
```

### Custom Test Parameters
```bash
# 100 broadcasters for 10 minutes
./scripts/load-test-metrics.sh 100 600

# 25 broadcasters for 2 minutes (quick test)
./scripts/load-test-metrics.sh 25 120
```

## Environment Configuration

Set these environment variables before running the test:

```bash
export API_BASE_URL=https://api.videonowandlater.com
export AWS_REGION=us-east-1
export DYNAMODB_TABLE_NAME=VideoNowAndLaterStack-Table
```

## Prerequisites

1. AWS CLI configured with credentials that have CloudWatch read access
2. API endpoint accessible from test machine
3. curl and basic Unix tools (awk, sort, date)

## Interpreting Results

### Success Output
```
✓ PASS: p99 latency 145ms < 200ms (QUAL-06)
✓ PASS: Zero DynamoDB throttle events (QUAL-06)
✓ ALL QUAL-06 GATES PASSED
```

### Failure Output
```
✗ FAIL: p99 latency 250ms >= 200ms (QUAL-06)
✗ QUAL-06 LOAD TEST FAILED
```

## Troubleshooting

### High Latency (>200ms p99)

1. Check API Gateway throttling settings
2. Review Lambda concurrency limits
3. Analyze CloudWatch X-Ray traces for bottlenecks
4. Verify DynamoDB read capacity settings

### DynamoDB Throttle Events

1. Switch to on-demand capacity mode:
   ```bash
   aws dynamodb update-table \
     --table-name VideoNowAndLaterStack-Table \
     --billing-mode PAY_PER_REQUEST
   ```

2. Or increase provisioned capacity:
   ```bash
   aws dynamodb update-table \
     --table-name VideoNowAndLaterStack-Table \
     --provisioned-throughput ReadCapacityUnits=100,WriteCapacityUnits=50
   ```

## Running in CI/CD

Add to GitHub Actions workflow:

```yaml
- name: Run Load Test
  env:
    API_BASE_URL: ${{ secrets.API_ENDPOINT }}
    AWS_REGION: us-east-1
  run: |
    ./scripts/load-test-metrics.sh 50 300
```

## Metrics Collected

- **Latency percentiles**: p50, p99, average
- **Total samples**: Number of successful polls
- **DynamoDB throttles**: UserErrors metric from CloudWatch
- **Baseline comparison**: Pre-test vs test latency

## Scaling Considerations

If you need to support more than 50 concurrent broadcasters:

1. **API Gateway**: Increase throttle limits in API Gateway settings
2. **Lambda**: Request concurrency limit increase via AWS support
3. **DynamoDB**: Use on-demand mode or increase provisioned capacity
4. **Monitoring**: Set up CloudWatch alarms for proactive scaling

## Cost Estimation

Running this test incurs minimal AWS costs:
- API Gateway: ~3,000 requests per test = $0.003
- Lambda: ~3,000 invocations = $0.006
- DynamoDB: Read capacity consumed = $0.001
- CloudWatch: Metrics API calls = $0.01

Total: ~$0.02 per 5-minute test run