import { Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { ISubnet, IVpc, InstanceType, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Alias, Key } from "aws-cdk-lib/aws-kms";
import { AuroraCapacityUnit, AuroraMysqlEngineVersion, AuroraPostgresEngineVersion, Credentials, DatabaseCluster, DatabaseClusterEngine, DatabaseSecret, ParameterGroup, ServerlessCluster } from "aws-cdk-lib/aws-rds";
import { CnameRecord, HostedZone } from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export interface RdsStackProps extends NestedStackProps {
    prefix: string;
    vpc: IVpc;
    subnets: ISubnet[];
	serverlessConfiguration?: {
		autoPauseDuration?: number;
		minCapacity: AuroraCapacityUnit;
		maxCapacity: AuroraCapacityUnit;
	};
	serverfullConfiguration?: {
		azNumber: number;
		instanceType: string;
	};
	privateHostedZone: HostedZone,
	deletionProtection?: boolean;
}

export class RdsStack extends NestedStack {
    private _database : ServerlessCluster | DatabaseCluster;
    private _databaseSecurityGroup: SecurityGroup;
    private _databaseSecret: DatabaseSecret;
    private _kmsKey: Key;
    private _dbCnameRecord: CnameRecord;
    constructor(scope: Construct, id: string, props: RdsStackProps) {
        super(scope, id);

		this.initDatabaseConfiguration(props.prefix, props.vpc);
		if (props.serverlessConfiguration) {
			this.createRdsServerless(props.prefix, props.vpc, props.subnets, props.serverlessConfiguration, props.deletionProtection);
		} else this.createRdsServerfull(props.prefix, props.serverfullConfiguration, props.vpc, props.subnets);

		this._dbCnameRecord = this.createCnameRecord(props.privateHostedZone)
    }

	private initDatabaseConfiguration(prefix: string, vpc: IVpc) {
		this._kmsKey = new Key(this, 'AuroraKey', {});
		const alias = new Alias(this, 'AuroraKeyAlias', {
			// aliasName is required
			aliasName: `${prefix}/aurora-serverless`,
			targetKey: this._kmsKey,
		});
        this._databaseSecret = new DatabaseSecret(this, "DatabaseSecret", {
			username: "master",
			secretName: `${prefix}-database-secret`,
		});

		this._databaseSecurityGroup = new SecurityGroup(
			this,
			`DatabaseSecurityGroup`,
			{
				vpc: vpc,
				allowAllOutbound: true,
				securityGroupName: `${prefix}-database-sg`,
				description: `Security group used by Notification`,
			}
		);
	}

    private createRdsServerless(prefix: string, vpc: IVpc, subnets: ISubnet[], serverlessConfiguration: any, deletionProtection?: boolean) {

		this._database = new ServerlessCluster(this, "RDSserverlessCluster", {
			clusterIdentifier: `${prefix}-serverless-cluster`,
			engine: DatabaseClusterEngine.auroraMysql({
				version: AuroraMysqlEngineVersion.VER_2_07_1,
			}),
            defaultDatabaseName: 'wordpress',
			deletionProtection: deletionProtection || false,
			parameterGroup: ParameterGroup.fromParameterGroupName(
				this,
				"ParameterGroup",
				"default.aurora-mysql5.7"
			),
			vpc: vpc,
            vpcSubnets: {
                subnets: subnets
            },
            storageEncryptionKey: this._kmsKey,
			scaling: {
				autoPause: Duration.minutes(serverlessConfiguration.duration || 10),
				minCapacity: serverlessConfiguration.minCapacity,
				maxCapacity: serverlessConfiguration.maxCapacity,
			},
			credentials: Credentials.fromSecret(this._databaseSecret),
			securityGroups: [this._databaseSecurityGroup],
		});
    }

	private createRdsServerfull(prefix: string, serverfullConfiguration: any, vpc: IVpc, subnets: ISubnet[], deletionProtection?: boolean) {
		this._database = new DatabaseCluster(this, 'RdsServerfullCluster', {
			engine: DatabaseClusterEngine.auroraMysql({version: AuroraMysqlEngineVersion.VER_2_11_1}),
			clusterIdentifier: `${prefix}-serverfull-cluster`,
			instances: serverfullConfiguration.azNumber,
			defaultDatabaseName: "wordpress",
			instanceProps: {
				vpc: vpc,
				vpcSubnets: {
					subnets
				},
				instanceType: new InstanceType(serverfullConfiguration.instanceType)
			},
			cloudwatchLogsExports: ["error", "slowquery"],
			instanceIdentifierBase: `${prefix}-serverfull-cluster`,
			deletionProtection: deletionProtection || false,
			storageEncryptionKey: this._kmsKey
		})
	}

	private createCnameRecord(hostedzone: HostedZone) {
		return new CnameRecord(this, 'CnameDbRecord', {
			zone: hostedzone,
			domainName: this._database.clusterEndpoint.hostname,
			recordName: 'db'
		})
	}

    get database(): ServerlessCluster | DatabaseCluster {
        return this._database;
    }

    get databaseSecurityGroup(): SecurityGroup {
        return this._databaseSecurityGroup;
    }

    get databaseSecret(): DatabaseSecret {
        return this._databaseSecret;
    }

    get kmsKey(): Key {
        return this._kmsKey;
    }

    get dbCnameRecord(): CnameRecord {
        return this._dbCnameRecord;
    }
}