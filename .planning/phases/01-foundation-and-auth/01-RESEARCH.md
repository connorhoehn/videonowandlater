# Phase 1: Foundation & Auth - Research

**Researched:** 2026-03-01
**Domain:** AWS CDK infrastructure, Cognito authentication, React frontend bootstrapping, developer tooling
**Confidence:** HIGH

## Summary

Phase 1 establishes the entire project scaffold: a CDK-managed AWS backend with Cognito authentication, a React+Vite frontend that consumes CDK outputs for configuration, CloudWatch billing alarms, and developer CLI scripts for user management and token generation. This is a well-trodden path in the AWS ecosystem with mature tooling and extensive official documentation.

The core architecture is a TypeScript monorepo with three workspaces: CDK infrastructure (`infra/`), Lambda functions (`backend/`), and React frontend (`web/`). CDK v2 with `aws-cdk-lib` provides all constructs needed. Cognito UserPool handles username/password auth with no email verification. The frontend uses AWS Amplify JS v6 (client library only, no Amplify backend) to communicate with the existing Cognito pool. CDK outputs are written to a JSON config file that the frontend reads at startup, with a fallback "stack not deployed" screen when the config is missing or the API is unreachable.

**Primary recommendation:** Use a TypeScript monorepo (npm workspaces) with CDK v2, Cognito UserPool (username-only sign-in, self-signup enabled, no email verification), Amplify JS v6 for frontend auth, and shell scripts wrapping AWS CLI for developer tooling.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | CDK multi-stack infrastructure deploys cleanly with `cdk deploy --all` | CDK v2 multi-stack patterns with cross-stack references via constructor injection; separate Auth, API, and Monitoring stacks |
| INFRA-02 | CDK infrastructure tears down cleanly with `cdk destroy --all` | RemovalPolicy.DESTROY on all resources; autoDeleteObjects on S3 buckets; no RETAIN policies in dev |
| INFRA-03 | CloudWatch billing alarms fire at $10, $50, $100 thresholds | CloudWatch Metric on AWS/Billing namespace, EstimatedCharges metric, SNS topic for notifications; must deploy in us-east-1 |
| AUTH-01 | User can sign up with username and password (no email verification) | Cognito UserPool with signInAliases: { username: true }, selfSignUpEnabled: true, no autoVerify; UserPoolClient with userPassword and userSrp authFlows |
| AUTH-02 | User can log in and receive JWT tokens for API authorization | Amplify JS v6 signIn() returns isSignedIn; fetchAuthSession() provides accessToken and idToken; Cognito issues JWTs natively |
| AUTH-03 | User session persists across browser refresh | Amplify JS v6 uses localStorage by default; tokens auto-refresh when refresh token is valid; fetchAuthSession() handles this transparently |
| AUTH-04 | User can log out from any page | Amplify JS v6 signOut() clears local tokens; global signOut({ global: true }) revokes all refresh tokens |
| DEPLOY-01 | CDK deployment outputs are wired into web app via env vars or generated config files | `cdk deploy --outputs-file` writes cdk-outputs.json; post-deploy script generates frontend config from outputs |
| DEPLOY-02 | Deploy/destroy scripts update frontend configuration automatically | Shell scripts that run `cdk deploy --all --outputs-file` then transform outputs into frontend-readable config; destroy script removes config file |
| DEV-01 | CLI command to create/list/delete Cognito users | AWS CLI commands: admin-create-user, admin-set-user-password (--permanent), list-users, admin-delete-user; wrapped in shell scripts |
| DEV-02 | CLI command to generate auth tokens for testing | AWS CLI admin-initiate-auth with ADMIN_USER_PASSWORD_AUTH flow; returns AccessToken, IdToken, RefreshToken |
| DEV-07 | Frontend detects "stack not deployed" and shows developer setup guidance | Check for config file existence and/or catch API connection errors; render setup instructions component instead of app shell |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| aws-cdk-lib | ^2.170+ | All CDK constructs (Cognito, CloudWatch, API Gateway, Lambda, DynamoDB, S3, SNS) | Single package for all AWS CDK v2 constructs; official AWS maintained |
| constructs | ^10.0 | CDK construct base class | Required peer dependency for aws-cdk-lib |
| aws-cdk (CLI) | ^2.170+ | CDK CLI for deploy/destroy/synth | Official CLI tool; installed globally or via npx |
| react | ^19.0 | Frontend UI library | Project decision; current stable version |
| react-dom | ^19.0 | React DOM rendering | Required for React web apps |
| aws-amplify | ^6.x | Cognito auth client (signIn, signUp, signOut, session management) | Official AWS client library for Cognito; works with existing pools without Amplify backend |
| vite | ^6.x | Frontend build tool and dev server | Industry standard; 40x faster than CRA; native ES modules in dev |
| typescript | ^5.5+ | Type safety across all workspaces | Project decision; enables shared types between infra/backend/frontend |
| esbuild | ^0.24+ | Lambda function bundling (via NodejsFunction) | Bundled automatically by CDK's NodejsFunction construct; extremely fast |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/react | ^19.0 | React TypeScript definitions | Always, for TypeScript React development |
| @types/react-dom | ^19.0 | React DOM TypeScript definitions | Always, for TypeScript React development |
| react-router-dom | ^7.x | Client-side routing | For multi-page navigation (login, app, logout) |
| @aws-sdk/client-cognito-identity-provider | ^3.x | Cognito admin operations in Lambda/scripts | For server-side Cognito operations (token generation, user management in Lambda) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Amplify JS v6 | amazon-cognito-identity-js | Lower level, more control but more boilerplate; Amplify v6 is the maintained successor |
| Vite | Next.js | Next.js adds SSR complexity not needed for this SPA; Vite is lighter and faster for client-only apps |
| Shell scripts for CLI | Custom Node.js CLI (Commander/yargs) | Shell scripts are simpler for wrapping AWS CLI; Node.js CLI makes sense if commands grow complex in later phases |
| npm workspaces | Turborepo/Nx | npm workspaces are sufficient for 3 packages; Turborepo adds build caching value only at scale |

**Installation (infra workspace):**
```bash
npm init -y
npx cdk init app --language typescript
# aws-cdk-lib and constructs are included by cdk init
```

**Installation (web workspace):**
```bash
npm create vite@latest web -- --template react-ts
cd web && npm install aws-amplify react-router-dom
```

## Architecture Patterns

### Recommended Project Structure
```
videonowandlater/
├── package.json              # Root workspace config
├── tsconfig.base.json        # Shared TypeScript config
├── cdk.json                  # CDK app configuration
├── infra/                    # CDK infrastructure
│   ├── bin/
│   │   └── app.ts            # CDK app entry point (instantiates stacks)
│   ├── lib/
│   │   ├── stacks/
│   │   │   ├── auth-stack.ts       # Cognito UserPool, UserPoolClient
│   │   │   ├── api-stack.ts        # API Gateway, Lambda functions
│   │   │   └── monitoring-stack.ts # CloudWatch billing alarms, SNS
│   │   └── constructs/            # Reusable L3 constructs
│   ├── package.json
│   └── tsconfig.json
├── backend/                  # Lambda function handlers
│   ├── src/
│   │   └── handlers/         # Lambda handler functions
│   ├── package.json
│   └── tsconfig.json
├── web/                      # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── auth/             # Auth components and hooks
│   │   ├── components/       # Shared UI components
│   │   ├── config/           # CDK output config loader
│   │   └── pages/            # Route-level components
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
└── scripts/                  # Developer CLI scripts
    ├── deploy.sh             # CDK deploy + config generation
    ├── destroy.sh            # CDK destroy + config cleanup
    ├── create-user.sh        # Cognito user management
    ├── list-users.sh
    ├── delete-user.sh
    └── get-token.sh          # Auth token generation
```

### Pattern 1: Multi-Stack with Cross-Stack References
**What:** Separate CDK stacks for Auth, API, and Monitoring with constructor-injected references
**When to use:** Always for this project; separates concerns and allows independent stack updates
**Example:**
```typescript
// Source: AWS CDK Best Practices - https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html
// infra/bin/app.ts
import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';

const app = new App();
const env = { region: 'us-east-1' }; // Required for billing alarms

const authStack = new AuthStack(app, 'VNL-Auth', { env });
const apiStack = new ApiStack(app, 'VNL-Api', {
  env,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});
new MonitoringStack(app, 'VNL-Monitoring', { env });
```

### Pattern 2: CDK Outputs to Frontend Config
**What:** Post-deploy script transforms CDK outputs JSON into a frontend-readable config
**When to use:** Every deploy; the frontend reads this config to know its backend endpoints
**Example:**
```typescript
// infra/lib/stacks/auth-stack.ts
import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'vnl-user-pool',
      selfSignUpEnabled: true,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true, // Required for DEV-02 token generation
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'VNL-UserPoolId',
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'VNL-UserPoolClientId',
    });
    new CfnOutput(this, 'CognitoRegion', {
      value: this.region,
      exportName: 'VNL-CognitoRegion',
    });
  }
}
```

### Pattern 3: Frontend Config Loading with "Stack Not Deployed" Detection
**What:** Frontend reads a generated config file; if missing or API unreachable, shows setup guidance
**When to use:** Always; handles the first-run developer experience gracefully
**Example:**
```typescript
// web/src/config/aws-config.ts
interface AwsConfig {
  userPoolId: string;
  userPoolClientId: string;
  region: string;
  apiUrl: string;
}

let config: AwsConfig | null = null;

export async function loadConfig(): Promise<AwsConfig | null> {
  try {
    const response = await fetch('/aws-config.json');
    if (!response.ok) return null;
    config = await response.json();
    return config;
  } catch {
    return null; // Config file doesn't exist; stack not deployed
  }
}

export function getConfig(): AwsConfig | null {
  return config;
}
```

```typescript
// web/src/App.tsx
function App() {
  const [config, setConfig] = useState<AwsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfig(cfg);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!config) return <StackNotDeployed />;

  return <AuthenticatedApp config={config} />;
}
```

### Pattern 4: Amplify JS v6 with Existing Cognito Pool
**What:** Configure Amplify to use a CDK-created Cognito UserPool (no Amplify backend)
**When to use:** After config is loaded; before any auth operations
**Example:**
```typescript
// Source: https://docs.amplify.aws/react/build-a-backend/auth/use-existing-cognito-resources/
import { Amplify } from 'aws-amplify';
import { signIn, signUp, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

export function configureAuth(config: AwsConfig) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
}

// Sign up
async function handleSignUp(username: string, password: string) {
  const { isSignUpComplete, nextStep } = await signUp({ username, password });
  return { isSignUpComplete, nextStep };
}

// Sign in
async function handleSignIn(username: string, password: string) {
  const { isSignedIn, nextStep } = await signIn({ username, password });
  return { isSignedIn, nextStep };
}

// Sign out
async function handleSignOut() {
  await signOut();
}

// Check current session (persists across refresh via localStorage)
async function checkSession() {
  try {
    const { username } = await getCurrentUser();
    const { tokens } = await fetchAuthSession();
    return { username, tokens };
  } catch {
    return null; // Not authenticated
  }
}
```

### Anti-Patterns to Avoid
- **Putting all resources in one stack:** Separating auth, API, and monitoring into distinct stacks enables independent updates and clearer ownership boundaries.
- **Using environment variables for CDK outputs in Vite:** Vite embeds `VITE_*` env vars at build time, not runtime. Use a JSON config file loaded at runtime instead, so the same build works with different deployments.
- **Generating a client secret for the Cognito UserPoolClient:** Browser-based apps cannot safely store client secrets. Set `generateSecret: false` (the default).
- **Using RETAIN removal policy in development:** This prevents `cdk destroy --all` from cleaning up completely. Use `RemovalPolicy.DESTROY` for all resources in development.
- **Calling Amplify.configure() before config is loaded:** Configure Amplify only after the AWS config JSON is successfully fetched. Guard with the config-loading pattern above.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT token management | Custom token refresh/storage logic | Amplify JS v6 (auto-refresh, localStorage, fetchAuthSession) | Token lifecycle has edge cases (expiry, refresh rotation, concurrent requests) that Amplify handles |
| Password hashing/auth flow | Custom SRP or password handling | Cognito UserPool + Amplify signIn/signUp | SRP protocol is cryptographically complex; Cognito handles it server-side |
| User session detection | Manual cookie/localStorage parsing | Amplify getCurrentUser() + fetchAuthSession() | Amplify knows its own token format and storage keys |
| Billing alarm metrics | Custom metric collection | CloudWatch EstimatedCharges metric (built-in) | AWS already collects billing data every 6 hours; just create alarms on it |
| Lambda bundling | Custom webpack/esbuild scripts | CDK NodejsFunction construct | Handles esbuild config, tree-shaking, source maps, and Lambda-compatible output automatically |
| CORS configuration | Manual header management | API Gateway CORS options in CDK | API Gateway handles OPTIONS preflight and response headers |

**Key insight:** This phase is almost entirely "glue code" connecting well-established AWS services. Every component has an official CDK construct and client library. The risk is not in building custom solutions but in misconfiguring the existing ones.

## Common Pitfalls

### Pitfall 1: Billing Alarms Must Be in us-east-1
**What goes wrong:** Billing alarms created in other regions silently fail because billing metrics are only published in us-east-1.
**Why it happens:** Developers deploy everything to their preferred region without knowing billing is region-specific.
**How to avoid:** The MonitoringStack (or at minimum the billing alarm construct) must specify `env: { region: 'us-east-1' }`. If the main stacks are in another region, create a separate stack for billing alarms in us-east-1.
**Warning signs:** Alarms show "Insufficient Data" permanently.

### Pitfall 2: Cognito UserPool Cannot Change signInAliases After Creation
**What goes wrong:** Attempting to add email as a sign-in alias later requires replacing the entire UserPool, which deletes all users.
**Why it happens:** Cognito sign-in aliases are immutable after pool creation.
**How to avoid:** Decide sign-in aliases upfront. For this project, `signInAliases: { username: true }` is the correct and final configuration per requirements (no email verification).
**Warning signs:** CloudFormation tries to replace the UserPool resource during an update.

### Pitfall 3: adminUserPassword Auth Flow Not Enabled
**What goes wrong:** Developer CLI token generation fails with "ADMIN_USER_PASSWORD_AUTH is not enabled for the client."
**Why it happens:** The UserPoolClient authFlows must explicitly include `adminUserPassword: true` for the `admin-initiate-auth` CLI command to work.
**How to avoid:** Set `authFlows: { userPassword: true, userSrp: true, adminUserPassword: true }` on the UserPoolClient.
**Warning signs:** AWS CLI admin-initiate-auth returns InvalidParameterException.

### Pitfall 4: CDK Cross-Stack Reference Locking
**What goes wrong:** Cannot update or remove a resource that is exported and imported by another stack.
**Why it happens:** CloudFormation prevents removing exports that other stacks reference.
**How to avoid:** Use constructor injection (pass stack objects directly) rather than CfnOutput exports for cross-stack references within the same CDK app. Reserve CfnOutput for frontend consumption.
**Warning signs:** CloudFormation deploy fails with "Export VNL-UserPoolId cannot be deleted as it is in use."

### Pitfall 5: Vite Build-Time vs Runtime Configuration
**What goes wrong:** Frontend config values are baked into the build and cannot change without rebuilding.
**Why it happens:** Vite replaces `import.meta.env.VITE_*` at build time. If you put CDK outputs into `.env`, they become static.
**How to avoid:** Use a runtime-loaded JSON file (`aws-config.json` in `public/`) instead of environment variables. The deploy script generates this file from CDK outputs.
**Warning signs:** Config values don't update after redeploying the backend without rebuilding the frontend.

### Pitfall 6: Billing Alerts Must Be Enabled in AWS Console First
**What goes wrong:** CloudWatch billing alarms show "Insufficient Data" even though they are correctly configured.
**Why it happens:** AWS does not collect billing metrics by default. Billing alerts must be enabled in the AWS Console (Billing > Billing Preferences > Alert Preferences > Receive CloudWatch Billing Alerts).
**How to avoid:** Document this as a prerequisite step. The deploy script or README should warn developers to enable billing alerts in the console before deploying the monitoring stack.
**Warning signs:** Billing metric shows no data points in CloudWatch console.

### Pitfall 7: Cognito admin-create-user Puts Users in FORCE_CHANGE_PASSWORD State
**What goes wrong:** Test users created via CLI cannot sign in because they are stuck in FORCE_CHANGE_PASSWORD status.
**Why it happens:** admin-create-user sets a temporary password by default.
**How to avoid:** After admin-create-user, immediately call `admin-set-user-password --permanent` to set a permanent password and transition the user to CONFIRMED status.
**Warning signs:** signIn returns a NEW_PASSWORD_REQUIRED challenge.

## Code Examples

Verified patterns from official sources:

### CloudWatch Billing Alarm Stack
```typescript
// Source: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
// Source: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const billingTopic = new sns.Topic(this, 'BillingAlarmTopic', {
      displayName: 'VNL Billing Alerts',
    });

    const thresholds = [10, 50, 100];

    for (const threshold of thresholds) {
      const metric = new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        statistic: 'Maximum',
        period: cdk.Duration.hours(6),
        dimensionsMap: { Currency: 'USD' },
      });

      const alarm = new cloudwatch.Alarm(this, `BillingAlarm${threshold}`, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `Alert when estimated charges exceed $${threshold}`,
        alarmName: `vnl-billing-${threshold}`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(new actions.SnsAction(billingTopic));
    }

    new cdk.CfnOutput(this, 'BillingAlarmTopicArn', {
      value: billingTopic.topicArn,
    });
  }
}
```

### Developer CLI: Create User Script
```bash
#!/usr/bin/env bash
# scripts/create-user.sh
# Usage: ./scripts/create-user.sh <username> <password>
# Source: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-create-user.html
# Source: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-set-user-password.html

set -euo pipefail

USERNAME="${1:?Usage: create-user.sh <username> <password>}"
PASSWORD="${2:?Usage: create-user.sh <username> <password>}"

# Read UserPoolId from CDK outputs
OUTPUTS_FILE="cdk-outputs.json"
if [ ! -f "$OUTPUTS_FILE" ]; then
  echo "Error: $OUTPUTS_FILE not found. Run 'npm run deploy' first."
  exit 1
fi

USER_POOL_ID=$(jq -r '."VNL-Auth".UserPoolId' "$OUTPUTS_FILE")

# Create user (suppress welcome email)
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --message-action SUPPRESS

# Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --permanent

echo "User '$USERNAME' created and confirmed."
```

### Developer CLI: Generate Auth Token Script
```bash
#!/usr/bin/env bash
# scripts/get-token.sh
# Usage: ./scripts/get-token.sh <username> <password>
# Source: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-initiate-auth.html

set -euo pipefail

USERNAME="${1:?Usage: get-token.sh <username> <password>}"
PASSWORD="${2:?Usage: get-token.sh <username> <password>}"

OUTPUTS_FILE="cdk-outputs.json"
USER_POOL_ID=$(jq -r '."VNL-Auth".UserPoolId' "$OUTPUTS_FILE")
CLIENT_ID=$(jq -r '."VNL-Auth".UserPoolClientId' "$OUTPUTS_FILE")

RESULT=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD")

echo "$RESULT" | jq '{
  AccessToken: .AuthenticationResult.AccessToken,
  IdToken: .AuthenticationResult.IdToken,
  RefreshToken: .AuthenticationResult.RefreshToken,
  ExpiresIn: .AuthenticationResult.ExpiresIn
}'
```

### Deploy Script with Config Generation
```bash
#!/usr/bin/env bash
# scripts/deploy.sh
# Deploys all CDK stacks and generates frontend config

set -euo pipefail

echo "Deploying CDK stacks..."
npx cdk deploy --all --require-approval never --outputs-file cdk-outputs.json

echo "Generating frontend config..."
# Transform CDK outputs into frontend-readable format
jq '{
  userPoolId: ."VNL-Auth".UserPoolId,
  userPoolClientId: ."VNL-Auth".UserPoolClientId,
  region: ."VNL-Auth".CognitoRegion,
  apiUrl: ."VNL-Api".ApiUrl
}' cdk-outputs.json > web/public/aws-config.json

echo "Deploy complete. Frontend config written to web/public/aws-config.json"
```

### Destroy Script with Config Cleanup
```bash
#!/usr/bin/env bash
# scripts/destroy.sh
# Destroys all CDK stacks and removes generated config

set -euo pipefail

echo "Destroying CDK stacks..."
npx cdk destroy --all --force

echo "Cleaning up generated config..."
rm -f cdk-outputs.json
rm -f web/public/aws-config.json

echo "Destroy complete."
```

### API Gateway with Cognito Authorizer (Minimal Phase 1 API)
```typescript
// Source: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';

interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
    });

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'vnl-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Health check endpoint (no auth required)
    const health = api.root.addResource('health');
    health.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200', responseTemplates: { 'application/json': '{"status":"ok"}' } }],
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), { methodResponses: [{ statusCode: '200' }] });

    // Protected endpoint example (auth required)
    const me = api.root.addResource('me');
    const meHandler = new lambda.NodejsFunction(this, 'MeHandler', {
      entry: '../backend/src/handlers/me.ts',
      handler: 'handler',
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
    });
    me.addMethod('GET', new apigateway.LambdaIntegration(meHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: 'VNL-ApiUrl',
    });
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CDK v1 (separate packages per service) | CDK v2 (single aws-cdk-lib package) | 2021 (CDK v2 GA); v1 EOL June 2023 | Single dependency; no version mismatches between service packages |
| Amplify JS v5 (CognitoUser objects) | Amplify JS v6 (tree-shakeable, no CognitoUser) | 2023 (Amplify v6 GA) | Smaller bundle; simpler API; modular imports like `from 'aws-amplify/auth'` |
| Create React App | Vite | 2023 (CRA deprecated) | 40x faster builds; native ESM; actively maintained |
| amazon-cognito-identity-js | aws-amplify/auth (v6) | 2023 | Amplify v6 auth module is the official replacement; cognito-identity-js still works but is legacy |
| Lambda@Edge for auth | Cognito UserPoolsAuthorizer on API Gateway | Stable since 2020 | Built-in JWT validation at the API Gateway layer; no custom Lambda for auth checking |

**Deprecated/outdated:**
- **Create React App:** Deprecated; use Vite instead
- **Amplify JS v5 Auth.signIn():** Use v6 modular imports (`import { signIn } from 'aws-amplify/auth'`)
- **CDK v1 @aws-cdk/* packages:** Use `aws-cdk-lib` (v2) exclusively

## Open Questions

1. **API Gateway type: REST vs HTTP API**
   - What we know: REST API has more features (Cognito authorizer, request validation, mock integrations); HTTP API is cheaper and faster but uses JWT authorizers differently
   - What's unclear: Whether the cost difference matters at this project's scale
   - Recommendation: Use REST API. It has native CognitoUserPoolsAuthorizer support which is simpler to configure, and cost is negligible at development scale. Can migrate to HTTP API later if needed.

2. **Monorepo workspace manager**
   - What we know: npm workspaces, Yarn workspaces, pnpm workspaces, Turborepo, and Nx are all viable options
   - What's unclear: Whether npm workspaces will cause friction with CDK's NodejsFunction bundling
   - Recommendation: Use npm workspaces. It is the simplest option with no additional tooling. CDK NodejsFunction supports it via the `depsLockFilePath` and `projectRoot` properties. Only add Turborepo if build times become a concern.

3. **SNS email subscription for billing alarms**
   - What we know: SNS topics can send email notifications, but email subscriptions require manual confirmation (clicking a link in the confirmation email)
   - What's unclear: Whether to hardcode an email address or make it a CDK context parameter
   - Recommendation: Make the notification email a CDK context parameter (`cdk deploy -c alarmEmail=you@example.com`). The subscription confirmation is a one-time manual step per email address.

## Sources

### Primary (HIGH confidence)
- [AWS CDK v2 Cognito module README](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito-readme.html) - UserPool configuration, authFlows, signInAliases, passwordPolicy
- [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html) - Multi-stack patterns, cross-stack references, construct vs stack guidance
- [AWS Amplify v6: Use existing Cognito resources](https://docs.amplify.aws/react/build-a-backend/auth/use-existing-cognito-resources/) - Amplify.configure() with existing pool
- [AWS Amplify v6: Enable sign-up/sign-in/sign-out](https://docs.amplify.aws/gen1/react/build-a-backend/auth/enable-sign-up/) - signIn, signUp, signOut API
- [AWS Amplify v6: Manage user session](https://docs.amplify.aws/gen1/react/build-a-backend/auth/manage-user-session/) - fetchAuthSession, getCurrentUser, token storage options
- [CloudWatch billing alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html) - Metric namespace, prerequisites, alarm configuration
- [AWS CLI admin-create-user](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-create-user.html) - Create test users
- [AWS CLI admin-set-user-password](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-set-user-password.html) - Set permanent password
- [AWS CLI admin-initiate-auth](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-initiate-auth.html) - Generate auth tokens
- [CDK CloudWatch Alarm construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html) - Alarm configuration
- [CDK CfnOutput](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.CfnOutput.html) - Stack outputs for frontend config

### Secondary (MEDIUM confidence)
- [CDK multi-stack deployment guide](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/deploy-multiple-stack-applications-using-aws-cdk-with-typescript.html) - AWS Prescriptive Guidance
- [Vite Getting Started](https://vite.dev/guide/) - Project scaffolding, configuration
- [Vite Environment Variables](https://vite.dev/guide/env-and-mode) - Build-time vs runtime config distinction
- [CDK NodejsFunction](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html) - Lambda TypeScript bundling

### Tertiary (LOW confidence)
- None. All findings are verified with official AWS documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are official AWS products with stable APIs and comprehensive CDK documentation
- Architecture: HIGH - Multi-stack CDK with Cognito + API Gateway + React is one of the most common AWS patterns; extensively documented
- Pitfalls: HIGH - Known issues (billing region, FORCE_CHANGE_PASSWORD, cross-stack locking) are documented in official AWS docs and support forums

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable technologies; CDK v2 and Amplify v6 are mature)
