#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();

new InfraStack(app, 'CookbookStack-Test', {
  env: { account: '558215002534', region: 'us-west-2' },
  envName: 'test',
});

new InfraStack(app, 'CookbookStack-Prod', {
  env: { account: '558215002534', region: 'us-west-2' },
  envName: 'prod',
});
