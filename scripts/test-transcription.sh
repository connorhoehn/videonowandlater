#!/bin/bash

# Test transcription pipeline by manually publishing a MediaConvert completion event
# Usage: ./test-transcription.sh <session-id>

SESSION_ID="${1:-d773403b-f39a-44b1-8b96-17f6e7d668f4}"

if [ -z "$SESSION_ID" ]; then
    echo "Usage: $0 <session-id>"
    exit 1
fi

echo "Testing transcription pipeline for session: $SESSION_ID"

# Create a test MediaConvert completion event
EVENT_DETAIL='{
  "jobId": "test-'$(date +%s)'",
  "status": "COMPLETE",
  "userMetadata": {
    "sessionId": "'$SESSION_ID'",
    "phase": "19-transcription"
  },
  "outputGroupDetails": [
    {
      "outputDetails": [
        {
          "outputFilePaths": [
            "s3://vnl-transcription-vnl-session/'$SESSION_ID'/recording.mp4"
          ]
        }
      ]
    }
  ]
}'

echo "Publishing test event to EventBridge..."

# Create properly escaped JSON for AWS CLI
ENTRIES=$(cat <<EOF
[
  {
    "Source": "aws.mediaconvert",
    "DetailType": "MediaConvert Job State Change",
    "Detail": "$(echo "$EVENT_DETAIL" | jq -c '.' | sed 's/"/\\"/g')"
  }
]
EOF
)

aws events put-events --entries "$ENTRIES" --output json | jq '.'

if [ $? -eq 0 ]; then
    echo "✅ Successfully published test event"
    echo "Monitor logs at: /aws/lambda/VNL-Session-TranscodeCompletedAD058BD0-1t0MotmCd2N2"
    echo ""
    echo "To check Transcribe job status:"
    echo "aws transcribe list-transcription-jobs --job-name-contains \"vnl-$SESSION_ID\" --query 'TranscriptionJobSummaries[0]'"
else
    echo "❌ Failed to publish test event"
    exit 1
fi