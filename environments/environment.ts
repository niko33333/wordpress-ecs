let environment: {
	name: string;
	project: string;
	accountId: string;
	region: string;
	repository: {
		arn: string;
		branch: string;
	};
	infrastructurePipeline: boolean;
	costAccount: string;
	privateHostedZoneName: string;
	networkConfiguration: {
		cidr: string;
		numberOfNat: number;
		subnetMask: number
	};
	rdsConfiguration: any;
	ecsConfiguration: {
		serviceName: string;
		cpu: number;
		memory: number;
		min: number;
		max: number;
		port: number;
	};
	[key: string]: any;
};

// handling sandbox environment using dev as default
try {
	/* eslint-disable @typescript-eslint/no-var-requires */
	environment = require(`./environment.${process.env.ENVIRONMENT_NAME}`).environment;
} catch (e) {
	/* eslint-disable @typescript-eslint/no-var-requires */
	environment = require('./environment.dev').environment;
}

export {environment};
