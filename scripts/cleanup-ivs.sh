#!/bin/bash

# Cleanup IVS channels by detaching recording configurations
# This allows the CDK stack to be deleted cleanly

echo "🧹 Cleaning up IVS channels..."
echo ""

# Get all channels with recording configurations
CHANNELS=$(aws ivs list-channels --query 'channels[?recordingConfigurationArn].arn' --output json | jq -r '.[]')

if [ -z "$CHANNELS" ]; then
    echo "✅ No channels with recording configurations found"
    exit 0
fi

# Count channels
CHANNEL_COUNT=$(echo "$CHANNELS" | wc -l | tr -d ' ')
echo "Found $CHANNEL_COUNT channels with recording configurations attached"
echo ""

# Detach recording configuration from each channel
for CHANNEL_ARN in $CHANNELS; do
    CHANNEL_ID=$(echo "$CHANNEL_ARN" | awk -F'/' '{print $2}')
    echo "📹 Processing channel: $CHANNEL_ID"

    # Detach recording configuration
    if aws ivs update-channel --arn "$CHANNEL_ARN" --recording-configuration-arn "" 2>/dev/null; then
        echo "   ✅ Detached recording configuration"
    else
        echo "   ⚠️  Failed to detach (may already be detached)"
    fi
done

echo ""
echo "🎯 Cleanup complete!"
echo ""

# Verify all channels are cleaned
REMAINING=$(aws ivs list-channels --query 'channels[?recordingConfigurationArn].arn' --output json | jq -r '.[]' | wc -l | tr -d ' ')

if [ "$REMAINING" -eq "0" ]; then
    echo "✅ All channels cleaned successfully"
    echo "You can now destroy the CDK stack:"
    echo "   cd infra && cdk destroy VNL-Session"
else
    echo "⚠️  $REMAINING channels still have recording configurations attached"
    echo "Manual cleanup may be required"
fi