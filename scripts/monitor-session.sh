#!/usr/bin/env bash
# scripts/monitor-session.sh
# Monitor a session's transition from live → ended → recording available
#
# Usage:
#   ./scripts/monitor-session.sh <session-id>
#   ./scripts/monitor-session.sh          # auto-picks the most recent LIVE session

set -euo pipefail

TABLE="vnl-sessions"
INTERVAL=5

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Resolve session ID ───────────────────────────────────────────────────────
if [ -n "${1:-}" ]; then
  SESSION_ID="$1"
else
  SESSION_ID=$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression "entityType = :t AND (GSI1PK = :live OR GSI1PK = :ending)" \
    --expression-attribute-values '{":t":{"S":"SESSION"},":live":{"S":"STATUS#LIVE"},":ending":{"S":"STATUS#ENDING"}}' \
    --query "Items[0].sessionId.S" \
    --output text 2>/dev/null || true)

  if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "None" ]; then
    SESSION_ID=$(aws dynamodb scan \
      --table-name "$TABLE" \
      --filter-expression "entityType = :t" \
      --expression-attribute-values '{":t":{"S":"SESSION"}}' \
      --query "reverse(sort_by(Items, &createdAt.S))[0].sessionId.S" \
      --output text 2>/dev/null || true)
  fi

  if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "None" ]; then
    echo -e "${RED}No sessions found in $TABLE${RESET}"
    exit 1
  fi

  echo -e "${DIM}Auto-selected session: $SESSION_ID${RESET}"
fi

# ── Resolve partial session ID ───────────────────────────────────────────────
FULL_ID=$(aws dynamodb get-item \
  --table-name "$TABLE" \
  --key "{\"PK\":{\"S\":\"SESSION#$SESSION_ID\"},\"SK\":{\"S\":\"METADATA\"}}" \
  --query "Item.sessionId.S" --output text 2>/dev/null || true)

if [ -z "$FULL_ID" ] || [ "$FULL_ID" = "None" ]; then
  FULL_ID=$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression "entityType = :t AND begins_with(sessionId, :prefix)" \
    --expression-attribute-values "{\":t\":{\"S\":\"SESSION\"},\":prefix\":{\"S\":\"$SESSION_ID\"}}" \
    --query "Items[0].sessionId.S" --output text 2>/dev/null || true)
fi

if [ -n "$FULL_ID" ] && [ "$FULL_ID" != "None" ]; then
  SESSION_ID="$FULL_ID"
fi

# ── Log group lookup ─────────────────────────────────────────────────────────
RECORDING_ENDED_LG=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/VNL-Session-RecordingEnded" \
  --query "logGroups[0].logGroupName" --output text 2>/dev/null || true)

MEDIACONVERT_LG=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/VNL-Start-MediaConvert" \
  --query "logGroups[0].logGroupName" --output text 2>/dev/null || true)

TRANSCRIBE_LG=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/VNL-Transcribe-Start" \
  --query "logGroups[0].logGroupName" --output text 2>/dev/null || true)

SUMMARIZE_LG=$(aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/VNL-Bedrock-Summarize" \
  --query "logGroups[0].logGroupName" --output text 2>/dev/null || true)

# ── Helpers ──────────────────────────────────────────────────────────────────
get_session() {
  aws dynamodb get-item \
    --table-name "$TABLE" \
    --key "{\"PK\":{\"S\":\"SESSION#$SESSION_ID\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --output json 2>/dev/null
}

parse_field() {
  local json="$1" field="$2"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null
}

status_label() {
  case "$1" in
    live)     echo -e "${YELLOW}● LIVE${RESET}" ;;
    ending)   echo -e "${CYAN}◎ ENDING${RESET}" ;;
    ended)    echo -e "${GREEN}✓ ENDED${RESET}" ;;
    creating) echo -e "${DIM}○ CREATING${RESET}" ;;
    *)        echo -e "${DIM}? ${1}${RESET}" ;;
  esac
}

rec_label() {
  case "$1" in
    available)  echo -e "${GREEN}✓ available${RESET}" ;;
    processing) echo -e "${YELLOW}⏳ processing${RESET}" ;;
    pending)    echo -e "${DIM}○ pending${RESET}" ;;
    failed)     echo -e "${RED}✗ failed${RESET}" ;;
    "")         echo -e "${DIM}—${RESET}" ;;
    *)          echo -e "${DIM}${1}${RESET}" ;;
  esac
}

transcript_label() {
  case "$1" in
    available)  echo -e "${GREEN}✓ available${RESET}" ;;
    processing) echo -e "${YELLOW}⏳ processing${RESET}" ;;
    pending)    echo -e "${DIM}○ pending${RESET}" ;;
    failed)     echo -e "${RED}✗ failed${RESET}" ;;
    "")         echo -e "${DIM}—${RESET}" ;;
    *)          echo -e "${DIM}${1}${RESET}" ;;
  esac
}

summary_label() {
  case "$1" in
    available)  echo -e "${GREEN}✓ available${RESET}" ;;
    processing) echo -e "${YELLOW}⏳ processing${RESET}" ;;
    pending)    echo -e "${DIM}○ pending${RESET}" ;;
    failed)     echo -e "${RED}✗ failed${RESET}" ;;
    "")         echo -e "${DIM}—${RESET}" ;;
    *)          echo -e "${DIM}${1}${RESET}" ;;
  esac
}

format_timestamp() {
  local iso_time="$1"
  if [ -z "$iso_time" ] || [ "$iso_time" = "None" ]; then
    return
  fi
  echo "$iso_time" | python3 -c "
import sys
from datetime import datetime
try:
  dt = datetime.fromisoformat(sys.stdin.read().strip().replace('Z', '+00:00'))
  print(dt.strftime('%H:%M:%S'))
except:
  pass
" 2>/dev/null || echo "$iso_time"
}

tail_lambda_logs() {
  local log_group="$1"
  if [ -z "$log_group" ] || [ "$log_group" = "None" ]; then
    echo -e "  ${DIM}recording-ended: Lambda not yet invoked (no log group)${RESET}"
    return
  fi
  local start=$(( ($(date +%s) - 300) * 1000 ))
  local lines
  lines=$(aws logs filter-log-events \
    --log-group-name "$log_group" \
    --start-time "$start" \
    --query "events[*].message" \
    --output json 2>/dev/null \
    | python3 -c "
import sys, json
msgs = json.load(sys.stdin)
skip = ('START ', 'END ', 'REPORT ', 'INIT_START')
for m in msgs[-8:]:
    m = m.strip()
    if m and not any(m.startswith(s) for s in skip):
        print('  ' + m)
" 2>/dev/null || true)
  if [ -n "$lines" ]; then
    echo -e "${DIM}recording-ended logs (last 5 min):${RESET}"
    echo "$lines"
  else
    echo -e "  ${DIM}recording-ended: no recent invocations${RESET}"
  fi
}

# ── Main loop ────────────────────────────────────────────────────────────────
PREV_STATUS=""
PREV_REC_STATUS=""
START_TIME=$(date +%s)

echo -e "${BOLD}VideoNowAndLater — Session Monitor${RESET}"
echo -e "${DIM}Session: $SESSION_ID${RESET}"
echo -e "${DIM}Table:   $TABLE${RESET}"
echo -e "${DIM}Press Ctrl+C to exit  |  force-end: ./scripts/force-end-session.sh $SESSION_ID${RESET}"
echo ""

SHOW_LOGS=0

while true; do
  RAW=$(get_session)
  ITEM=$(echo "$RAW" | python3 -c "
import sys, json
d = json.load(sys.stdin)
item = d.get('Item', {})
print(json.dumps({k: list(v.values())[0] for k, v in item.items()}))
" 2>/dev/null || echo "{}")

  STATUS=$(parse_field "$ITEM" status)
  REC_STATUS=$(parse_field "$ITEM" recordingStatus)
  REC_URL=$(parse_field "$ITEM" recordingHlsUrl)
  REC_DURATION=$(parse_field "$ITEM" recordingDuration)
  SESSION_TYPE=$(parse_field "$ITEM" sessionType)
  ENDED_AT=$(parse_field "$ITEM" endedAt)
  CREATED_AT=$(parse_field "$ITEM" createdAt)
  TRANSCRIPT_STATUS=$(parse_field "$ITEM" transcriptStatus)
  TRANSCRIPT_URL=$(parse_field "$ITEM" transcriptUrl)
  SUMMARY_STATUS=$(parse_field "$ITEM" aiSummaryStatus)
  REACTION_COUNT=$(parse_field "$ITEM" reactionCount)
  ELAPSED=$(( $(date +%s) - START_TIME ))

  # Detect transitions
  TRANSITION=""
  if [ -n "$PREV_STATUS" ] && [ "$STATUS" != "$PREV_STATUS" ]; then
    TRANSITION="${PREV_STATUS} → ${STATUS}"
  fi
  if [ -n "$PREV_REC_STATUS" ] && [ "$REC_STATUS" != "$PREV_REC_STATUS" ]; then
    TRANSITION="${TRANSITION:+$TRANSITION  }recording: ${PREV_REC_STATUS} → ${REC_STATUS}"
  fi

  # Print status block
  echo -e "$(date '+%H:%M:%S')  elapsed ${ELAPSED}s"
  echo -e "  Type:      ${SESSION_TYPE}"
  echo -e "  Status:    $(status_label "$STATUS")"

  # Pipeline summary
  echo -e ""
  echo -e "${DIM}Summary${RESET}"
  echo -e "  Recording: $(rec_label "$REC_STATUS")"
  echo -e "  Transcript: $(transcript_label "$TRANSCRIPT_STATUS")"
  echo -e "  AI Summary: $(summary_label "$SUMMARY_STATUS")"
  [ -n "$REACTION_COUNT" ] && [ "$REACTION_COUNT" != "0" ] && echo -e "  Reactions: ${REACTION_COUNT}"

  # Processing timeline
  echo -e ""
  echo -e "${DIM}Processing Timeline${RESET}"
  if [ -n "$CREATED_AT" ]; then
    CREATED_TS=$(format_timestamp "$CREATED_AT")
    echo -e "  Session created           ${DIM}${CREATED_TS}${RESET}"
  fi
  if [ "$REC_STATUS" != "pending" ] && [ -n "$REC_STATUS" ]; then
    if [ -n "$ENDED_AT" ]; then
      ENDED_TS=$(format_timestamp "$ENDED_AT")
      echo -e "  Recording available       ${DIM}${ENDED_TS}${RESET}"
    fi
  fi
  if [ "$TRANSCRIPT_STATUS" = "processing" ] || [ "$TRANSCRIPT_STATUS" = "available" ]; then
    echo -e "  Transcription ${TRANSCRIPT_STATUS}"
  elif [ "$TRANSCRIPT_STATUS" = "failed" ]; then
    echo -e "  Transcription ${RED}failed${RESET}"
  fi
  if [ "$SUMMARY_STATUS" = "processing" ] || [ "$SUMMARY_STATUS" = "available" ]; then
    echo -e "  AI Summary ${SUMMARY_STATUS}"
  elif [ "$SUMMARY_STATUS" = "failed" ]; then
    echo -e "  AI Summary ${RED}failed${RESET}"
  fi

  [ -n "$REC_URL" ]      && echo -e "  HLS URL:   ${GREEN}${REC_URL}${RESET}"
  if [ -n "$REC_DURATION" ] && [ "$REC_DURATION" != "0" ]; then
    SECS=$(( ${REC_DURATION%.*} / 1000 ))
    echo -e "  Duration:  ${SECS}s"
  fi
  [ -n "$TRANSCRIPT_URL" ] && echo -e "  Transcript: ${TRANSCRIPT_URL}"
  [ -n "$TRANSITION" ] && echo -e "  ${BOLD}▶ ${TRANSITION}${RESET}"

  # Show Lambda logs every 30s or during active processing
  SHOW_LOGS=$(( (SHOW_LOGS + 1) % 6 ))
  if [ "$SHOW_LOGS" -eq 0 ] || [ "$STATUS" = "ending" ] || [ "$REC_STATUS" = "processing" ] || [ "$TRANSCRIPT_STATUS" = "processing" ] || [ "$SUMMARY_STATUS" = "processing" ]; then
    if [ "$REC_STATUS" = "processing" ] || [ "$STATUS" = "ending" ]; then
      tail_lambda_logs "$RECORDING_ENDED_LG"
    fi
    if [ "$REC_STATUS" = "available" ] && [ "$TRANSCRIPT_STATUS" = "processing" ]; then
      tail_lambda_logs "$MEDIACONVERT_LG"
      tail_lambda_logs "$TRANSCRIBE_LG"
    fi
    if [ "$TRANSCRIPT_STATUS" = "available" ] && [ "$SUMMARY_STATUS" = "processing" ]; then
      tail_lambda_logs "$SUMMARIZE_LG"
    fi
  fi

  PREV_STATUS="$STATUS"
  PREV_REC_STATUS="$REC_STATUS"

  echo -e "${DIM}────────────────────────────────${RESET}"

  if [ "$REC_STATUS" = "available" ]; then
    if [ "$TRANSCRIPT_STATUS" = "available" ] && [ "$SUMMARY_STATUS" = "available" ]; then
      echo -e "${GREEN}${BOLD}✓ Session fully processed! (recording + transcript + summary)${RESET}"
      break
    elif [ "$TRANSCRIPT_STATUS" = "available" ]; then
      echo -e "${GREEN}${BOLD}✓ Recording & transcript available${RESET}"
    elif [ "$TRANSCRIPT_STATUS" != "failed" ]; then
      echo -e "${GREEN}✓ Recording available. Waiting for transcription...${RESET}"
    fi
  fi
  if [ "$REC_STATUS" = "failed" ]; then
    echo -e "${RED}${BOLD}✗ Recording failed. Check recording-ended Lambda logs above.${RESET}"
    break
  fi
  if [ "$TRANSCRIPT_STATUS" = "failed" ] || [ "$SUMMARY_STATUS" = "failed" ]; then
    echo -e "${RED}${BOLD}✗ Pipeline failed. Check Lambda logs above.${RESET}"
    break
  fi

  sleep "$INTERVAL"
done
