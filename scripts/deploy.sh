#!/usr/bin/env bash
# scripts/deploy.sh
# Runs pre-deploy checks, deploys all CDK stacks, and generates frontend config

set -euo pipefail

SKIP_CHECKS="${1:-}"

# Run pre-deploy checks (skip with --no-checks)
if [[ "$SKIP_CHECKS" != "--no-checks" ]]; then
  echo "Running pre-deploy checks..."
  echo ""
  ./scripts/predeploy-check.sh
  echo ""
fi

echo "Deploying CDK stacks..."
npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json

echo "Generating frontend config..."
mkdir -p web/public

jq '{
  userPoolId: ."VNL-Auth".UserPoolId,
  userPoolClientId: ."VNL-Auth".UserPoolClientId,
  region: ."VNL-Auth".CognitoRegion,
  apiUrl: (."VNL-Api".ApiUrl | rtrimstr("/"))
}' cdk-outputs.json > web/public/aws-config.json

echo "Deploy complete. Frontend config written to web/public/aws-config.json"
