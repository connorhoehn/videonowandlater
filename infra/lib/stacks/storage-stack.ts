import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

/**
 * StorageStack — long-lived S3 buckets and CloudFront distribution.
 *
 * Separated from SessionStack so that bucket policies survive failed
 * deployments.  SessionStack frequently changes (Lambdas, IVS, SQS, etc.)
 * and any mid-create rollback orphans the CDK-managed BucketPolicy on S3,
 * blocking the next deploy.  Keeping buckets here avoids that entirely.
 */
export class StorageStack extends Stack {
  public readonly recordingsBucket: s3.Bucket;
  public readonly transcriptionBucket: s3.Bucket;
  public readonly cloudfrontDomainName: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 bucket for session recordings
    this.recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      bucketName: `vnl-recordings-${this.stackName.toLowerCase()}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
    });

    // S3 bucket for transcription pipeline (MediaConvert input/output and Transcribe outputs)
    this.transcriptionBucket = new s3.Bucket(this, 'TranscriptionBucket', {
      bucketName: `vnl-transcription-${this.stackName.toLowerCase()}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 lifecycle rule for orphaned multipart uploads (clean up after 24 hours)
    this.recordingsBucket.addLifecycleRule({
      id: 'AbortIncompleteMultipartUploads',
      abortIncompleteMultipartUploadAfter: Duration.days(1),
      prefix: 'uploads/',
    });

    // CloudFront CORS policy for HLS playback
    const recordingsCorsPolicy = new cloudfront.ResponseHeadersPolicy(this, 'RecordingsCorsPolicy', {
      corsBehavior: {
        accessControlAllowOrigins: ['*'],
        accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
        accessControlAllowHeaders: ['*'],
        accessControlExposeHeaders: ['*'],
        accessControlAllowCredentials: false,
        originOverride: true,
      },
      comment: 'CORS headers for IVS Player HLS requests',
    });

    // CloudFront distribution for secure recording playback
    const distribution = new cloudfront.Distribution(this, 'RecordingsDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.recordingsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: recordingsCorsPolicy,
      },
      comment: 'CloudFront distribution for VNL session recordings',
    });

    this.cloudfrontDomainName = distribution.distributionDomainName;

    new CfnOutput(this, 'RecordingsDomain', {
      value: distribution.distributionDomainName,
      exportName: 'vnl-recordings-domain',
      description: 'CloudFront domain for session recordings',
    });
  }
}
