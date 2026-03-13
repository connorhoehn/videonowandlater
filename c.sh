#!/bin/bash

START=$(date -u -v0H +"%Y-%m-%dT%H:%M:%SZ")
END=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

INPUT_TOTAL=0
OUTPUT_TOTAL=0

for MODEL in $(aws cloudwatch list-metrics \
  --namespace AWS/Bedrock \
  --metric-name InputTokenCount \
  --query 'Metrics[].Dimensions[?Name==`ModelId`].Value' \
  --output text | sort -u); do

  INPUT=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Bedrock \
    --metric-name InputTokenCount \
    --dimensions Name=ModelId,Value=$MODEL \
    --statistics Sum \
    --period 300 \
    --start-time $START \
    --end-time $END \
    --query "sum(Datapoints[].Sum)" \
    --output text)

  OUTPUT=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Bedrock \
    --metric-name OutputTokenCount \
    --dimensions Name=ModelId,Value=$MODEL \
    --statistics Sum \
    --period 300 \
    --start-time $START \
    --end-time $END \
    --query "sum(Datapoints[].Sum)" \
    --output text)

  INPUT_TOTAL=$(echo "$INPUT_TOTAL + ${INPUT:-0}" | bc)
  OUTPUT_TOTAL=$(echo "$OUTPUT_TOTAL + ${OUTPUT:-0}" | bc)

done

echo "Input tokens:  $INPUT_TOTAL"
echo "Output tokens: $OUTPUT_TOTAL"
