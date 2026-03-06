#!/usr/bin/env bash
# scripts/sync-config.sh
# Regenerates web/public/aws-config.json from cdk-outputs.json
# Run after deploying individual CDK stacks to update frontend config

set -euo pipefail

OUTPUTS_FILE="cdk-outputs.json"
CONFIG_FILE="web/public/aws-config.json"

if [ ! -f "$OUTPUTS_FILE" ]; then
  echo "Error: $OUTPUTS_FILE not found. Run './scripts/deploy.sh' first."
  exit 1
fi

mkdir -p web/public

jq '{
  userPoolId: ."VNL-Auth".UserPoolId,
  userPoolClientId: ."VNL-Auth".UserPoolClientId,
  region: ."VNL-Auth".CognitoRegion,
  apiUrl: (."VNL-Api".ApiUrl | rtrimstr("/"))
}' "$OUTPUTS_FILE" > "$CONFIG_FILE"

echo "Frontend config updated: $CONFIG_FILE"
jq . "$CONFIG_FILE"
