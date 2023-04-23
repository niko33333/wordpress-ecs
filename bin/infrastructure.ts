#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WordpressStack } from '../lib/wordpress.stack';
import { environment } from '../environments/environment';
import { PipelineStack } from '../lib/pipeline.stack';

const app = new cdk.App();
const partialProps = {
	tags: {
		Environment: environment.name,
		CostAccount: environment.costAccount,
	}
}

if (environment.infrastructurePipeline) {
	new PipelineStack(app, `${environment.name}${environment.project}Pipeline`, {
		stackName: `${environment.name}-${environment.project}-infrastructure-pipeline`,
		description: `${environment.name} ${environment.project} infrastructure pipeline`,
		env: { 
		  account: environment.accountId, 
		  region: environment.region
		},
		...partialProps
	});
} else {
	new WordpressStack(app, `${environment.name}${environment.project}WordpressStack`, {
		  stackName: `${environment.name}-${environment.project}-stack`,
		description: `${environment.name} Wordpress Stack`,
		env: {
			region: environment.region,
			account: environment.accountId,
		},
		...partialProps
	})
}
