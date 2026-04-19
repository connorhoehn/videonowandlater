#!/usr/bin/env bash
# scripts/generate-frontend-config.sh
# Regenerate web/public/aws-config.json from cdk-outputs.json.
# Safe to run standalone — no CDK deploy required. Useful when you want to
# point a local `npm run dev` at an already-deployed stack.

set -euo pipefail

OUTPUTS_FILE="${1:-cdk-outputs.json}"

if [[ ! -f "$OUTPUTS_FILE" ]]; then
  echo "error: $OUTPUTS_FILE not found. Run 'npx cdk deploy ... --outputs-file $OUTPUTS_FILE' first." >&2
  exit 1
fi

mkdir -p web/public

# VNL_ADS_BASE_URL is an env-var passthrough (vnl-ads is a separate repo — its
# URL doesn't land in this repo's cdk-outputs.json). Set it before running
# this script, or edit aws-config.json by hand afterward.
ADS_BASE_URL="${VNL_ADS_BASE_URL:-}"

jq --arg adsBaseUrl "$ADS_BASE_URL" '{
  userPoolId: ."VNL-Auth".UserPoolId,
  userPoolClientId: ."VNL-Auth".UserPoolClientId,
  region: ."VNL-Auth".CognitoRegion,
  apiUrl: (."VNL-Api".ApiUrl | rtrimstr("/")),
  adsBaseUrl: $adsBaseUrl,
}' "$OUTPUTS_FILE" > web/public/aws-config.json

echo "Wrote web/public/aws-config.json from $OUTPUTS_FILE (adsBaseUrl='$ADS_BASE_URL')"
