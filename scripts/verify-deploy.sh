#!/bin/bash
# Post-deploy verification script
# Usage: ./scripts/verify-deploy.sh
# Requires: AWS CLI configured with appropriate credentials
set -e

echo "=== VNL Deploy Verification ==="

# Check Lambda functions exist
echo ""
echo "--- Checking Lambda functions ---"
for fn in ModerationFrameSampler CheckBudget AdminKillSession AdminListSessions AdminAuditLog AdminCostSummary AdminGetSessionDetail AdminReviewModeration SubmitAppeal AdminReviewAppeal ReceiveModerationFrame AdminGetSessionCost AdminGetUserCosts; do
  if aws lambda get-function --function-name "vnl-${fn}" --query 'Configuration.FunctionName' --output text 2>/dev/null; then
    echo "  ✓ ${fn}"
  else
    echo "  ✗ ${fn} — NOT FOUND (may have different prefix)"
  fi
done

# Check DynamoDB GSIs
echo ""
echo "--- Checking DynamoDB GSIs ---"
TABLE_NAME=$(aws dynamodb list-tables --query 'TableNames[?contains(@, `vnl`)]' --output text | head -1)
if [ -n "$TABLE_NAME" ]; then
  GSI_COUNT=$(aws dynamodb describe-table --table-name "$TABLE_NAME" --query 'Table.GlobalSecondaryIndexes | length(@)' --output text)
  echo "  Table: $TABLE_NAME"
  echo "  GSI count: $GSI_COUNT (expected: 6)"
fi

# Check Cognito admin group
echo ""
echo "--- Checking Cognito Admin Group ---"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --query 'UserPools[?contains(Name, `vnl`)].Id' --output text | head -1)
if [ -n "$POOL_ID" ]; then
  if aws cognito-idp get-group --user-pool-id "$POOL_ID" --group-name admin 2>/dev/null; then
    echo "  ✓ Admin group exists"
  else
    echo "  ✗ Admin group NOT FOUND — create it manually"
  fi
fi

# Check SNS topic
echo ""
echo "--- Checking SNS Budget Alert Topic ---"
aws sns list-topics --query 'Topics[?contains(TopicArn, `budget-alert`)]' --output text

# Check EventBridge rules
echo ""
echo "--- Checking EventBridge Rules ---"
for rule in ModerationSamplerSchedule CheckBudgetSchedule; do
  if aws events describe-rule --name "vnl-${rule}" 2>/dev/null | head -1; then
    echo "  ✓ ${rule}"
  else
    echo "  Note: ${rule} may have different prefix"
  fi
done

echo ""
echo "=== Verification Complete ==="
