export const environment = {
	name: 'dev',
	project: 'exprj',
	accountId: '364050767034', // use your account ID
	region: 'eu-central-1', // select the region in which you want to deploy the infrastructure
	repository: {
		arn: "arn:aws:codecommit:eu-central-1:364050767034:wordpress-ecs",
		branch: "develop",
	},
	infrastructurePipeline: true,
	costAccount: "dev",
	privateHostedZoneName: "dev.wp.internal",
	networkConfiguration: {
		cidr: '10.230.0.0/16',
		numberOfNat: 1,
		subnetMask: 24
	},
	rdsConfiguration: {
		min: 1,
		max: 2,
		autoPause: 10
	},
	ecsConfiguration: {
		serviceName: 'wordpress',
		cpu: 512,
		memory: 1024,
		min: 1,
		max: 1,
		port: 80
	},
	...process.env,
};
