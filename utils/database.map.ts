import { AuroraCapacityUnit } from "aws-cdk-lib/aws-rds";

export const rdsCapacityMap: any = {
    '1': AuroraCapacityUnit.ACU_1,
    '2': AuroraCapacityUnit.ACU_2,
    '4': AuroraCapacityUnit.ACU_4,
    '8': AuroraCapacityUnit.ACU_8,
    '16': AuroraCapacityUnit.ACU_16,
    '32': AuroraCapacityUnit.ACU_32,
    '64': AuroraCapacityUnit.ACU_64
}