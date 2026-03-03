/**
 * Configuration loader - reads deployment config from cdk-outputs.json
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DeploymentConfig {
  apiUrl: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

/**
 * Load deployment configuration from cdk-outputs.json
 * @throws Error if cdk-outputs.json not found or invalid
 * @returns Deployment configuration
 */
export function loadConfig(): DeploymentConfig {
  try {
    // Navigate to project root (3 levels up from backend/src/cli/lib)
    const projectRoot = path.resolve(__dirname, '../../../..');
    const cdkOutputsPath = path.join(projectRoot, 'cdk-outputs.json');

    const cdkOutputsRaw = fs.readFileSync(cdkOutputsPath, 'utf-8');
    const cdkOutputs = JSON.parse(cdkOutputsRaw);

    return {
      apiUrl: cdkOutputs['VNL-Api'].ApiUrl,
      region: cdkOutputs['VNL-Auth'].CognitoRegion,
      userPoolId: cdkOutputs['VNL-Auth'].UserPoolId,
      userPoolClientId: cdkOutputs['VNL-Auth'].UserPoolClientId,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new Error('cdk-outputs.json not found. Run ./scripts/deploy.sh first.');
    }
    throw error;
  }
}
