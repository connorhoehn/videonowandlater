#!/usr/bin/env bash
# scripts/diagnose.sh
# Full-system diagnostic: sessions, Lambda logs, EventBridge, IVS channels
#
# Usage:
#   ./scripts/diagnose.sh              # last 30 min
#   ./scripts/diagnose.sh 60           # last 60 min
#   ./scripts/diagnose.sh 30 <session> # deep dive on specific session

set -euo pipefail

WINDOW_MIN="${1:-30}"
HIGHLIGHT="${2:-}"
TABLE="vnl-sessions"
NOW_S=$(date +%s)
START_MS=$(( (NOW_S - WINDOW_MIN * 60) * 1000 ))
START_MS_DEEP=$(( (NOW_S - 86400) * 1000 ))  # 24h for deep dive

R='\033[0;31m' Y='\033[0;33m' G='\033[0;32m' C='\033[0;36m'
B='\033[1m' D='\033[2m' N='\033[0m'

hdr() { echo -e "\n${B}══ $* ══${N}"; }

parse_sessions() {
python3 << 'EOF'
import sys, json, os

path = os.environ['_TMP_JSON']
with open(path) as f:
    data = json.load(f)

items = data.get('Items', [])
sessions = [{k: list(v.values())[0] for k,v in item.items()} for item in items]
sessions.sort(key=lambda x: x.get('createdAt',''), reverse=True)

STATUS = {'live':'\033[0;33m● LIVE\033[0m','ending':'\033[0;36m◎ ENDING\033[0m',
          'ended':'\033[0;32m✓ ENDED\033[0m','creating':'\033[2m○ CREATING\033[0m'}
REC = {'available':'\033[0;32m✓ avail\033[0m','processing':'\033[0;33m⏳ processing\033[0m',
       'pending':'\033[2m○ pending\033[0m','failed':'\033[0;31m✗ failed\033[0m','':'\033[2m—\033[0m'}

for s in sessions[:10]:
    sid   = s.get('sessionId','?')
    stype = s.get('sessionType','?')[:9]
    stat  = s.get('status','?')
    rec   = s.get('recordingStatus','')
    url   = s.get('recordingHlsUrl','')
    cat   = s.get('createdAt','')[:19]
    eat   = s.get('endedAt','—')[:19]

    sl = STATUS.get(stat, stat)
    rl = REC.get(rec, rec)
    flag = ''
    if stat == 'ended' and not url:
        flag = '  \033[0;31m← NO HLS URL (recording-ended never fired?)\033[0m'
    if stat == 'live' and eat != '—':
        flag = '  \033[0;33m← endedAt set but still LIVE?\033[0m'

    print(f'  {sid[:8]}  {stype:<9}  {sl:<34}  rec:{rl}{flag}')
    print(f'\033[2m    created:{cat}  ended:{eat}\033[0m')
EOF
}

parse_logs() {
  local label="$1" log_group="$2" start="$3" pattern="${4:-}"
python3 << EOF
import sys, json, os, datetime

label = "$label"
log_group = "$log_group"

path = os.environ.get('_TMP_LOGS','')
if not path:
    print(f'  (no log data)')
    sys.exit(0)

try:
    with open(path) as f:
        events = json.load(f)
except:
    events = []

skip = ('START ','END ','REPORT ','INIT_START')
invocations = sum(1 for e in events if e['message'].startswith('START '))
errors = sum(1 for e in events if 'ERROR' in e['message'] or 'Error:' in e['message'])

if errors > 0:
    print(f'  \033[0;31m✗\033[0m {label} — {invocations} invocations, {errors} ERRORS')
elif invocations > 0:
    print(f'  \033[0;32m✓\033[0m {label} — {invocations} invocations')
else:
    print(f'  \033[0;33m▲\033[0m {label} — 0 invocations in window')

printed = 0
for e in events:
    m = e['message'].strip()
    if not m or any(m.startswith(s) for s in skip):
        continue
    if printed >= 15:
        break
    ts = datetime.datetime.fromtimestamp(e['timestamp']/1000).strftime('%H:%M:%S')
    if 'ERROR' in m or 'Error:' in m or 'error' in m:
        col = '\033[0;31m'
    elif 'WARN' in m or 'warn' in m:
        col = '\033[0;33m'
    else:
        col = '\033[2m'
    print(f'    {col}{ts}  {m[:150]}\033[0m')
    printed += 1
EOF
}

TMP=$(mktemp)
trap "rm -f $TMP" EXIT

echo -e "${B}VideoNowAndLater — System Diagnostic${N}"
echo -e "${D}Window: last ${WINDOW_MIN} min  |  $(date '+%H:%M:%S')${N}"

# ── SESSIONS ─────────────────────────────────────────────────────────────────
hdr "SESSIONS (last 10)"
aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression "entityType = :t" \
  --expression-attribute-values '{":t":{"S":"SESSION"}}' \
  --output json > "$TMP" 2>/dev/null
export _TMP_JSON="$TMP"
parse_sessions

# ── LAMBDA LOGS ──────────────────────────────────────────────────────────────
hdr "LAMBDA LOGS (last ${WINDOW_MIN} min)"

declare -A PREFIXES=(
  ["stream-started"]="/aws/lambda/VNL-Session-StreamStarted"
  ["stream-ended"]="/aws/lambda/VNL-Session-StreamEnded"
  ["recording-started"]="/aws/lambda/VNL-Session-RecordingStarted"
  ["recording-ended"]="/aws/lambda/VNL-Session-RecordingEnded"
  ["join-hangout"]="/aws/lambda/VNL-Api-JoinHangoutHandler"
  ["create-chat-token"]="/aws/lambda/VNL-Api-CreateChatTokenHandler"
)

for LABEL in stream-started stream-ended recording-started recording-ended join-hangout create-chat-token; do
  PREFIX="${PREFIXES[$LABEL]}"
  LG=$(aws logs describe-log-groups \
    --log-group-name-prefix "$PREFIX" \
    --query "reverse(sort_by(logGroups, &creationTime))[0].logGroupName" \
    --output text 2>/dev/null)

  if [ -z "$LG" ] || [ "$LG" = "None" ]; then
    echo -e "  ${Y}▲${N} ${LABEL} — no log group yet"
    continue
  fi

  aws logs filter-log-events \
    --log-group-name "$LG" \
    --start-time "$START_MS" \
    --query "events[*].{timestamp:timestamp,message:message}" \
    --output json > "$TMP" 2>/dev/null || echo "[]" > "$TMP"

  export _TMP_LOGS="$TMP"
  parse_logs "$LABEL" "$LG" "$START_MS"
done

# ── EVENTBRIDGE RULES ────────────────────────────────────────────────────────
hdr "EVENTBRIDGE RULES"
aws events list-rules \
  --query "Rules[?contains(Name,'VNL')].{n:Name,s:State}" \
  --output json 2>/dev/null \
  | python3 -c "
import sys,json
for r in json.load(sys.stdin):
    icon = '\033[0;32m✓\033[0m' if r['s']=='ENABLED' else '\033[0;31m✗\033[0m'
    print(f'  {icon} {r[\"n\"]}')
"

# ── IVS CHANNELS ─────────────────────────────────────────────────────────────
hdr "IVS CHANNELS"
CHANNELS=$(aws ivs list-channels --query "channels[*].arn" --output json 2>/dev/null || echo "[]")
echo "$CHANNELS" | python3 -c "
import sys,json,subprocess
arns = json.load(sys.stdin)
if not arns:
    print('  (no channels)')
    sys.exit(0)
for arn in arns:
    cid = arn.split('/')[-1]
    try:
        r = subprocess.run(['aws','ivs','get-stream','--channel-arn',arn,
            '--query','stream.state','--output','text'],
            capture_output=True,text=True,timeout=4)
        state = r.stdout.strip() if r.returncode==0 else 'OFFLINE'
    except:
        state = 'OFFLINE'
    icon = '\033[0;33m● LIVE  \033[0m' if state=='LIVE' else '\033[2m○ offline\033[0m'
    print(f'  {icon}  {cid}')
"

# ── POOL HEALTH ───────────────────────────────────────────────────────────────
hdr "RESOURCE POOL"
aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression "entityType = :t" \
  --expression-attribute-values '{":t":{"S":"POOL_ITEM"}}' \
  --output json > "$TMP" 2>/dev/null
python3 << 'EOF'
import json, os
with open(os.environ['_TMP_JSON']) as f:
    items = json.load(f).get('Items',[])

counts = {}
for item in items:
    r = {k:list(v.values())[0] for k,v in item.items()}
    key = f"{r.get('resourceType','?')}/{r.get('status','?')}"
    counts[key] = counts.get(key,0)+1

if not counts:
    print('  \033[0;31m✗ Pool is empty\033[0m')
else:
    for k,n in sorted(counts.items()):
        icon = '\033[0;32m✓\033[0m' if 'AVAILABLE' in k else '\033[2m·\033[0m'
        print(f'  {icon} {k}: {n}')
EOF

# ── DEEP DIVE ─────────────────────────────────────────────────────────────────
if [ -n "$HIGHLIGHT" ]; then
  hdr "DEEP DIVE: $HIGHLIGHT"

  aws dynamodb get-item \
    --table-name "$TABLE" \
    --key "{\"PK\":{\"S\":\"SESSION#$HIGHLIGHT\"},\"SK\":{\"S\":\"METADATA\"}}" \
    --output json > "$TMP" 2>/dev/null

  python3 << 'EOF'
import json, os
with open(os.environ['_TMP_JSON']) as f:
    item = json.load(f).get('Item',{})
if not item:
    print('  Session not found')
else:
    r = {k:list(v.values())[0] for k,v in item.items()}
    skip = {'PK','SK','GSI1PK','GSI1SK','entityType','version'}
    for k,v in sorted(r.items()):
        if k not in skip:
            print(f'  {k}: {v}')
EOF

  echo -e "\n  ${D}Searching Lambda logs for session ID (last 24h)...${N}"
  for PREFIX in \
    "/aws/lambda/VNL-Session-StreamStarted" \
    "/aws/lambda/VNL-Session-StreamEnded" \
    "/aws/lambda/VNL-Session-RecordingStarted" \
    "/aws/lambda/VNL-Session-RecordingEnded" \
    "/aws/lambda/VNL-Api-JoinHangoutHandler" \
    "/aws/lambda/VNL-Api-CreateChatTokenHandler"; do

    LG=$(aws logs describe-log-groups \
      --log-group-name-prefix "$PREFIX" \
      --query "reverse(sort_by(logGroups, &creationTime))[0].logGroupName" \
      --output text 2>/dev/null)
    [ -z "$LG" ] || [ "$LG" = "None" ] && continue

    HITS=$(aws logs filter-log-events \
      --log-group-name "$LG" \
      --start-time "$START_MS_DEEP" \
      --filter-pattern "\"$HIGHLIGHT\"" \
      --query "events[*].{t:timestamp,m:message}" \
      --output json 2>/dev/null \
      | python3 -c "
import sys,json,datetime
events = json.load(sys.stdin)
skip=('START ','END ','REPORT ','INIT_START')
for e in events:
    m=e['m'].strip()
    if not m or any(m.startswith(s) for s in skip): continue
    ts=datetime.datetime.fromtimestamp(e['t']/1000).strftime('%H:%M:%S')
    col='\033[0;31m' if 'ERROR' in m or 'error' in m else '\033[2m'
    print(f'    {col}{ts}  {m[:160]}\033[0m')
" 2>/dev/null || true)

    if [ -n "$HITS" ]; then
      echo -e "  ${C}$(basename $PREFIX):${N}"
      echo "$HITS"
    fi
  done
fi

echo ""
echo -e "${D}Deep dive:  ./scripts/diagnose.sh 30 <session-id>${N}"
echo -e "${D}Force-end:  ./scripts/force-end-session.sh <session-id>${N}"
echo -e "${D}Monitor:    ./scripts/monitor-session.sh <session-id>${N}"
