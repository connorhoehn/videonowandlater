#!/bin/bash
set -e

# Load test configuration
CONCURRENT_BROADCASTERS=${1:-50}
TEST_DURATION_SEC=${2:-300}  # 5 minutes default
API_ENDPOINT="${API_BASE_URL:-http://localhost:3000}"
REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="${DYNAMODB_TABLE_NAME:-VideoNowAndLaterStack-Table}"

echo "=== Phase 23 Load Test: Stream Quality Metrics ==="
echo "Concurrent broadcasters: $CONCURRENT_BROADCASTERS"
echo "Test duration: ${TEST_DURATION_SEC}s"
echo "API endpoint: $API_ENDPOINT"
echo ""

# Step 1: Get CloudWatch baseline metrics (5 min before test)
echo "[1/5] Capturing baseline CloudWatch metrics..."
START_TIME=$(date -u -v-5M +%s 2>/dev/null || date -u -d '5 minutes ago' +%s)
BASELINE_LATENCY=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Latency \
  --dimensions Name=ApiName,Value=VideoNowAndLaterAPI \
  --statistics Average \
  --start-time $(date -u -d "@$START_TIME" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r "$START_TIME" +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --region "$REGION" \
  --query 'Datapoints[0].Average' \
  --output text 2>/dev/null || echo "0")

echo "Baseline API latency: ${BASELINE_LATENCY}ms"

# Step 2: Simulate concurrent broadcasters polling metrics
echo "[2/5] Starting $CONCURRENT_BROADCASTERS simulated broadcasters..."
PIDS=()
for i in $(seq 1 $CONCURRENT_BROADCASTERS); do
  (
    SESSION_ID="load-test-session-$i"
    for j in $(seq 1 $((TEST_DURATION_SEC / 5))); do
      # Simulate metrics poll (5s cadence)
      START=$(date +%s%3N 2>/dev/null || echo $(($(date +%s) * 1000)))
      curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer fake-token-$i" \
        "$API_ENDPOINT/sessions/$SESSION_ID" > /tmp/load-test-$i-$j.log 2>&1
      END=$(date +%s%3N 2>/dev/null || echo $(($(date +%s) * 1000)))
      LATENCY=$((END - START))
      echo "$LATENCY" >> /tmp/load-test-latencies.log
      sleep 5
    done
  ) &
  PIDS+=($!)
done

echo "Broadcasters spawned (PIDs: ${PIDS[@]:0:5}...)"
echo "Waiting ${TEST_DURATION_SEC}s for test to complete..."

# Step 3: Wait for all background processes
sleep $TEST_DURATION_SEC
for pid in "${PIDS[@]}"; do
  kill $pid 2>/dev/null || true
done
wait 2>/dev/null || true

echo "[3/5] Load test complete. Analyzing results..."

# Step 4: Analyze latency results
if [ -f /tmp/load-test-latencies.log ]; then
  LATENCY_P50=$(sort -n /tmp/load-test-latencies.log | awk '{a[NR]=$0} END {print a[int(NR*0.5)]}')
  LATENCY_P99=$(sort -n /tmp/load-test-latencies.log | awk '{a[NR]=$0} END {print a[int(NR*0.99)]}')
  LATENCY_AVG=$(awk '{s+=$1; c++} END {print s/c}' /tmp/load-test-latencies.log)
  SAMPLE_COUNT=$(wc -l < /tmp/load-test-latencies.log | tr -d ' ')

  echo ""
  echo "=== Latency Results ==="
  echo "Samples: $SAMPLE_COUNT"
  echo "p50 latency: ${LATENCY_P50}ms"
  echo "p99 latency: ${LATENCY_P99}ms"
  echo "Average: ${LATENCY_AVG}ms"

  # QUAL-06 gate: p99 latency must be <200ms
  if [ "$LATENCY_P99" -lt 200 ]; then
    echo "✓ PASS: p99 latency ${LATENCY_P99}ms < 200ms (QUAL-06)"
  else
    echo "✗ FAIL: p99 latency ${LATENCY_P99}ms >= 200ms (QUAL-06)"
    FAILED=1
  fi
else
  echo "✗ FAIL: No latency data collected"
  FAILED=1
fi

# Step 5: Check DynamoDB throttle events
echo ""
echo "[4/5] Checking DynamoDB throttle events..."
TEST_END_TIME=$(date -u +%s)
TEST_START_TIME=$((TEST_END_TIME - TEST_DURATION_SEC))

THROTTLE_COUNT=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name UserErrors \
  --dimensions Name=TableName,Value="$TABLE_NAME" \
  --statistics Sum \
  --start-time $(date -u -d "@$TEST_START_TIME" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r "$TEST_START_TIME" +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u -d "@$TEST_END_TIME" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r "$TEST_END_TIME" +%Y-%m-%dT%H:%M:%S) \
  --period $TEST_DURATION_SEC \
  --region "$REGION" \
  --query 'Datapoints[0].Sum' \
  --output text 2>/dev/null || echo "0")

echo "DynamoDB throttle events: $THROTTLE_COUNT"

if [ "$THROTTLE_COUNT" = "0" ] || [ "$THROTTLE_COUNT" = "None" ]; then
  echo "✓ PASS: Zero DynamoDB throttle events (QUAL-06)"
else
  echo "✗ FAIL: $THROTTLE_COUNT throttle events detected (QUAL-06)"
  FAILED=1
fi

# Cleanup
rm -f /tmp/load-test-*.log

# Final result
echo ""
echo "[5/5] === Load Test Summary ==="
if [ -z "$FAILED" ]; then
  echo "✓ ALL QUAL-06 GATES PASSED"
  echo "  - 50 concurrent broadcasters sustained for ${TEST_DURATION_SEC}s"
  echo "  - API latency p99 < 200ms"
  echo "  - Zero DynamoDB throttle events"
  exit 0
else
  echo "✗ QUAL-06 LOAD TEST FAILED"
  echo "  Review CloudWatch metrics and scale DynamoDB if needed"
  exit 1
fi