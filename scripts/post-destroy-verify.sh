#!/usr/bin/env bash
# scripts/post-destroy-verify.sh
# Verify no billable `vnl-*` resources remain after a destroy. Exits nonzero
# if anything is found. Safe to run repeatedly — idempotent read-only checks.
#
# Covers resources that have burned us before:
#   - CloudFormation stacks (VNL-*)
#   - IVS channels, stages, chat rooms
#   - S3 buckets tagged / named vnl-*
#   - ECR repositories (the vnl-ai-agent container repo)
#   - DynamoDB tables (vnl-sessions, vnl-idempotency)
#   - Cognito user pools
#   - CloudWatch log groups under /aws/lambda/VNL-* (no cost but clutter)
#   - Secrets Manager secrets with vnl- prefix
#
# Skips: Route 53 (none), KMS CMKs (none), NAT gateways (none), EIPs (none).

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

ERRORS=0
FOUND=()

check() {
  local label="$1"
  shift
  local output
  output=$("$@" 2>/dev/null)
  if [[ -n "$output" ]]; then
    echo -e "${RED}FOUND${RESET}: $label"
    echo "$output" | sed 's/^/    /'
    FOUND+=("$label")
    ERRORS=$((ERRORS + 1))
  else
    echo -e "${GREEN}OK${RESET}: $label"
  fi
}

echo "== vnl destroy verification =="
echo ""

check "CloudFormation stacks (VNL-*)" \
  aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE CREATE_IN_PROGRESS UPDATE_COMPLETE UPDATE_IN_PROGRESS ROLLBACK_COMPLETE ROLLBACK_IN_PROGRESS DELETE_FAILED REVIEW_IN_PROGRESS \
    --query "StackSummaries[?starts_with(StackName, 'VNL-')].StackName" \
    --output text

check "IVS channels (Low-Latency)" \
  aws ivs list-channels --query 'channels[].name' --output text

check "IVS stages (Real-Time)" \
  aws ivs-realtime list-stages --query 'stages[].name' --output text

check "IVS chat rooms" \
  aws ivschat list-rooms --query 'rooms[].name' --output text

check "S3 buckets (vnl-*)" \
  aws s3api list-buckets --query "Buckets[?starts_with(Name, 'vnl-')].Name" --output text

check "ECR repositories (vnl-*)" \
  aws ecr describe-repositories --query "repositories[?starts_with(repositoryName, 'vnl-')].repositoryName" --output text

check "DynamoDB tables (vnl-*)" \
  aws dynamodb list-tables --query "TableNames[?starts_with(@, 'vnl-')]" --output text

check "Cognito user pools (vnl-*)" \
  aws cognito-idp list-user-pools --max-results 20 --query "UserPools[?starts_with(Name, 'vnl-')].Name" --output text

check "Secrets Manager secrets (vnl-*)" \
  aws secretsmanager list-secrets --query "SecretList[?starts_with(Name, 'vnl-')].Name" --output text

echo ""
echo -e "${YELLOW}== CloudWatch log groups (non-billable but indicate leftover state) ==${RESET}"
aws logs describe-log-groups --log-group-name-prefix '/aws/lambda/VNL-' \
  --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' | head -5 || true
log_count=$(aws logs describe-log-groups --log-group-name-prefix '/aws/lambda/VNL-' \
  --query 'length(logGroups)' --output text 2>/dev/null || echo 0)
if [[ "$log_count" -gt 0 ]]; then
  echo "(total: $log_count log groups — run destroy-all.sh to clean)"
fi

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}=== clean ===${RESET}"
  exit 0
else
  echo -e "${RED}=== $ERRORS billable resource class(es) still present ===${RESET}"
  echo "Leftovers: ${FOUND[*]}"
  echo "Run scripts/destroy-all.sh or clean up individually."
  exit 1
fi
