// const debianBase = pulumi.output(
//   gcp.compute.getImage({
//     family: "debian-9",
//     project: "debian-cloud"
//   })
// );

// const firstInstance = new gcp.compute.Instance(
//   "firstInstance",
//   {
//     bootDisk: {
//       initializeParams: {
//         image: debianBase.selfLink
//       }
//     },
//     networkInterfaces: [
//       {
//         accessConfigs: [{}],
//         network: "default"
//       }
//     ],
//     machineType: "n1-standard-8",
//     zone,
//     name: "first-instance",
//     project: pulumiFirstProject.id
//   },
//   {
//     dependsOn: projectComputeServices
//   }
// );

// exports.firstInstanceName = firstInstance.name;
