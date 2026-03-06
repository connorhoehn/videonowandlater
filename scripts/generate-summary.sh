#!/bin/bash

# Generate AI summary for a session using AWS CLI
# Usage: ./scripts/generate-summary.sh <sessionId>

SESSION_ID=$1

if [ -z "$SESSION_ID" ]; then
  echo "Usage: ./scripts/generate-summary.sh <sessionId>"
  exit 1
fi

echo "🤖 Generating AI summary for session: $SESSION_ID"

# Get transcript from S3
echo "📄 Fetching transcript..."
aws s3 cp s3://vnl-transcription-vnl-session/transcripts/$SESSION_ID/transcript.json /tmp/transcript-$SESSION_ID.json 2>/dev/null

if [ ! -f "/tmp/transcript-$SESSION_ID.json" ]; then
  echo "❌ Transcript not found"
  exit 1
fi

# Extract transcript text
TRANSCRIPT=$(jq -r '.results.transcripts[0].transcript' /tmp/transcript-$SESSION_ID.json)

echo "✅ Transcript loaded (${#TRANSCRIPT} characters)"

# Generate summary using Bedrock Claude
echo "🤖 Calling Bedrock Claude..."

# Create the prompt - escape the transcript properly
ESCAPED_TRANSCRIPT=$(echo "$TRANSCRIPT" | jq -Rs .)

# Create the request body
cat > /tmp/bedrock-request.json << EOF
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 500,
  "temperature": 0.7,
  "messages": [
    {
      "role": "user",
      "content": "Please provide a concise one-paragraph summary (3-4 sentences) of the following video transcript. Focus on the main topics discussed and key points made:\n\n${TRANSCRIPT}"
    }
  ]
}
EOF

# Call Bedrock
RESPONSE=$(aws bedrock-runtime invoke-model \
  --model-id anthropic.claude-3-sonnet-20240229-v1:0 \
  --content-type application/json \
  --accept application/json \
  --body file:///tmp/bedrock-request.json \
  --output json \
  /tmp/bedrock-response.json 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "❌ Failed to call Bedrock. Make sure you have access to Claude in Bedrock."
  exit 1
fi

# Extract summary from response
SUMMARY=$(jq -r '.content[0].text' /tmp/bedrock-response.json)

echo "✅ Summary generated!"
echo ""
echo "📝 Summary:"
echo "$SUMMARY"
echo ""

# Update DynamoDB
echo "💾 Updating session in DynamoDB..."
aws dynamodb update-item \
  --table-name vnl-sessions \
  --key "{\"PK\": {\"S\": \"SESSION#$SESSION_ID\"}, \"SK\": {\"S\": \"METADATA\"}}" \
  --update-expression "SET aiSummary = :summary, aiSummaryStatus = :status" \
  --expression-attribute-values "{\":summary\": {\"S\": \"$SUMMARY\"}, \":status\": {\"S\": \"available\"}}" \
  2>/dev/null

if [ $? -eq 0 ]; then
  echo "✅ Session updated with AI summary!"
else
  echo "⚠️  Failed to update DynamoDB"
fi

# Clean up
rm -f /tmp/transcript-$SESSION_ID.json /tmp/bedrock-request.json /tmp/bedrock-response.json

echo ""
echo "🎉 AI summary generation complete!"