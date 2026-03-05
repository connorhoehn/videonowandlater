# VideoNowAndLater

Live and recorded video streaming app built on AWS IVS (Interactive Video Service). Supports broadcast sessions (one-to-many), hangout sessions (multi-participant), chat, reactions, and replay.

## Architecture

- **`web/`** — React + Vite frontend (Amazon IVS player/broadcaster, AWS Amplify auth)
- **`backend/`** — TypeScript Lambda handlers, DynamoDB repositories, domain models, developer CLI
- **`infra/`** — AWS CDK stacks (Cognito, API Gateway, Lambda, DynamoDB, IVS)

The backend runs entirely on AWS — there is no local server.

---

## Prerequisites

- **Node.js** v18+ and **npm**
- **AWS CLI** configured with credentials (`aws configure`)
- **AWS CDK** bootstrapped in your account/region (`npx cdk bootstrap`)
- **jq** — for deploy script JSON processing (`brew install jq`)
- **FFmpeg** — only needed for test video streaming (`brew install ffmpeg`)

---

## 1. Install Dependencies

```bash
npm install
```

This installs dependencies for all workspaces (`web`, `backend`, `infra`).

---

## 2. Deploy to AWS

```bash
npm run deploy
```

This runs `./scripts/deploy.sh` which:
1. Deploys all CDK stacks (`VNL-Auth`, `VNL-Api`, etc.)
2. Saves stack outputs to `cdk-outputs.json`
3. Generates `web/public/aws-config.json` for the frontend

> Re-run this after any infrastructure changes.

---

## 3. Create a User

```bash
./scripts/create-user.sh <username> <password>
```

Creates a Cognito user with a permanent password (requires `cdk-outputs.json` from deploy).

---

## 4. Run the Frontend

```bash
npm run dev
```

Starts the Vite dev server at `http://localhost:5173`. The frontend reads `web/public/aws-config.json` to connect to the deployed AWS backend.

---

## Developer Tools

### Get an Auth Token

```bash
./scripts/get-token.sh <username> <password>
```

Saves tokens to stdout. To use with CLI scripts, redirect to a file:

```bash
./scripts/get-token.sh myuser mypassword | jq -r '.AccessToken' > ./scripts/.token
```

### Build the CLI

```bash
cd backend
npm run build
npm link   # makes `vnl-cli` globally available
```

### CLI Commands

```bash
# Seed test data
vnl-cli seed-sessions -n 10
vnl-cli seed-chat <session-id> -n 50
vnl-cli seed-reactions <session-id> -n 100

# Stream test video (requires FFmpeg)
vnl-cli stream-broadcast <session-id> video.mp4 --loop
vnl-cli stream-hangout <session-id> video.mp4

# Simulate viewer presence
vnl-cli simulate-presence <session-id> --viewers 42
```

CLI commands read config from `cdk-outputs.json` automatically. You can also set manually:

```bash
export TABLE_NAME=VNL-App-SessionsTable-xxx
export AWS_REGION=us-east-1
```

---

## Other Scripts

| Script | Description |
|---|---|
| `./scripts/list-users.sh` | List all Cognito users |
| `./scripts/delete-user.sh <username>` | Delete a Cognito user |
| `./scripts/test-broadcast.sh <session-id> <video>` | Stream video via FFmpeg (shell alternative to CLI) |
| `npm run destroy` | Tear down all AWS stacks |

---

## Backend Tests

```bash
cd backend
npm test
```
