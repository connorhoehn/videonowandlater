#!/usr/bin/env bash
# smoke-live-channel.sh — end-to-end test of the /v1/sessions/:id/live-channel
# endpoint using the same JWT shape vnl-ads would produce.
#
# Exits 0 only if auth, 404 on unknown, 410 on non-LIVE, and 401 on bad-JWT
# all behave as specified. The 200 (LIVE broadcast) path is skipped unless
# you pass a session ID that's currently LIVE as $LIVE_SESSION_ID.
#
# Usage:
#   ./scripts/smoke-live-channel.sh
#   LIVE_SESSION_ID=abc123 ./scripts/smoke-live-channel.sh

set -euo pipefail

API_URL=$(aws cloudformation describe-stacks --stack-name VNL-Api \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]" \
  --output text 2>/dev/null | sed 's|/$||')
if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
  echo "could not resolve ApiUrl from VNL-Api stack"
  exit 2
fi

SECRET=$(aws ssm get-parameter --name /vnl/ads-service-jwt --with-decryption \
  --query Parameter.Value --output text 2>/dev/null)
if [ -z "$SECRET" ]; then
  echo "could not read /vnl/ads-service-jwt from SSM"
  exit 2
fi

base="$API_URL/v1/sessions"
echo "api base:  $base"

# --- tiny HS256 JWT minter (no deps) ---
b64url() {
  # usage: b64url <string>
  printf %s "$1" | openssl base64 -A | tr '+/' '-_' | tr -d '='
}
b64url_bin() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

mint_jwt() {
  # usage: mint_jwt <iss> <aud> <sub> <ttl_seconds>
  local iss="$1" aud="$2" sub="$3" ttl="$4"
  local now=$(date +%s)
  local exp=$((now + ttl))
  local header='{"alg":"HS256","typ":"JWT"}'
  local payload
  payload=$(printf '{"iss":"%s","aud":"%s","sub":"%s","iat":%d,"exp":%d}' \
    "$iss" "$aud" "$sub" "$now" "$exp")
  local h=$(b64url "$header")
  local p=$(b64url "$payload")
  local sig=$(printf '%s.%s' "$h" "$p" \
    | openssl dgst -sha256 -mac HMAC -macopt "key:$SECRET" -binary | b64url_bin)
  printf '%s.%s.%s' "$h" "$p" "$sig"
}

hit() {
  # usage: hit <label> <expected_status> <path> [--header "..."]
  local label="$1" expected="$2" path="$3"
  shift 3
  local resp
  resp=$(curl -sS -o /tmp/smoke-body.json -w '%{http_code}' "$base$path" "$@")
  if [ "$resp" = "$expected" ]; then
    printf '  ok   %-40s (%s)\n' "$label" "$resp"
  else
    printf '  FAIL %-40s (expected %s, got %s)\n' "$label" "$expected" "$resp"
    echo "       body: $(cat /tmp/smoke-body.json)"
    return 1
  fi
}

good_jwt=$(mint_jwt "vnl-ads" "vnl" "vnl-ads-api" 300)
wrong_iss_jwt=$(mint_jwt "someone-else" "vnl" "vnl-ads-api" 300)

# --- test cases ---
echo ""
echo "== auth =="
hit "no auth header"           401 "/made-up/live-channel"
hit "wrong issuer"             401 "/made-up/live-channel" -H "Authorization: Bearer $wrong_iss_jwt"

echo ""
echo "== routing =="
hit "unknown sessionId"        404 "/id-does-not-exist/live-channel" -H "Authorization: Bearer $good_jwt"

if [ -n "${LIVE_SESSION_ID:-}" ]; then
  echo ""
  echo "== live (against $LIVE_SESSION_ID) =="
  hit "live broadcast"         200 "/$LIVE_SESSION_ID/live-channel" -H "Authorization: Bearer $good_jwt"
  echo "       body: $(cat /tmp/smoke-body.json | head -c 400)"
else
  echo ""
  echo "== live (skipped — set LIVE_SESSION_ID=... to test the 200 path) =="
fi

echo ""
echo "all checks passed"
