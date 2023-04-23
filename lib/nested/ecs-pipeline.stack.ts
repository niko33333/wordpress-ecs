import { Duration, NestedStack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodeBuildAction, CodeCommitSourceAction, CodeCommitSourceActionProps, CodeCommitTrigger, EcrSourceAction, EcsDeployAction, ManualApprovalAction } from "aws-cdk-lib/aws-codepipeline-actions";
import { IRepository, Repository } from 'aws-cdk-lib/aws-codecommit';
import { CfnRepository, Repository as EcrRepository } from 'aws-cdk-lib/aws-ecr';
import { BuildSpec, LinuxBuildImage, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BaseService, FargateService } from 'aws-cdk-lib/aws-ecs';
import { environment } from '../../environments/environment';

export interface EcsPipelineNestedStackProps {
    prefix: string,
    repository: any,
    ecsService: FargateService,
    ecrRepository: CfnRepository,
    containerName: string,
}

export class EcsPipelineStack extends NestedStack {

    private _pipeline: Pipeline

    constructor(scope: Construct, id: string, props: EcsPipelineNestedStackProps) {
        super(scope, id);

        const sourceOutput = new Artifact();


        const repo = EcrRepository.fromRepositoryAttributes(this, 'EcrRepository', {
            repositoryArn: props.ecrRepository.attrArn,
            repositoryName: props.ecrRepository.repositoryName!
        })
        const sourceAction = new EcrSourceAction({
            actionName: 'FetchImage',
            repository: repo,
            output: sourceOutput
        })

        const buildimageDefinitionOutput = new Artifact();
        const buildimageDefinition = new Project(this, `ImageDefinition`, {
            projectName: `${props.ecsService.serviceName}-image-definition`,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_6_0,
                privileged: true
            },
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    build: {
                        commands: [
                            `echo '[{"name": "${props.containerName}", "imageUri": "${props.ecrRepository.attrRepositoryUri}:latest"}]' > imagedefinitions.json`
                        ]
                    }
                },
                artifacts: {
                    files: ["**/*"]
                }
            })
        });

        const buildimageDefinitionAction = new CodeBuildAction({
            actionName: 'BuildimageDefinition',
            project: buildimageDefinition,
            input: sourceOutput,
            outputs: [buildimageDefinitionOutput],
        });


        const service = BaseService.fromServiceArnWithCluster(this, `EcsService`,
            `arn:aws:ecs:${environment.region}:${environment.accountId}:service/${props.ecsService.cluster.clusterName}/${props.ecsService.serviceName}`
        );

        const deployAction = new EcsDeployAction({
            actionName: 'DeployAction',
            service: service,
            input: buildimageDefinitionOutput,
            deploymentTimeout: Duration.minutes(5)
        });

        const stages = [
            {
                stageName: 'Source',
                actions: [sourceAction],
            },
            {
                stageName: 'CreateImageDefinition',
                actions: [buildimageDefinitionAction],
            },
            {
                stageName: 'Deploy',
                actions: [deployAction],
            }
        ]
        const pipelineRole = new Role(this, `PipelineRole`, {
            assumedBy: new ServicePrincipal('codepipeline.amazonaws.com'),
            roleName: `${props.ecsService.serviceName}-PipelineRole`
        })
        this._pipeline = new Pipeline(this, `Pipeline`, {
            pipelineName: `${props.ecsService.serviceName}`,
            stages: stages,
            role: pipelineRole
        });
    }

    public get pipeline(): Pipeline {
        return this._pipeline
    }

}
