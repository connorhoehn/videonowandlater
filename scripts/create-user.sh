#!/usr/bin/env bash
# scripts/create-user.sh
# Usage: ./scripts/create-user.sh <username> <password>
# Creates a Cognito test user and sets a permanent password

set -euo pipefail

USERNAME="${1:?Usage: create-user.sh <username> <password>}"
PASSWORD="${2:?Usage: create-user.sh <username> <password>}"

OUTPUTS_FILE="cdk-outputs.json"
if [ ! -f "$OUTPUTS_FILE" ]; then
  echo "Error: $OUTPUTS_FILE not found. Run './scripts/deploy.sh' first."
  exit 1
fi

USER_POOL_ID=$(jq -r '."VNL-Auth".UserPoolId' "$OUTPUTS_FILE")

# Create user (suppress welcome email)
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --message-action SUPPRESS

# Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --permanent

echo "User '$USERNAME' created and confirmed."
