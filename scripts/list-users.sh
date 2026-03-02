#!/usr/bin/env bash
# scripts/list-users.sh
# Lists all Cognito users in the deployed user pool

set -euo pipefail

OUTPUTS_FILE="cdk-outputs.json"
if [ ! -f "$OUTPUTS_FILE" ]; then
  echo "Error: $OUTPUTS_FILE not found. Run './scripts/deploy.sh' first."
  exit 1
fi

USER_POOL_ID=$(jq -r '."VNL-Auth".UserPoolId' "$OUTPUTS_FILE")

echo "Users in pool $USER_POOL_ID:"
echo ""

aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  | jq -r '.Users[] | "\(.Username)\t\(.UserStatus)"'
