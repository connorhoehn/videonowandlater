---
phase: quick-fix
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/lib/stacks/session-stack.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "MediaConvert job completions trigger on-mediaconvert-complete handler"
    - "Session convertStatus updates from pending to available when job completes"
    - "EventBridge rule correctly filters MediaConvert events with phase tag"
  artifacts:
    - path: "infra/lib/stacks/session-stack.ts"
      provides: "Fixed EventBridge rule with tag filtering"
      contains: "userMetadata"
  key_links:
    - from: "MediaConvert job completion event"
      to: "on-mediaconvert-complete handler"
      via: "EventBridge rule with userMetadata filter"
---

<objective>
Fix MediaConvert EventBridge rule to properly trigger the transcription pipeline

Purpose: MediaConvert jobs are completing but the EventBridge rule isn't matching them, breaking the entire transcription pipeline. The rule needs to filter by userMetadata.phase field.
Output: Working EventBridge rule that triggers on-mediaconvert-complete handler
</objective>

<context>
The issue: MediaConvert jobs include `userMetadata: { phase: '19-transcription' }` but the MediaConvertCompleteRule doesn't filter for this, causing it to miss the events. 5 test sessions are stuck at convertStatus: pending despite completed MediaConvert jobs.

MediaConvert events include both Tags and UserMetadata in the event detail. The rule at line 697 needs to match the userMetadata structure.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix EventBridge rule to filter by userMetadata</name>
  <files>infra/lib/stacks/session-stack.ts</files>
  <action>
    Update the MediaConvertCompleteRule at line 697 to filter by userMetadata.phase field:

    Change the eventPattern detail from:
    ```typescript
    detail: {
      'status': ['COMPLETE', 'ERROR', 'CANCELED'],
    }
    ```

    To:
    ```typescript
    detail: {
      'status': ['COMPLETE', 'ERROR', 'CANCELED'],
      'userMetadata': {
        'phase': ['19-transcription']
      }
    }
    ```

    This ensures the rule only matches MediaConvert jobs tagged with phase 19-transcription, which are the ones submitted by start-mediaconvert handler.
  </action>
  <verify>grep -A 5 "MediaConvertCompleteRule" infra/lib/stacks/session-stack.ts | grep "phase.*19-transcription"</verify>
  <done>EventBridge rule includes userMetadata filter for phase: 19-transcription</done>
</task>

<task type="auto">
  <name>Task 2: Deploy and verify the fix</name>
  <files>infra/lib/stacks/session-stack.ts</files>
  <action>
    Deploy the updated CDK stack to apply the EventBridge rule fix:

    1. Run CDK diff to confirm only the EventBridge rule is changing:
       ```bash
       cd infra && npm run cdk -- diff VNL-Session
       ```

    2. Deploy the change:
       ```bash
       cd infra && npm run cdk -- deploy VNL-Session --require-approval never
       ```

    3. After deployment, verify the rule in AWS Console or via CLI:
       ```bash
       aws events describe-rule --name VNL-Session-MediaConvertCompleteRule* --query 'EventPattern' | jq .
       ```

    The EventPattern should now include the userMetadata.phase filter.
  </action>
  <verify>aws events list-rules --name-prefix "VNL-Session-MediaConvertComplete" --query "Rules[0].State" --output text | grep "ENABLED"</verify>
  <done>Updated EventBridge rule deployed and enabled in AWS</done>
</task>

<task type="auto">
  <name>Task 3: Re-trigger stuck sessions</name>
  <files>backend/src/handlers/on-mediaconvert-complete.ts</files>
  <action>
    Create a script to manually trigger the on-mediaconvert-complete handler for the 5 stuck sessions:

    1. For each stuck session, construct a synthetic MediaConvert completion event
    2. Invoke the Lambda directly with the event payload

    Sessions to re-process:
    - f8781b3d-6782-4639-8299-fee18c2288a0
    - 8cb61344-0254-414a-826f-d6d22a6f212f
    - d174f333-7df4-4dff-8469-5b7d449ce18c
    - c78d45cf-4ee2-434f-8d9f-87ac34cf3de7
    - 0b17eb75-169f-4de3-b459-ba9b40b99df3

    Use AWS CLI to invoke:
    ```bash
    for sessionId in f8781b3d-6782-4639-8299-fee18c2288a0 8cb61344-0254-414a-826f-d6d22a6f212f d174f333-7df4-4dff-8469-5b7d449ce18c c78d45cf-4ee2-434f-8d9f-87ac34cf3de7 0b17eb75-169f-4de3-b459-ba9b40b99df3; do
      aws lambda invoke \
        --function-name VNL-Session-OnMediaConvertComplete* \
        --payload "{\"detail\":{\"jobName\":\"vnl-${sessionId}-1234567890\",\"jobId\":\"manual-trigger\",\"status\":\"COMPLETE\"}}" \
        response.json
      echo "Triggered for session: ${sessionId}"
    done
    ```
  </action>
  <verify>aws dynamodb get-item --table-name VNL-Session --key '{"pk":{"S":"SESSION#f8781b3d-6782-4639-8299-fee18c2288a0"},"sk":{"S":"SESSION#f8781b3d-6782-4639-8299-fee18c2288a0"}}' --query "Item.convertStatus.S" --output text | grep "available"</verify>
  <done>All 5 stuck sessions have convertStatus: available in DynamoDB</done>
</task>

</tasks>

<verification>
1. EventBridge rule includes userMetadata.phase filter
2. CDK deployment successful
3. All 5 stuck sessions updated to convertStatus: available
4. New MediaConvert jobs trigger the pipeline correctly
</verification>

<success_criteria>
- MediaConvertCompleteRule filters by userMetadata.phase = 19-transcription
- on-mediaconvert-complete handler receives MediaConvert completion events
- Session convertStatus updates from pending to available
- Transcription pipeline continues to Transcribe job submission
</success_criteria>

<output>
After completion, verify in CloudWatch Logs that on-mediaconvert-complete handler is being invoked for new MediaConvert job completions.
</output>