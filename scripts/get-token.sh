#!/usr/bin/env bash
# scripts/get-token.sh
# Usage: ./scripts/get-token.sh <username> <password>
# Generates auth tokens for a Cognito test user

set -euo pipefail

USERNAME="${1:?Usage: get-token.sh <username> <password>}"
PASSWORD="${2:?Usage: get-token.sh <username> <password>}"

OUTPUTS_FILE="cdk-outputs.json"
if [ ! -f "$OUTPUTS_FILE" ]; then
  echo "Error: $OUTPUTS_FILE not found. Run './scripts/deploy.sh' first."
  exit 1
fi

USER_POOL_ID=$(jq -r '."VNL-Auth".UserPoolId' "$OUTPUTS_FILE")
CLIENT_ID=$(jq -r '."VNL-Auth".UserPoolClientId' "$OUTPUTS_FILE")

RESULT=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD")

echo "$RESULT" | jq '{
  AccessToken: .AuthenticationResult.AccessToken,
  IdToken: .AuthenticationResult.IdToken,
  RefreshToken: .AuthenticationResult.RefreshToken,
  ExpiresIn: .AuthenticationResult.ExpiresIn
}'
