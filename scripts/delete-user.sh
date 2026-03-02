#!/usr/bin/env bash
# scripts/delete-user.sh
# Usage: ./scripts/delete-user.sh <username>
# Deletes a Cognito user from the deployed user pool

set -euo pipefail

USERNAME="${1:?Usage: delete-user.sh <username>}"

OUTPUTS_FILE="cdk-outputs.json"
if [ ! -f "$OUTPUTS_FILE" ]; then
  echo "Error: $OUTPUTS_FILE not found. Run './scripts/deploy.sh' first."
  exit 1
fi

USER_POOL_ID=$(jq -r '."VNL-Auth".UserPoolId' "$OUTPUTS_FILE")

aws cognito-idp admin-delete-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME"

echo "User '$USERNAME' deleted."
