export const environment = {
	name: 'prod',
	project: 'exprj',
	accountId: 'ACCOUNT_ID',
	region: 'eu-central-1',
	repository: {
		arn: "arn:aws:codecommit:eu-central-1:ACCOUNT_ID:wordpress-ecs",
		branch: "main",
	},
	infrastructurePipeline: true,
	costAccount: "prod",
	privateHostedZoneName: "database.internal",
	networkConfiguration: {
		cidr: '10.240.0.0/16',
		numberOfNat: 3,
		subnetMask: 24
	},
	rdsConfiguration: {
		azNumber: 2,
    	instanceType: "t3.medium",
	},
	ecsConfiguration: {
		serviceName: 'wordpress',
		cpu: 512,
		memory: 1024,
		min: 2,
		max: 6,
		port: 80
	},
	...process.env,
};
