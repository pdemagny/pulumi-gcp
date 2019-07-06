const pulumi = require("@pulumi/pulumi");
const gcp = require("@pulumi/gcp");
require("dotenv").config();

const hostProjectName = "pulumi-host1";
const hostProjectId = `${hostProjectName}-96yz79`;
const serviceProjectName = "pulumi-service1";
const serviceProjectId = `${serviceProjectName}-56er45`;
const orgId = process.env.GCP_ORGANIZATION_ID;
const billingAccount = process.env.GCP_BILLING_ACCOUNT;
const zone = "europe-west1-b";
const region = "europe-west1";
const enabledServices = [
  "oslogin.googleapis.com",
  "bigquery-json.googleapis.com",
  "containerregistry.googleapis.com",
  "pubsub.googleapis.com",
  "compute.googleapis.com",
  "deploymentmanager.googleapis.com",
  "replicapool.googleapis.com",
  "replicapoolupdater.googleapis.com",
  "resourceviews.googleapis.com",
  "container.googleapis.com",
  "storage-api.googleapis.com",
  "logging.googleapis.com",
  "monitoring.googleapis.com",
  "cloudbilling.googleapis.com",
  "sqladmin.googleapis.com",
  "redis.googleapis.com",
  "storage-component.googleapis.com",
  "cloudtrace.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com"
];
const masterAuthorizedNetworksConfigCidrBlocks = [
  {
    cidrBlock: process.env.HOME_CIDR_BLOCK,
    displayName: "Home"
  }
];

// Create projects
const hostProject = new gcp.organizations.Project("hostProject", {
  name: hostProjectName,
  orgId,
  billingAccount,
  projectId: hostProjectId,
  autoCreateNetwork: false
});

const serviceProject = new gcp.organizations.Project("serviceProject", {
  name: serviceProjectName,
  orgId,
  billingAccount,
  projectId: serviceProjectId,
  autoCreateNetwork: false
});

// Enable Google API/Services
const hostProjectEnabledServices = new gcp.projects.Services(
  "hostProjectEnabledServices",
  {
    project: hostProject.projectId,
    services: enabledServices
  }
);

const serviceProjectEnabledServices = new gcp.projects.Services(
  "serviceProjectEnabledServices",
  {
    project: serviceProject.projectId,
    services: enabledServices
  }
);

// Create Shared Vpc
const sharedVpcHostProject = new gcp.compute.SharedVPCHostProject(
  "sharedVpcHostProject",
  {
    project: hostProject.projectId
  },
  {
    dependsOn: hostProjectEnabledServices
  }
);

const sharedVpcServiceProject = new gcp.compute.SharedVPCServiceProject(
  "sharedVpcServiceProject",
  {
    hostProject: hostProject.projectId,
    serviceProject: serviceProject.projectId
  },
  {
    dependsOn: [sharedVpcHostProject, serviceProjectEnabledServices]
  }
);

// Create Vpc Network in Shared Vpc Host Project
const vpcHostNetwork = new gcp.compute.Network("vpcHostNetwork", {
  name: "vpc-hostnetwork1",
  project: hostProject.projectId,
  autoCreateSubnetworks: false,
  deleteDefaultRoutesOnCreate: true,
  routingMode: "GLOBAL"
});

// Create Vpc Subnetwork in Shared Vpc Host Project's Network
const vpcHostSubnetwork = new gcp.compute.Subnetwork("vpcHostSubnetwork", {
  name: "service1-subnet1",
  project: hostProject.projectId,
  region,
  ipCidrRange: "10.42.0.0/16",
  network: vpcHostNetwork.selfLink,
  enableFlowLogs: true,
  privateIpGoogleAccess: true,
  secondaryIpRanges: [
    {
      ipCidrRange: "10.44.0.0/16",
      rangeName: "secondary-range-pods"
    },
    {
      ipCidrRange: "10.45.0.0/16",
      rangeName: "secondary-range-services"
    }
  ]
});

// Configure serviceProject's Service Accounts
const serviceProjectDefaultServiceAccount = pulumi.output(
  gcp.compute.getDefaultServiceAccount({
    project: serviceProject.projectId
  })
);

const serviceProjectServiceAccounts = [
  pulumi.interpolate`serviceAccount:${serviceProjectDefaultServiceAccount.email}`,
  pulumi.interpolate`serviceAccount:${serviceProject.number}@cloudservices.gserviceaccount.com`,
  pulumi.interpolate`serviceAccount:service-${serviceProject.number}@container-engine-robot.iam.gserviceaccount.com`
];

// Authorize serviceProject's Service Accounts
const hostProjectIAMBinding = new gcp.projects.IAMBinding(
  "hostProjectIAMBinding",
  {
    members: [
      pulumi.interpolate`serviceAccount:service-${serviceProject.number}@container-engine-robot.iam.gserviceaccount.com`
    ],
    project: hostProject.projectId,
    role: "roles/container.hostServiceAgentUser"
  },
  {
    dependsOn: hostProjectEnabledServices
  }
);

const vpcHostSubnetworkIAMBinding = new gcp.compute.SubnetworkIAMBinding(
  "vpcHostSubnetworkIAMBinding",
  {
    project: hostProject.projectId,
    region,
    members: serviceProjectServiceAccounts,
    role: "roles/compute.networkUser",
    subnetwork: vpcHostSubnetwork.name
  },
  {
    dependsOn: hostProjectEnabledServices
  }
);

// Create a Router for our hostNerwork
const vpcHostNetworkRouter = new gcp.compute.Router("vpcHostNetworkRouter", {
  name: pulumi.interpolate`${vpcHostNetwork.name}-router`,
  project: hostProject.projectId,
  region,
  bgp: {
    advertiseMode: "CUSTOM",
    advertisedGroups: ["ALL_SUBNETS"],
    asn: 65534
  },
  network: vpcHostNetwork.name
});

// Enable NAT on this Router
const vpcHostNetworkRouterNat = new gcp.compute.RouterNat(
  "vpcHostNetworkRouterNat",
  {
    name: pulumi.interpolate`${vpcHostNetworkRouter.name}-nat`,
    project: hostProject.projectId,
    region,
    router: vpcHostNetworkRouter.name,
    natIpAllocateOption: "AUTO_ONLY",
    sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES"
  }
);

const KubernetesVersion = pulumi.output(
  gcp.container.getEngineVersions({
    location: zone,
    versionPrefix: "1.13."
  })
);

const primaryCluster = new gcp.container.Cluster(
  "primaryCluster",
  {
    name: "primary-cluster",
    description: "primary-cluster",
    project: serviceProject.projectId,
    location: zone,

    initialNodeCount: 1,
    removeDefaultNodePool: true,
    nodeVersion: KubernetesVersion.latestNodeVersion,
    minMasterVersion: KubernetesVersion.latestMasterVersion,
    masterAuth: {
      clientCertificateConfig: {
        issueClientCertificate: false
      }
    },
    monitoringService: "monitoring.googleapis.com/kubernetes",
    loggingService: "logging.googleapis.com/kubernetes",

    enableKubernetesAlpha: false,
    enableLegacyAbac: false,
    enableTpu: false,

    network: vpcHostNetwork.selfLink,
    subnetwork: vpcHostSubnetwork.selfLink,
    defaultMaxPodsPerNode: "110",
    privateClusterConfig: {
      enablePrivateEndpoint: false,
      enablePrivateNodes: true,
      masterIpv4CidrBlock: "10.43.0.0/28"
    },
    ipAllocationPolicy: {
      clusterSecondaryRangeName: "secondary-range-pods",
      servicesSecondaryRangeName: "secondary-range-services",
      useIpAliases: true
    },
    masterAuthorizedNetworksConfig: {
      cidrBlocks: masterAuthorizedNetworksConfigCidrBlocks
    },
    maintenancePolicy: {
      dailyMaintenanceWindow: {
        startTime: "04:30"
      }
    },
    addonsConfig: {
      cloudrunConfig: {
        disabled: true
      },
      horizontalPodAutoscaling: {
        disabled: false
      },
      httpLoadBalancing: {
        disabled: false
      },
      istioConfig: {
        disabled: true
      },
      kubernetesDashboard: {
        disabled: true
      },
      networkPolicyConfig: {
        disabled: true
      }
    }
  },
  {
    dependsOn: [
      hostProjectEnabledServices,
      sharedVpcServiceProject,
      vpcHostSubnetworkIAMBinding
    ]
  }
);

const primaryClusterPreemptibleNodes = new gcp.container.NodePool(
  "primaryClusterPreemptibleNodes",
  {
    name: pulumi.interpolate`${primaryCluster.name}-np1`,
    project: serviceProject.id,
    cluster: primaryCluster.name,
    location: zone,
    nodeVersion: KubernetesVersion.latestNodeVersion,
    nodeConfig: {
      machineType: "n1-standard-4",
      metadata: {
        "disable-legacy-endpoints": "true"
      },
      oauthScopes: [
        "https://www.googleapis.com/auth/logging.write",
        "https://www.googleapis.com/auth/monitoring"
      ],
      preemptible: true
    },
    nodeCount: 1
  }
);

const firstBucket = new gcp.storage.Bucket("firstBucket", {
  location: "EU",
  name: pulumi.interpolate`${serviceProjectName}-first-bucket`,
  project: serviceProject.id,
  storageClass: "STANDARD"
});

exports.hostProjectId = hostProject.id;
exports.hostProjectNumber = hostProject.number;
exports.serviceProjectId = serviceProject.id;
exports.serviceProjectNumber = serviceProject.number;
exports.hostProjectEnabledServicesId = hostProjectEnabledServices.id;
exports.serviceProjectEnabledServicesId = serviceProjectEnabledServices.id;
exports.sharedVpcHostProject = sharedVpcHostProject.id;
exports.sharedVpcServiceProject = sharedVpcServiceProject.id;
exports.vpcHostNetworkId = vpcHostNetwork.id;
exports.vpcHostNetworkSelflink = vpcHostNetwork.selfLink;
exports.vpcHostSubnetworkId = vpcHostSubnetwork.id;
exports.vpcHostSubnetworkSelflink = vpcHostSubnetwork.selfLink;
exports.vpcHostSubnetworkGatewayAddress = vpcHostSubnetwork.gatewayAddress;
exports.hostProjectIAMBindingId = hostProjectIAMBinding.id;
exports.vpcHostSubnetworkIAMBindingId = vpcHostSubnetworkIAMBinding.id;
exports.vpcHostNetworkRouterId = vpcHostNetworkRouter.id;
exports.vpcHostNetworkRouterName = vpcHostNetworkRouter.name;
exports.vpcHostNetworkRouterSelflink = vpcHostNetworkRouter.selfLink;
exports.vpcHostNetworkRouterNatId = vpcHostNetworkRouterNat.id;
exports.vpcHostNetworkRouterNatName = vpcHostNetworkRouterNat.name;
exports.primaryClusterEndpoint = primaryCluster.endpoint;
exports.primaryClusterId = primaryCluster.id;
exports.primaryClusterClusterCaCertificate =
  primaryCluster.masterAuth.clusterCaCertificate;
exports.primaryClusterMasterVersion = primaryCluster.masterVersion;
exports.primaryClusterNodeVersion = primaryCluster.nodeVersion;
exports.primaryClusterPreemptibleNodesId = primaryClusterPreemptibleNodes.id;
exports.primaryClusterPreemptibleNodesInstanceGroupUrls =
  primaryClusterPreemptibleNodes.instanceGroupUrls;
exports.primaryClusterPreemptibleNodes = primaryClusterPreemptibleNodes.version;
exports.firstBucket = firstBucket.id;
exports.firstBucket = firstBucket.cors;
exports.firstBucket = firstBucket.lifecycleRules;
exports.firstBucket = firstBucket.name;
