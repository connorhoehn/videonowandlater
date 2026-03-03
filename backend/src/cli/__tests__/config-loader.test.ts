/**
 * Tests for config-loader - loads deployment config from cdk-outputs.json
 */

import * as fs from 'fs';
import { loadConfig } from '../lib/config-loader';

// Mock fs module
jest.mock('fs');
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

describe('config-loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should read cdk-outputs.json and extract apiUrl and region', () => {
    const mockCdkOutputs = {
      'VNL-Api': {
        ApiUrl: 'https://test.execute-api.us-east-1.amazonaws.com/prod/',
      },
      'VNL-Auth': {
        CognitoRegion: 'us-east-1',
        UserPoolId: 'us-east-1_test',
        UserPoolClientId: 'test-client-id',
      },
    };

    mockReadFileSync.mockReturnValue(JSON.stringify(mockCdkOutputs));

    const config = loadConfig();

    expect(config).toEqual({
      apiUrl: 'https://test.execute-api.us-east-1.amazonaws.com/prod/',
      region: 'us-east-1',
      userPoolId: 'us-east-1_test',
      userPoolClientId: 'test-client-id',
    });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('cdk-outputs.json'),
      'utf-8'
    );
  });

  it('should throw error if cdk-outputs.json is missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => loadConfig()).toThrow(
      'cdk-outputs.json not found. Run ./scripts/deploy.sh first.'
    );
  });

  it('should throw error if cdk-outputs.json is malformed', () => {
    mockReadFileSync.mockReturnValue('invalid json');

    expect(() => loadConfig()).toThrow();
  });
});
