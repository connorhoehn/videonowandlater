#!/bin/bash

# Directly trigger MediaConvert job for a session
# Usage: ./trigger-mediaconvert.sh <session-id>

SESSION_ID="${1:-d773403b-f39a-44b1-8b96-17f6e7d668f4}"

if [ -z "$SESSION_ID" ]; then
    echo "Usage: $0 <session-id>"
    exit 1
fi

echo "🎬 Triggering MediaConvert for session: $SESSION_ID"

# Get session details
SESSION=$(aws dynamodb get-item \
    --table-name vnl-sessions \
    --key '{"PK": {"S": "SESSION#'$SESSION_ID'"}, "SK": {"S": "METADATA"}}' \
    --query 'Item' \
    --output json)

if [ "$SESSION" == "null" ]; then
    echo "❌ Session not found"
    exit 1
fi

# Extract recording URL
RECORDING_URL=$(echo "$SESSION" | jq -r '.recordingHlsUrl.S // empty')

if [ -z "$RECORDING_URL" ]; then
    echo "❌ No recording URL found"
    exit 1
fi

echo "📹 Recording: $RECORDING_URL"

# Parse S3 info from recording URL
# Format: https://d13v6t4hf3gttt.cloudfront.net/ivs/v1/264161986065/OaJIwBnDlQ0u/2026/3/6/18/11/gLP6J7PajrrE/media/hls/master.m3u8
S3_PREFIX=$(echo "$RECORDING_URL" | sed 's|https://[^/]*/||' | sed 's|/media/hls/master.m3u8||')
BUCKET="vnl-recordings-vnl-session"

# Submit MediaConvert job directly
echo "📤 Submitting MediaConvert job..."

# Create job input JSON
cat > /tmp/mediaconvert-job.json <<EOF
{
  "Role": "arn:aws:iam::264161986065:role/VNL-Session-MediaConvertRole38679124-zIdxfCQGJ6zN",
  "Queue": "arn:aws:mediaconvert:us-east-1:264161986065:queues/Default",
  "Settings": {
    "Inputs": [
      {
        "FileInput": "s3://$BUCKET/$S3_PREFIX/media/hls/master.m3u8",
        "AudioSelectors": {
          "default": {
            "DefaultSelection": "DEFAULT"
          }
        }
      }
    ],
    "OutputGroups": [
      {
        "Name": "File Group",
        "OutputGroupSettings": {
          "Type": "FILE_GROUP_SETTINGS",
          "FileGroupSettings": {
            "Destination": "s3://vnl-transcription-vnl-session/$SESSION_ID/"
          }
        },
        "Outputs": [
          {
            "NameModifier": "recording",
            "ContainerSettings": {
              "Container": "MP4"
            },
            "VideoDescription": {
              "CodecSettings": {
                "Codec": "H_264",
                "H264Settings": {
                  "Bitrate": 5000000,
                  "MaxBitrate": 5000000,
                  "RateControlMode": "VBR",
                  "CodecProfile": "MAIN"
                }
              }
            },
            "AudioDescriptions": [
              {
                "AudioSourceName": "default",
                "CodecSettings": {
                  "Codec": "AAC",
                  "AacSettings": {
                    "Bitrate": 128000,
                    "CodingMode": "CODING_MODE_2_0",
                    "SampleRate": 48000
                  }
                }
              }
            ]
          }
        ]
      }
    ]
  },
  "UserMetadata": {
    "sessionId": "$SESSION_ID",
    "phase": "19-transcription"
  }
}
EOF

# Submit job
JOB_RESULT=$(aws mediaconvert create-job --cli-input-json file:///tmp/mediaconvert-job.json 2>&1)

if echo "$JOB_RESULT" | grep -q "Job"; then
    JOB_ID=$(echo "$JOB_RESULT" | jq -r '.Job.Id')
    echo "✅ MediaConvert job submitted: $JOB_ID"
    echo ""
    echo "⏳ Job will take 1-2 minutes to complete"
    echo "📊 Check status: aws mediaconvert get-job --id $JOB_ID --query 'Job.Status'"
    echo "📝 Once complete, transcript will be generated automatically"
else
    echo "❌ Failed to submit MediaConvert job:"
    echo "$JOB_RESULT"
    exit 1
fi

# Update session status
echo ""
echo "📝 Updating session status..."
aws dynamodb update-item \
    --table-name vnl-sessions \
    --key '{"PK": {"S": "SESSION#'$SESSION_ID'"}, "SK": {"S": "METADATA"}}' \
    --update-expression "SET transcriptStatus = :status, convertJobName = :jobName" \
    --expression-attribute-values '{":status": {"S": "processing"}, ":jobName": {"S": "manual-'$JOB_ID'"}}' \
    --return-values NONE

echo "✅ Done! Monitor progress at:"
echo "   http://localhost:5174/replay/$SESSION_ID"