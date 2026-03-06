---
phase: quick-2
plan: 1
subsystem: devtools
tags: [scripts, config-verification, developer-experience]
dependency_graph:
  requires: [aws-config.json, cdk-outputs.json]
  provides: [dev-script, config-verification]
  affects: [developer-workflow]
tech_stack:
  added: []
  patterns: [bash-scripting, json-validation, terminal-ui]
key_files:
  created:
    - scripts/verify-config.sh
    - scripts/dev.sh
  modified:
    - package.json
decisions:
  - "Use jq for JSON parsing and validation in bash scripts"
  - "Provide interactive prompt to deploy if configuration missing"
  - "Use terminal colors (tput/ANSI) for better developer UX"
  - "Test API connectivity with curl but don't fail on unreachable"
metrics:
  duration: 317s
  tasks_completed: 3
  files_created: 2
  files_modified: 1
  tests_added: 0
  tests_passing: 169
  loc_added: 264
  loc_removed: 1
  completed: "2026-03-06T15:22:58Z"
---

# Quick Task 2: Update Webapp Scripts to Connect to User

Development scripts with AWS configuration verification for seamless developer workflow.

## Executive Summary

Created bash scripts that verify AWS configuration before starting the development server, providing clear guidance when configuration is missing and displaying connection details when valid. The scripts ensure developers always have proper AWS connectivity before starting work on the webapp.

## What Was Built

### 1. Configuration Verification Script (`scripts/verify-config.sh`)
- **Purpose:** Validates AWS configuration before dev server startup
- **Features:**
  - Checks for CDK outputs and AWS config files
  - Validates JSON format and required fields
  - Displays configuration details (region, API URL, user pool)
  - Tests API connectivity with curl
  - Provides clear error messages with remediation steps
- **Lines:** 129

### 2. Development Startup Script (`scripts/dev.sh`)
- **Purpose:** Wraps dev server startup with config checks
- **Features:**
  - Runs configuration verification before starting
  - Interactive prompt to deploy if config missing
  - Displays connected AWS resources
  - Terminal colors for enhanced UX
  - Clear status messages throughout flow
- **Lines:** 135

### 3. Package.json Updates
- **Changed:** `dev` script now uses `./scripts/dev.sh`
- **Added:** `dev:direct` script for bypassing checks

## Implementation Details

### Configuration Verification Flow
1. Check `cdk-outputs.json` exists (CDK deployment indicator)
2. Check `web/public/aws-config.json` exists
3. Validate JSON format with `jq`
4. Verify required fields: userPoolId, userPoolClientId, region, apiUrl
5. Display configuration details with truncated IDs
6. Test API connectivity (non-blocking)

### Developer Experience Enhancements
- **Clear visual hierarchy:** Headers, status indicators, color coding
- **Actionable errors:** Each failure includes specific remediation steps
- **Interactive recovery:** Prompt to deploy if configuration missing
- **Configuration visibility:** Shows which AWS resources the app will connect to

### Error Handling
- **Missing CDK outputs:** Directs to run `npm run deploy`
- **Invalid JSON:** Suggests regenerating configuration
- **Missing fields:** Lists specific missing fields
- **API unreachable:** Noted as warning (may be normal for auth-required endpoints)

## Deviations from Plan

None - plan executed exactly as written.

## Testing Evidence

### Manual Verification
```bash
# Script execution
✓ verify-config.sh works
✓ dev.sh exists and is executable
✓ package.json updated

# Configuration check output
✓ CDK outputs found
✓ AWS configuration found
✓ Configuration is valid JSON
✓ All required fields present
✓ API is reachable (authentication required)
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Execution duration | 5m 17s |
| Tasks completed | 3/3 |
| Files created | 2 |
| Files modified | 1 |
| Lines of code added | 264 |
| Commits | 3 |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 1c33e63 | Add AWS configuration verification script |
| 2 | 6af53b7 | Create development startup script with config checks |
| 3 | 5462ffd | Update package.json to use new dev script |

## Key Outcomes

1. **Improved Developer Onboarding:** New developers get clear guidance on AWS setup
2. **Reduced Configuration Errors:** Verification catches issues before dev server starts
3. **Better Visibility:** Developers see which AWS resources they're connected to
4. **Graceful Recovery:** Interactive prompt to deploy if configuration missing

## Next Steps

The development workflow is now streamlined with automatic configuration verification. Developers can:

1. Run `npm run dev` - automatically checks configuration and starts server
2. Run `npm run dev:direct` - bypass checks for faster startup when config is known good
3. Run `./scripts/verify-config.sh` - standalone config validation

The scripts provide a foundation for future enhancements like environment switching or credential rotation checks.

## Self-Check

### Files Created
✓ FOUND: scripts/verify-config.sh
✓ FOUND: scripts/dev.sh

### Commits Exist
✓ FOUND: 1c33e63
✓ FOUND: 6af53b7
✓ FOUND: 5462ffd

## Self-Check: PASSED