import {
    Fn,
    NestedStack,
    NestedStackProps,
    Stack,
    Tags
} from "aws-cdk-lib";
import { CfnEIP, CfnInternetGateway, CfnNatGateway, CfnRoute, CfnRouteTable, CfnSubnet, CfnSubnetRouteTableAssociation, CfnVPC, CfnVPCGatewayAttachment, ISubnet, IVpc, Subnet, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { CustomSubnetType } from "../../utils/network.enum";

export interface VpcProps extends NestedStackProps {
    prefix: string
    cidr: string;
    subnetsMask: number;
    numberOfNat: number;
}


export class CustomVpc extends NestedStack {
    private _vpc: CfnVPC;
    private _igw: CfnInternetGateway;
    private _isolatedSubnets: CfnSubnet[] = [];
    private _privateSubnets: CfnSubnet[] = [];
    private _publicSubnets: CfnSubnet[] = [];
    private _routeTablePublic: CfnRouteTable[] = [];
    private _routeTablePrivate: CfnRouteTable[] = [];
    private _routeTableIsolated: CfnRouteTable[] = [];
    private _natGwList: CfnNatGateway[] = [];

    constructor(scope: Construct, id: string, props: VpcProps) {
        
        super(scope, id);
        const azs = Stack.of(this).availabilityZones;
        this._vpc = this.createVpc(props.prefix, props.cidr);
        this._publicSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[0], 0, 16, CustomSubnetType.PUBLIC));
        this._publicSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[1], 1, 16, CustomSubnetType.PUBLIC));
        this._publicSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[2], 2, 16, CustomSubnetType.PUBLIC));
        this._privateSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[0], 4, 16, CustomSubnetType.PRIVATE));
        this._privateSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[1], 5, 16, CustomSubnetType.PRIVATE));
        this._privateSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[2], 6, 16, CustomSubnetType.PRIVATE));
        this._isolatedSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[0], 8, 16, CustomSubnetType.ISOLATED));
        this._isolatedSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[1], 9, 16, CustomSubnetType.ISOLATED));
        this._isolatedSubnets.push(this.generateSubnet(props.prefix, this._vpc.ref, props.cidr, 24, azs[2], 10, 16, CustomSubnetType.ISOLATED));
        this._igw = this.createIgw(props.prefix, this._vpc);
        for (let index = 0; index < props.numberOfNat; index++) {
            this._natGwList.push(this.createNatGateway(props.prefix, this._publicSubnets, 0));
        }
        this._routeTablePublic.push(this.createRouteTable(props.prefix, this._vpc, CustomSubnetType.PUBLIC, this._publicSubnets, 0));
        this._routeTableIsolated.push(this.createRouteTable(props.prefix, this._vpc, CustomSubnetType.ISOLATED, this._isolatedSubnets, 0));

        if (this._natGwList.length > 1) {
            for (let idx = 0; idx < this._natGwList.length; idx++) {
                this._routeTablePrivate.push(this.createRouteTable(props.prefix, this._vpc, CustomSubnetType.PRIVATE, this._privateSubnets.slice(idx, idx+1), idx, this._natGwList[idx]));
            }
        } else {
            this._routeTablePrivate.push(this.createRouteTable(props.prefix, this._vpc, CustomSubnetType.PRIVATE, this._privateSubnets, 0, this._natGwList[0]));
        }

    }

    private createVpc(prefix: string, cidr: string) {
        const vpc = new CfnVPC(this, 'Vpc', {
            cidrBlock: cidr,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            tags: [
                {
                    key: `Name`,
                    value: `${prefix}-vpc`
                }
            ]
        });

        return vpc;
    }

    private generateSubnet(prefix: string, vpcId: string, vpcCidrBlock: string, subnetMask: number, azName: string, subnetSelector: number, subnetNumberLimit: number, type: CustomSubnetType): CfnSubnet {

        const subnet = new CfnSubnet(this, `${type}Subnet${azName}`, {
            vpcId,
            availabilityZone: azName,
            cidrBlock: Fn.select(subnetSelector, Fn.cidr(vpcCidrBlock, subnetNumberLimit, (32 - subnetMask).toString())),
            mapPublicIpOnLaunch: type === 'public' ? true : false,
        })       
        Tags.of(subnet).add(
            "Name",
            `${prefix}-${type}-subnet-${azName.slice(-2)}`,
        );
        return subnet

    }

    private createIgw(prefix: string, vpc: CfnVPC): CfnInternetGateway {
        const igw = new CfnInternetGateway(this, `InternetGateway`)
            
        new CfnVPCGatewayAttachment(this, `VpcGatewayAttachment`, {
            vpcId : vpc.attrVpcId,
            internetGatewayId : igw.attrInternetGatewayId
        }) 

        Tags.of(igw).add(
            "Name",
            `${prefix}-igw`
        )
        return igw;
    }

    private createNatGateway(prefix: string, publicSubnets: CfnSubnet[], subnetSelector: number): CfnNatGateway {
        const eip = new CfnEIP(this, `NatEip${subnetSelector}`)

        Tags.of(eip).add(
            `Name`, `${prefix}-nat-gw-eip-${publicSubnets[subnetSelector].attrAvailabilityZone}`
        )

        const natgw = new CfnNatGateway(this, `NatGateway${subnetSelector}`, {
            subnetId: publicSubnets[subnetSelector].attrSubnetId,
            allocationId: eip.attrAllocationId
        })

        Tags.of(natgw).add(
            `Name`, `${prefix}-nat-gateway-${publicSubnets[subnetSelector].attrAvailabilityZone}`
        )

        return natgw;
    }

    private createRouteTable(prefix: string, vpc: CfnVPC, type: CustomSubnetType, subnetList: CfnSubnet[], idx?: number, nat?: CfnNatGateway): CfnRouteTable {
        const routeTable = new CfnRouteTable(this, `${type}RouteTable${idx}`, {
            vpcId: vpc.attrVpcId,
            tags: [
                {
                    key: `Name`,
                    value:  nat ? `${prefix}-${type}-rt-${idx}` : `${prefix}-${type}-rt`
                }
            ]
        })
        if (type === CustomSubnetType.PUBLIC) {
            new CfnRoute(this, `PublicRoute`, {
                routeTableId: routeTable.attrRouteTableId,
                destinationCidrBlock: "0.0.0.0/0",
                gatewayId: this._igw.attrInternetGatewayId
            })
        } 
        if (type === CustomSubnetType.PRIVATE && nat) {
            new CfnRoute(this, `PublicRoute${idx}`, {
                routeTableId: routeTable.attrRouteTableId,
                destinationCidrBlock: "0.0.0.0/0",
                natGatewayId: nat.attrNatGatewayId
            })
        }

        subnetList.forEach((subnet, idx) => {
            new CfnSubnetRouteTableAssociation(this, `${type}RouteTableAssociation${idx}`, {
                routeTableId: routeTable.attrRouteTableId,
                subnetId: subnet.attrSubnetId
            })
        })

        return routeTable
    }

    public getCDKVpc = (scope: Construct) : IVpc => {

        return Vpc.fromVpcAttributes(scope, `VPC`, {
            availabilityZones: Stack.of(this).availabilityZones,
            vpcId: this._vpc.attrVpcId
        });

    };

    public getCDKVpcSubnet = (scope: Construct) : {publicSubnets: ISubnet[], privateSubnets: ISubnet[], isolatedSubnets: ISubnet[]} => {
        const publicSubnetsIds = this._publicSubnets.map(subnet => subnet.attrSubnetId)
        const privateSubnetsIds = this._privateSubnets.map(subnet => subnet.attrSubnetId)
        const isolatedSubnetsIds = this._isolatedSubnets.map(subnet => subnet.attrSubnetId)

        const publicSubnets = publicSubnetsIds.map((s: string): ISubnet => {
            return Subnet.fromSubnetAttributes(scope, s, {
                subnetId: s
            })
        })
        const privateSubnets = privateSubnetsIds.map((s: string): ISubnet => {
            return Subnet.fromSubnetAttributes(scope, s, {
                subnetId: s
            })
        })
        const isolatedSubnets = isolatedSubnetsIds.map((s: string): ISubnet => {
            return Subnet.fromSubnetAttributes(scope, s, {
                subnetId: s
            })
        })
        return {
            publicSubnets: publicSubnets,
            privateSubnets: privateSubnets,
            isolatedSubnets: isolatedSubnets
        }

    };
    
}

