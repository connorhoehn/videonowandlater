#!/usr/bin/env bash
# scripts/predeploy-check.sh
# Pre-deploy environment checks — runs before cdk deploy
# Verifies AWS credentials, builds, tests, and CDK synth

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

ERRORS=0
WARNINGS=0

echo ""
echo -e "${BOLD}VideoNowAndLater — Pre-Deploy Checks${RESET}"
echo ""

# ── 1. AWS Credentials ──────────────────────────────────────────────────────
echo -n "  AWS credentials... "
if IDENTITY=$(aws sts get-caller-identity --output json 2>/dev/null); then
  ACCOUNT=$(echo "$IDENTITY" | jq -r '.Account')
  echo -e "${GREEN}OK${RESET} (account: $ACCOUNT)"
else
  echo -e "${RED}FAILED${RESET} — configure AWS credentials first"
  ERRORS=$((ERRORS + 1))
fi

# ── 1b. Local file: deps resolvable (vnl-ads client + admin-ui) ─────────────
echo -n "  @vnl/ads-client (local file dep)... "
if [ -f "node_modules/@vnl/ads-client/package.json" ]; then
  ADS_CLIENT_VER=$(jq -r '.version' node_modules/@vnl/ads-client/package.json 2>/dev/null || echo "?")
  echo -e "${GREEN}OK${RESET} (v$ADS_CLIENT_VER)"
else
  echo -e "${RED}MISSING${RESET} — run: npm install"
  echo -e "    ${DIM}Check that ../vnl-ads/client exists and is built (npm run build in vnl-ads/client).${RESET}"
  ERRORS=$((ERRORS + 1))
fi

echo -n "  @vnl/ads-admin-ui (local file dep)... "
if [ -f "node_modules/@vnl/ads-admin-ui/package.json" ]; then
  ADS_UI_VER=$(jq -r '.version' node_modules/@vnl/ads-admin-ui/package.json 2>/dev/null || echo "?")
  echo -e "${GREEN}OK${RESET} (v$ADS_UI_VER)"
else
  echo -e "${RED}MISSING${RESET} — run: npm install"
  echo -e "    ${DIM}Check that ../vnl-ads/admin-ui exists and is built.${RESET}"
  ERRORS=$((ERRORS + 1))
fi

# ── 2. Backend TypeScript ────────────────────────────────────────────────────
echo -n "  Backend TypeScript... "
if (cd backend && npx tsc --noEmit) > /dev/null 2>&1; then
  echo -e "${GREEN}OK${RESET}"
else
  echo -e "${RED}FAILED${RESET} — run: cd backend && npx tsc --noEmit"
  ERRORS=$((ERRORS + 1))
fi

# ── 3. Infra TypeScript ─────────────────────────────────────────────────────
echo -n "  Infra TypeScript... "
if (cd infra && npx tsc --noEmit) > /dev/null 2>&1; then
  echo -e "${GREEN}OK${RESET}"
else
  echo -e "${RED}FAILED${RESET} — run: cd infra && npx tsc --noEmit"
  ERRORS=$((ERRORS + 1))
fi

# ── 4. Frontend TypeScript ───────────────────────────────────────────────────
echo -n "  Frontend TypeScript... "
if (cd web && npx tsc --noEmit) > /dev/null 2>&1; then
  echo -e "${GREEN}OK${RESET}"
else
  echo -e "${RED}FAILED${RESET} — run: cd web && npx tsc --noEmit"
  ERRORS=$((ERRORS + 1))
fi

# ── 5. Backend Tests ─────────────────────────────────────────────────────────
# Capture jest output without letting a non-zero exit kill the script (pipefail + set -e).
echo -n "  Backend tests... "
JEST_OUTPUT=$(cd backend && npx jest 2>&1; echo "__EXIT__=$?")
JEST_EXIT=$(echo "$JEST_OUTPUT" | grep -oE '__EXIT__=[0-9]+' | tail -1 | cut -d= -f2)
TEST_SUMMARY=$(echo "$JEST_OUTPUT" | grep -E "^Tests:" | tail -1 | sed 's/^[[:space:]]*//')
if [ "${JEST_EXIT:-1}" = "0" ]; then
  echo -e "${GREEN}OK${RESET} ($TEST_SUMMARY)"
else
  echo -e "${RED}FAILED${RESET} — run: cd backend && npm test"
  [ -n "$TEST_SUMMARY" ] && echo -e "    ${DIM}${TEST_SUMMARY}${RESET}"
  ERRORS=$((ERRORS + 1))
fi

# ── 6. Frontend Build ────────────────────────────────────────────────────────
echo -n "  Frontend build... "
if (cd web && npm run build) > /dev/null 2>&1; then
  echo -e "${GREEN}OK${RESET}"
else
  echo -e "${RED}FAILED${RESET} — run: cd web && npm run build"
  ERRORS=$((ERRORS + 1))
fi

# ── 7. CDK Synth ─────────────────────────────────────────────────────────────
echo -n "  CDK synth... "
if npx cdk synth > /dev/null 2>&1; then
  echo -e "${GREEN}OK${RESET}"
else
  echo -e "${RED}FAILED${RESET} — run: npx cdk synth"
  ERRORS=$((ERRORS + 1))
fi

# ── 8. AWS Environment Checks ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  AWS Environment${RESET}"

# 8a. S3 bucket policy conflicts — auto-fix orphaned policies from failed rollbacks
RECORDINGS_BUCKET="vnl-recordings-vnl-storage"
echo -n "  S3 bucket policy ($RECORDINGS_BUCKET)... "
if aws s3api get-bucket-policy --bucket "$RECORDINGS_BUCKET" --output text > /dev/null 2>&1; then
  # Bucket has a policy — check if CDK manages it or it's out-of-band
  STACK_POLICY=$(aws cloudformation describe-stack-resource \
    --stack-name VNL-Session \
    --logical-resource-id RecordingsBucketPolicy7D6C1F47 \
    --query 'StackResourceDetail.PhysicalResourceId' \
    --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STACK_POLICY" = "NOT_FOUND" ]; then
    echo -e "${YELLOW}EXISTS (not CDK-managed) — removing...${RESET}"
    if aws s3api delete-bucket-policy --bucket "$RECORDINGS_BUCKET" 2>/dev/null; then
      echo -e "    ${GREEN}Deleted orphaned bucket policy${RESET} — CDK will recreate it on deploy"
    else
      echo -e "    ${RED}Failed to delete orphaned bucket policy${RESET}"
      echo -e "    ${DIM}Manually run: aws s3api delete-bucket-policy --bucket $RECORDINGS_BUCKET${RESET}"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo -e "${GREEN}OK${RESET} (CDK-managed)"
  fi
else
  echo -e "${GREEN}OK${RESET} (no existing policy)"
fi

# 8b. Check for orphaned IVS resources that might block stack operations
echo -n "  IVS recording configurations... "
REC_CONFIGS=$(aws ivs list-recording-configurations --query 'recordingConfigurations | length(@)' --output text 2>/dev/null || echo "0")
ATTACHED=$(aws ivs list-channels --query 'channels[?recordingConfigurationArn] | length(@)' --output text 2>/dev/null || echo "0")
if [ "${ATTACHED:-0}" -gt 0 ]; then
  echo -e "${YELLOW}$ATTACHED channel(s) have recording config attached${RESET}"
  echo -e "    ${DIM}May block RecordingConfiguration updates. Run cleanup-ivs.sh if deploy fails.${RESET}"
else
  echo -e "${GREEN}OK${RESET} ($REC_CONFIGS config(s), none attached to channels)"
fi

# 8c. Check for IVS storage configurations (needed for stage recording)
echo -n "  IVS storage configurations... "
STORAGE_CONFIGS=$(aws ivs-realtime list-storage-configurations --query 'storageConfigurations | length(@)' --output text 2>/dev/null || echo "0")
echo -e "${GREEN}${STORAGE_CONFIGS} existing${RESET}"

# 8d. Check CloudFormation stack status (detect ROLLBACK states, auto-fix ROLLBACK_COMPLETE)
echo -n "  CloudFormation stack status... "
STACK_ERRORS=0
for STACK in VNL-Storage VNL-Session VNL-Api VNL-Api-Ext VNL-Auth VNL-Web VNL-Monitoring VNL-Agent; do
  STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
    # Stack failed on first create and rolled back — must be deleted before CDK can recreate
    if [ "$STACK_ERRORS" -eq 0 ]; then echo ""; fi
    echo -e "    ${YELLOW}$STACK: $STATUS — deleting so CDK can recreate...${RESET}"
    if aws cloudformation delete-stack --stack-name "$STACK" 2>/dev/null \
       && aws cloudformation wait stack-delete-complete --stack-name "$STACK" 2>/dev/null; then
      echo -e "    ${GREEN}Deleted $STACK${RESET} — CDK will recreate it on deploy"
    else
      echo -e "    ${RED}Failed to delete $STACK${RESET}"
      echo -e "    ${DIM}Manually run: aws cloudformation delete-stack --stack-name $STACK${RESET}"
      ERRORS=$((ERRORS + 1))
    fi
    STACK_ERRORS=$((STACK_ERRORS + 1))
  elif [[ "$STATUS" != "UPDATE_ROLLBACK_COMPLETE" ]] && { [[ "$STATUS" == *ROLLBACK* ]] || [[ "$STATUS" == *FAILED* ]]; }; then
    if [ "$STACK_ERRORS" -eq 0 ]; then echo ""; fi
    echo -e "    ${RED}$STACK: $STATUS${RESET}"
    echo -e "    ${DIM}Stack is in a failed state. May need manual cleanup before deploy.${RESET}"
    ERRORS=$((ERRORS + 1))
    STACK_ERRORS=$((STACK_ERRORS + 1))
  fi
done
if [ "$STACK_ERRORS" -eq 0 ]; then
  echo -e "${GREEN}OK${RESET}"
fi

# 8e. Check DynamoDB table exists and GSI count
echo -n "  DynamoDB table (vnl-sessions)... "
TABLE_STATUS=$(aws dynamodb describe-table --table-name vnl-sessions --query 'Table.TableStatus' --output text 2>/dev/null || echo "NOT_FOUND")
if [ "$TABLE_STATUS" = "ACTIVE" ]; then
  GSI_COUNT=$(aws dynamodb describe-table --table-name vnl-sessions --query 'Table.GlobalSecondaryIndexes | length(@)' --output text 2>/dev/null || echo "0")
  echo -e "${GREEN}ACTIVE${RESET} ($GSI_COUNT GSIs)"
elif [ "$TABLE_STATUS" = "NOT_FOUND" ]; then
  echo -e "${DIM}not found (will be created)${RESET}"
else
  echo -e "${YELLOW}$TABLE_STATUS${RESET}"
fi

# 8f. Check Cognito user pool
echo -n "  Cognito user pool... "
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --query 'UserPools[?contains(Name, `vnl`) || contains(Name, `VNL`)].Id' --output text 2>/dev/null | head -1)
if [ -n "$POOL_ID" ] && [ "$POOL_ID" != "None" ]; then
  ADMIN_GROUP=$(aws cognito-idp get-group --user-pool-id "$POOL_ID" --group-name admin --query 'Group.GroupName' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$ADMIN_GROUP" = "admin" ]; then
    echo -e "${GREEN}OK${RESET} (admin group exists)"
  else
    echo -e "${YELLOW}OK${RESET} (admin group not yet created — will be created on deploy)"
  fi
else
  echo -e "${DIM}not found (will be created)${RESET}"
fi

# 8g. Check moderation frames bucket (Phase 4 — auto-created by CDK)
echo -n "  Moderation frames bucket... "
MOD_BUCKET=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, 'vnl-moderation-frames-')].Name" --output text 2>/dev/null | head -1)
if [ -n "$MOD_BUCKET" ] && [ "$MOD_BUCKET" != "None" ]; then
  echo -e "${GREEN}OK${RESET} ($MOD_BUCKET)"
else
  echo -e "${DIM}not found (will be created)${RESET}"
fi

# 8h. Check ECR repo for VNL-Agent container
echo -n "  ECR repository (vnl-ai-agent)... "
if aws ecr describe-repositories --repository-names vnl-ai-agent > /dev/null 2>&1; then
  echo -e "${GREEN}OK${RESET}"
else
  echo -e "${DIM}not found (will be created by VNL-Agent deploy)${RESET}"
fi

# 8i. CFN 500-resource-per-stack limit — surface before synth attempts it
echo -n "  CDK synth resource counts... "
if SYNTH=$(npx cdk synth --json 2>&1 > /dev/null); then
  echo -e "${GREEN}OK${RESET}"
elif echo "$SYNTH" | grep -q "greater than allowed maximum of 500"; then
  COUNT=$(echo "$SYNTH" | grep -oE "stack '[^']+': [0-9]+" | head -1)
  echo -e "${RED}RESOURCE LIMIT${RESET} — $COUNT"
  echo -e "    ${DIM}CFN hard-caps 500 resources per stack. Split ApiStack into more sibling stacks.${RESET}"
  ERRORS=$((ERRORS + 1))
elif echo "$SYNTH" | grep -q "already a Construct with name"; then
  DUPE=$(echo "$SYNTH" | grep -oE "name '[^']+'" | head -1)
  echo -e "${RED}DUPLICATE CONSTRUCT${RESET} — $DUPE"
  echo -e "    ${DIM}Two agents likely added the same CDK resource. Find and dedupe.${RESET}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${YELLOW}synth issue${RESET}"
  echo "$SYNTH" | tail -3 | sed 's/^/    /'
  ERRORS=$((ERRORS + 1))
fi

# ── 9. vnl-ads integration sanity (CDK context) ─────────────────────────────
echo ""
echo -e "${BOLD}  vnl-ads Integration${RESET}"
ADS_BASE_CTX=$(jq -r '.context.vnlAdsBaseUrl // ""' cdk.json 2>/dev/null || echo "")
ADS_SECRET_CTX=$(jq -r '.context.vnlAdsJwtSecret // ""' cdk.json 2>/dev/null || echo "")
ADS_FLAG_CTX=$(jq -r '.context.vnlAdsFeatureEnabled // "false"' cdk.json 2>/dev/null || echo "false")
echo -n "  Feature flag... "
if [ "$ADS_FLAG_CTX" = "true" ]; then
  if [ -n "$ADS_BASE_CTX" ] && [ -n "$ADS_SECRET_CTX" ]; then
    echo -e "${GREEN}ON${RESET} (base=$ADS_BASE_CTX)"
  else
    echo -e "${YELLOW}ON but missing base URL or secret${RESET} — deploy will feature-flag off at runtime"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${DIM}off (default) — vnl-ads calls will short-circuit to safe defaults${RESET}"
fi

# ── 9. Check for uncommitted changes ────────────────────────────────────────
echo ""
echo -n "  Git status... "
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$DIRTY" -eq 0 ]; then
  echo -e "${GREEN}clean${RESET}"
else
  echo -e "${YELLOW}$DIRTY uncommitted change(s)${RESET} — consider committing first"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All checks passed — ready to deploy.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}$ERRORS check(s) failed — fix before deploying.${RESET}"
  exit 1
fi
