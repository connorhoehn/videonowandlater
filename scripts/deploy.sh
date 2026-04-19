#!/usr/bin/env bash
# scripts/deploy.sh
# Runs pre-deploy checks, deploys all CDK stacks, and generates frontend config.
#
# NOTE: do NOT invoke as `./scripts/deploy.sh | tail -N` — a pipe masks the
# exit code of the left side under `set -euo pipefail`, so deploy failures
# can look like successes. Let the script run unpiped, or capture stderr to a
# file if you need a shorter tail.

set -euo pipefail

SKIP_CHECKS="${1:-}"

# Run pre-deploy checks (skip with --no-checks)
if [[ "$SKIP_CHECKS" != "--no-checks" ]]; then
  echo "Running pre-deploy checks..."
  echo ""
  ./scripts/predeploy-check.sh
  echo ""
fi

BACKEND_STACKS=(VNL-Storage VNL-Auth VNL-Session VNL-Api VNL-Api-Ext VNL-Api-Ext-Admin VNL-Monitoring VNL-Agent)

# Phase 1: Deploy everything except Web (so Auth/Api outputs exist for config).
# We don't validate cdk-outputs.json here — CDK omits unchanged stacks from
# --outputs-file, which makes the file an unreliable signal. generate-frontend-config.sh
# now pulls live from CloudFormation describe-stacks instead.
echo "Deploying backend stacks..."
npx cdk deploy "${BACKEND_STACKS[@]}" \
  --require-approval never --outputs-file cdk-outputs.json

# Phase 1b: Force API Gateway stage redeploy.
# When sibling stacks (VNL-Api-Ext, VNL-Api-Ext-Admin) add Method/Resource
# constructs to a RestApi imported from VNL-Api via fromRestApiAttributes,
# those new methods are CREATED in API Gateway but the `prod` stage continues
# to serve the *previous* deployment snapshot — so the new routes (and their
# CORS OPTIONS handlers) 403 with MissingAuthenticationToken until the stage
# is pointed at a fresh snapshot. CDK's auto-deployment only fires when the
# RestApi construct's own stack redeploys, which doesn't happen on pure
# sibling-stack edits. Fix: create a fresh deployment explicitly.
API_ID=$(aws cloudformation describe-stacks \
  --stack-name VNL-Api \
  --query "Stacks[0].Outputs[?OutputKey=='ExportsOutputRefApiF70053CD5653BA4D'].OutputValue | [0]" \
  --output text 2>/dev/null || echo "")
if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
  echo "Refreshing API Gateway prod stage ($API_ID)..."
  aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name prod \
    --description "deploy.sh post-deploy stage refresh" > /dev/null
fi

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
