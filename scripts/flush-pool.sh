#!/usr/bin/env bash
# scripts/flush-pool.sh
# Deletes all pool items from DynamoDB so replenish-pool recreates them fresh.
# Use when existing channels/stages lack recording configuration.
#
# Usage:
#   ./scripts/flush-pool.sh        # interactive confirm
#   ./scripts/flush-pool.sh --yes  # skip confirmation

set -euo pipefail

TABLE="vnl-sessions"
AUTO_YES="${1:-}"

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}VideoNowAndLater — Pool Flush${RESET}"
echo ""

# ── Scan for all pool items ───────────────────────────────────────────────────
echo "Scanning pool..."
ITEMS_JSON=$(aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression 'begins_with(PK, :prefix)' \
  --expression-attribute-values '{":prefix":{"S":"POOL#"}}' \
  --query 'Items[].{PK:PK,SK:SK}' \
  --output json)

TOTAL=$(echo "$ITEMS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

if [ "$TOTAL" -eq 0 ]; then
  echo -e "${GREEN}Pool is already empty — nothing to flush.${RESET}"
  exit 0
fi

# ── Summarise by type ─────────────────────────────────────────────────────────
echo "$ITEMS_JSON" | python3 -c "
import sys, json, collections
items = json.load(sys.stdin)
counts = collections.Counter()
claimed = collections.Counter()
for item in items:
    pk = item['PK']['S']
    if   'CHANNEL' in pk: t = 'CHANNEL'
    elif 'STAGE'   in pk: t = 'STAGE'
    elif 'ROOM'    in pk: t = 'ROOM'
    else:                 t = 'OTHER'
    counts[t] += 1
for t, n in sorted(counts.items()):
    print(f'  {t:<10} {n}')
print(f'  {\"TOTAL\":<10} {sum(counts.values())}')
"

# ── Warn about claimed items ──────────────────────────────────────────────────
CLAIMED=$(aws dynamodb scan \
  --table-name "$TABLE" \
  --filter-expression 'begins_with(PK, :prefix) AND #s = :claimed' \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":prefix":{"S":"POOL#"},":claimed":{"S":"claimed"}}' \
  --query 'Count' \
  --output text)

if [ "${CLAIMED:-0}" -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}⚠  $CLAIMED pool item(s) are currently CLAIMED by active sessions.${RESET}"
  echo -e "${DIM}   Force-end those sessions first if you want a clean flush.${RESET}"
fi

echo ""
echo -e "${DIM}Note: IVS resources (channels/stages/rooms) are NOT deleted in AWS — only DynamoDB references.${RESET}"
echo -e "${DIM}      replenish-pool recreates pool items with recording config within 5 minutes.${RESET}"
echo ""

# ── Confirm ───────────────────────────────────────────────────────────────────
if [[ "$AUTO_YES" != "--yes" ]]; then
  read -r -p "Delete all $TOTAL pool items from DynamoDB? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Delete in batches of 25 ───────────────────────────────────────────────────
echo ""
echo "Deleting..."
echo "$ITEMS_JSON" | python3 -c "
import sys, json, subprocess

TABLE = '$TABLE'
items = json.load(sys.stdin)

for i in range(0, len(items), 25):
    batch = items[i:i+25]
    request = {TABLE: [{'DeleteRequest': {'Key': item}} for item in batch]}
    result = subprocess.run(
        ['aws', 'dynamodb', 'batch-write-item', '--request-items', json.dumps(request), '--output', 'json'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f'Error: {result.stderr}', file=sys.stderr)
        sys.exit(1)
    print(f'  Deleted items {i+1}–{i+len(batch)}')
"

echo ""
echo -e "${GREEN}${BOLD}✓ Pool flushed — $TOTAL items removed${RESET}"
echo -e "${DIM}replenish-pool runs every 5 min and will recreate channels with recording config.${RESET}"
echo ""
