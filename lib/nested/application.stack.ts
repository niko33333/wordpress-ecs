import { Duration, NestedStack, NestedStackProps, RemovalPolicy, Tags } from "aws-cdk-lib";
import { CfnSecurityGroupIngress, ISubnet, IVpc, Peer, Port, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { CfnRepository } from "aws-cdk-lib/aws-ecr";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import { AwsLogDriver, Cluster, ContainerDefinition, ContainerImage, DeploymentControllerType, FargateService, FargateTaskDefinition, Protocol, Secret } from "aws-cdk-lib/aws-ecs";
import { FileSystem, PerformanceMode } from "aws-cdk-lib/aws-efs";
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, ListenerAction, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Alias, Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { DatabaseSecret } from "aws-cdk-lib/aws-rds";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as ecrdeploy from 'cdk-ecr-deployment';

export interface ApplicationStackProps extends NestedStackProps {
    prefix: string;
    vpc: IVpc;
    publicSubnets: ISubnet[];
    privateSubnets: ISubnet[];
    dbSecurityGroup: SecurityGroup;
    databaseSecret: DatabaseSecret;
    dbEndpoint: string;
    dockerImagePath: string;
    ecsConfiguration: any;
    autoDeleteLogBucket?: boolean;
}

export class ApplicationStack extends NestedStack {
    private _alb: ApplicationLoadBalancer;
    private _accessLogBucket: Bucket;
    private _albSg: SecurityGroup;
    private _efsSg: SecurityGroup;
    private _ecsSg: SecurityGroup;
    private _ecsTg: ApplicationTargetGroup;
    private _efs: FileSystem;
    private _cluster: Cluster;
    private _ecsExecutionRole: Role;
    private _ecsTaskDefRole: Role;
    private _taskDefinition: FargateTaskDefinition;
    private _ecsService: FargateService;
    private _ecrRepository: CfnRepository;
    private _serviceName: string;
    private _container: ContainerDefinition;

    constructor(scope: Construct, id: string, props: ApplicationStackProps) {
        super(scope, id)

        this._accessLogBucket = new Bucket(this, 'AccessLogBucket', {
            bucketName: `${props.prefix}-access-log`,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            autoDeleteObjects: props.autoDeleteLogBucket || false,
            removalPolicy: props.autoDeleteLogBucket == true ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN
        })

        this._albSg = new SecurityGroup(this, 'AlbSg', {
            securityGroupName: `${props.prefix}-alb-sg`,
            vpc: props.vpc
        })
        this._serviceName = `${props.prefix}-${props.ecsConfiguration.serviceName}-service`;
        this._alb = this.createAlb(props.prefix, props.vpc, props.publicSubnets, this._accessLogBucket, this._albSg);
        this._ecsSg = this.createEcsSecurityGroup(props.prefix, this._serviceName, this._albSg, props.vpc);
        new CfnSecurityGroupIngress(this, 'MysqlInbound', {
            ipProtocol: 'tcp',
            description: 'Inbound traffic from ECS to RDS Mysql',
            fromPort: 3306,
            groupId: props.dbSecurityGroup.securityGroupId,
            sourceSecurityGroupId: this._ecsSg.securityGroupId,
            toPort: 3306,
        });
        this._efs = this.createEfs(props.prefix, props.vpc, props.privateSubnets, this._ecsSg);

        
        this._ecrRepository = this.createEcrRepository(props.prefix, this._serviceName);
        const image = new DockerImageAsset(this, 'CDKDockerImage', {
            directory: props.dockerImagePath
        });
        new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
            src: new ecrdeploy.DockerImageName(image.imageUri),
            dest: new ecrdeploy.DockerImageName(this._ecrRepository.attrRepositoryUri),
        });

        this.createEcs(props.prefix, props.vpc, props.privateSubnets, this._serviceName, props.databaseSecret, this._efs, props.dbEndpoint, props.ecsConfiguration);
        this._ecsTg = this.createTargetGroup(props.prefix, props.vpc, props.ecsConfiguration.port, this._ecsService);
        this._alb.addListener("PrivateHTTPListener", {
            port: 80,
            defaultAction: ListenerAction.forward([this._ecsTg])
        });
        this.createAutoscaling(this._ecsService, props.ecsConfiguration);
    }

    private createAlb(prefix: string, vpc: IVpc, subnets: ISubnet[], bucket: Bucket, securityGroup: SecurityGroup): ApplicationLoadBalancer {
        const alb =  new ApplicationLoadBalancer(this, `PublicAlb`, {
            vpc: vpc,
            vpcSubnets: {
              subnets: subnets
            },
            internetFacing: true,
            securityGroup: securityGroup,
            loadBalancerName: `${prefix}-alb`
        })
        alb.logAccessLogs(bucket);
        return alb;
    }

    private createEfs(prefix: string, vpc: IVpc, subnets: ISubnet[], ecsSg: SecurityGroup): FileSystem {
        this._efsSg = new SecurityGroup(this, `EfsSecurityGroup`, {
            vpc: vpc,
            securityGroupName: `${prefix}-efs-sg`
        });

        this._efsSg.addIngressRule(Peer.securityGroupId(ecsSg.securityGroupId), Port.tcp(2049));

        const efsKey = new Key(this, 'EfsKey', {});
        new Alias(this, 'EfsKeyAlias', {
            aliasName: `${prefix}/efs`,
            targetKey: efsKey,
        });
        Tags.of(efsKey).add(
            'Name', `${prefix}/efs`
        )

        const file_system = new FileSystem(this, `Efs`, {
            fileSystemName: `${prefix}-efs`,
            vpc: vpc,
            vpcSubnets: {
                subnets: subnets
            },
            encrypted: true,
            kmsKey: efsKey,
            performanceMode: PerformanceMode.GENERAL_PURPOSE,
            securityGroup: this._efsSg
        });

        return file_system
    }

    private createEcrRepository(prefix: string, serviceName: string): CfnRepository {

        const ecrKey = new Key(this, 'EcrKey', {});
        new Alias(this, 'EcrKeyAlias', {
            aliasName: `${prefix}/ecr`,
            targetKey: ecrKey,
        });
        Tags.of(ecrKey).add(
            'Name', `${prefix}/ecr`
        )
        return new CfnRepository(this, 'EcrRepository', {
            encryptionConfiguration: {
                encryptionType: 'KMS',
                kmsKey: ecrKey.keyId,
            },
            repositoryName: serviceName
        });
    }

    private createTargetGroup(prefix: string, vpc: IVpc, port: number, ecsService: FargateService): ApplicationTargetGroup {
        const targetGroup = new ApplicationTargetGroup(this, `EcsTargetGroup`, {
            targetGroupName: `${prefix}-ecs-tg`,
            targetType: TargetType.IP,
            port: port,
            protocol: ApplicationProtocol.HTTP,
            vpc: vpc,
            targets: [ecsService.loadBalancerTarget({
                containerName: 'wordpress',
                containerPort: port
            })],
            deregistrationDelay: Duration.seconds(30)
        })
        targetGroup.configureHealthCheck({
            timeout: Duration.seconds(15),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 3,
            port: String(port),
            healthyHttpCodes: '200-399'
        });
        return targetGroup
    }

    private createEcsSecurityGroup(prefix: string, serviceName: string, albSg: SecurityGroup, vpc: IVpc): SecurityGroup {

        const securityGroup = new SecurityGroup(this, 'EcsSecurityGroup', {
            description: `${prefix} security group for ecs ${serviceName}`,
            securityGroupName: `${serviceName}-ecs-sg`,
            vpc: vpc,
        });
        Tags.of(securityGroup).add(
            'Name', `${serviceName}-ecs-sg`
        )

        securityGroup.addIngressRule(albSg, Port.tcp(80), 'Inbound traffic from ALB')
        return securityGroup
    }

    private createEcs(prefix: string, vpc: IVpc, subnets: ISubnet[], serviceName: string, databaseSecret: DatabaseSecret, efs: FileSystem, dbHost: string, ecsConfiguration: any) {
        this._cluster = new Cluster(this, 'Cluster', {
            clusterName: `${prefix}-cluster-ecs`,
            vpc: vpc
        });
        
        const {executionRole, taskDefRole} = this.createEcsRoles(prefix, serviceName);
        this._ecsExecutionRole = executionRole;
        this._ecsTaskDefRole = taskDefRole;

        const volume = {
            name: 'efs-wp',
            efsVolumeConfiguration: {
                fileSystemId: efs.fileSystemId,
                transitEncryption: 'ENABLED'
            }
        }

        this._taskDefinition = new FargateTaskDefinition(this, `TaskDefinition`,{
            family: `${prefix}-task-def`,
            executionRole: this._ecsExecutionRole,
            taskRole: this._ecsTaskDefRole,
            memoryLimitMiB: ecsConfiguration.memory,
            cpu: ecsConfiguration.cpu,
            volumes: [volume]
        })

        this._ecsService = new FargateService(this, `EcsService`, {
            serviceName: serviceName,
            cluster: this._cluster,
            taskDefinition: this._taskDefinition,
            vpcSubnets: {
                subnets: subnets
            },
            deploymentController: {
                type: DeploymentControllerType.ECS
            },
            securityGroups: [this._ecsSg]
        });

        const logGroup = new LogGroup(this, 'EcsLoggroup', {
            logGroupName: serviceName,
            removalPolicy: RemovalPolicy.RETAIN,
            retention: RetentionDays.SIX_MONTHS
        });

        this._container = this._taskDefinition.addContainer(`ContainerApplication`, {
            image: ContainerImage.fromRegistry(`${this._ecrRepository.attrRepositoryUri}:latest`),
            environment: {
                WORDPRESS_DB_HOST: dbHost,
            },
            secrets: {
                WORDPRESS_DB_PASSWORD: Secret.fromSecretsManager(databaseSecret, 'password'),
                WORDPRESS_DB_USER:Secret.fromSecretsManager(databaseSecret, 'username'),
                WORDPRESS_DB_NAME: Secret.fromSecretsManager(databaseSecret, 'dbname'),
            },
            portMappings: [{
                containerPort: ecsConfiguration.port,
                protocol: Protocol.TCP
            }],
            containerName: 'wordpress',
            logging: new AwsLogDriver({
                logGroup: logGroup,
                streamPrefix: serviceName
            })
        });
        this._container.addMountPoints({
            containerPath: "/var/www/html/wp-content",
            sourceVolume: volume.name,
            readOnly: false
        });
    }

    private createAutoscaling(ecsService: FargateService, ecsConfiguration: any) {
        const ecsAsg = ecsService.autoScaleTaskCount({ minCapacity: ecsConfiguration.min, maxCapacity: ecsConfiguration.max })
        ecsAsg.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 75,
            scaleInCooldown: Duration.seconds(60),
            scaleOutCooldown: Duration.seconds(60)
        });
    }

    private createEcsRoles(prefix: string, serviceName: string): { executionRole: Role, taskDefRole: Role } {
        const executionRole = new Role(this, `EcsExecutionRole`, {
            roleName: `${serviceName}-ecs-exec-role`,
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceRole')
            ],
        });

        const taskDefRole = new Role(this, `EcsTaskRole`, {
            roleName: `${serviceName}-ecs-task-role`,
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceRole')
            ]
        });

        return {
            executionRole, 
            taskDefRole
        }
    }

    get ecrRepository(): CfnRepository {
        return this._ecrRepository;
    }

    get ecsService(): FargateService {
        return this._ecsService;
    }

    get serviceName(): string {
        return this._serviceName;
    }

    get container(): ContainerDefinition {
        return this._container;
    }
}