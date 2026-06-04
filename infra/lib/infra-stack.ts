import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

interface InfraStackProps extends cdk.StackProps {
    envName: string;
}

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: InfraStackProps) {
        super(scope, id, props);

        // RESOURCES
        const siteBucket = new s3.Bucket(this, 'SiteBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                }
            ],
        });

        const vectorBucketName = `cookbook-${props.envName}-vectors`;
        const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
            vectorBucketName,
        });
        vectorBucket.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

        const vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
            vectorBucketName: vectorBucketName,
            indexName: 'reviews',
            dataType: 'float32',
            dimension: 1024,
            distanceMetric: 'cosine',
        });

        // OUTPUTS
        new cdk.CfnOutput(this, 'BucketName', {
            value: siteBucket.bucketName,
        });

        new cdk.CfnOutput(this, 'DistributionId', {
            value: distribution.distributionId,
        });

        new cdk.CfnOutput(this, 'VectorBucketName', {
            value: vectorBucketName,
        });

        new cdk.CfnOutput(this, 'VectorIndexName', {
            value: 'reviews',
        });
    }
}