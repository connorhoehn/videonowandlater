#!/usr/bin/env bash
# scripts/destroy-all.sh
# Full environment teardown — deletes IVS resources, DynamoDB pool items, and CDK stacks
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

echo ""
echo -e "${BOLD}${RED}VideoNowAndLater — Full Destroy${RESET}"
echo ""
echo -e "${YELLOW}This will delete ALL AWS resources including:${RESET}"
echo "  - IVS channels, stages, and chat rooms"
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

# ── 1. Delete IVS Channels ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 1/6: Deleting IVS Channels${RESET}"

CHANNELS=$(aws ivs list-channels --query 'channels[].arn' --output text 2>/dev/null || echo "")
if [ -n "$CHANNELS" ] && [ "$CHANNELS" != "None" ]; then
  for ARN in $CHANNELS; do
    NAME=$(echo "$ARN" | awk -F'/' '{print $2}')
    # Detach recording config first
    aws ivs update-channel --arn "$ARN" --recording-configuration-arn "" 2>/dev/null || true
    # Stop any active stream
    aws ivs stop-stream --channel-arn "$ARN" 2>/dev/null || true
    # Delete the channel
    if aws ivs delete-channel --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} channel $NAME"
    else
      echo -e "  ${YELLOW}Failed${RESET} channel $NAME (may be in use)"
    fi
  done
else
  echo -e "  ${DIM}No channels found${RESET}"
fi

# ── 2. Delete IVS Stages ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 2/6: Deleting IVS Stages${RESET}"

STAGES=$(aws ivs-realtime list-stages --query 'stages[].arn' --output text 2>/dev/null || echo "")
if [ -n "$STAGES" ] && [ "$STAGES" != "None" ]; then
  for ARN in $STAGES; do
    NAME=$(echo "$ARN" | awk -F'/' '{print $2}')
    if aws ivs-realtime delete-stage --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} stage $NAME"
    else
      echo -e "  ${YELLOW}Failed${RESET} stage $NAME (may have active participants)"
    fi
  done
else
  echo -e "  ${DIM}No stages found${RESET}"
fi

# ── 3. Delete IVS Chat Rooms ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 3/6: Deleting IVS Chat Rooms${RESET}"

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

# ── 4. Delete IVS Storage Configurations ────────────────────────────────────
echo ""
echo -e "${BOLD}Step 4/6: Deleting IVS Storage Configurations${RESET}"

STORAGE_CONFIGS=$(aws ivs-realtime list-storage-configurations --query 'storageConfigurations[].arn' --output text 2>/dev/null || echo "")
if [ -n "$STORAGE_CONFIGS" ] && [ "$STORAGE_CONFIGS" != "None" ]; then
  for ARN in $STORAGE_CONFIGS; do
    if aws ivs-realtime delete-storage-configuration --arn "$ARN" 2>/dev/null; then
      echo -e "  ${GREEN}Deleted${RESET} storage config"
    else
      echo -e "  ${YELLOW}Failed${RESET} storage config (may be in use by stages)"
    fi
  done
else
  echo -e "  ${DIM}No storage configurations found${RESET}"
fi

# ── 5. Flush DynamoDB Pool Items ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 5/6: Flushing DynamoDB Pool Items${RESET}"

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

# ── 6. CDK Destroy ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 6/6: Destroying CDK Stacks${RESET}"
echo ""

npx cdk destroy --all --force

# ── Cleanup local files ──────────────────────────────────────────────────────
rm -f cdk-outputs.json
rm -f web/public/aws-config.json

echo ""
echo -e "${GREEN}${BOLD}Destroy complete.${RESET}"
echo -e "${DIM}All IVS resources, pool items, and CDK stacks have been removed.${RESET}"
echo ""
