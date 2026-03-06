#!/bin/bash

# Fix transcript for a session by rerunning the entire transcription pipeline
# Usage: ./fix-transcript.sh <session-id>

SESSION_ID="${1:-d773403b-f39a-44b1-8b96-17f6e7d668f4}"

if [ -z "$SESSION_ID" ]; then
    echo "Usage: $0 <session-id>"
    exit 1
fi

echo "🔧 Fixing transcript for session: $SESSION_ID"
echo ""

# Step 1: Reset transcript status in DynamoDB
echo "1️⃣ Resetting transcript status..."
aws dynamodb update-item \
    --table-name vnl-sessions \
    --key '{"PK": {"S": "SESSION#'$SESSION_ID'"}, "SK": {"S": "METADATA"}}' \
    --update-expression "SET transcriptStatus = :status" \
    --expression-attribute-values '{":status": {"S": "pending"}}' \
    --return-values ALL_NEW \
    --output json | jq -r '.Attributes.transcriptStatus.S // "Failed to update"'

# Step 2: Check if recording exists
echo ""
echo "2️⃣ Checking recording..."
RECORDING_URL=$(aws dynamodb get-item \
    --table-name vnl-sessions \
    --key '{"PK": {"S": "SESSION#'$SESSION_ID'"}, "SK": {"S": "METADATA"}}' \
    --query 'Item.recordingHlsUrl.S' \
    --output text)

if [ -z "$RECORDING_URL" ] || [ "$RECORDING_URL" == "None" ]; then
    echo "❌ No recording found for session"
    exit 1
fi

echo "✅ Recording found: $RECORDING_URL"

# Step 3: Submit MediaConvert job
echo ""
echo "3️⃣ Submitting MediaConvert job..."

# Extract S3 path from recording URL
S3_PATH=$(echo "$RECORDING_URL" | sed 's|https://[^/]*/||' | sed 's|/media/hls/master.m3u8||')
BUCKET_NAME="vnl-recordings-vnl-session"

SNS_MESSAGE='{
  "sessionId": "'$SESSION_ID'",
  "s3Bucket": "'$BUCKET_NAME'",
  "s3Key": "'$S3_PATH'/media/hls/master.m3u8",
  "sourceFileName": "master.m3u8",
  "sourceFileSize": 0
}'

MESSAGE_ID=$(aws sns publish \
    --topic-arn "arn:aws:sns:us-east-1:264161986065:vnl-mediaconvert-jobs" \
    --message "$SNS_MESSAGE" \
    --subject "Fix Transcript $SESSION_ID" \
    --output json | jq -r '.MessageId')

echo "✅ MediaConvert job queued (Message ID: $MESSAGE_ID)"

# Step 4: Wait for MediaConvert job
echo ""
echo "4️⃣ Waiting for MediaConvert job to complete (this may take 1-2 minutes)..."
sleep 10

# Check MediaConvert job status
for i in {1..12}; do
    JOB_STATUS=$(aws mediaconvert list-jobs \
        --query "Jobs[?UserMetadata.sessionId=='$SESSION_ID'] | [0].Status" \
        --output text 2>/dev/null)

    if [ "$JOB_STATUS" == "COMPLETE" ]; then
        echo "✅ MediaConvert job completed"
        break
    elif [ "$JOB_STATUS" == "ERROR" ] || [ "$JOB_STATUS" == "CANCELED" ]; then
        echo "❌ MediaConvert job failed with status: $JOB_STATUS"
        exit 1
    else
        echo "⏳ Job status: ${JOB_STATUS:-PENDING} (check $i/12)"
        sleep 10
    fi
done

# Step 5: Check Transcribe job
echo ""
echo "5️⃣ Checking Transcribe job status..."
sleep 5

TRANSCRIBE_JOB=$(aws transcribe list-transcription-jobs \
    --job-name-contains "vnl-$SESSION_ID" \
    --query 'TranscriptionJobSummaries[0].{Name:TranscriptionJobName,Status:TranscriptionJobStatus}' \
    --output json)

if [ "$TRANSCRIBE_JOB" != "null" ] && [ -n "$TRANSCRIBE_JOB" ]; then
    echo "Transcribe job found:"
    echo "$TRANSCRIBE_JOB" | jq '.'
else
    echo "⚠️ No Transcribe job found yet. The pipeline may still be processing."
fi

# Step 6: Check final transcript status
echo ""
echo "6️⃣ Checking final transcript status..."
sleep 5

FINAL_STATUS=$(aws dynamodb get-item \
    --table-name vnl-sessions \
    --key '{"PK": {"S": "SESSION#'$SESSION_ID'"}, "SK": {"S": "METADATA"}}' \
    --query 'Item.{Status:transcriptStatus.S,HasTranscript:transcript.S,HasSummary:aiSummary.S}' \
    --output json)

echo "Final status:"
echo "$FINAL_STATUS" | jq '.'

echo ""
echo "📋 Summary:"
echo "- Session ID: $SESSION_ID"
echo "- Replay URL: http://localhost:5174/replay/$SESSION_ID"
echo ""
echo "If transcript is still not available:"
echo "1. Check Lambda logs: /aws/lambda/VNL-Session-TranscodeCompletedAD058BD0-1t0MotmCd2N2"
echo "2. Check Transcribe console for job status"
echo "3. Ensure the Lambda has been updated with the latest code"