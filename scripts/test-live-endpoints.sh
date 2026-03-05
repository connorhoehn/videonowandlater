#!/usr/bin/env bash
# Usage: ./scripts/test-live-endpoints.sh <SESSION_ID> <AUTH_TOKEN>
# AUTH_TOKEN: copy from browser Network tab (Authorization header, strip "Bearer ")
# Example: ./scripts/test-live-endpoints.sh abc-123 eyJraWQ...

set -euo pipefail

SESSION_ID="${1:-}"
AUTH_TOKEN="${2:-}"

if [[ -z "$SESSION_ID" || -z "$AUTH_TOKEN" ]]; then
  echo "Usage: $0 <SESSION_ID> <AUTH_TOKEN>"
  echo ""
  echo "Get AUTH_TOKEN from browser DevTools → Network → any request → Authorization header (drop 'Bearer ')"
  exit 1
fi

API="https://blsrob3vr2.execute-api.us-east-1.amazonaws.com/prod"
TABLE="vnl-sessions"
REGION="us-east-1"

echo "========================================"
echo "  Session: $SESSION_ID"
echo "========================================"

# 1. Check session status in DynamoDB
echo ""
echo "--- DynamoDB Session State ---"
aws dynamodb get-item \
  --table-name "$TABLE" \
  --key "{\"PK\":{\"S\":\"SESSION#${SESSION_ID}\"},\"SK\":{\"S\":\"METADATA\"}}" \
  --region "$REGION" \
  | jq '{status: .Item.status.S, startedAt: (.Item.startedAt.S // "null"), version: .Item.version.N}'

# 2. Test reactions endpoint
echo ""
echo "--- POST /reactions ---"
REACTION_RESP=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "${API}/sessions/${SESSION_ID}/reactions" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"emojiType":"heart","reactionType":"live"}')

REACTION_BODY=$(echo "$REACTION_RESP" | sed -e 's/HTTP_STATUS:[0-9]*//')
REACTION_STATUS=$(echo "$REACTION_RESP" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')

if [[ "$REACTION_STATUS" == "200" || "$REACTION_STATUS" == "201" ]]; then
  echo "✅ PASS ($REACTION_STATUS): $REACTION_BODY"
else
  echo "❌ FAIL ($REACTION_STATUS): $REACTION_BODY"
fi

# 3. Test chat messages endpoint
echo ""
echo "--- POST /chat/messages ---"
MSG_ID=$(uuidgen 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())")
SENT_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
MSG_RESP=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "${API}/sessions/${SESSION_ID}/chat/messages" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"messageId\":\"${MSG_ID}\",\"content\":\"test message\",\"senderId\":\"test-user\",\"senderAttributes\":{\"displayName\":\"test-user\",\"role\":\"viewer\"},\"sentAt\":\"${SENT_AT}\"}")

MSG_BODY=$(echo "$MSG_RESP" | sed -e 's/HTTP_STATUS:[0-9]*//')
MSG_STATUS=$(echo "$MSG_RESP" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')

if [[ "$MSG_STATUS" == "200" || "$MSG_STATUS" == "201" ]]; then
  echo "✅ PASS ($MSG_STATUS): $MSG_BODY"
else
  echo "❌ FAIL ($MSG_STATUS): $MSG_BODY"
fi

echo ""
echo "========================================"

# 4. If failing due to session status, offer to force LIVE
if [[ "$REACTION_STATUS" != "200" && "$REACTION_STATUS" != "201" ]] || \
   [[ "$MSG_STATUS" != "200" && "$MSG_STATUS" != "201" ]]; then
  echo ""
  read -p "Force session to LIVE in DynamoDB for testing? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    aws dynamodb update-item \
      --table-name "$TABLE" \
      --key "{\"PK\":{\"S\":\"SESSION#${SESSION_ID}\"},\"SK\":{\"S\":\"METADATA\"}}" \
      --update-expression "SET #s = :live, startedAt = :now, GSI1PK = :gsi, version = version + :inc" \
      --expression-attribute-names '{"#s":"status"}' \
      --expression-attribute-values "{\":live\":{\"S\":\"live\"},\":now\":{\"S\":\"${NOW}\"},\":gsi\":{\"S\":\"STATUS#LIVE\"},\":inc\":{\"N\":\"1\"}}" \
      --region "$REGION"
    echo "✅ Session forced to LIVE with startedAt=$NOW"
    echo "Re-run this script to verify endpoints now pass."
  fi
fi
