import { Construct } from 'constructs';
import { CustomVpc } from './nested/vpc.stack';
import { environment } from '../environments/environment';
import { RdsStack } from './nested/rds.stack';
import { ApplicationStack } from './nested/application.stack';
import { Stack, StackProps } from 'aws-cdk-lib';
import { rdsCapacityMap } from '../utils/database.map';
import path = require('path');
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { EcsPipelineStack } from './nested/ecs-pipeline.stack';


export class WordpressStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const prefix = `${environment.name}-${environment.project}`;
    const partialProps = {
			tags: {
				Environment: environment.name,
				CostAccount: environment.costAccount,
			}
		}

    const vpcStack = new CustomVpc(this, 'NetworkStack', {
      cidr: environment.networkConfiguration.cidr,
      prefix: prefix,
      subnetsMask: environment.networkConfiguration.subnetMask,
      numberOfNat: environment.networkConfiguration.numberOfNat,
      ...partialProps
    })

    const vpc = vpcStack.getCDKVpc(this);
    const {publicSubnets, privateSubnets, isolatedSubnets} = vpcStack.getCDKVpcSubnet(this);

    const privateZone = new HostedZone(this, `PrivateHostedZone`,
      {
        zoneName: environment.privateHostedZoneName,
        vpcs: [vpc]
      }
    );
    const databaseStack = new RdsStack(this, 'RdsStack', {
      prefix: prefix,
      vpc: vpc,
      subnets: isolatedSubnets,
      serverlessConfiguration: environment.name == 'prod' ? undefined : {
        autoPauseDuration: environment.rdsConfiguration.autoPause,
        minCapacity: rdsCapacityMap[environment.rdsConfiguration.min],
        maxCapacity: rdsCapacityMap[environment.rdsConfiguration.max]
      },
      serverfullConfiguration: environment.name == 'prod' ? {
        azNumber: environment.rdsConfiguration.azNumber,
        instanceType: environment.rdsConfiguration.instanceType
      } : undefined,
      privateHostedZone: privateZone,
      deletionProtection: environment.name == 'prod' ? true : false,
      ...partialProps
    })

    const applicationStack = new ApplicationStack(this, 'ApplicationStack', {
      prefix: prefix,
      vpc: vpc,
      publicSubnets: publicSubnets,
      privateSubnets: privateSubnets,
      dbSecurityGroup: databaseStack.databaseSecurityGroup,
      databaseSecret: databaseStack.databaseSecret,
      dbEndpoint: databaseStack.dbCnameRecord.domainName,
      dockerImagePath: path.join(__dirname, '../wordpress'),
      ecsConfiguration: environment.ecsConfiguration,
      autoDeleteLogBucket: environment.name == 'prod' ? false : true,
      ...partialProps
    });

    const ecsPipelineStack = new EcsPipelineStack(this, 'EcsPipelineStack', {
      prefix: prefix,
      repository: environment.repository,
      ecsService: applicationStack.ecsService,
      ecrRepository: applicationStack.ecrRepository,
      containerName: applicationStack.container.containerName
    })
  }
}
