#!/usr/bin/env bash
# scripts/deploy.sh
# Deploys all CDK stacks and generates frontend config from CDK outputs

set -euo pipefail

echo "Deploying CDK stacks..."
npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json

echo "Generating frontend config..."
mkdir -p web/public

jq '{
  userPoolId: ."VNL-Auth".UserPoolId,
  userPoolClientId: ."VNL-Auth".UserPoolClientId,
  region: ."VNL-Auth".CognitoRegion,
  apiUrl: ."VNL-Api".ApiUrl
}' cdk-outputs.json > web/public/aws-config.json

echo "Deploy complete. Frontend config written to web/public/aws-config.json"
