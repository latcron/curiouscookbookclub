import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import { join } from 'path';

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

        const vectorBucketName = `cookbook-${props.envName}-vectors-${this.account}`;
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
        vectorIndex.addDependency(vectorBucket);

        const searchFn = new NodejsFunction(this, 'SearchFunction', {
            entry: join(__dirname, '../../lambda/search-handler.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_24_X,
            depsLockFilePath: join(__dirname, '../../lambda/package-lock.json'),
            projectRoot: join(__dirname, '../../lambda'),
            environment: {
                VECTOR_BUCKET_NAME: vectorBucketName,
                VECTOR_INDEX_NAME: 'reviews',
            },
            bundling: {
                format: OutputFormat.ESM,
                externalModules: ['@aws-sdk/*'],
            },
        });
        searchFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`], 
        }));
        searchFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3vectors:QueryVectors'],
            resources: [`arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucketName}/index/reviews`]
        }));

        const api = new apigatewayv2.HttpApi(this, 'SearchApi', {
            corsPreflight:{
                allowOrigins: ['https://d1fv8z4s0pqtq.cloudfront.net', 'https://curiouscookbook.club'],
                allowMethods: [apigatewayv2.CorsHttpMethod.GET],
            },
        });
        const cfnStage = api.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
        cfnStage.defaultRouteSettings = {
            throttlingRateLimit: 5,
            throttlingBurstLimit: 2,
        };
        api.addRoutes({
            path: '/search',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new HttpLambdaIntegration('SearchIntegration', searchFn),
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

        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.apiEndpoint,
        });
    }
}