---
status: testing
phase: 21-video-uploads
source: 21-01-SUMMARY.md, 21-02-SUMMARY.md, 21-03-SUMMARY.md, 21-04-SUMMARY.md
started: 2026-03-06T18:00:00Z
updated: 2026-03-06T18:15:00Z
---

## Current Test

number: 5
name: Upload Completion and Navigation
expected: |
  After upload completes and processing begins, the browser automatically navigates to /replay/{sessionId} and displays the replay viewer. The session appears as an uploaded recording with title matching the uploaded filename.
awaiting: user response

## Tests

### 1. Upload Button Visible on HomePage
expected: HomePage displays a green "Upload" button alongside the "Go Live" and "Start Hangout" buttons in the header actions. Clicking it opens a modal with the video upload form.
result: pass

### 2. File Selection and Validation
expected: Click the file input in the upload form. Select a MP4 or MOV video file. The form shows the selected filename and file size in human-readable format (e.g., "123 MB"). Selecting a non-video file shows an error "Invalid file format. Please select MP4, MOV, or AVI."
result: pass

### 3. File Size Validation
expected: Try to select a video file larger than 10GB. The form shows an error "File size exceeds 10GB limit." and the upload button remains disabled. Selecting a valid-sized file clears the error.
result: pass

### 4. Upload Progress Display
expected: After clicking "Upload" on a valid file, a progress bar appears showing the upload progress (0-100%). The bar increments as chunks are uploaded. At 100%, the message shows "Processing... estimated 2-5 minutes" while waiting for MediaConvert.
result: issue
reported: "CORS errors block part-upload requests. POST to /upload/part-url returns 200 but browser blocks fetch due to missing CORS headers. Error: 'No Access-Control-Allow-Origin header present'"
severity: blocker

### 5. Upload Completion and Navigation
expected: After upload completes and processing begins, the browser automatically navigates to /replay/{sessionId} and displays the replay viewer. The session appears as an uploaded recording with title matching the uploaded filename.
result: pending

### 6. Error Handling and Retry
expected: Interrupt the upload by closing the browser or losing network connectivity. Reopen the upload form and start again with the same file. The form shows an error message and allows retrying without restarting from 0%.
result: pending

### 7. Cancel Upload
expected: Start uploading a file. While the upload is in progress (progress bar showing <100%), click the "Cancel" button. The upload stops, the form resets, and you can select a new file to upload.
result: pending

### 8. Mobile Responsiveness
expected: Open the upload form on a mobile device or narrow viewport (max-width: 768px). The modal is centered, the file input and buttons are readable and tappable, and the progress bar and text scale appropriately.
result: pending

### 9. Session Appears in Activity Feed
expected: After uploading a video and waiting for processing to complete (~2-5 minutes), go to the HomePage activity feed. The uploaded video appears as a new session entry with title, duration, participant info (showing your username), and message count.
result: pending

### 10. Replay Viewer Displays Upload
expected: Click the uploaded video in the activity feed. The replay viewer loads, displaying the uploaded video (not IVS stream) with HLS playback controls (play/pause, seek, volume, fullscreen). Chat messages (if any) sync to the video timeline.
result: pending

## Summary

total: 10
passed: 3
issues: 1
pending: 6
skipped: 0

## Gaps

- truth: "Upload requests should include CORS headers to allow browser fetch from frontend origin"
  status: failed
  reason: "User reported: CORS errors block part-upload requests. POST to /upload/part-url returns 200 but browser blocks fetch due to missing CORS headers. Error: 'No Access-Control-Allow-Origin header present'"
  severity: blocker
  test: 4
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
