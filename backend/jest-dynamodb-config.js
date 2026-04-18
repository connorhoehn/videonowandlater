/**
 * DynamoDB Local table definitions for integration tests.
 *
 * Mirrors the schema defined in infra/lib/stacks/session-stack.ts:
 *   - Primary key: PK (HASH) / SK (RANGE)
 *   - GSI1..GSI6 with various attribute names
 *   - BillingMode: PAY_PER_REQUEST
 */

module.exports = {
  tables: [
    {
      TableName: 'vnl-sessions',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
        { AttributeName: 'channelArn', AttributeType: 'S' },
        { AttributeName: 'stageArn', AttributeType: 'S' },
        { AttributeName: 'GSI5PK', AttributeType: 'S' },
        { AttributeName: 'GSI5SK', AttributeType: 'S' },
        { AttributeName: 'GSI6PK', AttributeType: 'S' },
        { AttributeName: 'GSI6SK', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI3',
          KeySchema: [
            { AttributeName: 'channelArn', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI4',
          KeySchema: [
            { AttributeName: 'stageArn', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI5',
          KeySchema: [
            { AttributeName: 'GSI5PK', KeyType: 'HASH' },
            { AttributeName: 'GSI5SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI6',
          KeySchema: [
            { AttributeName: 'GSI6PK', KeyType: 'HASH' },
            { AttributeName: 'GSI6SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    },
  ],
  port: 8000,
};
