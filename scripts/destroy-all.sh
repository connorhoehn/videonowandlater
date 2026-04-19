#!/usr/bin/env bash
# scripts/destroy-all.sh
# Full environment teardown — deletes IVS resources, DynamoDB pool items, and CDK stacks
#
# Handles all known failure modes:
#   - IVS recording configs attached to channels (detach → delete)
#   - IVS storage configs attached to stages (delete stages first)
#   - Stacks stuck in DELETE_FAILED (retry with --retain-resources)
#   - Stacks stuck in ROLLBACK_COMPLETE (delete before retry)
#   - Orphaned S3 bucket policies from failed deploys
#
# Usage:
#   npm run destroy          # interactive confirmation
#   npm run destroy -- --yes # skip confirmation

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

AUTO_YES="${1:-}"
TABLE="vnl-sessions"
ALL_STACKS=(VNL-Agent VNL-Api VNL-Session VNL-Storage VNL-Monitoring VNL-Web VNL-Auth)

echo ""
echo -e "${BOLD}${RED}VideoNowAndLater — Full Destroy${RESET}"
echo ""
echo -e "${YELLOW}This will delete ALL AWS resources including:${RESET}"
echo "  - IVS channels, stages, recording configs, storage configs, and chat rooms"
echo "  - DynamoDB pool items"
echo "  - All CDK stacks (S3 recordings, CloudFront, Lambdas, etc.)"
echo "  - SNS topics, SQS queues, EventBridge rules"
echo ""

if [[ "$AUTO_YES" != "--yes" ]]; then
  read -r -p "Are you sure? Type 'destroy' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "destroy" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ============================================================================
# Helper: delete all IVS channels (detach recording configs, stop streams)
# ============================================================================
delete_all_channels() {
  local CHANNELS
  CHANNELS=$(aws ivs list-channels --query 'channels[].arn' --output text 2>/dev/null || echo "")
  if [ -z "$CHANNELS" ] || [ "$CHANNELS" = "None" ]; then
    echo -e "  ${DIM}No channels found${RESET}"
    return
  fi
  for ARN in $CHANNELS; do
    local NAME
    NAME=$(echo "$ARN" | awk -F'/' '{print $2}')
    aws ivs update-channel --arn "$ARN" --recording-configuration-arn "" 2>/dev/null || true
    aws ivs stop-stream --channel-arn "$ARN" 2>/dev/null || true
    if aws ivs delete-channel --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} channel $NAME"
    else
      echo -e "  ${YELLOW}Failed${RESET} channel $NAME"
    fi
  done
}

# ============================================================================
# Helper: delete a CloudFormation stack, handling DELETE_FAILED by retaining
#         stuck resources and ROLLBACK_COMPLETE by deleting directly
# ============================================================================
force_delete_stack() {
  local STACK_NAME="$1"
  local STATUS
  STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

  if [ "$STATUS" = "NOT_FOUND" ]; then
    return 0
  fi

  if [ "$STATUS" = "DELETE_FAILED" ]; then
    echo -e "  ${YELLOW}$STACK_NAME is DELETE_FAILED — retrying with retain on stuck resources${RESET}"

    # Find which resources failed to delete
    local FAILED_RESOURCES
    FAILED_RESOURCES=$(aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" \
      --query 'StackResources[?ResourceStatus==`DELETE_FAILED`].LogicalResourceId' \
      --output text 2>/dev/null || echo "")

    if [ -n "$FAILED_RESOURCES" ] && [ "$FAILED_RESOURCES" != "None" ]; then
      local RETAIN_ARGS=()
      for RES in $FAILED_RESOURCES; do
        RETAIN_ARGS+=("$RES")
        echo -e "    ${DIM}Retaining: $RES${RESET}"
      done
      aws cloudformation delete-stack --stack-name "$STACK_NAME" \
        --retain-resources "${RETAIN_ARGS[@]}" 2>/dev/null || true
    else
      aws cloudformation delete-stack --stack-name "$STACK_NAME" 2>/dev/null || true
    fi

    echo -e "  ${DIM}Waiting for $STACK_NAME to delete...${RESET}"
    aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" 2>/dev/null || true
    return 0
  fi

  if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
    echo -e "  ${YELLOW}$STACK_NAME is ROLLBACK_COMPLETE — deleting${RESET}"
    aws cloudformation delete-stack --stack-name "$STACK_NAME" 2>/dev/null || true
    aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" 2>/dev/null || true
    return 0
  fi

  # Stack exists in a normal state — return 1 to signal CDK should handle it
  return 1
}

# ── 1. Delete IVS Channels ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 1/7: Deleting IVS Channels${RESET}"
delete_all_channels

# ── 2. Delete IVS Stages ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 2/7: Deleting IVS Stages${RESET}"

STAGES=$(aws ivs-realtime list-stages --query 'stages[].arn' --output text 2>/dev/null || echo "")
if [ -n "$STAGES" ] && [ "$STAGES" != "None" ]; then
  for ARN in $STAGES; do
    NAME=$(echo "$ARN" | awk -F'/' '{print $2}')
    # Disconnect all participants before deleting
    PARTICIPANTS=$(aws ivs-realtime list-participants --stage-arn "$ARN" \
      --query 'participants[].participantId' --output text 2>/dev/null || echo "")
    if [ -n "$PARTICIPANTS" ] && [ "$PARTICIPANTS" != "None" ]; then
      for PID in $PARTICIPANTS; do
        aws ivs-realtime disconnect-participant --stage-arn "$ARN" \
          --participant-id "$PID" 2>/dev/null || true
      done
    fi
    if aws ivs-realtime delete-stage --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} stage $NAME"
    else
      echo -e "  ${YELLOW}Failed${RESET} stage $NAME"
    fi
  done
else
  echo -e "  ${DIM}No stages found${RESET}"
fi

# ── 3. Delete IVS Chat Rooms ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 3/7: Deleting IVS Chat Rooms${RESET}"

ROOMS=$(aws ivschat list-rooms --query 'rooms[].arn' --output text 2>/dev/null || echo "")
if [ -n "$ROOMS" ] && [ "$ROOMS" != "None" ]; then
  for ARN in $ROOMS; do
    ID=$(echo "$ARN" | awk -F'/' '{print $2}')
    if aws ivschat delete-room --identifier "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} room $ID"
    else
      echo -e "  ${YELLOW}Failed${RESET} room $ID"
    fi
  done
else
  echo -e "  ${DIM}No chat rooms found${RESET}"
fi

# ── 4. Delete IVS Recording & Storage Configurations ───────────────────────
echo ""
echo -e "${BOLD}Step 4/7: Deleting IVS Recording & Storage Configurations${RESET}"

# Re-check for channels that appeared or were missed (e.g. CDK custom resources)
# and detach recording configs from them
ATTACHED=$(aws ivs list-channels --query 'channels[?recordingConfigurationArn!=``].arn' --output text 2>/dev/null || echo "")
if [ -n "$ATTACHED" ] && [ "$ATTACHED" != "None" ]; then
  for ARN in $ATTACHED; do
    aws ivs update-channel --arn "$ARN" --recording-configuration-arn "" 2>/dev/null || true
    echo -e "  ${DIM}Detached recording config from channel${RESET}"
  done
  # Delete those channels too
  for ARN in $ATTACHED; do
    aws ivs stop-stream --channel-arn "$ARN" 2>/dev/null || true
    aws ivs delete-channel --arn "$ARN" 2>/dev/null || true
  done
fi

# Delete recording configurations
REC_CONFIGS=$(aws ivs list-recording-configurations --query 'recordingConfigurations[].arn' --output text 2>/dev/null || echo "")
if [ -n "$REC_CONFIGS" ] && [ "$REC_CONFIGS" != "None" ]; then
  for ARN in $REC_CONFIGS; do
    if aws ivs delete-recording-configuration --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} recording config"
    else
      echo -e "  ${YELLOW}Failed${RESET} recording config — retrying after channel sweep"
      # Nuclear option: delete ALL remaining channels, then retry
      delete_all_channels
      if aws ivs delete-recording-configuration --arn "$ARN" 2>/dev/null; then
        echo -e "  ${GREEN}Deleted${RESET} recording config (retry succeeded)"
      else
        echo -e "  ${RED}Failed${RESET} recording config — will retain in CloudFormation"
      fi
    fi
  done
else
  echo -e "  ${DIM}No recording configurations found${RESET}"
fi

# Delete storage configurations
STORAGE_CONFIGS=$(aws ivs-realtime list-storage-configurations --query 'storageConfigurations[].arn' --output text 2>/dev/null || echo "")
if [ -n "$STORAGE_CONFIGS" ] && [ "$STORAGE_CONFIGS" != "None" ]; then
  for ARN in $STORAGE_CONFIGS; do
    if aws ivs-realtime delete-storage-configuration --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} storage config"
    else
      echo -e "  ${YELLOW}Failed${RESET} storage config (may be in use)"
    fi
  done
else
  echo -e "  ${DIM}No storage configurations found${RESET}"
fi

# ── 4b. Empty Moderation Frames Bucket (Phase 4) ────────────────────────────
echo ""
echo -e "${BOLD}Step 4b: Emptying moderation frames bucket${RESET}"
MOD_BUCKET=$(aws s3api list-buckets --query "Buckets[?starts_with(Name, 'vnl-moderation-frames-')].Name" --output text 2>/dev/null | head -1)
if [ -n "$MOD_BUCKET" ] && [ "$MOD_BUCKET" != "None" ]; then
  echo -e "  Emptying s3://$MOD_BUCKET (CDK autoDeleteObjects handles this too, but belt+suspenders)..."
  aws s3 rm "s3://$MOD_BUCKET" --recursive --quiet 2>/dev/null || true
  # Clean versioned deletes if versioning is enabled — same pattern as the recordings bucket
  aws s3api delete-objects --bucket "$MOD_BUCKET" --delete "$(aws s3api list-object-versions --bucket "$MOD_BUCKET" --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}' --output json 2>/dev/null)" 2>/dev/null || true
  echo -e "  ${GREEN}Moderation bucket drained${RESET}"
else
  echo -e "  ${DIM}No vnl-moderation-frames bucket found${RESET}"
fi

# ── 4c. Clear Cognito pre-token-generation trigger ──────────────────────────
# The trigger Lambda is owned by VNL-Api but attached to the UserPool owned by
# VNL-Auth. When VNL-Api is destroyed first, the UserPool can point at a
# deleted Lambda which blocks sign-in AND sometimes blocks UserPool deletion.
echo ""
echo -e "${BOLD}Step 4c: Clearing Cognito pre-token trigger${RESET}"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --query 'UserPools[?contains(Name, `vnl`) || contains(Name, `VNL`)].Id' --output text 2>/dev/null | head -1)
if [ -n "$POOL_ID" ] && [ "$POOL_ID" != "None" ]; then
  HAS_TRIGGER=$(aws cognito-idp describe-user-pool --user-pool-id "$POOL_ID" --query 'UserPool.LambdaConfig.PreTokenGeneration' --output text 2>/dev/null || echo "None")
  if [ "$HAS_TRIGGER" != "None" ] && [ -n "$HAS_TRIGGER" ]; then
    echo -e "  Removing PreTokenGeneration trigger on $POOL_ID..."
    aws cognito-idp update-user-pool --user-pool-id "$POOL_ID" --lambda-config '{}' >/dev/null 2>&1 \
      && echo -e "  ${GREEN}Trigger cleared${RESET}" \
      || echo -e "  ${YELLOW}Could not clear trigger — may need manual cleanup${RESET}"
  else
    echo -e "  ${DIM}No pre-token trigger set${RESET}"
  fi
else
  echo -e "  ${DIM}No vnl user pool found${RESET}"
fi

# ── 5. Flush DynamoDB Pool Items ────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 5/7: Flushing DynamoDB Pool Items${RESET}"

TABLE_EXISTS=$(aws dynamodb describe-table --table-name "$TABLE" --query 'Table.TableStatus' --output text 2>/dev/null || echo "NOT_FOUND")
if [ "$TABLE_EXISTS" = "ACTIVE" ]; then
  POOL_ITEMS=$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression 'begins_with(PK, :prefix)' \
    --expression-attribute-values '{":prefix":{"S":"POOL#"}}' \
    --query 'Items[].{PK:PK,SK:SK}' \
    --output json 2>/dev/null || echo "[]")

  POOL_COUNT=$(echo "$POOL_ITEMS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  if [ "$POOL_COUNT" -gt 0 ]; then
    echo "$POOL_ITEMS" | python3 -c "
import sys, json, subprocess
TABLE = '$TABLE'
items = json.load(sys.stdin)
for i in range(0, len(items), 25):
    batch = items[i:i+25]
    request = {TABLE: [{'DeleteRequest': {'Key': item}} for item in batch]}
    subprocess.run(
        ['aws', 'dynamodb', 'batch-write-item', '--request-items', json.dumps(request), '--output', 'json'],
        capture_output=True, text=True
    )
    print(f'  Deleted items {i+1}-{i+len(batch)}')
"
    echo -e "  ${GREEN}Flushed $POOL_COUNT pool items${RESET}"
  else
    echo -e "  ${DIM}No pool items found${RESET}"
  fi
else
  echo -e "  ${DIM}Table not found (already deleted)${RESET}"
fi

# ── 6. Clean up stuck CloudFormation stacks ─────────────────────────────────
echo ""
echo -e "${BOLD}Step 6/7: Cleaning up stuck CloudFormation stacks${RESET}"

STUCK_FOUND=0
for STACK_NAME in "${ALL_STACKS[@]}"; do
  if force_delete_stack "$STACK_NAME"; then
    STUCK_FOUND=1
  fi
done
if [ "$STUCK_FOUND" -eq 0 ]; then
  echo -e "  ${DIM}No stuck stacks${RESET}"
fi

# ── 7. CDK Destroy ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 7/7: Destroying CDK Stacks${RESET}"
echo ""

# Check if any stacks remain for CDK to destroy
REMAINING=0
for STACK_NAME in "${ALL_STACKS[@]}"; do
  STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STATUS" != "NOT_FOUND" ]; then
    REMAINING=1
    break
  fi
done

if [ "$REMAINING" -eq 1 ]; then
  if ! npx cdk destroy --all --force 2>&1; then
    echo ""
    echo -e "${YELLOW}CDK destroy hit errors — running recovery pass...${RESET}"
    echo ""

    # Final IVS sweep: some resources may have been recreated by custom resource Lambdas
    # during the delete process
    delete_all_channels

    REC_CONFIGS=$(aws ivs list-recording-configurations --query 'recordingConfigurations[].arn' --output text 2>/dev/null || echo "")
    if [ -n "$REC_CONFIGS" ] && [ "$REC_CONFIGS" != "None" ]; then
      for ARN in $REC_CONFIGS; do
        aws ivs delete-recording-configuration --arn "$ARN" 2>/dev/null || true
      done
    fi

    STORAGE_CONFIGS=$(aws ivs-realtime list-storage-configurations --query 'storageConfigurations[].arn' --output text 2>/dev/null || echo "")
    if [ -n "$STORAGE_CONFIGS" ] && [ "$STORAGE_CONFIGS" != "None" ]; then
      for ARN in $STORAGE_CONFIGS; do
        aws ivs-realtime delete-storage-configuration --arn "$ARN" 2>/dev/null || true
      done
    fi

    # Force-delete any stacks that got stuck
    for STACK_NAME in "${ALL_STACKS[@]}"; do
      force_delete_stack "$STACK_NAME"
    done

    # Retry CDK destroy for anything still standing
    REMAINING=0
    for STACK_NAME in "${ALL_STACKS[@]}"; do
      STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
      if [ "$STATUS" != "NOT_FOUND" ]; then
        REMAINING=1
        break
      fi
    done

    if [ "$REMAINING" -eq 1 ]; then
      npx cdk destroy --all --force || true
    fi
  fi
else
  echo -e "  ${DIM}All stacks already deleted${RESET}"
fi

# ── Delete orphaned S3 bucket policies ──────────────────────────────────────
for BUCKET in vnl-recordings-vnl-storage vnl-recordings-vnl-session vnl-transcription-vnl-storage vnl-transcription-vnl-session; do
  if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    aws s3api delete-bucket-policy --bucket "$BUCKET" 2>/dev/null || true
  fi
done

# ── Cleanup local files ────────────────────────────────────────────────────
rm -f cdk-outputs.json
rm -f web/public/aws-config.json

echo ""
echo -e "${GREEN}${BOLD}Destroy complete.${RESET}"
echo -e "${DIM}All IVS resources, pool items, and CDK stacks have been removed.${RESET}"
echo ""
