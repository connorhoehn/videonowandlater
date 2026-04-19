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

# Phase 1: Deploy everything except Web (so Auth/Api outputs exist for config)
echo "Deploying backend stacks..."
npx cdk deploy VNL-Storage VNL-Auth VNL-Session VNL-Api VNL-Api-Ext VNL-Api-Ext-Admin VNL-Monitoring VNL-Agent \
  --require-approval never --outputs-file cdk-outputs.json

# Phase 2: Generate frontend config from outputs
echo "Generating frontend config..."
./scripts/generate-frontend-config.sh cdk-outputs.json

# Phase 3: Rebuild web so aws-config.json is copied into dist/
echo "Rebuilding web with fresh config..."
(cd web && npm run build)

# Phase 4: Deploy Web stack last — it uploads dist/ (now including aws-config.json) to S3
echo "Deploying Web stack..."
npx cdk deploy VNL-Web --require-approval never --outputs-file cdk-outputs-web.json

# Merge Web outputs back into cdk-outputs.json for consumers
jq -s '.[0] * .[1]' cdk-outputs.json cdk-outputs-web.json > cdk-outputs.merged.json \
  && mv cdk-outputs.merged.json cdk-outputs.json \
  && rm -f cdk-outputs-web.json

echo "Deploy complete. Frontend config written to web/public/aws-config.json and uploaded to CloudFront."
