import { StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { WordpressStack } from './wordpress.stack';
import { environment } from '../environments/environment';

export class PipelineStage extends Stage {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props });

    const partialProps = {
      tags: {
        Environment: environment.name,
        CostAccount: environment.costAccount,
      }
    }

    const applicationStack = new WordpressStack(this, `WordpressStack`, {
      stackName: `${environment.name}-${environment.project}-stack`,
      description: `Stack that contains the application stack for the ${environment.owner}${environment.project}-${environment.name} environment`,
      ...partialProps
    });
  }
}
