#!/bin/bash

# Reprocess a session through MediaConvert pipeline
# Usage: ./reprocess-session.sh <session-id>

SESSION_ID="${1:-d773403b-f39a-44b1-8b96-17f6e7d668f4}"

if [ -z "$SESSION_ID" ]; then
    echo "Usage: $0 <session-id>"
    exit 1
fi

echo "Reprocessing session: $SESSION_ID"

# Get session details from DynamoDB
SESSION_DATA=$(aws dynamodb get-item \
    --table-name vnl-sessions \
    --key "{\"PK\": {\"S\": \"SESSION#$SESSION_ID\"}, \"SK\": {\"S\": \"METADATA\"}}" \
    --query 'Item' \
    --output json)

if [ "$SESSION_DATA" == "null" ]; then
    echo "Session not found: $SESSION_ID"
    exit 1
fi

# Extract recording details
RECORDING_URL=$(echo "$SESSION_DATA" | jq -r '.recordingHlsUrl.S // empty')

if [ -z "$RECORDING_URL" ]; then
    echo "No recording URL found for session: $SESSION_ID"
    exit 1
fi

# Extract S3 path from CloudFront URL
# Format: https://d13v6t4hf3gttt.cloudfront.net/ivs/v1/264161986065/OaJIwBnDlQ0u/2026/3/6/18/11/gLP6J7PajrrE/media/hls/master.m3u8
S3_PATH=$(echo "$RECORDING_URL" | sed 's|https://[^/]*/||' | sed 's|/media/hls/master.m3u8||')
BUCKET_NAME="vnl-recordings-vnl-session"

echo "Recording S3 path: s3://$BUCKET_NAME/$S3_PATH"

# Publish to SNS topic to trigger MediaConvert
# Note: start-mediaconvert expects s3Bucket and s3Key fields
SNS_MESSAGE="{
  \"sessionId\": \"$SESSION_ID\",
  \"s3Bucket\": \"$BUCKET_NAME\",
  \"s3Key\": \"$S3_PATH/media/hls/master.m3u8\",
  \"sourceFileName\": \"master.m3u8\",
  \"sourceFileSize\": 0
}"

echo "Publishing to SNS topic..."
aws sns publish \
    --topic-arn "arn:aws:sns:us-east-1:264161986065:vnl-mediaconvert-jobs" \
    --message "$SNS_MESSAGE" \
    --subject "Reprocess Session $SESSION_ID" \
    --message-attributes "{
        \"action\": {\"DataType\": \"String\", \"StringValue\": \"reprocess\"}
    }"

if [ $? -eq 0 ]; then
    echo "✅ Successfully queued session for reprocessing"
    echo "Session ID: $SESSION_ID"
    echo "Monitor progress in CloudWatch logs for start-mediaconvert Lambda"
else
    echo "❌ Failed to queue session for reprocessing"
    exit 1
fi