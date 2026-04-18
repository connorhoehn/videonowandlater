/**
 * Multi-project Jest configuration.
 *
 * Projects:
 *  - unit:        fast, isolated handler/repo tests using jest mocks only.
 *  - integration: runs against DynamoDB Local (spun up by @shelf/jest-dynamodb)
 *                 with real DDB SDK clients + aws-sdk-client-mock for IVS.
 */

const TS_MODULE_NAME_MAPPER = {
  // The codebase uses `.js` suffixes in `await import()` statements for
  // NodeNext compatibility. Under ts-jest those imports need to map back to
  // the actual `.ts` sources.
  '^(\\.{1,2}/.*)\\.js$': '$1',
};

module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '\\.integration\\.test\\.ts$',
      ],
      moduleNameMapper: TS_MODULE_NAME_MAPPER,
    },
    {
      displayName: 'integration',
      preset: '@shelf/jest-dynamodb',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.integration.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
      },
      moduleNameMapper: TS_MODULE_NAME_MAPPER,
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
  ],
};
