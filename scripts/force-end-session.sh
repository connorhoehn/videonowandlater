#!/usr/bin/env bash
# scripts/force-end-session.sh
# Force a stuck session from LIVE → ENDED in DynamoDB when EventBridge hasn't fired.
# Use this when IVS recording processing is delayed or the stream-end event was missed.
#
# Usage:
#   ./scripts/force-end-session.sh <session-id>
#   ./scripts/force-end-session.sh          # auto-picks most recent LIVE session

set -euo pipefail

TABLE="vnl-sessions"
AUTO_YES=""

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Parse args ────────────────────────────────────────────────────────────────
SESSION_ID=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES="yes" ;;
    *) SESSION_ID="$arg" ;;
  esac
done

# ── Resolve session ID ───────────────────────────────────────────────────────
if [ -n "$SESSION_ID" ]; then
  : # already set
else
  SESSION_ID=$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression "entityType = :t AND GSI1PK = :live" \
    --expression-attribute-values '{":t":{"S":"SESSION"},":live":{"S":"STATUS#LIVE"}}' \
    --query "Items[0].sessionId.S" \
    --output text 2>/dev/null || true)

  if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "None" ]; then
    echo -e "${RED}No LIVE sessions found.${RESET}"
    exit 1
  fi
  echo -e "${DIM}Auto-selected session: $SESSION_ID${RESET}"
fi

# ── Fetch current state (supports partial/truncated session IDs) ─────────────
RAW=$(aws dynamodb get-item \
  --table-name "$TABLE" \
  --key "{\"PK\":{\"S\":\"SESSION#$SESSION_ID\"},\"SK\":{\"S\":\"METADATA\"}}" \
  --output json 2>/dev/null)

ITEM=$(echo "$RAW" | python3 -c "
import sys, json
d = json.load(sys.stdin)
item = d.get('Item', {})
print(json.dumps({k: list(v.values())[0] for k, v in item.items()}))
" 2>/dev/null || echo "{}")

# If exact lookup failed, try prefix scan (handles 8-char truncated IDs from diagnose.sh)
STATUS_CHECK=$(echo "$ITEM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
if [ -z "$STATUS_CHECK" ]; then
  SCAN_RAW=$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression "entityType = :t AND begins_with(sessionId, :prefix)" \
    --expression-attribute-values "{\":t\":{\"S\":\"SESSION\"},\":prefix\":{\"S\":\"$SESSION_ID\"}}" \
    --output json 2>/dev/null)
  FULL_ID=$(echo "$SCAN_RAW" | python3 -c "
import sys, json
items = json.load(sys.stdin).get('Items', [])
if items:
    item = {k: list(v.values())[0] for k, v in items[0].items()}
    print(item.get('sessionId', ''))
" 2>/dev/null || true)
  if [ -n "$FULL_ID" ] && [ "$FULL_ID" != "$SESSION_ID" ]; then
    SESSION_ID="$FULL_ID"
    RAW=$(aws dynamodb get-item \
      --table-name "$TABLE" \
      --key "{\"PK\":{\"S\":\"SESSION#$SESSION_ID\"},\"SK\":{\"S\":\"METADATA\"}}" \
      --output json 2>/dev/null)
    ITEM=$(echo "$RAW" | python3 -c "
import sys, json
d = json.load(sys.stdin)
item = d.get('Item', {})
print(json.dumps({k: list(v.values())[0] for k, v in item.items()}))
" 2>/dev/null || echo "{}")
  fi
fi

STATUS=$(echo "$ITEM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))")
SESSION_TYPE=$(echo "$ITEM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionType','?'))")
USER_ID=$(echo "$ITEM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('userId','?'))")

echo ""
echo -e "${BOLD}Session:${RESET}  $SESSION_ID"
echo -e "${BOLD}Type:${RESET}     $SESSION_TYPE"
echo -e "${BOLD}Owner:${RESET}    $USER_ID"
echo -e "${BOLD}Status:${RESET}   ${YELLOW}$STATUS${RESET}"
echo ""

if [ "$STATUS" = "ended" ]; then
  echo -e "${GREEN}Session is already ENDED. Nothing to do.${RESET}"
  exit 0
fi

if [ "$STATUS" != "live" ] && [ "$STATUS" != "ending" ] && [ "$STATUS" != "creating" ]; then
  echo -e "${RED}Unexpected status '$STATUS' — only live/ending/creating can be force-ended.${RESET}"
  exit 1
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
echo -e "${YELLOW}This will force the session to ENDED in DynamoDB.${RESET}"
echo -e "${DIM}Note: Pool resources (channel, stage, chatRoom) will NOT be released by this script.${RESET}"
echo -e "${DIM}      Run ./scripts/cleanup-resources.sh if the pool needs to be replenished.${RESET}"
echo ""
if [[ "$AUTO_YES" != "yes" ]]; then
  read -r -p "Force-end session $SESSION_ID? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Update DynamoDB ──────────────────────────────────────────────────────────
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

aws dynamodb update-item \
  --table-name "$TABLE" \
  --key "{\"PK\":{\"S\":\"SESSION#$SESSION_ID\"},\"SK\":{\"S\":\"METADATA\"}}" \
  --update-expression "SET #status = :ended, GSI1PK = :gsi1pk, endedAt = :now, #version = #version + :one" \
  --expression-attribute-names '{"#status":"status","#version":"version"}' \
  --expression-attribute-values "{
    \":ended\":{\"S\":\"ended\"},
    \":gsi1pk\":{\"S\":\"STATUS#ENDED\"},
    \":now\":{\"S\":\"$NOW\"},
    \":one\":{\"N\":\"1\"}
  }" \
  --condition-expression "attribute_exists(PK)" \
  --output json > /dev/null

echo ""
echo -e "${GREEN}${BOLD}✓ Session forced to ENDED${RESET}"
echo -e "  endedAt: $NOW"
echo ""
echo -e "${DIM}The recording may still be processing in IVS. Once IVS fires the Recording End${RESET}"
echo -e "${DIM}EventBridge event, recordingHlsUrl and recordingStatus will be updated automatically.${RESET}"
echo ""
echo -e "Monitor: ${BOLD}./scripts/monitor-session.sh $SESSION_ID${RESET}"
