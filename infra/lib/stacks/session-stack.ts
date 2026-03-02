import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * SessionStack - DynamoDB table for session management and resource pool
 *
 * Single-table design with:
 * - PK/SK for primary access patterns
 * - GSI1 for status-based queries (e.g., finding AVAILABLE resources)
 */
export class SessionStack extends Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Single table for sessions and resource pool items
    this.table = new dynamodb.Table(this, 'SessionTable', {
      tableName: 'vnl-sessions',
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: false,
    });

    // GSI1 for status-based queries
    // Example: Query all AVAILABLE resources by setting GSI1PK=STATUS#AVAILABLE
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new CfnOutput(this, 'SessionTableName', {
      value: this.table.tableName,
    });
  }
}
