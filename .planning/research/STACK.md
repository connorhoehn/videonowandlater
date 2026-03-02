# Technology Stack

**Project:** VideoNowAndLater
**Researched:** 2026-03-01
**Overall Confidence:** HIGH (all versions verified via npm registry)

## Recommended Stack

### Language and Runtime

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| TypeScript | ^5.9 | All code (frontend, CDK, Lambda, CLI) | Single language across entire stack; type safety catches IVS SDK integration errors at compile time; AWS SDK v3 has first-class TS support | HIGH (npm: 5.9.3) |
| Node.js | 20.x LTS | Lambda runtime + local dev | Node 20 is the current stable Lambda runtime; Node 22 Lambda runtime is available but 20 is battle-tested; matches local dev env (20.19.2 locally) | HIGH |

### Frontend

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React | ^19.2 | UI framework | Latest stable; no peer dependency conflicts with IVS SDKs (they have zero React peer deps); concurrent features useful for video + chat UX | HIGH (npm: 19.2.4) |
| React DOM | ^19.2 | DOM rendering | Paired with React 19 | HIGH (npm: 19.2.4) |
| Vite | ^7.3 | Build tool + dev server | Fastest DX for React; native ESM; handles WASM loading that IVS Player SDK needs; HMR that doesn't kill WebRTC connections (unlike Webpack full-page reloads) | HIGH (npm: 7.3.1) |
| React Router | ^7.13 | Client-side routing | Mature, well-documented; v7 is stable with React 19; simple loader/action model for route-level data | HIGH (npm: 7.13.1) |
| Zustand | ^5.0 | Client state management | Minimal boilerplate for complex video/chat state; works outside React tree (needed for IVS SDK callbacks); no context provider wrapping | HIGH (npm: 5.0.11) |
| TanStack Query | ^5.90 | Server state / API caching | Handles session lists, replay metadata, presence polling with automatic caching, deduplication, and background refresh | HIGH (npm: 5.90.21) |
| Tailwind CSS | ^4.2 | Styling | Utility-first; v4 is stable with new CSS-first config, Vite plugin; fast iteration for video/chat layouts | HIGH (npm: 4.2.1) |

### AWS IVS SDKs (Frontend -- Browser)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| amazon-ivs-web-broadcast | ^1.32 | Broadcasting + RealTime stages | Unified SDK for BOTH low-latency broadcasting (RTMPS ingest) AND RealTime/WebRTC stages; handles camera/mic capture, compositing, publish/subscribe | HIGH (npm: 1.32.0) |
| amazon-ivs-player | ^1.49 | Playback of low-latency streams and recordings | Web player for IVS low-latency channels; also plays back recorded S3 content via HLS; required for viewer experience and replay | HIGH (npm: 1.49.0) |
| amazon-ivs-chat-messaging | ^1.1 | Chat room WebSocket client | Official client-side Chat SDK; handles connect, send, receive, disconnect events, message threading; lightweight (only dep: uuid) | HIGH (npm: 1.1.1) |

**Critical note on IVS Web Broadcast SDK:** This single SDK covers BOTH use cases. For one-to-many broadcasting it provides RTMPS ingest. For RealTime hangouts it provides the WebRTC Stage API. Do NOT look for a separate "IVS RealTime Web SDK" -- it is bundled in `amazon-ivs-web-broadcast`.

**Critical note on IVS Player SDK:** Has peer dependencies on `bowser` (^2.13.1) and `lodash` (^4.17.21). These must be installed alongside it.

### AWS SDK v3 (Backend -- Lambda)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @aws-sdk/client-ivs | ^3.x | IVS Channel management | Create/delete channels, get stream keys, manage recording configs; used for pre-warmed pool management | HIGH (npm: 3.1000.0) |
| @aws-sdk/client-ivs-realtime | ^3.x | IVS RealTime Stage management | Create/delete stages, generate participant tokens; used for hangout session setup | HIGH (npm: 3.1000.0) |
| @aws-sdk/client-ivschat | ^3.x | IVS Chat Room management | Create/delete chat rooms, generate chat tokens, manage message review handlers | HIGH (npm: 3.1000.0) |
| @aws-sdk/client-dynamodb | ^3.x | Low-level DynamoDB operations | Direct table operations when needed | HIGH (npm: 3.1000.0) |
| @aws-sdk/lib-dynamodb | ^3.x | DynamoDB Document Client | High-level document operations with automatic marshalling; use this 95% of the time over raw client | HIGH (npm: 3.1000.0) |
| @aws-sdk/client-cognito-identity-provider | ^3.x | Cognito user pool operations | Admin user operations for CLI tools (create/delete users, generate tokens) | HIGH (npm: 3.1000.0) |
| @aws-sdk/client-s3 | ^3.x | S3 operations | Generate presigned URLs for replay video access; manage recording bucket lifecycle | HIGH (npm: 3.1000.0) |

**Version note:** AWS SDK v3 uses synchronized versioning. Pin to `^3` and let the lockfile handle specific resolution. All clients are at 3.1000.0 as of 2026-02-27.

### Backend / Lambda

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @aws-lambda-powertools/logger | ^2.31 | Structured logging | JSON structured logs with correlation IDs; Lambda-aware (cold start detection, request context); standard in AWS Lambda TS ecosystem | HIGH (npm: 2.31.0) |
| @aws-lambda-powertools/tracer | ^2.31 | X-Ray tracing | Automatic X-Ray tracing for AWS SDK calls; essential for debugging IVS API latency issues | HIGH (npm: 2.31.0) |
| @aws-lambda-powertools/metrics | ^2.31 | CloudWatch custom metrics | EMF-format metrics for session counts, token generation latency, pool utilization | HIGH (npm: 2.31.0) |
| @middy/core | ^7.1 | Lambda middleware | Clean middleware pattern for common concerns (error handling, validation, CORS); avoids boilerplate in every handler | HIGH (npm: 7.1.2) |
| aws-jwt-verify | ^5.1 | Cognito JWT validation | Verify Cognito tokens in Lambda authorizers; caches JWKS, handles token expiry; official AWS library | HIGH (npm: 5.1.1) |
| zod | ^4.3 | Input validation + type inference | Validate API request bodies; infer TypeScript types from schemas; share validation between frontend and backend | HIGH (npm: 4.3.6) |
| uuid | ^13.0 | ID generation | Generate session IDs, correlation IDs; used internally by IVS Chat SDK too | HIGH (npm: 13.0.0) |

### Infrastructure (CDK)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| aws-cdk-lib | ^2.240 | CDK v2 core library | All L1/L2 constructs; includes `aws-ivs`, `aws-ivschat` modules for IVS channels and chat rooms; includes `aws-lambda-nodejs` for esbuild bundling | HIGH (npm: 2.240.0) |
| aws-cdk (CLI) | ^2.1108 | CDK CLI tool | Deploy, destroy, synthesize, diff; version can float independently of lib | HIGH (npm: 2.1108.0) |
| @aws-cdk/aws-ivs-alpha | ^2.240.0-alpha.0 | IVS L2 constructs (experimental) | Higher-level IVS constructs with recording configuration support; alpha but tracks stable CDK releases closely | MEDIUM (alpha status, but actively maintained and version-locked to cdk-lib) |
| constructs | ^10.5 | CDK construct base | Required peer dependency of aws-cdk-lib | HIGH (npm: 10.5.1) |
| cdk-nag | ^2.37 | CDK security/best practice checks | Catches security issues before deploy (public S3 buckets, missing encryption); run during synth | HIGH (npm: 2.37.55) |

**CDK IVS module detail:** `aws-cdk-lib` ships with stable L1 constructs at `aws-cdk-lib/aws-ivs` (channels, stream keys, recording configs) and `aws-cdk-lib/aws-ivschat` (chat rooms). The `@aws-cdk/aws-ivs-alpha` package adds higher-level L2 constructs. For IVS RealTime (stages), you will likely need L1 `CfnStage` constructs from `aws-cdk-lib/aws-ivs` since L2 support may be limited.

### Developer CLI Tool

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| commander | ^14.0 | CLI argument parsing | De facto standard for Node.js CLI tools; type-safe; subcommand support for users/tokens/sessions/stream operations | HIGH (npm: 14.0.3) |
| fluent-ffmpeg | ^2.1 | Video file streaming to RTMPS | Wraps FFmpeg for streaming MP4/MOV test files into IVS channels via RTMPS; required for testing without OBS/browser | HIGH (npm: 2.1.3) |

**FFmpeg system dependency:** `fluent-ffmpeg` requires FFmpeg installed on the system (`brew install ffmpeg` on macOS). This is a system dependency, not an npm package.

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | ^4.0 | Unit + integration tests | Native ESM, Vite-compatible, fast; works with TypeScript out of the box; same config as app build | HIGH (npm: 4.0.18) |
| @types/aws-lambda | ^8.10 | Lambda handler type definitions | Type-safe Lambda event/context/response objects | HIGH (npm: 8.10.161) |

### Dev Dependencies (Shared)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| esbuild | ^0.27 | Lambda bundling (via CDK NodejsFunction) | CDK's `aws-lambda-nodejs.NodejsFunction` uses esbuild under the hood for tree-shaking Lambda code; install as dev dep so CDK doesn't download it on every synth | HIGH (npm: 0.27.3) |

## Architecture Decision: Monorepo Structure

Use a **flat monorepo with npm workspaces** organized as:

```
/
  packages/
    cdk/          -- CDK app (infrastructure)
    api/          -- Lambda handlers (shared across functions)
    web/          -- React frontend (Vite)
    cli/          -- Developer CLI tool
    shared/       -- Shared types, validation schemas (zod), constants
```

**Why npm workspaces over Turborepo/Nx:** This project has 4-5 packages max. npm workspaces (built into npm 7+) handle this without additional tooling complexity. Add Turborepo later only if build orchestration becomes a bottleneck.

## What NOT to Use

| Category | Avoid | Use Instead | Why |
|----------|-------|-------------|-----|
| State management | Redux / Redux Toolkit | Zustand | Redux is overkill for this app; video/chat state is best managed outside React tree where Zustand excels |
| State management | React Context for global state | Zustand | Context causes full subtree re-renders; video frames + chat messages would destroy performance |
| API layer | GraphQL / AppSync | REST (API Gateway + Lambda) | Project spec says REST; session/token APIs are simple request-response; GraphQL adds complexity with no benefit here |
| Auth SDK | AWS Amplify (`aws-amplify`) | Direct `@aws-sdk/client-cognito-identity-provider` + `aws-jwt-verify` | Amplify pulls in massive bundle (~500KB+); we only need username/password auth; direct SDK is lighter and gives full control over the auth flow |
| CSS | CSS-in-JS (styled-components, emotion) | Tailwind CSS | Zero runtime cost; better for video-heavy UIs where JS thread must stay free for WebRTC/media |
| IVS | Separate "IVS RealTime SDK" | `amazon-ivs-web-broadcast` | There is no separate RealTime web SDK; the broadcast SDK includes the Stage (RealTime) API |
| Build tool | Webpack / Create React App | Vite | CRA is deprecated; Webpack is slower; Vite handles WASM (IVS Player) and WebRTC better |
| CDK IVS | Only L1 CfnChannel constructs | `@aws-cdk/aws-ivs-alpha` for channels | Alpha L2 constructs provide simpler API for recording configs; fall back to L1 for RealTime stages |
| Lambda bundling | Webpack for Lambda | CDK NodejsFunction (esbuild) | Built into CDK; automatic tree-shaking; no config files |
| Monorepo | Lerna | npm workspaces | Lerna is effectively deprecated for new projects; npm workspaces are built-in and sufficient |
| Testing | Jest | Vitest | Vitest is faster, native ESM, same config as Vite; Jest needs extra config for ESM/TypeScript |
| CLI framework | yargs / oclif | commander | commander is lighter for our needs; oclif is for plugin-heavy CLIs we don't need |
| React version | React 18 | React 19 | No IVS SDK conflicts (no React peer deps); React 19 concurrent features help with video + chat UI; use modern APIs |

## React 19 Compatibility Assessment

**Verdict: Safe to use React 19.**

The three IVS browser SDKs have the following React dependencies:
- `amazon-ivs-web-broadcast`: Zero React peer/regular dependencies (deps: jsdom, bowser, lodash, eventemitter3, sdp-transform, webrtc-adapter, reflect-metadata)
- `amazon-ivs-player`: Zero React dependencies (peer deps: bowser, lodash)
- `amazon-ivs-chat-messaging`: Zero React dependencies (dep: uuid)

None of the IVS SDKs are React components -- they are vanilla JavaScript libraries that we wrap in our own React hooks and components. React version is irrelevant to them.

## Version Pinning Strategy

| Layer | Strategy | Rationale |
|-------|----------|-----------|
| IVS SDKs (browser) | Pin minor: `~1.32.0`, `~1.49.0`, `~1.1.1` | IVS SDKs can have breaking behavior in minor bumps despite semver; pin tight and upgrade deliberately |
| AWS SDK v3 (Lambda) | Pin major: `^3` | AWS SDK v3 is stable; minor/patch updates are safe; tree-shaking keeps bundle small |
| React + React DOM | Pin major: `^19` | Stable within major; minor updates are safe |
| CDK | Pin minor: `~2.240.0` | CDK releases frequently; minor bumps can change synth output; control upgrade timing |
| CDK alpha | Match CDK: `~2.240.0-alpha.0` | Must stay in sync with `aws-cdk-lib` version |
| Everything else | Pin major: `^` | Standard semver trust for mature libraries |

## Installation

```bash
# ---- Root (monorepo setup) ----
npm init -w packages/cdk -w packages/api -w packages/web -w packages/cli -w packages/shared

# ---- packages/web (Frontend) ----
npm install -w packages/web \
  react@^19 react-dom@^19 react-router@^7 react-router-dom@^7 \
  zustand@^5 @tanstack/react-query@^5 \
  amazon-ivs-web-broadcast@~1.32.0 \
  amazon-ivs-player@~1.49.0 bowser@^2.13.1 lodash@^4.17.21 \
  amazon-ivs-chat-messaging@~1.1.1

npm install -w packages/web -D \
  vite@^7 @vitejs/plugin-react@latest \
  tailwindcss@^4 @tailwindcss/vite@^4 \
  typescript@^5.9 @types/react@^19 @types/react-dom@^19 \
  vitest@^4

# ---- packages/api (Lambda handlers) ----
npm install -w packages/api \
  @aws-sdk/client-ivs@^3 \
  @aws-sdk/client-ivs-realtime@^3 \
  @aws-sdk/client-ivschat@^3 \
  @aws-sdk/client-dynamodb@^3 \
  @aws-sdk/lib-dynamodb@^3 \
  @aws-sdk/client-cognito-identity-provider@^3 \
  @aws-sdk/client-s3@^3 \
  @aws-lambda-powertools/logger@^2 \
  @aws-lambda-powertools/tracer@^2 \
  @aws-lambda-powertools/metrics@^2 \
  @middy/core@^7 \
  aws-jwt-verify@^5 \
  zod@^4 uuid@^13

npm install -w packages/api -D \
  typescript@^5.9 @types/aws-lambda@^8.10 \
  esbuild@^0.27 vitest@^4

# ---- packages/cdk (Infrastructure) ----
npm install -w packages/cdk \
  aws-cdk-lib@~2.240.0 constructs@^10 \
  @aws-cdk/aws-ivs-alpha@~2.240.0-alpha.0 \
  cdk-nag@^2

npm install -w packages/cdk -D \
  aws-cdk@^2 typescript@^5.9

# ---- packages/cli (Developer CLI) ----
npm install -w packages/cli \
  commander@^14 fluent-ffmpeg@^2 \
  @aws-sdk/client-ivs@^3 \
  @aws-sdk/client-ivs-realtime@^3 \
  @aws-sdk/client-ivschat@^3 \
  @aws-sdk/client-cognito-identity-provider@^3

npm install -w packages/cli -D \
  typescript@^5.9 @types/fluent-ffmpeg@^2

# ---- packages/shared (Shared types/schemas) ----
npm install -w packages/shared \
  zod@^4

npm install -w packages/shared -D \
  typescript@^5.9

# ---- System dependency (macOS) ----
brew install ffmpeg
```

## Lambda Runtime Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Runtime | `nodejs20.x` | Current LTS; battle-tested in Lambda; Node 22 runtime exists but 20 is safer for production |
| Architecture | `arm64` | Graviton2 is 20% cheaper and generally faster for Lambda; all our dependencies are pure JS/TS (no native modules) |
| Bundling | `NodejsFunction` (esbuild) | Built into CDK; automatic tree-shaking; produces smallest bundles for AWS SDK v3 |
| Memory | 256 MB (start) | IVS token generation is lightweight; DynamoDB operations are fast; tune up only if needed |
| Timeout | 10 seconds (API), 30 seconds (pool warmup) | API calls should be fast; pool warmup may need to create IVS resources which can take a few seconds |

## Sources

All versions verified via `npm view [package] version` against the npm registry on 2026-03-01:

- amazon-ivs-web-broadcast: 1.32.0 (published, rc: 1.33.0-rc.2)
- amazon-ivs-player: 1.49.0 (published, rc: 1.49.0-rc.4)
- amazon-ivs-chat-messaging: 1.1.1
- @aws-sdk/client-ivs, client-ivs-realtime, client-ivschat, client-dynamodb, lib-dynamodb, client-cognito-identity-provider, client-s3: all 3.1000.0 (published 2026-02-27)
- aws-cdk-lib: 2.240.0
- @aws-cdk/aws-ivs-alpha: 2.240.0-alpha.0
- aws-cdk (CLI): 2.1108.0 (published 2026-02-26)
- constructs: 10.5.1
- cdk-nag: 2.37.55
- react, react-dom: 19.2.4
- vite: 7.3.1
- typescript: 5.9.3
- react-router, react-router-dom: 7.13.1
- zustand: 5.0.11
- @tanstack/react-query: 5.90.21
- tailwindcss, @tailwindcss/vite: 4.2.1
- @aws-lambda-powertools/logger, tracer, metrics: 2.31.0
- @middy/core: 7.1.2
- aws-jwt-verify: 5.1.1
- zod: 4.3.6
- uuid: 13.0.0
- commander: 14.0.3
- fluent-ffmpeg: 2.1.3
- vitest: 4.0.18
- esbuild: 0.27.3
- @types/aws-lambda: 8.10.161
