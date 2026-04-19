#!/usr/bin/env bash
# scripts/generate-frontend-config.sh
# Regenerate web/public/aws-config.json from live CloudFormation stack outputs.
#
# Reads directly from CFN via `describe-stacks` rather than `cdk-outputs.json`,
# because --outputs-file only contains stacks that actually deployed in the
# current run. When a stack has no changes, CDK omits it — which makes the
# outputs file unreliable as a config source across partial re-deploys.

set -euo pipefail

# Legacy first-arg path is accepted + ignored for backward compatibility with
# `./scripts/deploy.sh cdk-outputs.json` callsites.
LEGACY_PATH="${1:-}"
if [[ -n "$LEGACY_PATH" && "$LEGACY_PATH" != "cdk-outputs.json" ]]; then
  echo "note: ignoring legacy arg '$LEGACY_PATH' — reading live CFN outputs instead." >&2
fi

mkdir -p web/public

# Pull a single Output value from a stack. Returns empty string if missing.
cfn_output() {
  local STACK="$1"
  local KEY="$2"
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$KEY'].OutputValue" \
    --output text 2>/dev/null || echo ""
}

USER_POOL_ID=$(cfn_output VNL-Auth UserPoolId)
USER_POOL_CLIENT_ID=$(cfn_output VNL-Auth UserPoolClientId)
IDENTITY_POOL_ID=$(cfn_output VNL-Auth IdentityPoolId)
COGNITO_REGION=$(cfn_output VNL-Auth CognitoRegion)
API_URL=$(cfn_output VNL-Api ApiUrl)

# Required fields — refuse to emit a half-config.
for PAIR in "VNL-Auth/UserPoolId=$USER_POOL_ID" "VNL-Auth/UserPoolClientId=$USER_POOL_CLIENT_ID" "VNL-Auth/CognitoRegion=$COGNITO_REGION" "VNL-Api/ApiUrl=$API_URL"; do
  KEY="${PAIR%%=*}"
  VAL="${PAIR#*=}"
  if [ -z "$VAL" ] || [ "$VAL" = "None" ]; then
    echo "error: required CFN output '$KEY' is missing — has the stack been deployed?" >&2
    exit 1
  fi
done

# IdentityPoolId is optional — captions degrade gracefully when absent.
if [ "$IDENTITY_POOL_ID" = "None" ]; then
  IDENTITY_POOL_ID=""
fi

# Strip trailing slash from API URL so the frontend can concat paths cleanly.
API_URL="${API_URL%/}"

ADS_BASE_URL="${VNL_ADS_BASE_URL:-}"

jq -n \
  --arg userPoolId "$USER_POOL_ID" \
  --arg userPoolClientId "$USER_POOL_CLIENT_ID" \
  --arg identityPoolId "$IDENTITY_POOL_ID" \
  --arg region "$COGNITO_REGION" \
  --arg apiUrl "$API_URL" \
  --arg adsBaseUrl "$ADS_BASE_URL" \
  '{
    userPoolId: $userPoolId,
    userPoolClientId: $userPoolClientId,
    identityPoolId: (if $identityPoolId == "" then null else $identityPoolId end),
    region: $region,
    apiUrl: $apiUrl,
    adsBaseUrl: $adsBaseUrl,
  }' > web/public/aws-config.json

echo "Wrote web/public/aws-config.json from live CFN outputs (adsBaseUrl='$ADS_BASE_URL')"
