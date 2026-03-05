#!/usr/bin/env bash
# Resets all IVS channels and chat rooms back to AVAILABLE in the pool
# Safe to run anytime - only affects pool items, not session records
set -euo pipefail

REGION="us-east-1"
TABLE="vnl-sessions"

echo "=== Cleaning up stale session records (creating status) ==="
STALE=$(aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression "begins_with(PK, :pk) AND #s = :creating" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":pk":{"S":"SESSION#"},":creating":{"S":"creating"}}' \
  --region "$REGION" | jq -r '.Items[] | .PK.S + " " + .sessionId.S')

COUNT=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  PK=$(echo "$line" | awk '{print $1}')
  SID=$(echo "$line" | awk '{print $2}')
  echo "  Deleting stale session: $SID"
  aws dynamodb delete-item \
    --table-name "$TABLE" \
    --key "{\"PK\":{\"S\":\"${PK}\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --region "$REGION"
  COUNT=$((COUNT + 1))
done <<< "$STALE"
echo "  Deleted $COUNT stale sessions"

echo ""
echo "=== Resetting pool channels to AVAILABLE ==="
CHANNELS=$(aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression "begins_with(PK, :pk) AND #s = :claimed" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":pk":{"S":"POOL#CHANNEL#"},":claimed":{"S":"CLAIMED"}}' \
  --region "$REGION" | jq -r '.Items[] | .PK.S')

COUNT=0
while IFS= read -r PK; do
  [[ -z "$PK" ]] && continue
  echo "  Resetting: $PK"
  aws dynamodb update-item \
    --table-name "$TABLE" \
    --key "{\"PK\":{\"S\":\"${PK}\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --update-expression "SET #s = :avail, GSI1PK = :gsi REMOVE claimedBy, claimedAt" \
    --expression-attribute-names '{"#s":"status"}' \
    --expression-attribute-values '{":avail":{"S":"AVAILABLE"},":gsi":{"S":"STATUS#AVAILABLE"}}' \
    --region "$REGION"
  COUNT=$((COUNT + 1))
done <<< "$CHANNELS"
echo "  Reset $COUNT channels"

echo ""
echo "=== Resetting pool chat rooms to AVAILABLE ==="
CHATS=$(aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression "begins_with(PK, :pk) AND #s = :claimed" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":pk":{"S":"POOL#CHATROOM#"},":claimed":{"S":"CLAIMED"}}' \
  --region "$REGION" | jq -r '.Items[] | .PK.S')

COUNT=0
while IFS= read -r PK; do
  [[ -z "$PK" ]] && continue
  echo "  Resetting: $PK"
  aws dynamodb update-item \
    --table-name "$TABLE" \
    --key "{\"PK\":{\"S\":\"${PK}\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --update-expression "SET #s = :avail, GSI1PK = :gsi REMOVE claimedBy, claimedAt" \
    --expression-attribute-names '{"#s":"status"}' \
    --expression-attribute-values '{":avail":{"S":"AVAILABLE"},":gsi":{"S":"STATUS#AVAILABLE"}}' \
    --region "$REGION"
  COUNT=$((COUNT + 1))
done <<< "$CHATS"
echo "  Reset $COUNT chat rooms"

echo ""
echo "=== Done ==="
