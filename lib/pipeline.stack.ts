import {Stack} from "aws-cdk-lib";
import {CodePipeline, CodePipelineSource, ManualApprovalStep, ShellStep} from "aws-cdk-lib/pipelines";
import {Construct} from 'constructs';
import {Repository} from "aws-cdk-lib/aws-codecommit";
import { PipelineStage } from "./stage";
import { environment } from "../environments/environment";

export class PipelineStack extends Stack {

    constructor(scope: Construct, id: string, props: {}) {
        super(scope, id, { ...props });
        
        const cdkPipeline = new CodePipeline(this, `CodePipeline`, {
            pipelineName: `${environment.name}-${environment.project}-pipeline`,
            selfMutation: true,
            dockerEnabledForSynth: true,
			publishAssetsInParallel: false,
            synth: new ShellStep('Synth', {
                input: CodePipelineSource.codeCommit(
                    Repository.fromRepositoryArn(
                        this,
                        `SourceRepository`,
                        environment.repository.arn
                    ),
                    environment.repository.branch),
                env: {
                    ENVIRONMENT_NAME: environment.name
                },
                commands:  [
                    'npm ci',
                    'npx cdk synth'
                ],
            })
        });

        cdkPipeline.addStage(new PipelineStage(this, "DeploymentStage", {
            env: {
                account: environment.accountId,
                region: environment.region
            }
        }));
    };

}